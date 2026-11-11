"""Exercise asset verification, CSS URLs and page-specific resource delivery."""
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urljoin, urlsplit

from flask import Flask

from app import create_app, db
from app.frontend_assets import install
from app.models import Post, PostAppearance, Role, User
from config import TestingConfig


def sha(contents):
    return hashlib.sha256(contents).hexdigest()


class AssetVerificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.static = self.root / 'app' / 'static'
        self.static.mkdir(parents=True)
        (self.root / 'assets').mkdir()
        self.files = {'first.js': b'window.first = true;', 'second.js': b'window.second = true;'}
        for filename, contents in self.files.items():
            (self.static / filename).write_bytes(contents)
        (self.root / 'assets' / 'sources.json').write_text(
            json.dumps({'runtime': list(self.files)}), encoding='utf-8')
        self.bundle = b'window.first=true;window.second=true;'
        self.filename = f'bundles/runtime.{sha(self.bundle)[:16]}.js'
        (self.static / 'bundles').mkdir()
        (self.static / self.filename).write_bytes(self.bundle)
        self.manifest_file = self.static / 'asset-manifest.json'
        self.manifest = {'schema': 1, 'groups': {'runtime': {
            'file': self.filename, 'sha256': sha(self.bundle),
            'sources': {filename: sha(contents) for filename, contents in self.files.items()},
        }}}
        self.write_manifest(self.manifest)
        self.app = Flask(__name__, root_path=str(self.root / 'app'), static_folder='static')
        install(self.app)
        self.urls = self.app.jinja_env.globals['asset_urls']

    def write_manifest(self, value):
        previous = self.manifest_file.stat().st_mtime_ns if self.manifest_file.exists() else 0
        self.manifest_file.write_text(json.dumps(value), encoding='utf-8')
        # Deterministic cache invalidation even on filesystems with coarse timestamps.
        current = self.manifest_file.stat()
        os.utime(self.manifest_file, ns=(current.st_atime_ns, max(previous + 1_000_000, current.st_mtime_ns)))

    def fallback_urls(self):
        return [f'/static/{name}?v={sha((self.static / name).read_bytes())[:16]}' for name in self.files]

    def test_valid_bundle_has_stable_content_addressed_url(self):
        with self.app.test_request_context('/'):
            self.assertEqual(self.urls('runtime'), [f'/static/{self.filename}'])
            self.assertEqual(self.urls('runtime'), [f'/static/{self.filename}'])

    def test_source_change_invalidates_bundle_and_versions_fallback_in_source_order(self):
        with self.app.test_request_context('/'):
            self.assertEqual(self.urls('runtime'), [f'/static/{self.filename}'])
            (self.static / 'first.js').write_bytes(b'window.first = "changed";')
            self.assertEqual(self.urls('runtime'), self.fallback_urls())
            self.assertNotEqual(self.urls('runtime')[0], f'/static/first.js?v={sha(self.files["first.js"])[:16]}')

    def test_missing_and_tampered_bundle_fall_back_to_current_sources(self):
        with self.app.test_request_context('/'):
            self.urls('runtime')
            (self.static / self.filename).write_bytes(b'window.compromised = true;')
            self.assertEqual(self.urls('runtime'), self.fallback_urls())
            (self.static / self.filename).unlink()
            self.assertEqual(self.urls('runtime'), self.fallback_urls())

    def test_missing_and_invalid_json_manifest_fall_back(self):
        with self.app.test_request_context('/'):
            self.manifest_file.unlink()
            self.assertEqual(self.urls('runtime'), self.fallback_urls())
            self.manifest_file.write_text('{broken', encoding='utf-8')
            self.assertEqual(self.urls('runtime'), self.fallback_urls())

    def test_malformed_manifest_structures_fall_back(self):
        malformed = [None, [], {'groups': []}, {'groups': None},
                     {'groups': {'runtime': []}}, {'groups': {'runtime': None}},
                     {'groups': {'runtime': {'file': None}}},
                     {'groups': {'runtime': {'file': ['bundles/runtime.js']}}}]
        with self.app.test_request_context('/'):
            for value in malformed:
                with self.subTest(manifest=value):
                    self.write_manifest(value)
                    self.assertEqual(self.urls('runtime'), self.fallback_urls())

    def test_manifest_refresh_switches_to_new_verified_bundle(self):
        with self.app.test_request_context('/'):
            self.urls('runtime')
            contents = b'window.first=true;window.second=true;/* rebuilt */'
            filename = f'bundles/runtime.{sha(contents)[:16]}.js'
            (self.static / filename).write_bytes(contents)
            self.manifest['groups']['runtime'].update(file=filename, sha256=sha(contents))
            self.write_manifest(self.manifest)
            self.assertEqual(self.urls('runtime'), [f'/static/{filename}'])

    def test_disabled_bundles_use_hash_versioned_sources(self):
        self.app.config['LISS_USE_BUILT_ASSETS'] = False
        with self.app.test_request_context('/'):
            self.assertEqual(self.urls('runtime'), self.fallback_urls())

    def test_invalid_bundle_paths_are_not_served(self):
        with self.app.test_request_context('/'):
            for filename in ('first.js', '../outside.js', 'bundles/../first.js'):
                with self.subTest(filename=filename):
                    self.manifest['groups']['runtime']['file'] = filename
                    self.write_manifest(self.manifest)
                    self.assertEqual(self.urls('runtime'), self.fallback_urls())

    def test_asset_urls_respect_application_mount_prefix(self):
        with self.app.test_request_context('/', environ_overrides={'SCRIPT_NAME': '/forum'}):
            self.assertEqual(self.urls('runtime'), [f'/forum/static/{self.filename}'])
            self.app.config['LISS_USE_BUILT_ASSETS'] = False
            self.assertEqual(self.urls('runtime'), ['/forum' + url for url in self.fallback_urls()])


