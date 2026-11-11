"""The dedicated writing page: access, publishing, guest rules and links to it."""
import html
import os
import re
import tempfile
import unittest
from unittest.mock import patch

from app import create_app, db
from app.models import Post, PostAppearance


class WritePageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='liss-write-page-')
        self.environment = patch.dict(os.environ, {
            'SECRET_KEY': 'isolated-write-page-tests-' * 3,
            'LISS_DATA_DIR': self.directory.name,
            'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0',
        }, clear=True)
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False,
                               LISS_EMAIL_ACCOUNTS=False, MAIL_SUPPRESS_SEND=True)
        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def token(self, target):
        response = self.client.get(target)
        self.assertEqual(response.status_code, 200)
        return html.unescape(re.search(r'name="csrf_token"[^>]*value="([^"]+)"', response.get_data(as_text=True)).group(1))

    def join(self):
        response = self.client.post('/welcome', data={'csrf_token': self.token('/welcome')})
        self.assertEqual(response.status_code, 302)

    def test_anonymous_visitors_are_sent_to_join_first(self):
        response = self.client.get('/write')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/welcome', response.headers['Location'])
        self.assertRegex(response.headers['Location'], r'next=(/|%2F)write')

    def test_page_has_studio_layout_editor_assets_and_prompts(self):
        self.join()
        page = self.client.get('/write').get_data(as_text=True)
        for marker in ('data-write-studio', 'class="write-main"', 'class="write-side"', 'data-write-prompt=',
                       'name="appearance_material"', 'easymde', 'data-writing-scope="/"'):
            self.assertIn(marker, page)
        self.assertNotIn('data-write-orb', page)
        self.assertNotIn('class="depth-workpad"', page)

    def test_publishing_creates_the_article_with_appearance_and_opens_it(self):
        self.join()
        response = self.client.post('/write', data={
            'csrf_token': self.token('/write'), 'body': '# From the studio\n\nA short note.',
            'appearance_color': '#7ab8dd', 'appearance_material': 'water'})
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            post = Post.query.filter_by(body='# From the studio\n\nA short note.').one()
            self.assertTrue(response.headers['Location'].endswith(f'/post/{post.id}'))
            appearance = db.session.get(PostAppearance, post.id)
            self.assertEqual((appearance.theme_color, appearance.card_material), ('#7ab8dd', 'water'))

    def test_empty_body_stays_on_the_page_with_an_error(self):
        self.join()
        with self.app.app_context():
            before = Post.query.count()
        response = self.client.post('/write', data={'csrf_token': self.token('/write'), 'body': ''})
        self.assertEqual(response.status_code, 200)
        self.assertIn('data-write-studio', response.get_data(as_text=True))
        with self.app.app_context():
            self.assertEqual(Post.query.count(), before)

    def test_closed_guest_posting_shows_a_notice_and_refuses_posts(self):
        self.join()
        token = self.token('/write')
        with self.app.app_context():
            from app.admin import SiteSettings
            settings = db.session.get(SiteSettings, 1) or SiteSettings(id=1)
            settings.guest_posting_open = False
            db.session.add(settings)
            db.session.commit()
        page = self.client.get('/write').get_data(as_text=True)
        self.assertIn('访客发文暂时关闭', page)
        self.assertNotIn('class="write-main"', page)
        response = self.client.post('/write', data={'csrf_token': token, 'body': 'Closed for guests'})
        self.assertEqual(response.status_code, 403)

    def test_index_links_lead_to_the_writing_page(self):
        self.join()
        page = self.client.get('/').get_data(as_text=True)
        self.assertIn('class="composer-entry" id="write" href="/write"', page)
        self.assertIn('href="/write?prompt=', page)
        self.assertIn('class="write-orb" href="/write"', page)
        self.assertNotIn('<details class="composer"', page)


if __name__ == '__main__':
    unittest.main()
