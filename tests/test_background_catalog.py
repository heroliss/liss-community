"""Isolated real admin workflow, native upload and additive-store acceptance."""
from contextlib import closing
import hashlib
import html
import io
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, PngImagePlugin
from flask_migrate import Migrate, upgrade
from werkzeug.datastructures import MultiDict

from app import create_app, db
from app.admin import AdminAudit, role_for
from app.background_catalog import BackgroundCatalog, MAX_UPLOAD, document
from app.models import User
from app.public_schema import migrate_background_catalog_schema
from config import TestingConfig, config


class BackgroundCatalogTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict('os.environ', {'SECRET_KEY': 'background-test-secret-'*4,
            'LISS_DATA_DIR': self.directory.name, 'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0'})
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False,
                               PUBLIC_DEMO_AUTH_LIMIT=500, PUBLIC_DEMO_WRITE_LIMIT=500)
        self.client = self.app.test_client()
        self.assertEqual(self.client.get('/').status_code, 200)
        with self.app.app_context():
            admin_role, reader_role = role_for('admin'), role_for('normal')
            admin = User(username='background_admin', name='Background Admin', password='test-password-32',
                role=admin_role, account_kind='account', confirmed=True)
            user = User(username='background_reader', name='Background Reader', password='test-password-32',
                role=reader_role, account_kind='account', confirmed=True)
            db.session.add_all([admin, user]);db.session.commit()
            self.uid = admin.id
        self.login(self.client, 'background_admin')

    def tearDown(self):
        with self.app.app_context():
            db.session.remove();db.engine.dispose()
        self.environment.stop();self.directory.cleanup()

    def csrf(self, client=None, path='/admin/'):
        response = (client or self.client).get(path)
        self.assertEqual(response.status_code, 200)
        return html.unescape(re.search(r'name="csrf_token"[^>]*value="([^"]+)"', response.get_data(as_text=True)).group(1))

    def login(self, client, name):
        response = client.post('/auth/login', data=dict(username=name, password='test-password-32',
            csrf_token=self.csrf(client, '/auth/login')))
        self.assertEqual(response.status_code, 302)

    def state(self):
        with self.app.app_context():
            row = db.session.get(BackgroundCatalog, 1)
            return row.revision, document(row)

    def form(self):
        revision, data = self.state()
        values = MultiDict(dict(kind='backgrounds', action='update', catalog_revision=str(revision),
                           random_enabled='1' if data['randomEnabled'] else '0', return_to='/admin/backgrounds'))
        values.setlist('ordered_ids', [entry['id'] for entry in data['entries']])
        values.setlist('pool_ids', data['poolIds'])
        for entry in data['entries']:
            for key in ('title', 'description'):
                values[key+'_'+entry['id']] = entry.get(key, '')
            for key in ('enabled', 'deleted'):
                values[key+'_'+entry['id']] = '1' if entry[key] else '0'
            values['palette_'+entry['id']] = entry['paletteKey']
        return values

    def post(self, path, data):
        data = data.copy()
        data['csrf_token'] = self.csrf()
        return self.client.post(path, data=data)

    def preview(self, form):
        response = self.post('/admin/preview', form)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:1500])
        token = html.unescape(re.search(r'name="token"[^>]*value="([^"]+)"', response.get_data(as_text=True)).group(1))
        return token, response

    def apply(self, token):
        return self.post('/admin/apply', dict(token=token))

    def png(self, size=(640, 400)):
        output = io.BytesIO()
        metadata = PngImagePlugin.PngInfo();metadata.add_text('Comment', 'PRIVATE_NATIVE_METADATA')
        Image.new('RGB', size, '#426a85').save(output, 'PNG', pnginfo=metadata)
        return output.getvalue()

    def upload_form(self, raw=None, filename='island.png'):
        revision, _ = self.state()
        return dict(kind='backgrounds', action='upload', catalog_revision=str(revision),
                    title='Native uploaded scene', description='A restrained native scene.', palette_key='coast',
                    include_pool='1', return_to='/admin/backgrounds', image=(io.BytesIO(raw or self.png()), filename))

    def test_public_bootstrap_authority_and_admin_permissions(self):
        payload = self.client.get('/background-catalog.json').json
        self.assertEqual(len(payload['entries']), 51)
        self.assertEqual(payload['defaultRandom'], dict(enabled=True, ids=[entry['id'] for entry in payload['entries']]))
        self.assertTrue(all(entry['paletteKey'] and entry['palette']['name'] for entry in payload['entries']))
        page = self.client.get('/').get_data(as_text=True)
        self.assertLess(page.index('window.LissBackgroundSite='), page.index('blocking="render"'))
        self.assertNotIn('_storage', page)
        outsider = self.app.test_client()
        self.assertEqual(outsider.get('/admin/backgrounds').status_code, 403)
        self.assertEqual(outsider.post('/admin/preview', data={'kind': 'backgrounds'}).status_code, 403)
        self.login(outsider, 'background_reader')
        self.assertEqual(outsider.get('/admin/backgrounds').status_code, 403)
        self.assertEqual(self.client.get('/admin/backgrounds').status_code, 200)

    def test_drawn_scenes_match_the_client_and_can_join_the_default_pool(self):
        from app.background_catalog import DRAWN_IDS
        static = Path(self.app.static_folder)
        names = re.search(r"var names=\[([^\]]+)\]", (static/'community-background-aurora-v60.js').read_text(encoding='utf-8')).group(1)
        self.assertEqual(tuple(re.findall(r"'([a-z-]+)'", names)), DRAWN_IDS)
        catalogue = (static/'community-backgrounds.js').read_text(encoding='utf-8')
        self.assertTrue(all(f"'{name}':{{id:'{name}'" in catalogue and 'randomEligible:true' in catalogue for name in DRAWN_IDS))
        page = self.client.get('/admin/backgrounds').get_data(as_text=True)
        self.assertEqual(page.count('data-scene-pool'), 32)
        self.assertIn('data-scene-id="line"', page)
        data = self.form()
        data.setlist('pool_ids', [DRAWN_IDS[0], DRAWN_IDS[3], 'no-such-scene'])
        response = self.post('/admin/preview', data)
        self.assertEqual(response.status_code, 400)
        data.setlist('pool_ids', [DRAWN_IDS[0], DRAWN_IDS[3], 'line'])
        token, response = self.preview(data)
        self.assertIn('极光夜幕', response.get_data(as_text=True))
        self.assertEqual(self.apply(token).status_code, 302)
        self.assertEqual(self.state()[1]['poolIds'], [DRAWN_IDS[0], DRAWN_IDS[3], 'line'])
        payload = self.client.get('/background-catalog.json').json
        self.assertEqual(payload['defaultRandom'], dict(enabled=True, ids=[DRAWN_IDS[0], DRAWN_IDS[3], 'line']))
        self.assertEqual(len(payload['entries']), 51)

    def test_cli_sets_drawn_default_pool_once_with_audit(self):
        from app.background_catalog import DRAWN_IDS
        revision, before = self.state()
        runner = self.app.test_cli_runner()
        self.assertNotEqual(runner.invoke(args=['background-pool']).exit_code, 0)
        self.assertEqual(self.state(), (revision, before))
        result = runner.invoke(args=['background-pool', '--drawn'])
        self.assertEqual(result.exit_code, 0, result.output)
        after_revision, after = self.state()
        self.assertEqual((after_revision, after['poolIds'], after['randomEnabled']), (revision+1, list(DRAWN_IDS), True))
        self.assertEqual(after['entries'], before['entries'])
        self.assertIn('already', runner.invoke(args=['background-pool', '--drawn']).output)
        self.assertEqual(self.state()[0], after_revision)
        with self.app.app_context():
            audit = AdminAudit.query.filter_by(action='backgrounds.update').one()
            self.assertIsNone(audit.actor_id)
            self.assertIn('默认随机名单', audit.details)

    def test_signed_update_requires_csrf_and_preserves_unedited_data(self):
        before_revision, before = self.state()
        data = self.form();name = before['entries'][0]['id']
        data['title_'+name] = 'Managed new title'
        data['anchorX_'+name] = '.2';data['anchorY_'+name] = '.65';data['mobileAnchorX_'+name] = '.8'
        self.assertEqual(self.client.post('/admin/preview', data=data).status_code, 400)
        token, _ = self.preview(data)
        self.assertEqual(self.state(), (before_revision, before))
        self.assertEqual(self.client.post('/admin/apply', data={'token': token}).status_code, 400)
        self.assertEqual(self.apply(token).status_code, 302)
        revision, after = self.state()
        self.assertEqual(revision, before_revision+1)
        self.assertEqual(after['entries'][0]['title'], 'Managed new title')
        self.assertEqual([after['entries'][0][key] for key in ('anchorX', 'anchorY', 'mobileAnchorX')], [.2, .65, .8])
        self.assertEqual(after['entries'][1:], before['entries'][1:])
        with self.app.app_context():
            self.assertEqual(AdminAudit.query.filter_by(action='backgrounds.update').count(), 1)

    def test_nonce_copied_cookie_replay_and_stale_revision_are_rejected(self):
        data = self.form();name = data.getlist('ordered_ids')[0];data['title_'+name] = 'Nonce first title'
        token, _ = self.preview(data)
        cookie_name = self.app.config['SESSION_COOKIE_NAME']
        copied = self.client.get_cookie(cookie_name).value
        self.assertEqual(self.apply(token).status_code, 302)
        self.client.set_cookie(cookie_name, copied)
        self.assertEqual(self.apply(token).status_code, 400)
        data = self.form();data['title_'+name] = 'Stale title must not save'
        token, _ = self.preview(data)
        with self.app.app_context():
            row = db.session.get(BackgroundCatalog, 1);row.revision += 1;db.session.commit()
        self.assertEqual(self.apply(token).status_code, 409)
        self.assertNotEqual(self.state()[1]['entries'][0]['title'], 'Stale title must not save')
        old = self.form();old['catalog_revision'] = '1'
        self.assertEqual(self.post('/admin/preview', old).status_code, 409)

    def test_audit_retains_metadata_order_and_equal_size_pool_changes(self):
        values = self.form()
        names = values.getlist('ordered_ids')
        values.setlist('pool_ids', [names[0]])
        token, _ = self.preview(values)
        self.assertEqual(self.apply(token).status_code, 302)
        old_title = self.state()[1]['entries'][0]['title']
        other_title = self.state()[1]['entries'][1]['title']
        values = self.form()
        values.setlist('pool_ids', [names[1]])
        values.setlist('ordered_ids', [names[1], names[0], *names[2:]])
        values['title_'+names[0]] = '<script>AUDIT_UNTRUSTED</script>'
        values['description_'+names[0]] = 'Updated public description'
        values['palette_'+names[0]] = names[1]
        values['anchorX_'+names[0]] = '.25'
        token, _ = self.preview(values)
        self.assertEqual(self.apply(token).status_code, 302)
        with self.app.app_context():
            receipt = AdminAudit.query.filter_by(action='backgrounds.update').order_by(AdminAudit.id.desc()).first()
            states = json.loads(receipt.details)
            self.assertEqual(states['before']['pool_count'], states['after']['pool_count'])
            rows = receipt.changes
            changed = {row['label']: row for row in rows}
            self.assertEqual(changed[old_title+' · 名称']['before'], old_title)
            self.assertIn('AUDIT_UNTRUSTED', changed[old_title+' · 名称']['after'])
            self.assertEqual(changed[old_title+' · 横向焦点']['after'], '25.0%')
            self.assertIn(old_title+' · 配色', changed)
            self.assertIn(old_title+' · 说明', changed)
            self.assertIn('图片排序', changed)
            self.assertIn(old_title, changed['默认随机名单']['before'])
            self.assertIn(other_title, changed['默认随机名单']['after'])
            self.assertNotIn('_storage', receipt.details)
            self.assertNotIn('_native', receipt.details)
        page = self.client.get('/admin/audit?kind=backgrounds').get_data(as_text=True)
        self.assertIn('value="backgrounds" selected', page)
        self.assertIn('查看背景图库', page)
        self.assertIn('默认随机名单', page)
        self.assertIn('&lt;script&gt;AUDIT_UNTRUSTED&lt;/script&gt;', page)
        self.assertNotIn('<script>AUDIT_UNTRUSTED</script>', page)
        search = self.client.get('/admin/audit?kind=backgrounds&q=AUDIT_UNTRUSTED').get_data(as_text=True)
        self.assertIn('&lt;script&gt;AUDIT_UNTRUSTED&lt;/script&gt;', search)

    def test_legacy_and_malformed_background_audits_remain_safe(self):
        with self.app.app_context():
            receipt = AdminAudit(target_type='backgrounds', details=json.dumps({
                'before': {'revision': 1}, 'after': {'revision': 2},
                'background_changes': [{'label': 'Known', 'before': 'A', 'after': 'B'},
                                       {'label': 'PRIVATE', 'before': {'password': 'NEVER_DISPLAY'}, 'after': 'B'},
                                       {'label': 'EXTRA', 'before': 'A', 'after': 'B', 'extra': 'NEVER_DISPLAY'}, None]}))
            self.assertEqual([row['label'] for row in receipt.changes], ['图库版本', 'Known'])
            receipt.details = json.dumps({'before': {'revision': 1}, 'after': {'revision': 2}})
            self.assertEqual(receipt.changes, [{'label': '图库版本', 'before': '1', 'after': '2'}])
            receipt.target_type = 'post'
            receipt.details = json.dumps({'before': {}, 'after': {}, 'background_changes': [
                {'label': 'PRIVATE', 'before': 'NEVER_DISPLAY', 'after': 'NEVER_DISPLAY'}]})
            self.assertEqual(receipt.changes, [])

    def test_remove_last_pool_member_closes_random_in_preview_and_can_restore(self):
        values = self.form();name = values.getlist('ordered_ids')[0]
        values.setlist('pool_ids', [name]);token, _ = self.preview(values);self.assertEqual(self.apply(token).status_code, 302)
        values = self.form();values['deleted_'+name] = '1'
        token, preview = self.preview(values)
        self.assertIn('名单为空时自动关闭', preview.get_data(as_text=True))
        self.assertEqual(self.apply(token).status_code, 302)
        payload = self.client.get('/background-catalog.json').json
        self.assertNotIn(name, [entry['id'] for entry in payload['entries']])
        self.assertEqual(payload['defaultRandom'], dict(enabled=False, ids=[]))
        self.assertEqual(len(self.state()[1]['entries']), 51)
        values = self.form();values['deleted_'+name] = '0';values['random_enabled'] = '1';values.setlist('pool_ids', [name])
        token, _ = self.preview(values);self.assertEqual(self.apply(token).status_code, 302)
        self.assertEqual(self.client.get('/background-catalog.json').json['defaultRandom'], dict(enabled=True, ids=[name]))

    def test_invalid_fields_and_order_keep_draft_without_persisting(self):
        before = self.state();values = self.form();name = values.getlist('ordered_ids')[0]
        values['title_'+name] = 'Draft retained';values['anchorX_'+name] = 'nan';values['palette_'+name] = 'javascript:bad'
        response = self.post('/admin/preview', values)
        self.assertEqual(response.status_code, 400)
        self.assertIn('Draft retained', response.get_data(as_text=True))
        self.assertIn('有限数值', response.get_data(as_text=True))
        self.assertEqual(self.state(), before)
        values = self.form();values.setlist('ordered_ids', [name, name])
        self.assertEqual(self.post('/admin/preview', values).status_code, 400)

    def test_valid_upload_is_private_until_confirmed_native_kept_and_public_metadata_stripped(self):
        raw = self.png();before = self.state()
        token, preview = self.preview(self.upload_form(raw))
        self.assertEqual(self.state(), before)
        temporary = list((Path(self.directory.name)/'backgrounds/staging').glob('stage-*'))
        self.assertEqual(len(temporary), 1)
        preview_url = re.search(r'<img[^>]*src="([^"]*pending[^\"]+)"', preview.get_data(as_text=True))
        self.assertIsNotNone(preview_url)
        with self.client.get(preview_url.group(1)) as response:
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.app.test_client().get(preview_url.group(1)).status_code, 403)
        self.assertEqual(self.apply(token).status_code, 302)
        uploaded = self.state()[1]['entries'][-1]
        self.assertEqual(uploaded['sourceKind'], 'upload')
        self.assertLessEqual(uploaded['width'], 640)
        self.assertIn('未 AI 超分', uploaded['enhancement'])
        folder = Path(self.directory.name)/'backgrounds/items'/uploaded['id']
        self.assertEqual(hashlib.sha256((folder/'original.png').read_bytes()).hexdigest(), hashlib.sha256(raw).hexdigest())
        with self.app.test_client().get(uploaded['src']) as response:
            self.assertEqual(response.status_code, 200)
            with Image.open(io.BytesIO(response.data)) as image:
                self.assertEqual(image.format, 'WEBP')
                self.assertFalse(image.info.get('exif') or image.info.get('xmp') or image.info.get('icc_profile'))
        self.assertEqual(self.client.get(uploaded['src'].rsplit('/', 1)[0]+'/original.png').status_code, 404)
        values = self.form();values['deleted_'+uploaded['id']] = '1'
        token, _ = self.preview(values);self.assertEqual(self.apply(token).status_code, 302)
        self.assertEqual(self.client.get(uploaded['src']).status_code, 404)
        self.assertEqual((folder/'original.png').read_bytes(), raw)

    def test_upload_rejects_bad_types_pixels_paths_and_never_fetches_urls(self):
        cases = [(b'<svg/>', 'bad.svg'), (b'not an image', 'bad.png'), (self.png(), '../../outside.png'),
                 (self.png(), 'wrong.jpg'), (self.png((31, 31)), 'tiny.png'),
                 (self.png((16001, 180)), 'huge.png')]
        for raw, name in cases:
            with self.subTest(name=name):
                self.assertEqual(self.post('/admin/preview', self.upload_form(raw, name)).status_code, 400)
        values = self.upload_form();values.pop('image');values['image_url'] = 'https://example.invalid/remote.png'
        self.assertEqual(self.post('/admin/preview', values).status_code, 400)
        self.assertEqual(len(self.state()[1]['entries']), 51)
        self.assertFalse(list((Path(self.directory.name)/'backgrounds').rglob('original*')))

    def test_failed_derivative_encoding_cleans_owned_files(self):
        data = self.upload_form()
        with patch('PIL.Image.Image.save', side_effect=OSError('simulated encoder failure')):
            result = self.post('/admin/preview', data)
        self.assertEqual(result.status_code, 400)
        self.assertFalse(list((Path(self.directory.name)/'backgrounds').rglob('original*')))
        self.assertEqual(len(self.state()[1]['entries']), 51)

    def test_background_storage_budget_rejects_new_upload_without_deleting_sources(self):
        self.app.config['BACKGROUND_MAX_STORAGE_BYTES'] = 1
        response = self.post('/admin/preview', self.upload_form())
        self.assertEqual(response.status_code, 400)
        self.assertIn('容量已满', response.get_data(as_text=True))
        self.assertEqual(len(self.state()[1]['entries']), 51)
        self.assertFalse(list((Path(self.directory.name)/'backgrounds').rglob('original*')))
        raw = self.png()
        self.app.config['BACKGROUND_MAX_STORAGE_BYTES'] = len(raw)+1
        response = self.post('/admin/preview', self.upload_form(raw))
        self.assertEqual(response.status_code, 400)
        self.assertIn('容量不足', response.get_data(as_text=True))
        self.assertFalse(list((Path(self.directory.name)/'backgrounds').rglob('original*')))

    def test_valid_jpeg_webp_and_exif_orientation_use_native_pixels(self):
        for fmt, filename in [('JPEG', 'native.jpeg'), ('WEBP', 'native.webp')]:
            stream = io.BytesIO()
            exif = Image.Exif();exif[274] = 6;exif[270] = 'PRIVATE_EXIF'
            Image.new('RGB', (400, 640), '#596d83').save(stream, fmt, exif=exif)
            original = stream.getvalue()
            token, _ = self.preview(self.upload_form(original, filename))
            self.assertEqual(self.apply(token).status_code, 302)
            uploaded = self.state()[1]['entries'][-1]
            self.assertEqual((uploaded['width'], uploaded['height']), (640, 400))
            original_file = Path(self.directory.name)/'backgrounds/items'/uploaded['id']/uploaded['_native']['file']
            self.assertEqual(original_file.read_bytes(), original)
            with self.client.get(uploaded['src']) as response:
                with Image.open(io.BytesIO(response.data)) as image:
                    self.assertEqual(image.size, (640, 400))
                    self.assertFalse(image.info.get('exif'))

    def test_animation_size_csrf_and_expired_upload_have_no_public_side_effects(self):
        stream = io.BytesIO()
        Image.new('RGB', (640, 400), 'red').save(stream, 'WEBP', save_all=True,
            append_images=[Image.new('RGB', (640, 400), 'blue')], duration=100, loop=0)
        self.assertEqual(self.post('/admin/preview', self.upload_form(stream.getvalue(), 'animated.webp')).status_code, 400)
        self.assertEqual(self.post('/admin/preview', self.upload_form(b'x'*(MAX_UPLOAD+1), 'oversize.png')).status_code, 400)
        self.assertEqual(self.client.post('/admin/preview', data=self.upload_form()).status_code, 400)
        token, _ = self.preview(self.upload_form())
        staging = next((Path(self.directory.name)/'backgrounds/staging').glob('stage-*'))
        metadata = json.loads((staging/'stage.json').read_text(encoding='utf-8'))
        metadata['created'] -= 1200
        (staging/'stage.json').write_text(json.dumps(metadata), encoding='utf-8')
        self.assertEqual(self.apply(token).status_code, 409)
        self.assertEqual(len(self.state()[1]['entries']), 51)
        self.assertFalse(list((Path(self.directory.name)/'backgrounds/items').glob('*')))

    def test_commit_failure_removes_only_the_owned_unpublished_folder(self):
        token, _ = self.preview(self.upload_form())
        csrf = self.csrf()
        real_commit = db.session.commit
        def reject_catalog_commit():
            # The existing auth hook also commits last_seen before the view.
            if any(isinstance(item, BackgroundCatalog) for item in db.session.dirty):
                raise RuntimeError('simulated commit failure')
            return real_commit()
        with patch('app.admin.db.session.commit', side_effect=reject_catalog_commit):
            with self.assertRaisesRegex(RuntimeError, 'simulated commit failure'):
                self.client.post('/admin/apply', data={'token': token, 'csrf_token': csrf})
        self.assertEqual(len(self.state()[1]['entries']), 51)
        self.assertFalse(list((Path(self.directory.name)/'backgrounds').rglob('original*')))

    def test_focus_metadata_edit_does_not_regenerate_uploaded_image(self):
        token, _ = self.preview(self.upload_form());self.assertEqual(self.apply(token).status_code, 302)
        entry = self.state()[1]['entries'][-1]
        path = Path(self.directory.name)/'backgrounds/items'/entry['id']/Path(entry['src']).name
        before = path.read_bytes()
        values = self.form();values['anchorX_'+entry['id']] = '.15';values['title_'+entry['id']] = 'Moved native view'
        token, _ = self.preview(values);self.assertEqual(self.apply(token).status_code, 302)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.state()[1]['entries'][-1]['anchorX'], .15)

    def test_admin_can_preview_disabled_or_removed_derivative_but_not_native(self):
        token, _ = self.preview(self.upload_form());self.assertEqual(self.apply(token).status_code, 302)
        entry = self.state()[1]['entries'][-1]
        admin_thumb = f'/admin/backgrounds/items/{entry["id"]}/thumb.webp'
        for key in ('enabled', 'deleted'):
            values = self.form();values[key+'_'+entry['id']] = '0' if key == 'enabled' else '1'
            token, _ = self.preview(values);self.assertEqual(self.apply(token).status_code, 302)
            with self.client.get(admin_thumb) as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertEqual(self.client.get(entry['thumbnail']).status_code, 404)
            self.assertEqual(self.app.test_client().get(admin_thumb).status_code, 403)
            page = self.client.get('/admin/backgrounds').get_data(as_text=True)
            self.assertIn(admin_thumb, page)
        self.assertEqual(self.client.get(admin_thumb.replace('thumb.webp', 'original.png')).status_code, 404)

    def test_image_routes_do_not_ping_accounts_or_commit_last_seen(self):
        token, preview = self.preview(self.upload_form())
        preview_url = re.search(r'<img[^>]*src="([^"]*pending[^\"]+)"', preview.get_data(as_text=True)).group(1)
        with patch.object(User, 'ping', side_effect=AssertionError('image route must not ping')):
            with self.client.get(preview_url) as response:
                self.assertEqual(response.status_code, 200)
        self.assertEqual(self.apply(token).status_code, 302)
        entry = self.state()[1]['entries'][-1]
        admin_thumb = f'/admin/backgrounds/items/{entry["id"]}/thumb.webp'
        with patch.object(User, 'ping', side_effect=AssertionError('image route must not ping')):
            for url in (entry['thumbnail'], admin_thumb):
                with self.client.get(url) as response:
                    self.assertEqual(response.status_code, 200)
            self.assertEqual(self.app.test_client().get(admin_thumb).status_code, 403)

    def test_catalogue_survives_prepare_without_reset_and_escapes_head(self):
        data = self.form();name = data.getlist('ordered_ids')[0]
        data['title_'+name] = '</script><script>UNTRUSTED_TITLE</script>'
        data.setlist('ordered_ids', list(reversed(data.getlist('ordered_ids'))))
        token, _ = self.preview(data);self.assertEqual(self.apply(token).status_code, 302)
        before = self.state()
        with self.app.app_context():
            sandbox = self.app.extensions['public_demo'];sandbox.initialized = False
            with sandbox.exclusive():
                sandbox.prepare()
        self.assertEqual(self.state(), before)
        page = self.client.get('/').get_data(as_text=True)
        self.assertNotIn('</script><script>UNTRUSTED_TITLE', page)
        self.assertIn('\\u003c/script\\u003e', page)


