"""Optional article appearance persists without weakening native content guards.

Every database here is an in-memory engine or a new TemporaryDirectory. These
tests never load the repository demo database or the shared browser fixture.
"""
from base64 import b64encode
import html
import importlib.util
import os
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from alembic.config import Config as AlembicConfig
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from flask import template_rendered

from app import create_app, db
from app.community import ProjectEntry
from app.main.forms import PostForm
from app.models import Post, PostAppearance, Role, User
from app.post_appearance import (MATERIAL_KEYS, apply_post_appearance,
                                 normalize_color, normalize_material,
                                 post_appearance, color_theme, page_theme,
                                 THEME_ROLE_SPECS, THEME_READING_INK)


class AppearanceTokenTests(unittest.TestCase):
    def test_only_exact_six_digit_hex_is_accepted_and_normalized(self):
        self.assertEqual(normalize_color('#A0b1C2'), '#a0b1c2')
        self.assertEqual(normalize_color(''), '')
        self.assertEqual(normalize_color(None), '')
        for value in ('#abc', '#abcdef0', '#zzzzzz', 'abcdef', ' #abcdef',
                      '#abcdef\n', '#fffff;', 'red', 'url(x)', 1, []):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_color(value)

    def test_material_is_a_closed_token_set(self):
        self.assertEqual(normalize_material(None), 'auto')
        for value in MATERIAL_KEYS:
            self.assertEqual(normalize_material(value), value)
        for value in ('', 'Glass', 'url(x)', 'glass" onclick="run()', [], 1):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_material(value)

    def test_render_tokens_bound_chroma_and_ignore_selected_lightness(self):
        expected = {'#ff0000': (0, 55), '#00ff00': (120, 55),
                    '#0000ff': (240, 55), '#ffffff': (0, 0), '#000000': (0, 0)}
        for color, tokens in expected.items():
            with self.subTest(color=color):
                result = post_appearance(SimpleNamespace(appearance=SimpleNamespace(
                    theme_color=color, card_material='glass')))
                self.assertEqual((result['hue'], result['saturation']), tokens)
                self.assertTrue(result['custom'])
                self.assertNotIn('lightness', result)
        for number in range(0, 0x1000000, 104729):
            result = post_appearance(SimpleNamespace(appearance=SimpleNamespace(
                theme_color=f'#{number:06x}', card_material='auto')))
            self.assertTrue(0 <= result['hue'] <= 359)
            self.assertTrue(0 <= result['saturation'] <= 55)

    def test_legacy_and_invalid_storage_have_safe_fallbacks(self):
        expected = {'material': 'auto', 'color': '', 'hue': 0,
                    'saturation': 0, 'custom': False}
        self.assertEqual(post_appearance(SimpleNamespace()), expected)
        self.assertEqual(post_appearance(SimpleNamespace(appearance=None)), expected)
        malformed = SimpleNamespace(theme_color='#abcde;', card_material=['glass'])
        self.assertEqual(post_appearance(SimpleNamespace(appearance=malformed)), expected)

    def test_page_role_colors_keep_text_and_controls_readable_for_all_hues(self):
        import colorsys

        def luminance(color):
            rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
            linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
            return sum(c * weight for c, weight in zip(linear, (.2126, .7152, .0722)))

        def contrast(a, b):
            first, second = sorted((luminance(a), luminance(b)))
            return (second + .05) / (first + .05)

        for hue in range(0, 360, 3):
            for saturation in (0, .18, .35, 1):
                channels = colorsys.hls_to_rgb(hue / 360, .5, saturation)
                color = '#' + ''.join(f'{int(c * 255 + .5):02x}' for c in channels)
                theme = color_theme(color)
                for mode, surface in (('dark', '#192622'), ('light', '#fbfcf6')):
                    with self.subTest(color=color, mode=mode):
                        roles = theme[mode]
                        self.assertGreaterEqual(contrast(roles['accent'], roles['background']), 4.5)
                        self.assertGreaterEqual(contrast(roles['accent'], surface), 4.5)
                        self.assertGreaterEqual(contrast(roles['ink'], roles['accent']), 4.5)
                        for background in ('background', 'surface', 'raised', 'input'):
                            for ink in ('accent', 'text', 'muted', 'subtle'):
                                self.assertGreaterEqual(contrast(roles[ink], roles[background]), 4.5,
                                    f'{mode}: {ink} over {background}')

    def test_actual_css_page_and_article_roles_match_the_contrast_checked_palette(self):
        css = (Path(__file__).resolve().parents[1] / 'app/static/community-theme.css').read_text(encoding='utf-8')
        page_selector = 'body.community-room[data-community-theme]'
        post_selector = "body.community-room :is(article.post,[data-post-theme-card],[data-appearance-preview])[data-theme-color]:not([data-theme-color=''])"
        role_names = {'background': 'bg', 'hover': 'accent-hover', 'ink': 'accent-ink'}
        for mode, specs in THEME_ROLE_SPECS.items():
            prefix = ':root[data-theme=light] ' if mode == 'light' else ''
            for selector, source in ((page_selector, 'community'), (post_selector, 'appearance')):
                block = re.search(re.escape(prefix + selector) + r'\s*\{([^}]+)\}', css).group(1)
                declarations = dict(re.findall(r'--([\w-]+)\s*:\s*([^;]+);', block))
                for role, (lightness, cap) in specs.items():
                    saturation = (f'var(--{source}-saturation)' if cap is None else
                                  f'min(var(--{source}-saturation),{cap}%)')
                    self.assertEqual(declarations[role_names.get(role, role)],
                                     f'hsl(var(--{source}-hue) {saturation} {lightness}%)')
                self.assertEqual(declarations['text'], THEME_READING_INK[mode])
            default_block = re.search(re.escape(prefix + 'body.community-room :is(article.post,[data-post-theme-card])') + r'\s*\{([^}]+)\}', css).group(1)
            isolated = set(re.findall(r'--([\w-]+)\s*:', default_block))
            self.assertTrue({'bg', 'surface', 'raised', 'input', 'line', 'text', 'muted', 'subtle'}.issubset(isolated))

    def test_page_theme_uses_only_validated_saved_color_and_scoped_post_id(self):
        automatic = page_theme()
        self.assertFalse(automatic['active'])
        self.assertIsNone(automatic['post_id'])
        post = SimpleNamespace(id=19, appearance=SimpleNamespace(theme_color='#A0B1C2', card_material='metal'))
        saved = page_theme(post)
        self.assertEqual((saved['color'], saved['hue'], saved['saturation'], saved['post_id']),
                         ('#a0b1c2', 210, 22, 19))
        self.assertEqual(color_theme('#acf858')['hue'], 89)
        self.assertEqual(color_theme('#8751bc')['dark']['ink'], '#1a1320')
        post.appearance.theme_color = 'url(x)'
        self.assertFalse(page_theme(post)['active'])
        self.assertEqual(page_theme(post)['color'], '')


class AppearanceHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='liss-appearance-test-')
        # No inherited database, storage, email, or deployment configuration.
        self.environment = patch.dict(os.environ, {
            'SECRET_KEY': 'appearance-tests-not-production-' * 3,
            'LISS_DATA_DIR': self.directory.name,
            'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0',
        }, clear=True)
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False,
                               LISS_EMAIL_ACCOUNTS=False, MAIL_SUPPRESS_SEND=True)
        self.client = self.app.test_client()
        self.assertEqual(self.client.get('/').status_code, 200)
        self.join(self.client)

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def token(self, path='/', client=None):
        response = (client or self.client).get(path)
        self.assertEqual(response.status_code, 200)
        match = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', response.get_data(as_text=True))
        self.assertIsNotNone(match)
        return html.unescape(match.group(1))

    def join(self, client):
        response = client.post('/welcome', data={'csrf_token': self.token('/welcome', client)})
        self.assertEqual(response.status_code, 302)

    def create_post(self, body='# Appearance article\n\n**Original words**, unchanged.', **appearance):
        response = self.client.post('/', data={'csrf_token': self.token(), 'body': body, **appearance})
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            return Post.query.filter_by(body=body).one().id

    def saved(self, post_id):
        with self.app.app_context():
            post = db.session.get(Post, post_id)
            return (post.body, post.body_html,
                    None if post.appearance is None else
                    (post.appearance.theme_color, post.appearance.card_material))

    def edit_post(self, post_id, body, **appearance):
        target = f'/edit/{post_id}'
        return self.client.post(target, data={
            'csrf_token': self.token(target), 'body': body, **appearance})

    def page_context(self, path):
        recorded = []

        def record(sender, template, context, **extra):
            recorded.append(context)

        with template_rendered.connected_to(record, self.app):
            response = self.client.get(path)
        self.assertEqual(response.status_code, 200)
        return response, recorded[-1]['page_theme']

    def test_saved_theme_context_follows_detail_and_editor_without_leaking_to_other_pages(self):
        post_id = self.create_post(appearance_color='#A59BD8', appearance_material='glass')
        for path in (f'/post/{post_id}', f'/edit/{post_id}'):
            _, context = self.page_context(path)
            self.assertEqual(context['color'], '#a59bd8')
            self.assertEqual(context['post_id'], post_id)
            self.assertTrue(context['active'])
        for path in ('/', '/projects/outpost/talk/', '/auth/login'):
            _, context = self.page_context(path)
            self.assertEqual(context['color'], '')
            self.assertIsNone(context['post_id'])

    def test_each_article_keeps_its_color_in_a_shared_author_feed(self):
        first = self.create_post(body='# Red article', appearance_color='#ff0000', appearance_material='glass')
        second = self.create_post(body='# Blue article', appearance_color='#0000ff', appearance_material='metal')
        with self.app.app_context():
            username = db.session.get(Post, first).author.username
        response, context = self.page_context('/user/' + username)
        self.assertFalse(context['active'])
        source = response.get_data(as_text=True)
        self.assertIn('data-theme-color="#ff0000"', source)
        self.assertIn('data-theme-color="#0000ff"', source)
        self.assertEqual(self.page_context(f'/post/{first}')[1]['hue'], 0)
        self.assertEqual(self.page_context(f'/post/{second}')[1]['hue'], 240)

    def test_invalid_draft_theme_preserves_saved_page_context_and_published_body(self):
        post_id = self.create_post(appearance_color='#ff0000', appearance_material='glass')
        original = self.saved(post_id)
        recorded = []

        def record(sender, template, context, **extra):
            recorded.append(context)

        with template_rendered.connected_to(record, self.app):
            response = self.edit_post(post_id, '# New draft retained',
                appearance_color='#bad', appearance_material='metal')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(recorded[-1]['page_theme']['color'], '#ff0000')
        self.assertIn('New draft retained', response.get_data(as_text=True))
        self.assertEqual(self.saved(post_id), original)

    def test_native_create_persists_optional_appearance_and_keeps_markdown(self):
        post_id = self.create_post(appearance_color='#AbC123', appearance_material='glass')
        body, rendered, appearance = self.saved(post_id)
        self.assertEqual(appearance, ('#abc123', 'glass'))
        self.assertEqual(body, '# Appearance article\n\n**Original words**, unchanged.')
        self.assertIn('<strong>Original words</strong>', rendered)
        self.assertEqual(self.client.get(f'/post/{post_id}').status_code, 200)

    def test_old_body_only_create_has_no_appearance_record(self):
        post_id = self.create_post()
        self.assertIsNone(self.saved(post_id)[2])
        with self.app.app_context():
            self.assertEqual(PostAppearance.query.count(), 0)

    def test_edit_saves_and_explicit_reset_removes_only_appearance(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='paper')
        original = self.saved(post_id)
        response = self.edit_post(post_id, original[0],
            appearance_color='#fedcba', appearance_material='metal')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.saved(post_id), (*original[:2], ('#fedcba', 'metal')))
        response = self.edit_post(post_id, original[0],
            appearance_color='', appearance_material='auto')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.saved(post_id), (*original[:2], None))

    def test_old_body_only_edit_preserves_saved_appearance(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='ceramic')
        response = self.edit_post(post_id, '# Revised body\n\nStill my article.')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.saved(post_id)[2], ('#123456', 'ceramic'))
        self.assertTrue(self.saved(post_id)[0].startswith('# Revised body'))

    def test_partial_edit_keeps_the_omitted_field(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='glass')
        body = self.saved(post_id)[0]
        self.assertEqual(self.edit_post(post_id, body, appearance_color='#abcdef').status_code, 302)
        self.assertEqual(self.saved(post_id)[2], ('#abcdef', 'glass'))
        self.assertEqual(self.edit_post(post_id, body, appearance_material='metal').status_code, 302)
        self.assertEqual(self.saved(post_id)[2], ('#abcdef', 'metal'))
        self.assertEqual(self.edit_post(post_id, body, appearance_color='').status_code, 302)
        self.assertEqual(self.saved(post_id)[2], ('', 'metal'))

    def test_edit_get_prefills_and_invalid_post_keeps_user_input(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='paper')
        with self.app.app_context(), self.app.test_request_context(f'/edit/{post_id}'):
            form = PostForm()
            form.load_appearance(db.session.get(Post, post_id))
            self.assertEqual((form.appearance_color.data, form.appearance_material.data),
                             ('#123456', 'paper'))
        with self.app.app_context(), self.app.test_request_context(f'/edit/{post_id}',
                method='POST', data={'body': 'Attempted', 'appearance_color': 'invalid',
                                     'appearance_material': 'metal'}):
            form = PostForm()
            form.load_appearance(db.session.get(Post, post_id))
            self.assertEqual((form.appearance_color.data, form.appearance_material.data),
                             ('invalid', 'metal'))

    def test_invalid_color_material_or_blank_body_cannot_partially_update_content(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='glass')
        original = self.saved(post_id)
        attempts = [dict(appearance_color=value, appearance_material='metal') for value in
                    ('#abc', '#zzzzzz', '#fffff;', '#123456\n', ' ', 'url(x)')]
        attempts += [dict(appearance_color='#abcdef', appearance_material='invalid')]
        for appearance in attempts:
            with self.subTest(appearance=appearance):
                self.assertEqual(self.edit_post(post_id, 'Must not be saved', **appearance).status_code, 200)
                self.assertEqual(self.saved(post_id), original)
        self.assertEqual(self.edit_post(post_id, '',
            appearance_color='#abcdef', appearance_material='metal').status_code, 200)
        self.assertEqual(self.saved(post_id), original)

    def test_invalid_create_does_not_add_article_or_appearance(self):
        with self.app.app_context():
            original_count = Post.query.count()
        response = self.client.post('/', data={'csrf_token': self.token(),
            'body': 'Invalid appearance cannot post.', 'appearance_color': '#bad',
            'appearance_material': 'glass'})
        self.assertEqual(response.status_code, 200)
        with self.app.app_context():
            self.assertEqual(Post.query.count(), original_count)
            self.assertEqual(PostAppearance.query.count(), 0)

    def test_invalid_appearance_retains_edited_draft_until_successful_resubmit(self):
        post_id = self.create_post(body='# Saved article\n\nOriginal published body.',
                                   appearance_color='#123456', appearance_material='glass')
        original = self.saved(post_id)
        draft = '# Edited draft\n\nKeep this new wording & unfinished thought.'
        rejected = self.edit_post(post_id, draft,
            appearance_color='#bad', appearance_material='metal')
        self.assertEqual(rejected.status_code, 200)
        textarea = re.search(r'<textarea\b[^>]*name="body"[^>]*>(.*?)</textarea>',
                             rejected.get_data(as_text=True), re.S)
        self.assertIsNotNone(textarea)
        # HTML textarea parsing ignores the single initial newline emitted by
        # the PageDown widget; preserve every character of the actual draft.
        displayed_draft = re.sub(r'^\r?\n', '', html.unescape(textarea.group(1)), count=1)
        self.assertEqual(displayed_draft, draft)
        self.assertEqual(self.saved(post_id), original)
        accepted = self.edit_post(post_id, draft,
            appearance_color='#abcdef', appearance_material='metal')
        self.assertEqual(accepted.status_code, 302)
        saved = self.saved(post_id)
        self.assertEqual(saved[0], draft)
        self.assertIn('Keep this new wording &amp; unfinished thought.', saved[1])
        self.assertEqual(saved[2], ('#abcdef', 'metal'))

    def test_other_author_cannot_edit_appearance_or_body(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='glass')
        original = self.saved(post_id)
        outsider = self.app.test_client()
        self.join(outsider)
        response = outsider.post(f'/edit/{post_id}', data={
            'csrf_token': self.token('/', outsider), 'body': 'Other author attempt',
            'appearance_color': '#abcdef', 'appearance_material': 'metal'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.saved(post_id), original)

    def test_native_csrf_blocks_create_edit_and_project_post(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='glass')
        original = self.saved(post_id)
        for target in ('/', f'/edit/{post_id}', '/projects/outpost/talk/'):
            with self.subTest(target=target):
                response = self.client.post(target, data={'body': 'No CSRF',
                    'appearance_color': '#abcdef', 'appearance_material': 'metal'})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.saved(post_id), original)
        with self.app.app_context():
            self.assertEqual(ProjectEntry.query.count(), 0)

    def test_project_article_keeps_association_and_saves_in_same_transaction(self):
        target = '/projects/ssframework/talk/'
        body = '# A framework thought\n\nOriginal project discussion.'
        response = self.client.post(target, data={'csrf_token': self.token(target), 'body': body,
            'appearance_color': '#ABCDEF', 'appearance_material': 'ceramic'})
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            entry = ProjectEntry.query.one()
            self.assertEqual(entry.project_slug, 'ssframework')
            self.assertEqual(entry.post.body, body)
            self.assertEqual(entry.post.appearance.theme_color, '#abcdef')
            self.assertEqual(entry.post.appearance.card_material, 'ceramic')
            self.assertTrue(response.location.endswith('/post/' + str(entry.post_id)))

    def test_project_anonymous_and_invalid_requests_add_nothing(self):
        target = '/projects/outpost/talk/'
        anonymous = self.app.test_client()
        self.assertEqual(anonymous.post(target, data={'body': 'Anonymous',
            'appearance_material': 'metal'}).status_code, 403)
        response = self.client.post(target, data={'csrf_token': self.token(target),
            'body': 'Invalid material', 'appearance_color': '#123456',
            'appearance_material': 'unknown'})
        self.assertEqual(response.status_code, 200)
        with self.app.app_context():
            self.assertEqual(ProjectEntry.query.count(), 0)
            self.assertEqual(PostAppearance.query.count(), 0)

    def test_model_validators_constraints_and_delete_orphan(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='glass')
        with self.app.app_context():
            row = db.session.get(PostAppearance, post_id)
            for key, value in (('theme_color', '#bad'), ('card_material', 'unknown')):
                with self.subTest(key=key), self.assertRaises(ValueError):
                    setattr(row, key, value)
            with self.assertRaises(IntegrityError):
                db.session.execute(sa.text('UPDATE post_appearances SET card_material=:bad'), {'bad': 'unknown'})
            db.session.rollback()
            with self.assertRaises(IntegrityError):
                db.session.execute(sa.text('INSERT INTO post_appearances(post_id) VALUES (:id)'), {'id': post_id})
            db.session.rollback()
            db.session.delete(db.session.get(Post, post_id))
            db.session.commit()
            self.assertIsNone(db.session.get(PostAppearance, post_id))

    def test_application_restart_retains_appearance_identity_and_content(self):
        post_id = self.create_post(appearance_color='#123456', appearance_material='glass')
        original = self.saved(post_id)
        with self.app.app_context():
            epoch = db.session.execute(sa.text('SELECT identity_epoch FROM public_demo_state WHERE id=1')).scalar_one()
            db.session.remove()
            db.engine.dispose()
        restarted = create_app('public-demo')
        restarted.config.update(TESTING=True, SESSION_COOKIE_SECURE=False, LISS_EMAIL_ACCOUNTS=False)
        self.assertEqual(restarted.test_client().get('/').status_code, 200)
        with restarted.app_context():
            post = db.session.get(Post, post_id)
            self.assertEqual((post.body, post.body_html,
                (post.appearance.theme_color, post.appearance.card_material)), original)
            self.assertEqual(db.session.execute(sa.text('SELECT identity_epoch FROM public_demo_state WHERE id=1')).scalar_one(), epoch)
            db.session.remove()
            db.engine.dispose()

    def test_public_prepare_adds_only_missing_appearance_table_to_old_store(self):
        post_id = self.create_post()
        with self.app.app_context():
            before = db.session.execute(sa.text('SELECT id, body, body_html, author_id FROM posts ORDER BY id')).all()
            identity = db.session.execute(sa.text('SELECT identity_epoch FROM public_demo_state WHERE id=1')).scalar_one()
            PostAppearance.__table__.drop(db.engine)
            db.session.remove()
            db.engine.dispose()
        restarted = create_app('public-demo')
        restarted.config.update(TESTING=True, SESSION_COOKIE_SECURE=False, LISS_EMAIL_ACCOUNTS=False)
        self.assertEqual(restarted.test_client().get('/').status_code, 200)
        with restarted.app_context():
            self.assertEqual(db.session.execute(sa.text('SELECT id, body, body_html, author_id FROM posts ORDER BY id')).all(), before)
            self.assertEqual(db.session.execute(sa.text('SELECT identity_epoch FROM public_demo_state WHERE id=1')).scalar_one(), identity)
            self.assertIsNone(db.session.get(Post, post_id).appearance)
            self.assertEqual(PostAppearance.query.count(), 0)
            db.session.remove()
            db.engine.dispose()


