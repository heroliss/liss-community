"""Indexing is opt-in; real rendered metadata never reveals private context."""
import html
from html.parser import HTMLParser
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET

from flask import render_template

from app import create_app, db
from app.models import Comment, Post, ReplyNotification, User
from app.seo import XMLNS, metadata, public_request, robots_policy


class HeadParser(HTMLParser):
    def __init__(self, content):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.canonicals = []
        self.feed(content)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'meta':
            self.meta[values.get('name') or values.get('property')] = values.get('content', '')
        if tag == 'link' and values.get('rel') == 'canonical':
            self.canonicals.append(values.get('href'))


class SeoOfflineRenderTests(unittest.TestCase):
    def test_mail_render_without_request_uses_generic_metadata_and_no_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / 'unprepared-mail-app'
            with patch.dict('os.environ', {
                    'SECRET_KEY': 'seo-offline-test-secret-' * 3,
                    'LISS_DATA_DIR': str(storage), 'LISS_EMAIL_ACCOUNTS': '0',
                    'LIHOU_PROXY_HOPS': '0'}):
                app = create_app('public-demo')
            app.config['TESTING'] = True
            recipient = type('Recipient', (), {'display_name': 'Reader'})()
            payload = dict(user=recipient, heading='Test', action='Continue',
                           link='https://example.invalid/action', explanation='Test mail')
            with patch('app.discussions.reply_notification_query',
                       side_effect=AssertionError('Unexpected reminder database query')):
                with app.app_context():
                    self.assertFalse(public_request())
                    self.assertEqual(robots_policy(), 'noindex, nofollow')
                    page_meta = metadata({})
                    self.assertIsNone(page_meta['canonical'])
                    self.assertIsNone(page_meta['image'])
                    self.assertEqual(page_meta['robots'], 'noindex, nofollow')
                    self.assertIn('Reader', render_template('auth/email/account_action.html', **payload))
                with app.test_request_context('/'):
                    self.assertIn('Reader', render_template('auth/email/account_action.html', **payload))
            with app.app_context():
                db.session.remove()
                db.engine.dispose()
            self.assertFalse((storage / 'public-demo.sqlite').exists())