class BackgroundMigrationTests(unittest.TestCase):
    def test_old_database_gets_one_backed_up_additive_table_without_reset(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'old.sqlite'
            with closing(sqlite3.connect(path)) as connection:
                connection.executescript("CREATE TABLE users(id INTEGER PRIMARY KEY,password_hash TEXT); INSERT INTO users VALUES(7,'KEEP_HASH'); CREATE TABLE posts(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO posts VALUES(8,'KEEP_BODY'); CREATE TABLE roles(id INTEGER); CREATE TABLE comments(id INTEGER); CREATE TABLE follows(id INTEGER);")
                connection.commit()
            migrate_background_catalog_schema(path)
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute('SELECT * FROM users').fetchall(), [(7, 'KEEP_HASH')])
                self.assertEqual(connection.execute('SELECT * FROM posts').fetchall(), [(8, 'KEEP_BODY')])
                connection.execute("INSERT INTO background_catalog VALUES(1,9,'{}','2026-11-02')");connection.commit()
            backups = list(Path(temporary).glob('before-background-catalog-*.sqlite'))
            self.assertEqual(len(backups), 1)
            migrate_background_catalog_schema(path)
            self.assertEqual(list(Path(temporary).glob('before-background-catalog-*.sqlite')), backups)
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute('SELECT revision,data FROM background_catalog').fetchone(), (9, '{}'))

    def test_normal_alembic_upgrade_is_additive_and_repeatable(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary)/'normal.sqlite'
            mode = type('BackgroundMigrationConfig', (TestingConfig,), {'SQLALCHEMY_DATABASE_URI': 'sqlite:///'+database.as_posix()})
            with patch.dict(config, {'background-migration-test': mode}):
                app = create_app('background-migration-test')
            Migrate(app, db)
            migrations = str(Path(__file__).resolve().parents[1]/'migrations')
            with app.app_context():
                try:
                    upgrade(directory=migrations, revision='20261031_reflective_materials')
                    with db.engine.begin() as connection:
                        connection.execute(db.text("INSERT INTO roles(id,name,permissions,\"default\") VALUES(1,'Retained',255,0)"))
                        connection.execute(db.text("INSERT INTO users(id,username,password_hash,role_id,confirmed,account_kind) VALUES(7,'preserved','KEEP_HASH',1,1,'account')"))
                    upgrade(directory=migrations)
                    self.assertIn('background_catalog', db.inspect(db.engine).get_table_names())
                    self.assertEqual(db.session.get(User, 7).password_hash, 'KEEP_HASH')
                    db.session.remove();upgrade(directory=migrations)
                    self.assertEqual(db.session.get(User, 7).password_hash, 'KEEP_HASH')
                finally:
                    db.session.remove();db.engine.dispose()


if __name__ == '__main__':
    unittest.main()