class AppearanceMigrationTests(unittest.TestCase):
    def migration(self):
        path = Path(__file__).resolve().parents[1] / 'migrations/versions/20261030_post_appearance.py'
        spec = importlib.util.spec_from_file_location('appearance_migration_under_test', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_additive_upgrade_keeps_legacy_rows_and_is_idempotent(self):
        engine = sa.create_engine('sqlite:///:memory:')
        with engine.begin() as connection:
            connection.exec_driver_sql('PRAGMA foreign_keys=ON')
            connection.exec_driver_sql('CREATE TABLE posts(id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
            connection.execute(sa.text('INSERT INTO posts VALUES (7, :body)'), {'body': 'Unchanged legacy markdown.'})
            migration = self.migration()
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            self.assertEqual(connection.execute(sa.text('SELECT * FROM posts')).all(), [(7, 'Unchanged legacy markdown.')])
            self.assertEqual([column['name'] for column in sa.inspect(connection).get_columns('posts')], ['id', 'body'])
            foreign_key = sa.inspect(connection).get_foreign_keys('post_appearances')[0]
            self.assertEqual(foreign_key['referred_table'], 'posts')
            self.assertEqual(foreign_key['options'].get('ondelete'), 'CASCADE')
            connection.execute(sa.text('INSERT INTO post_appearances(post_id) VALUES (7)'))
            self.assertEqual(connection.execute(sa.text('SELECT theme_color, card_material FROM post_appearances')).one(), ('', 'auto'))
            connection.exec_driver_sql('DELETE FROM posts WHERE id=7')
            self.assertEqual(connection.execute(sa.text('SELECT COUNT(*) FROM post_appearances')).scalar_one(), 0)
        engine.dispose()

    def test_new_revision_follows_the_single_existing_head(self):
        config = AlembicConfig()
        config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'migrations'))
        scripts = ScriptDirectory.from_config(config)
        self.assertEqual(scripts.get_heads(), ['20261030_post_appearance'])
        self.assertEqual(scripts.get_revision('20261030_post_appearance').down_revision,
                         '20261024_owner_identity')


