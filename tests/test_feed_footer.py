"""HTTP-rendered navigation follows identity, site settings and list context.

These checks use disposable databases and the real Jinja routes. Browser
geometry, photo contrast and the optional view controller have separate QA.
"""
from html.parser import HTMLParser
import re
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

if __package__:
    from . import test_discussions as discussions
else:
    import test_discussions as discussions

from app import create_app, db
from app.admin import SiteSettings
from app.models import Comment, Post, ReplyNotification, Role, User
from app.writing_guide import publish_writing_guide
from config import TestingConfig


class PageMarkup(HTMLParser):
    def __init__(self, content):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.footer_depth = 0
        self.stack = []
        self.links = []
        self.feed(content)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'footer' and (self.footer_depth or
                                'reading-footer' in values.get('class', '').split()):
            self.footer_depth += 1
        self.elements.append((tag, values, bool(self.footer_depth)))
        parent = self.stack[-1] if self.stack else {}
        hidden = (parent.get('hidden', False) or 'hidden' in values or
                  'inert' in values or values.get('aria-hidden', '').lower() == 'true')
        link = parent.get('link')
        if tag == 'a' and self.footer_depth:
            link = {'attrs': values, 'hidden': hidden, 'parts': []}
            self.links.append(link)
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                       'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append({'tag': tag, 'hidden': hidden, 'link': link})

    def handle_endtag(self, tag):
        if tag == 'footer' and self.footer_depth:
            self.footer_depth -= 1
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]['tag'] == tag:
                del self.stack[index:]
                break

    def handle_data(self, value):
        node = self.stack[-1] if self.stack else {}
        if node.get('link') is not None and not node.get('hidden'):
            node['link']['parts'].append(value)

    @property
    def footer_hrefs(self):
        return [attrs['href'] for tag, attrs, footer in self.elements
                if footer and tag == 'a' and 'href' in attrs]

    def with_attribute(self, name):
        return [attrs for _, attrs, _ in self.elements if name in attrs]

    def footer_link_names(self, href):
        """Read native link text, including sr-only copy but excluding hidden art."""
        return [re.sub(r'\s+', ' ', link['attrs'].get('aria-label') or
                       ' '.join(link['parts'])).strip()
                for link in self.links
                if link['attrs'].get('href') == href and not link['hidden']]


