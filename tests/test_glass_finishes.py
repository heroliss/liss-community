"""A saved glass finish survives native forms, article rendering and restart."""
import re

from app import create_app, db
from app.models import Post, PostAppearance, User
from app.post_appearance import MATERIAL_CHOICES, normalize_material
import unittest

if __package__:
    from . import test_material_catalog as catalog_tests
else:  # unittest discover -s tests imports modules at the top level.
    import test_material_catalog as catalog_tests


class GlassFinishHttpTests(unittest.TestCase):
    # Reuse the existing isolated public-demo fixture, not its test methods.
    setUp = catalog_tests.MaterialCatalogHttpTests.setUp
    tearDown = catalog_tests.MaterialCatalogHttpTests.tearDown
    token = catalog_tests.MaterialCatalogHttpTests.token
    create = catalog_tests.MaterialCatalogHttpTests.create

    def article_tag(self, source, identifier):
        found = re.search(r'<article\b[^>]*\bdata-depth-id="' + str(identifier) + r'"[^>]*>', source)
        self.assertIsNotNone(found)
        return found[0]

    def test_first_two_choices_are_real_finishes_and_auto_is_a_separate_mode(self):
        self.assertEqual(MATERIAL_CHOICES[:2], (('glass', '晶透玻璃'), ('frosted', '磨砂玻璃')))
        self.assertEqual(MATERIAL_CHOICES[-1], ('auto', '随站点安排'))
        identifier = self.create('frosted')
        for target in ('/', '/projects/ssframework/talk/', f'/edit/{identifier}'):
            with self.subTest(target=target):
                source = self.client.get(target).get_data(as_text=True)
                choices = re.findall(r'name="appearance_material" value="([a-z]+)"', source)
                self.assertEqual(choices, [key for key, _ in MATERIAL_CHOICES])
                self.assertNotIn('随站点 · 晶透玻璃', source)
                self.assertNotIn('晶透磨砂玻璃', source)
                self.assertIn('material-chip-frosted', source)

    def test_clear_and_frosted_share_glass_model_but_have_distinct_saved_metadata(self):
        identifiers = {material: self.create(material) for material in ('glass', 'frosted')}
        for material, identifier in identifiers.items():
            finish = 'frosted' if material == 'frosted' else 'clear'
            for target in ('/', f'/post/{identifier}'):
                with self.subTest(material=material, target=target):
                    tag = self.article_tag(self.client.get(target).get_data(as_text=True), identifier)
                    self.assertIn('data-material="glass"', tag)
                    self.assertIn(f'data-glass-finish="{finish}"', tag)
                    self.assertNotIn('data-material="frosted"', tag)
            editor = self.client.get(f'/edit/{identifier}').get_data(as_text=True)
            self.assertIn(f'value="{material}" checked', editor)
            self.assertIn(f'data-glass-finish="{finish}" data-appearance-preview', editor)
            with self.app.app_context():
                self.assertEqual(db.session.get(PostAppearance, identifier).card_material, material)

    def test_edit_and_validation_failure_preserve_the_actual_finish(self):
        identifier = self.create('glass')
        target = f'/edit/{identifier}'
        response = self.client.post(target, data={'csrf_token': self.token(target),
            'body': '# Frosted revised', 'appearance_color': '#7ab8dd', 'appearance_material': 'frosted'})
        self.assertEqual(response.status_code, 302)
        response = self.client.post(target, data={'csrf_token': self.token(target),
            'body': '# Unsaved', 'appearance_color': '#bad', 'appearance_material': 'frosted'})
        self.assertEqual(response.status_code, 200)
        source = response.get_data(as_text=True)
        self.assertIn('value="frosted" checked', source)
        self.assertIn('data-material="glass" data-glass-finish="frosted" data-appearance-preview', source)
        self.assertIn('data-appearance-new="false"', source)
        response = self.client.post(target, data={'csrf_token': self.token(target), 'body': '# Body edit only'})
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            post = db.session.get(Post, identifier)
            self.assertEqual(post.body, '# Body edit only')
            self.assertEqual((post.appearance.theme_color, post.appearance.card_material), ('#7ab8dd', 'frosted'))
        response = self.client.post(target, data={'csrf_token': self.token(target),
            'body': '# Clear revised', 'appearance_color': '', 'appearance_material': 'glass'})
        self.assertEqual(response.status_code, 302)
        tag = self.article_tag(self.client.get(f'/post/{identifier}').get_data(as_text=True), identifier)
        self.assertIn('data-glass-finish="clear"', tag)

    def test_project_discussion_uses_the_same_finish_storage_and_rendering(self):
        target = '/projects/ssframework/talk/'
        body = '# Frosted project note\n\nThe original discussion path.'
        response = self.client.post(target, data={'csrf_token': self.token(target), 'body': body,
            'appearance_color': '#a59bd8', 'appearance_material': 'frosted'})
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            post = Post.query.filter_by(body=body).one()
            identifier = post.id
            self.assertEqual(post.appearance.card_material, 'frosted')
            self.assertEqual(post.project_entry.project_slug, 'ssframework')
        for url in (target, f'/post/{identifier}'):
            tag = self.article_tag(self.client.get(url).get_data(as_text=True), identifier)
            self.assertIn('data-material="glass"', tag)
            self.assertIn('data-glass-finish="frosted"', tag)

    def test_same_visitor_and_saved_frosted_finish_survive_app_restart(self):
        identifier = self.create('frosted')
        with self.app.app_context():
            visitor = User.query.filter_by(account_kind='guest').one().username
            epoch = db.session.execute(db.text('SELECT identity_epoch FROM public_demo_state WHERE id=1')).scalar_one()
            db.session.remove()
            db.engine.dispose()
        cookie_name = self.app.config['SESSION_COOKIE_NAME']
        cookie = self.client.get_cookie(cookie_name)
        restarted = create_app('public-demo')
        restarted.config.update(TESTING=True, SESSION_COOKIE_SECURE=False, LISS_EMAIL_ACCOUNTS=False)
        client = restarted.test_client()
        client.set_cookie(cookie_name, cookie.value)
        source = client.get('/').get_data(as_text=True)
        self.assertIn('/user/' + visitor, source)
        self.assertIn('data-glass-finish="frosted"', self.article_tag(source, identifier))
        with restarted.app_context():
            self.assertEqual(db.session.get(PostAppearance, identifier).card_material, 'frosted')
            self.assertEqual(db.session.execute(db.text('SELECT identity_epoch FROM public_demo_state WHERE id=1')).scalar_one(), epoch)
            db.session.remove()
            db.engine.dispose()

    def test_legacy_auto_mapping_and_invalid_token_guards_remain_explicit(self):
        with self.app.app_context():
            ui = self.app.jinja_env.get_template('_ui.html').module
            for identifier in range(24):
                expected = {3: 'ceramic', 6: 'paper', 7: 'metal'}.get(identifier % 8, 'glass')
                self.assertEqual(ui.card_material(identifier, 'auto'), expected)
                self.assertEqual(ui.glass_finish('auto'), 'clear')
            self.assertEqual(ui.card_material(3, 'frosted'), 'glass')
            self.assertEqual(ui.glass_finish('frosted'), 'frosted')
        for invalid in ('Frosted', 'frost', 'frosted" onclick="run()', 'frosted; DROP TABLE posts'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                normalize_material(invalid)


if __name__ == '__main__':
    unittest.main()
