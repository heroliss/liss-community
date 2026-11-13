"""Per-IP page rate limit and the weekly visitor summary email."""
import html
import re
import tempfile
import unittest
from unittest.mock import patch

from app import create_app, db
from app.models import Role, User
from app import rate_limit, weekly_digest


class RateLimitAndDigestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict('os.environ', {
            'SECRET_KEY': 'temporary-digest-test-key-' * 3, 'LISS_DATA_DIR': self.directory.name,
            'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0'})
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False, PUBLIC_DEMO_AUTH_LIMIT=200,
                               PUBLIC_DEMO_WRITE_LIMIT=200)
        self.client = self.app.test_client()
        self.client.get('/')
        rate_limit._hits.clear()
        weekly_digest._state['week'] = None

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def test_page_rate_limit_per_ip(self):
        self.app.config.update(PAGE_RATE_LIMIT=5, PAGE_RATE_LIMIT_IN_TESTS=True)
        codes = [self.client.get('/', environ_base={'REMOTE_ADDR': '198.51.100.1'}).status_code for _ in range(7)]
        self.assertEqual(codes[:5], [200] * 5)
        blocked = self.client.get('/', environ_base={'REMOTE_ADDR': '198.51.100.1'})
        self.assertEqual(blocked.status_code, 429)
        self.assertIn('请求过于频繁', blocked.get_data(as_text=True))
        self.assertTrue(blocked.headers.get('Retry-After'))
        # Other IPs, static files and the collector are unaffected.
        self.assertEqual(self.client.get('/', environ_base={'REMOTE_ADDR': '198.51.100.2'}).status_code, 200)
        self.assertNotEqual(self.client.get('/static/liss-analytics.js', environ_base={'REMOTE_ADDR': '198.51.100.1'}).status_code, 429)
        self.assertNotEqual(self.client.get('/healthz', environ_base={'REMOTE_ADDR': '198.51.100.1'}).status_code, 429)
        self.app.config['PAGE_RATE_LIMIT'] = 0
        self.assertEqual(self.client.get('/', environ_base={'REMOTE_ADDR': '198.51.100.1'}).status_code, 200)

    def enable_mail(self):
        self.app.config.update(LISS_EMAIL_ACCOUNTS=True, LISS_MAIL_PROVIDER='outbox',
                               LISS_PUBLIC_BASE_URL='https://liss.example.test', LISS_DIGEST_EMAIL='owner@example.com',
                               WEEKLY_DIGEST_IN_TESTS=True)

    def test_weekly_digest_sends_once_per_week(self):
        self.enable_mail()
        self.client.get('/')
        outbox = self.app.extensions.get('liss_mail_outbox', [])
        self.assertEqual(len(outbox), 1)
        message = outbox[0]
        self.assertEqual(message['to'], 'owner@example.com')
        self.assertIn('每周访问摘要', message['subject'])
        self.assertIn('热门页面', message['text'])
        self.assertIn('查看完整统计', message['html'])
        self.assertIn('https://liss.example.test/admin/analytics', message['html'])
        weekly_digest._state['week'] = None  # A reloaded worker reads the stored week.
        self.client.get('/')
        self.assertEqual(len(outbox), 1)
        status = self.app.extensions['analytics'].scalar("SELECT value FROM meta WHERE key = 'digest_status'")
        self.assertIn('已发送', status)

    def test_digest_off_without_mail_and_admin_controls(self):
        self.app.config['WEEKLY_DIGEST_IN_TESTS'] = True
        self.client.get('/')
        self.assertEqual(self.app.extensions.get('liss_mail_outbox', []), [])
        with self.app.app_context():
            user = User(username='digest_owner', name='Owner', password='temporary-test-password-24',
                        role=Role.query.filter_by(default=True).one(), account_kind='account',
                        email='digest@example.invalid', confirmed=True)
            db.session.add(user)
            db.session.commit()
        self.app.test_cli_runner().invoke(args=['grant-admin', '--username', 'digest_owner'])
        page = self.client.get('/auth/login').get_data(as_text=True)
        token = html.unescape(re.search(r'name="csrf_token"[^>]*value="([^"]+)"', page).group(1))
        self.client.post('/auth/login', data={'username': 'digest_owner', 'password': 'temporary-test-password-24',
                                              'csrf_token': token})
        data = self.client.get('/admin/analytics/data').get_data(as_text=True)
        self.assertIn('邮件服务未配置', data)
        self.assertIn('访问频率限制', data)
        self.enable_mail()
        self.app.config['WEEKLY_DIGEST_IN_TESTS'] = False
        data = self.client.get('/admin/analytics/data').get_data(as_text=True)
        self.assertIn('owner@example.com', data)
        preview = self.client.get('/admin/analytics/digest/preview')
        self.assertEqual(preview.status_code, 200)
        self.assertIn('每周访问摘要', preview.get_data(as_text=True))
        token = html.unescape(re.search(r'name="csrf_token"[^>]*value="([^"]+)"', data).group(1))
        response = self.client.post('/admin/analytics/digest/test', data={'csrf_token': token})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(self.app.extensions.get('liss_mail_outbox', [])), 1)
        status = self.app.extensions['analytics'].scalar("SELECT value FROM meta WHERE key = 'digest_status'")
        self.assertTrue(status.startswith('测试：已发送'))
        self.assertIsNone(self.app.extensions['analytics'].scalar("SELECT value FROM meta WHERE key = 'digest_week'"))


if __name__ == '__main__':
    unittest.main()