class AppearanceApiCompatibilityTests(unittest.TestCase):
    def test_original_api_body_edit_keeps_appearance_and_ignores_presentation_payload(self):
        # Override the testing class before factory creation rather than trusting
        # any TEST_DATABASE_URL inherited from a developer shell.
        from config import TestingConfig
        with patch.object(TestingConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'):
            app = create_app('testing')
        with app.app_context():
            db.create_all()
            Role.insert_roles()
            user = User(username='appearance_api', email='appearance@example.invalid',
                        password='appearance-test-password', confirmed=True,
                        role=Role.query.filter_by(default=True).one())
            post = Post(body='# Original API article', author=user)
            apply_post_appearance(post, '#123456', 'glass')
            db.session.add(post)
            db.session.commit()
            post_id = post.id
            headers = {'Authorization': 'Basic ' + b64encode(
                b'appearance@example.invalid:appearance-test-password').decode('ascii')}
            client = app.test_client()
            response = client.put(f'/api/v1.0/posts/{post_id}', headers=headers,
                json={'body': '# Updated through original API', 'appearance_color': 'url(x)',
                      'appearance_material': 'unrecognized'})
            self.assertEqual(response.status_code, 200)
            db.session.expire_all()
            saved = db.session.get(Post, post_id)
            self.assertEqual(saved.body, '# Updated through original API')
            self.assertEqual((saved.appearance.theme_color, saved.appearance.card_material), ('#123456', 'glass'))
            created = client.post('/api/v1.0/posts/', headers=headers, json={'body': '# Body only API create'})
            self.assertEqual(created.status_code, 201)
            self.assertEqual(PostAppearance.query.count(), 1)
            db.session.remove()
            db.drop_all()
            db.engine.dispose()


if __name__ == '__main__':
    unittest.main()
