"""Additional materials survive the native form/storage/rendering boundaries.

All databases are disposable; no preview data or browser identity is loaded.
"""
import html
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app import create_app, db
from app.main.forms import PostForm
from app.models import Post, PostAppearance
from app.post_appearance import MATERIAL_CHOICES, normalize_material


NEW_MATERIALS = {'leather': '皮革', 'cork': '软木', 'slate': '岩板'}


class MaterialCatalogHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='liss-material-catalog-')
        self.environment = patch.dict(os.environ, {
            'SECRET_KEY': 'isolated-material-catalog-' * 3,
            'LISS_DATA_DIR': self.directory.name,
            'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0',
        }, clear=True)
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False,
                               LISS_EMAIL_ACCOUNTS=False, MAIL_SUPPRESS_SEND=True)
        self.client = self.app.test_client()
        response = self.client.post('/welcome', data={'csrf_token': self.token('/welcome')})
        self.assertEqual(response.status_code, 302)

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def token(self, target='/'):
        response = self.client.get(target)
        self.assertEqual(response.status_code, 200)
        found = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', response.get_data(as_text=True))
        self.assertIsNotNone(found)
        return html.unescape(found.group(1))

    def create(self, material, color='#7ab8dd'):
        body = '# Catalog ' + material + '\n\nUnchanged article words.'
        response = self.client.post('/', data={
            'csrf_token': self.token(), 'body': body,
            'appearance_color': color, 'appearance_material': material})
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            return Post.query.filter_by(body=body).one().id

    def test_catalog_and_all_native_composer_forms_offer_the_three_new_materials(self):
        self.assertTrue(NEW_MATERIALS.items() <= dict(MATERIAL_CHOICES).items())
        self.assertEqual(len(MATERIAL_CHOICES), len(dict(MATERIAL_CHOICES)))
        with self.app.test_request_context('/'):
            self.assertEqual(PostForm().appearance_material.choices, list(MATERIAL_CHOICES))
        post_id = self.create('glass')
        for target in ('/', '/projects/ssframework/talk/', f'/edit/{post_id}'):
            source = self.client.get(target).get_data(as_text=True)
            for material, label in NEW_MATERIALS.items():
                with self.subTest(target=target, material=material):
                    self.assertIn(f'name="appearance_material" value="{material}"', source)
                    self.assertIn('material-chip-' + material, source)
                    self.assertIn('>' + label + '</span>', source)

    def test_new_tokens_round_trip_through_create_refresh_editor_and_body_only_edit(self):
        for material in NEW_MATERIALS:
            with self.subTest(material=material):
                post_id = self.create(material)
                for target in ('/', f'/post/{post_id}'):
                    source = self.client.get(target).get_data(as_text=True)
                    self.assertIn(f'data-material="{material}"', source)
                editor = self.client.get(f'/edit/{post_id}').get_data(as_text=True)
                self.assertIn(f'value="{material}" checked', editor)
                response = self.client.post(f'/edit/{post_id}', data={
                    'csrf_token': self.token(f'/edit/{post_id}'),
                    'body': '# Revised ' + material})
                self.assertEqual(response.status_code, 302)
                with self.app.app_context():
                    db.session.expire_all()
                    post = db.session.get(Post, post_id)
                    self.assertEqual(post.body, '# Revised ' + material)
                    self.assertEqual((post.appearance.theme_color, post.appearance.card_material),
                                     ('#7ab8dd', material))

    def test_saved_new_material_can_be_changed_and_failed_draft_retains_selection(self):
        post_id = self.create('glass')
        target = f'/edit/{post_id}'
        for material in NEW_MATERIALS:
            with self.subTest(material=material):
                response = self.client.post(target, data={
                    'csrf_token': self.token(target), 'body': '# Valid ' + material,
                    'appearance_color': '#ddb17f', 'appearance_material': material})
                self.assertEqual(response.status_code, 302)
                response = self.client.post(target, data={
                    'csrf_token': self.token(target), 'body': '# Unsaved draft',
                    'appearance_color': '#bad', 'appearance_material': material})
                self.assertEqual(response.status_code, 200)
                source = response.get_data(as_text=True)
                self.assertIn(f'value="{material}" checked', source)
                self.assertIn('# Unsaved draft', source)
                self.assertIn('data-appearance-new="false"', source)
                with self.app.app_context():
                    post = db.session.get(Post, post_id)
                    self.assertEqual(post.body, '# Valid ' + material)
                    self.assertEqual(post.appearance.card_material, material)

    def test_invalid_tokens_cannot_bypass_form_model_or_database_guards(self):
        post_id = self.create('slate')
        target = f'/edit/{post_id}'
        for material in ('Leather', 'slate" onclick="run()', 'cork; DROP TABLE posts', 'unknown'):
            with self.subTest(material=material):
                with self.assertRaises(ValueError):
                    normalize_material(material)
                response = self.client.post(target, data={
                    'csrf_token': self.token(target), 'body': '# Rejected update',
                    'appearance_color': '#abcdef', 'appearance_material': material})
                self.assertEqual(response.status_code, 200)
                with self.app.app_context():
                    post = db.session.get(Post, post_id)
                    self.assertEqual(post.body, '# Catalog slate\n\nUnchanged article words.')
                    self.assertEqual(post.appearance.card_material, 'slate')
                    with self.assertRaises(ValueError):
                        post.appearance.card_material = material
                    with self.assertRaises(IntegrityError):
                        db.session.execute(sa.text('UPDATE post_appearances SET card_material=:value WHERE post_id=:id'),
                                           {'value': material, 'id': post_id})
                    db.session.rollback()

    def test_storage_capacity_accepts_each_new_token_without_truncation(self):
        self.assertGreaterEqual(PostAppearance.__table__.c.card_material.type.length,
                                max(map(len, NEW_MATERIALS)))
        for material in NEW_MATERIALS:
            self.assertEqual(normalize_material(material), material)

    def test_public_prepare_upgrades_old_constraint_without_changing_existing_data_or_identity(self):
        post_id = self.create('glass')
        tables = ('users', 'roles', 'posts', 'comments', 'follows',
                  'post_appearances', 'public_demo_state')
        with self.app.app_context():
            before = {table: db.session.execute(sa.text('SELECT * FROM ' + table + ' ORDER BY 1')).all()
                      for table in tables}
            db.session.remove()
            with db.engine.begin() as connection:
                operations = Operations(MigrationContext.configure(connection))
                with operations.batch_alter_table('post_appearances') as batch:
                    batch.drop_constraint('ck_post_appearance_material', type_='check')
                    batch.create_check_constraint('ck_post_appearance_material',
                        "card_material IN ('auto','glass','ceramic','paper','metal')")
            db.engine.dispose()
        restarted = create_app('public-demo')
        restarted.config.update(TESTING=True, SESSION_COOKIE_SECURE=False, LISS_EMAIL_ACCOUNTS=False)
        self.assertEqual(restarted.test_client().get('/').status_code, 200)
        with restarted.app_context():
            after = {table: db.session.execute(sa.text('SELECT * FROM ' + table + ' ORDER BY 1')).all()
                     for table in tables}
            self.assertEqual(after, before)
            for material in NEW_MATERIALS:
                row = db.session.get(PostAppearance, post_id)
                row.card_material = material
                db.session.commit()
                db.session.expire_all()
                self.assertEqual(db.session.get(PostAppearance, post_id).card_material, material)
            db.session.remove()
            db.engine.dispose()
        self.assertEqual(len(list(Path(self.directory.name).rglob('before-material-catalog-*.sqlite'))), 1)


if __name__ == '__main__':
    unittest.main()
