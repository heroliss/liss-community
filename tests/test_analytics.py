"""Visitor analytics: collection, dashboards, cleanup, ignore list and access control."""
import html
import json
import re
import tempfile
import unittest
from unittest.mock import patch

from app import create_app, db
from app.admin import AdminAudit
from app.analytics_store import parse_ua
from app.models import Role, User

VID, SID, PV = 'a' * 24, 'b' * 24, 'c' * 24
CHROME = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
          'Chrome/142.0.0.0 Safari/537.36')


def batch(**overrides):
    body = {'v': 1, 'site': 'works', 'vid': VID, 'sid': SID, 'now': 1_900_000_000_000,
            'pv': {'id': PV, 'url': 'https://heroliss.github.io/liss-works/projects/glass-atoll/',
                   'path': '/liss-works/projects/glass-atoll/', 'title': '玻璃海', 'ref': 'https://www.google.com/',
                   'active': 12_000, 'total': 15_000, 'scroll': 64, 'vp': '1280x720',
                   'perf': {'ttfb': 120, 'dom': 800, 'load': 1500}, 'end': False},
            'ev': [{'t': 1_899_999_999_000, 'type': 'click', 'label': '进入玻璃海', 'target': 'a.button',
                    'href': 'https://heroliss.github.io/liss-works/play/glass-atoll/', 'x': 10, 'y': 20}],
            'ctx': {'lang': 'zh-CN', 'tz': 'Asia/Shanghai', 'screen': '2560x1440'},
            'sref': 'https://www.google.com/', 'landing': '/liss-works/projects/glass-atoll/'}
    body.update(overrides)
    return body