class SeoTests(unittest.TestCase):
    origin = 'https://community.example.com'

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict('os.environ', {
            'SECRET_KEY': 'seo-test-secret-' * 4, 'LISS_DATA_DIR': self.directory.name,
            'LISS_EMAIL_ACCOUNTS': '0', 'LIHOU_PROXY_HOPS': '0',
            'LISS_INDEXING_ENABLED': '0', 'LISS_LOCAL_PREVIEW': '0',
        })
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False,
            LISS_INDEXING_ENABLED=False, LISS_LOCAL_PREVIEW=False, LISS_PUBLIC_BASE_URL=self.origin)
        self.client = self.app.test_client()
        self.client.get('/')
        with self.app.app_context():
            user = User(username='SeoAuthor', name='A "quoted" & <script>alert(1)</script>',
                        about_me='Public "biography" & <img src=x onerror=alert(2)>',
                        password='seo-test-only', account_kind='account', confirmed=True)
            self.visible = Post(body='# A "quoted" & title\n\nPublic description.\n\n![Cover](/static/community-writing.svg)', author=user)
            hidden = Post(body='# Secret hidden article\n\nHidden distinctive content', author=user, hidden=True)
            db.session.add_all([user, self.visible, hidden])
            db.session.commit()
            self.visible_id, self.hidden_id, self.author_id = self.visible.id, hidden.id, user.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def enable(self, **values):
        self.app.config.update(LISS_INDEXING_ENABLED=True, **values)

    def head(self, response):
        return HeadParser(response.get_data(as_text=True))

    def guest(self):
        page = self.client.get('/welcome').get_data(as_text=True)
        token = html.unescape(re.search(r'name="csrf_token"[^>]*value="([^"]+)"', page)[1])
        self.assertEqual(self.client.post('/welcome', data={'csrf_token': token}).status_code, 302)
        with self.client.session_transaction() as session:
            return int(session['public_demo_uid'])

    def test_default_is_noindex_and_sitemap_is_unavailable(self):
        for path in ('/', f'/post/{self.visible_id}', '/user/SeoAuthor'):
            response = self.client.get(path)
            self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow')
            self.assertEqual(self.head(response).meta['robots'], 'noindex, nofollow')
        self.assertIn('Disallow: /', self.client.get('/robots.txt').get_data(as_text=True))
        self.assertEqual(self.client.get('/sitemap.xml').status_code, 404)

    def test_explicit_indexing_enables_only_public_content(self):
        self.enable()
        for path in ('/', f'/post/{self.visible_id}', '/user/SeoAuthor', '/projects/liss-web/talk/'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['X-Robots-Tag'], 'index, follow')
            self.assertEqual(self.head(response).meta['robots'], 'index, follow')
            self.assertEqual(self.head(response).canonicals, [self.origin + path])
        robots = self.client.get('/robots.txt').get_data(as_text=True)
        self.assertIn('Disallow: /notifications', robots)
        self.assertIn('Sitemap: ' + self.origin + '/sitemap.xml', robots)

    def test_local_preview_overrides_explicit_indexing(self):
        self.enable(LISS_LOCAL_PREVIEW=True)
        self.assertEqual(self.client.get('/').headers['X-Robots-Tag'], 'noindex, nofollow')
        self.assertIn('Disallow: /', self.client.get('/robots.txt').get_data(as_text=True))
        self.assertEqual(self.client.get('/sitemap.xml').status_code, 404)

    def test_privacy_pages_keep_generic_share_text_and_no_canonical(self):
        self.enable()
        recipient = self.guest()
        with self.app.app_context():
            comment = Comment(body='Private reminder text sentinel', post_id=self.visible_id, author_id=self.author_id)
            db.session.add(comment)
            db.session.flush()
            db.session.add(ReplyNotification(recipient_id=recipient, comment=comment))
            db.session.commit()
        for path in ('/auth/login', '/auth/register', '/edit-profile', '/notifications', '/search?q=private-query-sentinel'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            parsed = self.head(response)
            self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow')
            self.assertEqual(parsed.meta['robots'], 'noindex, nofollow')
            self.assertEqual(parsed.canonicals, [])
            self.assertNotIn('og:image', parsed.meta)
            self.assertNotIn('private-query-sentinel', repr(parsed.meta))
            self.assertNotIn('Private reminder text sentinel', repr(parsed.meta))

    def test_followed_feed_and_query_variants_are_not_indexed(self):
        self.enable()
        for query in ('?q=private', '?page=2&page=3', '?preview=v32', '?page=0', '?page=٢', '?page=' + '9' * 100):
            response = self.client.get('/' + query)
            self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow')
            self.assertEqual(self.head(response).canonicals, [])
        self.client.set_cookie('show_followed', '1')
        self.assertEqual(self.client.get('/').headers['X-Robots-Tag'], 'noindex, nofollow')

    def test_canonical_pages_preserve_feed_pages_and_collapse_comment_pages(self):
        self.enable()
        response = self.client.get('/?page=0002')
        self.assertEqual(self.head(response).canonicals, [self.origin + '/?page=2'])
        response = self.client.get('/user/SeoAuthor?page=2')
        self.assertEqual(self.head(response).canonicals, [self.origin + '/user/SeoAuthor?page=2'])
        response = self.client.get(f'/post/{self.visible_id}?page=2')
        self.assertEqual(self.head(response).canonicals, [self.origin + f'/post/{self.visible_id}'])

    def test_hidden_and_missing_pages_have_consistent_noindex_meta_and_headers(self):
        self.enable()
        for path in (f'/post/{self.hidden_id}', '/post/999999', '/user/no-such-author'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow')
            self.assertEqual(self.head(response).meta['robots'], 'noindex, nofollow')
            self.assertEqual(self.head(response).canonicals, [])

    def test_sitemaps_exclude_hidden_posts_and_only_use_fixed_origin(self):
        self.enable()
        response = self.client.get('/sitemap.xml', base_url='https://attacker.invalid')
        index = ET.fromstring(response.data)
        self.assertEqual(response.status_code, 200)
        locations = [element.text for element in index.findall('.//{' + XMLNS + '}loc')]
        self.assertTrue(all(value.startswith(self.origin + '/') for value in locations))
        post_map = self.client.get('/sitemaps/posts/1.xml', base_url='https://attacker.invalid')
        locations = [element.text for element in ET.fromstring(post_map.data).findall('.//{' + XMLNS + '}loc')]
        self.assertIn(self.origin + f'/post/{self.visible_id}', locations)
        self.assertNotIn(self.origin + f'/post/{self.hidden_id}', locations)
        self.assertNotIn('Secret hidden', post_map.get_data(as_text=True))

    def test_host_and_forwarded_headers_cannot_poison_share_urls(self):
        self.enable()
        response = self.client.get(f'/post/{self.visible_id}', base_url='https://attacker.invalid',
                                   headers={'X-Forwarded-Host': 'other-attacker.invalid'})
        parsed = self.head(response)
        expected = self.origin + f'/post/{self.visible_id}'
        self.assertEqual(parsed.canonicals, [expected])
        self.assertEqual(parsed.meta['og:url'], expected)
        self.assertEqual(parsed.meta['og:image'], self.origin + '/static/community-writing.svg')
        self.assertNotIn('attacker.invalid', repr(parsed.meta))

    def test_sitemap_pages_are_bounded_without_duplicates_or_hidden_urls(self):
        self.enable()
        with self.app.app_context():
            expected = {self.origin + f'/post/{post.id}' for post in Post.query.filter_by(hidden=False)}
        with patch('app.seo.SITEMAP_SIZE', 2):
            index = ET.fromstring(self.client.get('/sitemap.xml').data)
            pages = [element.text for element in index.findall('.//{' + XMLNS + '}loc')
                     if '/sitemaps/posts/' in element.text]
            actual = []
            for location in pages:
                response = self.client.get(location[len(self.origin):])
                self.assertEqual(response.status_code, 200)
                locations = [element.text for element in ET.fromstring(response.data).findall('.//{' + XMLNS + '}loc')]
                self.assertLessEqual(len(locations), 2)
                actual.extend(locations)
            self.assertEqual(set(actual), expected)
            self.assertEqual(len(actual), len(set(actual)))

    def test_share_attribute_text_is_html_escaped(self):
        self.enable()
        response = self.client.get('/user/SeoAuthor')
        page = response.get_data(as_text=True)
        self.assertNotIn('<script>alert(1)</script>', page)
        self.assertNotIn('<img src=x onerror=alert(2)>', page)
        self.assertIn('&lt;script&gt;', page)
        parsed = self.head(response)
        self.assertIn('"quoted"', parsed.meta['og:title'])
        self.assertIn('<script>alert(1)</script>', parsed.meta['og:title'])

    def test_invalid_public_origin_does_not_enable_indexing(self):
        self.enable()
        for origin in ('http://example.com', 'https://localhost', 'https://127.0.0.1',
                       'https://example.local', 'https://example.com:443', 'https://user@example.com',
                       'https://example.com/path', 'https://example.com?secret=1', 'https://bad..example'):
            self.app.config['LISS_PUBLIC_BASE_URL'] = origin
            with self.subTest(origin=origin):
                response = self.client.get('/')
                self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow')
                self.assertEqual(self.head(response).canonicals, [])

    def test_sitemap_page_input_is_bounded_before_integer_conversion(self):
        self.enable()
        for page in ('0', '-1', 'invalid', '999999999', '9' * 100, '9' * 5000):
            with self.subTest(length=len(page)):
                response = self.client.get('/sitemaps/posts/' + page + '.xml')
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow')

    def test_missing_bundle_does_not_receive_a_year_of_immutable_caching(self):
        response = self.client.get('/static/bundles/nonexistent-seo-test.js')
        self.assertEqual(response.status_code, 404)
        self.assertNotIn('immutable', response.headers.get('Cache-Control', ''))