class ResourceParser(HTMLParser):
    def __init__(self, page):
        super().__init__()
        self.scripts = []
        self.styles = []
        self.elements = []
        self.feed(page)

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        self.elements.append((tag, values))
        if tag == 'script' and values.get('src'):
            self.scripts.append(values['src'])
        if tag == 'link' and values.get('rel') == 'stylesheet' and values.get('href'):
            self.styles.append(values['href'])


class PageAssetTests(unittest.TestCase):
    def setUp(self):
        # Force an isolated in-memory database even when a local TEST_DATABASE_URL exists.
        self.configuration = patch.multiple(TestingConfig,
            SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
            LISS_EMAIL_ACCOUNTS=False, LISS_INDEXING_ENABLED=False,
            LISS_PUBLIC_BASE_URL='', LISS_PORTFOLIO_URL='', LISS_USE_BUILT_ASSETS=True)
        self.configuration.start()
        self.addCleanup(self.configuration.stop)
        self.app = create_app('testing')
        with self.app.app_context():
            db.create_all()
            Role.insert_roles()
            user = User(email='asset-test@example.com', username='asset-test',
                        password='asset-test-password', confirmed=True)
            post = Post(body='# A page with an image\n\n![test](/static/textures/material-v22/paper-albedo.png)', author=user)
            db.session.add_all([user, post])
            db.session.commit()
            self.post_id = post.id
        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()

    def page(self, path):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, path)
        return ResourceParser(response.get_data(as_text=True))

    def group_urls(self, group):
        with self.app.test_request_context('/'):
            return self.app.jinja_env.globals['asset_urls'](group)

    def assert_group(self, page, group, present=True):
        for url in self.group_urls(group):
            if present:
                self.assertIn(url, page.scripts)
            else:
                self.assertNotIn(url, page.scripts)

    def login(self):
        response = self.client.post('/auth/login', data={
            'email': 'asset-test@example.com', 'password': 'asset-test-password'})
        self.assertEqual(response.status_code, 302)

    def test_anonymous_reading_pages_have_gallery_without_editor(self):
        for path in ('/', f'/post/{self.post_id}', '/user/asset-test', '/search?q=page', '/projects/outpost/talk/'):
            with self.subTest(path=path):
                page = self.page(path)
                self.assert_group(page, 'gallery')
                self.assert_group(page, 'writing', False)
                self.assertFalse(any('easymde' in url for url in page.scripts + page.styles))

    def test_login_page_has_portal_without_gallery_or_editor(self):
        page = self.page('/auth/login')
        self.assert_group(page, 'portals')
        self.assert_group(page, 'gallery', False)
        self.assert_group(page, 'writing', False)
        self.assertFalse(any('easymde' in url for url in page.scripts + page.styles))

    def test_background_viewer_is_available_in_production_but_initially_hidden(self):
        for local, path in ((False, '/'), (False, '/?background_review=1'),
                            (True, '/'), (True, '/?background_review=1')):
            with self.subTest(local=local, path=path):
                self.app.config['LISS_LOCAL_PREVIEW'] = local
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                html = response.get_data(as_text=True)
                page = ResourceParser(html)
                self.assert_group(page, 'background-review')
                for url in self.group_urls('background-review-styles'):
                    self.assertIn(url, page.styles)
                viewers = [attributes for _, attributes in page.elements
                           if 'data-background-viewer' in attributes]
                self.assertEqual(len(viewers), 1)
                self.assertIn('hidden', viewers[0])
                entries = [attributes for tag, attributes in page.elements
                           if tag == 'button' and 'data-background-viewer-start' in attributes]
                self.assertEqual(len(entries), 1)
                self.assertNotIn('hidden', entries[0])
                self.assertNotIn('background-advanced', html)
                self.assertNotIn('data-background-motion-note', html)
                self.assertNotIn('data-background-note', html)
                self.assertNotIn('background-viewer-hint', html)
                self.assertTrue(any('data-background-credit' in attributes
                                    for _, attributes in page.elements))
                self.assertNotIn('data-review-save', html)
                self.assertNotIn('data-review-export', html)
                self.assertNotIn('本地候选', html)

    def test_background_settings_and_hidden_viewer_are_on_reading_and_account_pages(self):
        for path in (f'/post/{self.post_id}', '/user/asset-test', '/auth/login'):
            with self.subTest(path=path):
                page = self.page(path)
                self.assert_group(page, 'background-review')
                self.assertTrue(any('data-background-dialog' in attributes
                                    for _, attributes in page.elements))
                viewers = [attributes for _, attributes in page.elements
                           if 'data-background-viewer' in attributes]
                self.assertEqual(len(viewers), 1)
                self.assertIn('hidden', viewers[0])

    def test_background_controls_preserve_an_articles_explicit_colour_and_material(self):
        with self.app.app_context():
            db.session.add(PostAppearance(post_id=self.post_id,
                theme_color='#cc7733', card_material='cork'))
            db.session.commit()
        for suffix in ('', '?background_review=1&scene=noctilucent-sea'):
            with self.subTest(suffix=suffix):
                page = self.page(f'/post/{self.post_id}{suffix}')
                body = next(attributes for tag, attributes in page.elements if tag == 'body')
                self.assertEqual(body['data-post-theme-color'], '#cc7733')
                self.assertEqual(body['data-community-theme'], 'post')
                self.assertTrue(any('data-background-dialog' in attributes
                                    for _, attributes in page.elements))
        with self.app.app_context():
            appearance = db.session.get(PostAppearance, self.post_id)
            self.assertEqual(appearance.theme_color, '#cc7733')
            self.assertEqual(appearance.card_material, 'cork')

    def test_authenticated_composer_pages_load_editor_and_gallery(self):
        self.login()
        for path in ('/write', f'/edit/{self.post_id}', '/projects/outpost/talk/'):
            with self.subTest(path=path):
                page = self.page(path)
                self.assert_group(page, 'writing')
                self.assert_group(page, 'gallery')
                self.assertTrue(any('easymde' in url for url in page.scripts))
                self.assertTrue(any('easymde' in url for url in page.styles))
                editor = next(i for i, url in enumerate(page.scripts) if 'easymde' in url)
                writing = page.scripts.index(self.group_urls('writing')[0])
                self.assertLess(editor, writing)

    def test_authenticated_reading_and_profile_pages_omit_editor(self):
        self.login()
        for path in (f'/post/{self.post_id}', '/user/asset-test', '/search?q=page', '/edit-profile'):
            with self.subTest(path=path):
                page = self.page(path)
                self.assert_group(page, 'writing', False)
                self.assertFalse(any('easymde' in url for url in page.scripts + page.styles))
                self.assert_group(page, 'gallery', path != '/edit-profile')

    def test_generated_css_preserves_reachable_font_and_texture_urls(self):
        static = Path(self.app.static_folder)
        manifest = json.loads((static / 'asset-manifest.json').read_text(encoding='utf-8'))
        filename = manifest['groups']['styles']['file']
        contents = (static / filename).read_text(encoding='utf-8')
        references = re.findall(r'url\(\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s)]+))\s*\)', contents)
        local_urls = set()
        for alternatives in references:
            reference = next(value for value in alternatives if value)
            if urlsplit(reference).scheme or reference.startswith(('#', '//')):
                continue
            self.assertTrue(reference.startswith('../'), reference)
            url = urljoin('/static/' + filename, reference)
            self.assertTrue(url.startswith('/static/'), url)
            local = (static / unquote(urlsplit(url).path.removeprefix('/static/'))).resolve()
            self.assertTrue(local.is_relative_to(static.resolve()), url)
            self.assertTrue(local.is_file(), url)
            local_urls.add(url)
        self.assertTrue(any('/fonts/' in url for url in local_urls))
        self.assertTrue(any('/textures/' in url for url in local_urls))
        for url in sorted(local_urls):
            with self.subTest(url=url), self.client.get(url) as response:
                self.assertEqual(response.status_code, 200)


if __name__ == '__main__':
    unittest.main()