class FeedFooterTests(unittest.TestCase):
    token = discussions.DiscussionTests.token
    start = discussions.DiscussionTests.start
    submit = discussions.DiscussionTests.submit
    tearDown = discussions.DiscussionTests.tearDown

    def setUp(self):
        discussions.DiscussionTests.setUp(self)
        with self.app.app_context():
            self.owner_username = db.session.get(User, self.owner_id).username

    def page(self, path='/', client=None, **kwargs):
        response = (client or self.client).get(path, **kwargs)
        self.assertEqual(response.status_code, 200, path)
        return PageMarkup(response.get_data(as_text=True))

    def settings(self, **changes):
        with self.app.app_context():
            row = db.session.get(SiteSettings, 1)
            for name, value in changes.items():
                setattr(row, name, value)
            db.session.commit()

    def account(self):
        with self.app.app_context():
            db.session.add(User(username='footer_account', name='Footer reader',
                                password='footer-test-password', confirmed=True,
                                account_kind='account'))
            db.session.commit()
        client = self.app.test_client()
        response = self.submit(client, '/auth/login', {
            'username': 'footer_account', 'password': 'footer-test-password',
        }, token_path='/auth/login')
        self.assertEqual(response.status_code, 302)
        return client

    def assert_public_links(self, page):
        for href in ('/writing-guide/', '/search', '/works/', '#main-content'):
            self.assertIn(href, page.footer_hrefs)
        self.assertEqual(page.footer_link_names('/writing-guide/'), ['发文指南'])
        self.assertEqual(page.footer_link_names('/works/'), ['探索作品'])
        self.assertNotIn('/#article-feed', page.footer_hrefs)

    def test_anonymous_footer_offers_reading_and_a_real_visitor_writing_destination(self):
        page = self.page(client=self.app.test_client())
        self.assert_public_links(page)
        self.assertIn('/welcome', page.footer_hrefs)
        self.assertIn('/auth/login', page.footer_hrefs)
        self.assertNotIn('/notifications', page.footer_hrefs)
        writing = [href for href in page.footer_hrefs
                   if urlsplit(href).path == '/welcome' and urlsplit(href).query]
        self.assertEqual(len(writing), 1)
        self.assertEqual(parse_qs(urlsplit(writing[0]).query), {'next': ['/#write']})

    def test_visitor_footer_contains_private_navigation_and_identity_upgrade(self):
        page = self.page()
        self.assert_public_links(page)
        for href in ('/#write', f'/user/{self.owner_username}', '/notifications',
                     '/edit-profile', '/auth/register'):
            self.assertIn(href, page.footer_hrefs)
        self.assertNotIn('/auth/login', page.footer_hrefs)
        self.assertNotIn('/welcome', page.footer_hrefs)

    def test_closed_guest_writing_and_registration_keep_existing_identity_navigation(self):
        self.settings(registration_open=False, guest_posting_open=False)
        page = self.page()
        self.assert_public_links(page)
        for href in (f'/user/{self.owner_username}', '/notifications', '/edit-profile'):
            self.assertIn(href, page.footer_hrefs)
        for href in ('/#write', '/auth/register'):
            self.assertNotIn(href, page.footer_hrefs)
        anonymous = self.page(client=self.app.test_client())
        self.assert_public_links(anonymous)
        self.assertIn('/auth/login', anonymous.footer_hrefs)
        self.assertIn('/welcome', anonymous.footer_hrefs)
        self.assertFalse(any(parse_qs(urlsplit(href).query).get('next') == ['/#write']
                             for href in anonymous.footer_hrefs))

    def test_registered_account_keeps_writing_when_guest_and_registration_are_closed(self):
        client = self.account()
        self.settings(registration_open=False, guest_posting_open=False)
        page = self.page(client=client)
        self.assert_public_links(page)
        for href in ('/#write', '/user/footer_account', '/notifications', '/edit-profile'):
            self.assertIn(href, page.footer_hrefs)
        for href in ('/auth/login', '/auth/register', '/welcome'):
            self.assertNotIn(href, page.footer_hrefs)

    def test_pages_remove_pause_controls_and_keep_one_header_background_entry(self):
        for client, path in ((self.client, '/'), (self.client, '/notifications'),
                             (self.client, f'/post/{self.post_id}'),
                             (self.app.test_client(), '/search'),
                             (self.app.test_client(), '/auth/login')):
            with self.subTest(path=path):
                page = self.page(path, client)
                self.assertFalse(page.with_attribute('data-room-motion-toggle'))
                background_controls = [(attrs, footer) for _, attrs, footer in page.elements
                                       if 'data-background-open' in attrs]
                self.assertEqual(len(background_controls), 1)
                self.assertFalse(background_controls[0][1])
                self.assertEqual(len([1 for tag, attrs, _ in page.elements if tag == 'footer'
                                      and 'reading-footer' in attrs.get('class', '').split()]), 1)

    def test_footer_uses_escaped_site_configuration(self):
        self.settings(site_name='Reader <script>alert(1)</script>',
                      tagline='Useful <b>words</b> & real writing')
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        footer = re.search(r'<footer\b[^>]*class="[^"]*\breading-footer\b[^"]*"[^>]*>.*?</footer>',
                           response.get_data(as_text=True), re.S)[0]
        self.assertIn('Reader &lt;script&gt;alert(1)&lt;/script&gt;', footer)
        self.assertIn('Useful &lt;b&gt;words&lt;/b&gt; &amp; real writing', footer)
        self.assertNotIn('<script>', footer)
        self.assertNotIn('<b>words</b>', footer)

    def test_footer_ends_with_a_quiet_signature_instead_of_a_slogan(self):
        for path in ('/', f'/post/{self.post_id}', '/search'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                page = response.get_data(as_text=True)
                footer = re.search(r'<footer\b[^>]*class="[^"]*\breading-footer\b[^"]*"[^>]*>.*?</footer>', page, re.S)[0]
                self.assertIn('@Liss', re.sub(r'<[^>]+>', ' ', footer))
                self.assertNotIn('一个想法，下一段对话。', footer)

    def test_footer_signature_resolves_the_real_site_author(self):
        with self.app.app_context():
            db.session.add(User(username='footer_author', name='Liss',
                                password='footer-author-test-password', confirmed=True,
                                account_kind='account', is_site_owner=True))
            db.session.commit()
        for client in (self.client, self.app.test_client()):
            with self.subTest(anonymous=client is not self.client):
                page = self.page(client=client)
                self.assertEqual(page.footer_link_names('/user/footer_author'), ['站点作者的主页'])

    def test_published_guide_has_one_footer_link_and_hidden_guide_keeps_builtin_help(self):
        with self.app.app_context():
            publication = publish_writing_guide()
            self.assertEqual(publication['status'], 'created')
            guide_id = publication['post_id']
        for client in (self.client, self.app.test_client()):
            with self.subTest(anonymous=client is not self.client):
                page = self.page(client=client)
                self.assertIn('/writing-guide/', page.footer_hrefs)
                self.assertEqual(len(page.footer_link_names('/writing-guide/')), 1)
                self.assertIn('发文指南', page.footer_link_names('/writing-guide/')[0])
                destination = client.get('/writing-guide/')
                self.assertEqual(destination.status_code, 302)
                self.assertEqual(urlsplit(destination.location).path, f'/post/{guide_id}')
        with self.app.app_context():
            db.session.get(Post, guide_id).hidden = True
            db.session.commit()
        self.assertEqual(self.page().footer_link_names('/writing-guide/'), ['发文指南'])
        for client in (self.client, self.app.test_client()):
            destination = client.get('/writing-guide/')
            self.assertEqual(destination.status_code, 200)
            self.assertIn('id="writing-guide-title"', destination.get_data(as_text=True))
        with self.app.app_context():
            self.assertTrue(db.session.get(Post, guide_id).hidden)

    def test_footer_notification_link_names_a_real_unread_reply_without_marking_it_read(self):
        reader = self.app.test_client()
        self.start(reader)
        response = self.submit(reader, f'/post/{self.post_id}', {'body': 'Footer reply'})
        self.assertEqual(response.status_code, 302)
        page = self.page()
        names = page.footer_link_names('/notifications')
        self.assertEqual(len(names), 1)
        self.assertRegex(names[0], r'回复提醒\s*1\s*条未读')
        with self.app.app_context():
            notification = ReplyNotification.query.filter_by(recipient_id=self.owner_id).one()
            self.assertIsNone(notification.read_at)
        anonymous = self.page(client=self.app.test_client())
        self.assertFalse(anonymous.footer_link_names('/notifications'))

    def test_footer_caps_large_unread_name_and_retains_notification_link_after_read_all(self):
        reader = self.app.test_client()
        reader_id = self.start(reader)
        with self.app.app_context():
            comments = [Comment(body=f'Footer reminder {index}', post_id=self.post_id,
                                author_id=reader_id) for index in range(101)]
            db.session.add_all(comments)
            db.session.flush()
            db.session.add_all([ReplyNotification(recipient_id=self.owner_id, comment=comment)
                                for comment in comments])
            db.session.commit()
        names = self.page().footer_link_names('/notifications')
        self.assertEqual(len(names), 1)
        self.assertRegex(names[0], r'回复提醒\s*99\+\s*条未读')
        response = self.submit(self.client, '/notifications/read-all', {})
        self.assertEqual(response.status_code, 302)
        names = self.page().footer_link_names('/notifications')
        self.assertEqual(len(names), 1)
        self.assertIn('回复提醒', names[0])
        self.assertNotIn('未读', names[0])

    def test_feed_controls_have_one_matching_target_only_on_list_pages(self):
        paths = ('/', f'/user/{self.owner_username}', '/projects/dubforge/talk/')
        for client in (self.client, self.app.test_client()):
            for path in paths:
                with self.subTest(path=path, anonymous=client is not self.client):
                    page = self.page(path, client)
                    controls = page.with_attribute('data-feed-view-control')
                    targets = page.with_attribute('data-feed-list')
                    self.assertEqual(len(controls), 1)
                    self.assertEqual(controls[0].get('role'), 'group')
                    self.assertIn('hidden', controls[0])
                    self.assertEqual([item.get('id') for item in targets], ['article-list'])
                    buttons = page.with_attribute('data-feed-view-value')
                    self.assertEqual([item['data-feed-view-value'] for item in buttons], ['cards', 'list'])
                    self.assertEqual([item.get('aria-pressed') for item in buttons], ['true', 'false'])
                    self.assertTrue(all(item.get('type') == 'button' and
                                        item.get('aria-controls') == 'article-list' for item in buttons))

    def test_feed_controls_and_target_are_absent_from_reading_search_and_account_pages(self):
        for path in (f'/post/{self.post_id}', '/search?q=needle',
                     f'/edit/{self.post_id}', '/edit-profile', '/notifications', '/auth/login'):
            with self.subTest(path=path):
                page = self.page(path)
                self.assertFalse(page.with_attribute('data-feed-view-control'))
                self.assertFalse(page.with_attribute('data-feed-view-value'))
                self.assertFalse(page.with_attribute('data-feed-list'))

    def test_all_and_followed_filters_keep_feed_controls_after_the_native_redirect(self):
        for path in ('/all', '/followed'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 302)
                page = self.page(path, follow_redirects=True)
                self.assertEqual(len(page.with_attribute('data-feed-view-control')), 1)
                self.assertEqual(len(page.with_attribute('data-feed-list')), 1)


class StandardFooterTests(unittest.TestCase):
    def setUp(self):
        self.configuration = patch.multiple(TestingConfig,
            SQLALCHEMY_DATABASE_URI='sqlite:///:memory:', LISS_EMAIL_ACCOUNTS=False,
            LISS_INDEXING_ENABLED=False, LISS_PUBLIC_BASE_URL='', LISS_PORTFOLIO_URL='')
        self.configuration.start()
        self.app = create_app('testing')
        with self.app.app_context():
            db.create_all()
            Role.insert_roles()
        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()
        self.configuration.stop()

    def test_standard_anonymous_footer_links_to_login_and_registration_without_visitor_routes(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        page = PageMarkup(response.get_data(as_text=True))
        self.assertIn('/auth/login', page.footer_hrefs)
        self.assertIn('/auth/register', page.footer_hrefs)
        self.assertNotIn('/welcome', page.footer_hrefs)
        writing = [href for href in page.footer_hrefs
                   if urlsplit(href).path == '/auth/login' and urlsplit(href).query]
        self.assertEqual(len(writing), 1)
        self.assertEqual(parse_qs(urlsplit(writing[0]).query), {'next': ['/#write']})


if __name__ == '__main__':
    unittest.main()