class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict('os.environ', {
            'SECRET_KEY': 'temporary-analytics-test-key-' * 3, 'LISS_DATA_DIR': self.directory.name,
            'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0'})
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False,
                               PUBLIC_DEMO_AUTH_LIMIT=200, PUBLIC_DEMO_WRITE_LIMIT=200)
        self.client = self.app.test_client()
        self.client.get('/')
        with self.app.app_context():
            user = User(username='stats_owner', name='Owner', password='temporary-test-password-24',
                        role=Role.query.filter_by(default=True).one(), account_kind='account',
                        email='stats@example.invalid', confirmed=True)
            db.session.add(user)
            db.session.commit()
        result = self.app.test_cli_runner().invoke(args=['grant-admin', '--username', 'stats_owner'])
        self.assertEqual(result.exit_code, 0, result.output)

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def login(self):
        token = self.csrf('/auth/login')
        response = self.client.post('/auth/login', data={'username': 'stats_owner',
                                    'password': 'temporary-test-password-24', 'csrf_token': token})
        self.assertIn(response.status_code, {200, 302})

    def csrf(self, path):
        page = self.client.get(path).get_data(as_text=True)
        return html.unescape(re.search(r'name="csrf_token"[^>]*value="([^"]+)"', page).group(1))

    def collect(self, body, origin='https://heroliss.github.io', ip='203.0.113.7', ua=CHROME, client=None):
        return (client or self.client).post('/analytics/collect', data=json.dumps(body, ensure_ascii=False),
                                content_type='text/plain;charset=UTF-8',
                                headers={'Origin': origin, 'User-Agent': ua}, environ_base={'REMOTE_ADDR': ip})

    def store(self):
        return self.app.extensions['analytics']

    def test_collect_records_visitor_session_pageview_and_events(self):
        self.assertEqual(self.collect(batch()).status_code, 204)
        update = batch(ev=[], sref=None)
        update['pv'] = dict(update['pv'], active=30_000, total=40_000, scroll=90, end=True)
        self.assertEqual(self.collect(update).status_code, 204)
        store = self.store()
        visitor = store.query('SELECT * FROM visitors')[0]
        self.assertEqual((visitor['first_ip'], visitor['browser'], visitor['os'], visitor['device']),
                         ('203.0.113.7', 'Chrome 142', 'Windows 10/11', '电脑'))
        session = store.query('SELECT * FROM sessions')[0]
        self.assertEqual((session['referrer_host'], session['landing']), ('google.com', '/liss-works/projects/glass-atoll/'))
        view = store.query('SELECT * FROM pageviews')[0]
        self.assertEqual((view['active_ms'], view['total_ms'], view['scroll'], view['ended'], view['clicks'], view['load_ms']),
                         (30_000, 40_000, 90, 1, 1, 1500))
        event = store.query('SELECT * FROM events')[0]
        self.assertEqual((event['type'], event['label'], event['path']), ('click', '进入玻璃海', '/liss-works/projects/glass-atoll/'))

    def test_collect_rejects_foreign_origin_bad_ids_and_large_bodies(self):
        self.assertEqual(self.collect(batch(), origin='https://evil.example').status_code, 403)
        self.assertEqual(self.collect(batch(vid='short')).status_code, 204)
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews'), 0)
        big = batch()
        big['pv']['title'] = 'x' * 70_000
        self.assertEqual(self.collect(big).status_code, 413)
        # A session cannot be adopted by another visitor id.
        self.collect(batch())
        self.collect(batch(vid='d' * 24, pv=dict(batch()['pv'], id='e' * 24)))
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews'), 1)

    def test_collect_skips_community_lock_session_and_csrf(self):
        response = self.collect(batch(site='forum'), origin='http://localhost', client=self.app.test_client())
        self.assertEqual(response.status_code, 204)
        self.assertNotIn('Set-Cookie', response.headers)

    def test_dashboards_require_admin_and_render(self):
        self.collect(batch())
        self.collect(batch(vid='f' * 24, sid='g' * 24, pv=dict(batch()['pv'], id='h' * 24)), ip='198.51.100.4',
                     ua='Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile MicroMessenger/8.0.50')
        self.assertEqual(self.client.get('/admin/analytics').status_code, 403)
        self.login()
        pages = ['/admin/analytics', '/admin/analytics?range=today', '/admin/analytics?range=all&site=works&bots=1',
                 '/admin/analytics?range=custom&from=2020-01-01&to=2030-01-01', '/admin/analytics/live',
                 '/admin/analytics/visitors', '/admin/analytics/visitors?by=ip&sort=pv', '/admin/analytics/visitors?q=203.0',
                 f'/admin/analytics/visitor/{VID}', '/admin/analytics/ip/203.0.113.7', '/admin/analytics/pages?range=all',
                 '/admin/analytics/page?range=all&s=works&path=/liss-works/projects/glass-atoll/',
                 '/admin/analytics/events?range=all&type=click', '/admin/analytics/data']
        for path in pages:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path + response.get_data(as_text=True)[:400])
        overview = self.client.get('/admin/analytics?range=all').get_data(as_text=True)
        self.assertIn('访问统计', overview)
        self.assertIn('玻璃海', overview)
        visitors = self.client.get('/admin/analytics/visitors?range=all').get_data(as_text=True)
        self.assertIn('203.0.113.7', visitors)
        self.assertIn('微信', visitors)
        csv_text = self.client.get('/admin/analytics/export?kind=pageviews&range=all').get_data(as_text=True)
        self.assertTrue(csv_text.startswith('﻿时间'))
        self.assertIn('203.0.113.7', csv_text)
        self.assertEqual(self.client.get('/admin/analytics/visitor/zz').status_code, 404)
        self.assertEqual(self.client.get('/admin/analytics/ip/not-an-ip').status_code, 404)

    def test_overview_lists_404_pages_with_referrers(self):
        missing = batch(pv=dict(batch()['pv'], id='m' * 24, path='/liss-works/old-link/', title='没有找到页面 · Liss Works',
                                ref='https://example.org/blog'))
        self.collect(missing)
        self.login()
        page = self.client.get('/admin/analytics?range=all').get_data(as_text=True)
        self.assertIn('/liss-works/old-link/', page)
        self.assertIn('https://example.org/blog', page)

    def test_tracker_tag_on_community_pages_not_admin(self):
        self.assertIn('liss-analytics.js', self.client.get('/').get_data(as_text=True))
        self.login()
        self.assertNotIn('liss-analytics.js', self.client.get('/admin/').get_data(as_text=True))

    def test_delete_requires_preview_and_confirmation_and_is_audited(self):
        self.collect(batch())
        self.collect(batch(vid='f' * 24, sid='g' * 24, pv=dict(batch()['pv'], id='h' * 24)), ip='198.51.100.4')
        self.login()
        token = self.csrf('/admin/analytics/data')
        preview = self.client.post('/admin/analytics/delete/preview', data={'scope': 'ip', 'ip': '203.0.113.7', 'csrf_token': token})
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews'), 2)
        confirm = html.unescape(re.search(r'name="token"[^>]*value="([^"]+)"', preview.get_data(as_text=True)).group(1))
        applied = self.client.post('/admin/analytics/delete/apply', data={'token': confirm, 'csrf_token': token})
        self.assertEqual(applied.status_code, 302)
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews'), 1)
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM visitors'), 1)
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM events WHERE ip = ?', ('203.0.113.7',)), 0)
        with self.app.app_context():
            entry = AdminAudit.query.filter_by(action='analytics.delete').one()
            self.assertTrue(entry.changes)
        self.assertEqual(self.client.post('/admin/analytics/delete/apply', data={'token': 'bad', 'csrf_token': token}).status_code, 400)
        self.assertEqual(self.client.get('/admin/audit?kind=analytics').status_code, 200)

    def test_ignored_ip_stops_new_records(self):
        self.login()
        token = self.csrf('/admin/analytics/data')
        response = self.client.post('/admin/analytics/ignore', data={'ip': '203.0.113.7', 'ignored': '1', 'csrf_token': token})
        self.assertEqual(response.status_code, 302)
        self.collect(batch())
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews'), 0)
        self.client.post('/admin/analytics/ignore', data={'ip': '203.0.113.7', 'ignored': '0', 'csrf_token': token})
        self.collect(batch())
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews'), 1)

    def test_region_lookup_without_and_with_database(self):
        from app.ip_region import RegionLookup, area, pretty
        lookup = RegionLookup(self.directory.name)
        self.assertFalse(lookup.available)
        self.assertEqual((lookup.lookup('127.0.0.1'), lookup.lookup('10.1.2.3'), lookup.lookup('8.8.8.8')), ('本机', '内网', ''))
        self.assertEqual(pretty('中国|广东省|深圳市|电信|CN'), '中国 广东省 深圳市 · 电信')
        self.assertEqual(area('中国|广东省|深圳市|电信|CN'), '广东省')
        self.assertEqual(area('United States|California|0|Google LLC|US'), 'United States')
        self.login()
        self.collect(batch())
        self.assertEqual(self.client.get('/admin/analytics?range=all').status_code, 200)
        self.assertIn('未安装', self.client.get('/admin/analytics/data').get_data(as_text=True))

    def test_user_agent_classification(self):
        self.assertEqual(parse_ua(CHROME)['device'], '电脑')
        self.assertEqual(parse_ua('Mozilla/5.0 (compatible; Googlebot/2.1)')['bot'], 1)
        android = parse_ua('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36')
        self.assertEqual((android['os'], android['device'], android['browser']), ('Android 14', '手机', 'Chrome 141'))
        self.assertEqual(parse_ua('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Safari/604.1')['device'], '平板')


if __name__ == '__main__':
    unittest.main()
