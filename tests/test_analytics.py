"""Visitor analytics: collection, dashboards, cleanup, ignore list and access control."""
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from app import create_app, db
from app.admin import AdminAudit
from app.analytics_store import classify, env_facts, network_type, parse_ua, refine_os, signals, tz_matches_region
from app.models import Role, User

VID, SID, PV = 'a' * 24, 'b' * 24, 'c' * 24


def secrets_hex():
    import secrets
    return secrets.token_hex(12)
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
        cookies = response.headers.getlist('Set-Cookie')
        # Only the device id and (community) the visitor id, never a session.
        self.assertEqual(sorted(c.split('=')[0] for c in cookies), ['liss_d', 'liss_v'])
        self.assertIn('liss_v=' + VID, ' '.join(cookies))
        works = self.collect(batch(), client=self.app.test_client()).headers.getlist('Set-Cookie')
        self.assertEqual([c.split('=')[0] for c in works], ['liss_d'])  # github.io cannot read pythonanywhere cookies.

    def test_dashboards_require_admin_and_render(self):
        self.collect(batch())
        self.collect(batch(vid='f' * 24, sid='g' * 24, pv=dict(batch()['pv'], id='h' * 24),
                           ctx={'lang': 'zh-CN', 'tz': 'Asia/Shanghai', 'screen': '390x844@3'}), ip='198.51.100.4',
                     ua='Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile MicroMessenger/8.0.50')
        self.assertEqual(self.client.get('/admin/analytics').status_code, 403)
        self.login()
        pages = ['/admin/analytics', '/admin/analytics?range=today', '/admin/analytics?range=all&site=works&bots=1',
                 '/admin/analytics?range=custom&from=2020-01-01&to=2030-01-01', '/admin/analytics/live',
                 '/admin/analytics/visitors', '/admin/analytics/visitors?by=ip&sort=pv', '/admin/analytics/visitors?q=203.0',
                 '/admin/analytics/visitors?by=record', '/admin/analytics/visitors?by=suggest', '/admin/analytics/visitors?by=device',
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


    def test_visitor_types_from_recorded_signals(self):
        iphone = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
                  'Version/26.0 Mobile/15E148 Safari/604.1')
        linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
        cases = [
            (dict(ua=CHROME, lang='zh-CN', tz='Asia/Kuala_Lumpur', screen='2560x1440'), 0),
            (dict(ua=CHROME.replace('Chrome/', 'Claude/5.1 Chrome/'), tz='Asia/Kuala_Lumpur', screen='2560x1440'), 3),
            (dict(ua=CHROME.replace('Chrome', 'HeadlessChrome'), tz='UTC', screen='800x600'), 1),
            (dict(ua='Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)'), 1),
            (dict(ua=iphone, lang='en-US@posix', tz='UTC', screen='1920x1080'), 2),
            (dict(ua='"' + iphone, tz='Etc/Unknown', screen='390x844@3'), 2),
            (dict(ua=CHROME.replace('142', '104'), tz='UTC', screen='1366x768'), 2),
            (dict(ua=linux, tz='UTC', screen='1366x768'), 2),
            (dict(ua=linux, tz='UTC', screen='1366x768', human=1), 0),  # Two weak signals, but a person moved the mouse.
            (dict(ua=CHROME, tz='Asia/Shanghai', screen='1920x1080', env='{"wd": true}'), 2),
            (dict(ua=CHROME, tz='Asia/Shanghai', screen='1920x1080',
                  env='{"gpu": "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))"}'), 2),
            (dict(ua=iphone, tz='Asia/Shanghai', screen='390x844@3', env='{"tp": 0}'), 2),
        ]
        for visitor, expected in cases:
            self.assertEqual(classify(visitor)[0], expected, visitor)
        self.assertEqual(classify(dict(ua=CHROME, tz='Asia/Shanghai', screen='1920x1080'), owner=True)[0], 4)
        self.assertEqual(classify(dict(ua=CHROME, screen='800x600'), owner=True)[0], 3)
        self.assertEqual(classify(dict(ua=linux, tz='UTC', screen='1920x1080'), region='美国|0|弗吉尼亚|0|亚马逊')[0], 2)

    def test_owner_ip_marking_and_type_filters(self):
        self.collect(batch(), ip='198.51.100.20')
        # Separate browsers: each gets its own device cookie.
        self.collect(batch(vid='d' * 24, sid='e' * 24, pv=dict(batch()['pv'], id='f' * 24)), ip='203.0.113.7',
                     client=self.app.test_client())
        self.collect(batch(vid='g' * 24, sid='h' * 24, pv=dict(batch()['pv'], id='i' * 24)), ip='192.0.2.5',
                     ua=CHROME.replace('Chrome', 'HeadlessChrome'), client=self.app.test_client())
        kinds = {r['id'][0]: r['bot'] for r in self.store().query('SELECT id, bot FROM visitors')}
        self.assertEqual(kinds, {'a': 0, 'd': 0, 'g': 1})
        self.login()
        # The administrator now browses from 198.51.100.20: that earlier visitor becomes 本人, on every table.
        self.client.get('/admin/analytics', environ_base={'REMOTE_ADDR': '198.51.100.20'})
        self.assertEqual(self.store().scalar('SELECT bot FROM visitors WHERE id = ?', (VID,)), 4)
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews WHERE visitor_id = ? AND bot <> 4', (VID,)), 0)
        default = self.client.get('/admin/analytics/visitors?range=all').get_data(as_text=True)
        self.assertIn('203.0.113.7', default)
        self.assertNotIn('198.51.100.20', default)
        self.assertNotIn('192.0.2.5', default)
        owner = self.client.get('/admin/analytics/visitors?range=all&who=owner').get_data(as_text=True)
        self.assertIn('198.51.100.20', owner)
        self.assertIn('an-kind-owner', owner)
        self.assertIn('192.0.2.5', self.client.get('/admin/analytics/visitors?range=all&who=all').get_data(as_text=True))
        self.assertIn('192.0.2.5', self.client.get('/admin/analytics/visitors?range=all&bots=1').get_data(as_text=True))
        self.assertNotIn('192.0.2.5', self.client.get('/admin/analytics/live').get_data(as_text=True))
        self.assertIn('192.0.2.5', self.client.get('/admin/analytics/live?who=bot').get_data(as_text=True))
        # Later visits from the owner IP are classified on arrival.
        self.collect(batch(vid='j' * 24, sid='k' * 24, pv=dict(batch()['pv'], id='l' * 24)), ip='198.51.100.20')
        self.assertEqual(self.store().scalar('SELECT bot FROM pageviews WHERE id = ?', ('l' * 24,)), 4)

    def test_manual_type_and_tracker_signals(self):
        body = batch()
        body['ctx'] = dict(body['ctx'], env={'wd': False, 'hc': 8, 'tp': 0, 'gpu': 'ANGLE (NVIDIA GeForce RTX 4070)', 'bogus': 'x'})
        body['pv'] = dict(body['pv'], hi=True)
        self.collect(body)
        row = self.store().query('SELECT env, human, bot FROM visitors')[0]
        stored = json.loads(row['env'])
        self.assertEqual({k: stored[k] for k in ('wd', 'hc', 'tp', 'gpu')}, {'wd': False, 'hc': 8, 'tp': 0, 'gpu': 'ANGLE (NVIDIA GeForce RTX 4070)'})
        self.assertNotIn('bogus', stored)
        self.assertEqual(stored['h'], 1)  # Request headers were read.
        self.assertEqual((row['human'], row['bot']), (1, 0))
        self.login()
        page = self.client.get(f'/admin/analytics/visitor/{VID}').get_data(as_text=True)
        self.assertIn('RTX 4070', page)
        self.assertIn('有真人操作', page)
        token = self.csrf(f'/admin/analytics/visitor/{VID}')
        self.client.post('/admin/analytics/kind', data={'visitor': VID, 'kind': '1', 'csrf_token': token})
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM pageviews WHERE bot = 1'), 1)
        self.collect(body)  # A manually set type survives new visits.
        self.assertEqual(self.store().scalar('SELECT bot FROM visitors'), 1)
        self.client.post('/admin/analytics/kind', data={'visitor': VID, 'kind': 'auto', 'csrf_token': token})
        self.assertEqual(self.store().scalar('SELECT bot FROM visitors'), 0)
        bad = self.client.post('/admin/analytics/kind', data={'visitor': VID, 'kind': '9', 'csrf_token': token})
        self.assertEqual(bad.status_code, 400)

    def test_upgrade_reclassifies_old_rows(self):
        iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile Safari/604.1'
        body = batch()
        body['ctx'] = {'lang': 'en-US@posix', 'tz': 'UTC', 'screen': '1920x1080'}
        self.collect(body, ua=iphone)
        store = self.store()
        with store.connect() as connection:
            for table in ('visitors', 'sessions', 'pageviews', 'events'):
                connection.execute(f'UPDATE {table} SET bot = 0')
            connection.execute("UPDATE meta SET value = '1' WHERE key = 'schema'")
        store._ready = False
        self.assertEqual(store.scalar('SELECT COUNT(*) FROM pageviews WHERE bot = 2'), 1)
        self.assertEqual(store.scalar("SELECT value FROM meta WHERE key = 'schema'"), '5')
        self.assertEqual(store.scalar('SELECT person_id FROM pageviews'), VID)


    def test_header_and_fingerprint_signals(self):
        iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1'
        phone = {'lang': 'zh-CN', 'tz': 'Asia/Shanghai', 'screen': '390x844@3'}
        # A real iPhone (Safari sends no client hints) stays a visitor.
        self.collect(batch(ctx=phone), ua=iphone, client=None)
        self.assertEqual(self.store().scalar('SELECT bot FROM visitors'), 0)
        # The same claim with Chromium client hints is a disguise.
        body = batch(vid='d' * 24, sid='e' * 24, pv=dict(batch()['pv'], id='f' * 24), ctx=phone)
        self.client.post('/analytics/collect', data=json.dumps(body), content_type='text/plain',
                         headers={'Origin': 'https://heroliss.github.io', 'User-Agent': iphone,
                                  'Sec-CH-UA': '"Chromium";v="141", "Not?A_Brand";v="8"', 'Sec-CH-UA-Platform': '"Linux"',
                                  'Accept-Language': 'en-US'}, environ_base={'REMOTE_ADDR': '192.0.2.9'})
        row = self.store().query("SELECT bot, kind_reason, env FROM visitors WHERE id = ?", ('d' * 24,))[0]
        self.assertEqual(row['bot'], 2)
        self.assertIn('Chromium 客户端提示', row['kind_reason'])
        self.assertEqual(json.loads(row['env'])['chp'], 'Linux')
        reasons = classify(dict(ua=CHROME, tz='Asia/Shanghai', screen='1920x1080',
                                env=json.dumps({'h': 1, 'al': 'zh-CN', 'chua': '"Chromium";v="142"', 'chp': 'Linux'})))
        self.assertEqual(reasons[0], 2)
        self.assertIn('请求头系统为 Linux', reasons[1][0])
        for env in ({'hl': True},):
            self.assertEqual(classify(dict(ua=CHROME, tz='Asia/Shanghai', screen='1920x1080', env=json.dumps(env)))[0], 2, env)
        weak = classify(dict(ua=CHROME, tz='UTC', screen='1920x1080', env=json.dumps({'h': 1, 'pl': 0})))
        self.assertEqual(weak[0], 2)
        self.assertIn('请求缺少 Accept-Language', weak[1])
        self.assertEqual(refine_os('Windows 10/11', {'pv': '15.0.0', 'chp': 'Windows'}), 'Windows 11')
        self.assertEqual(refine_os('Windows 10/11', {'pv': '10.0.0'}), 'Windows 10')
        self.assertEqual(refine_os('macOS', {'pv': '15.3.1'}), 'macOS 15.3')

    def test_owner_flag_inputs_reclassify_and_breakdown(self):
        body = batch()
        body['ctx'] = dict(body['ctx'], env={'me': True, 'pv': '15.0.0', 'mdl': '', 'ptr': 'fine', 'hdr': True})
        body['pv'] = dict(body['pv'], hi=True, inp=7)
        self.collect(body)
        row = self.store().query('SELECT bot, kind_reason, os FROM visitors')[0]
        self.assertEqual((row['bot'], row['os']), (4, 'Windows 11'))
        self.assertIn('标记为本人', row['kind_reason'])
        self.assertEqual(self.store().scalar('SELECT inputs FROM pageviews'), 7)
        # Later batches without the async signals keep them (merge, not replace).
        later = batch()
        later['ctx'] = dict(later['ctx'], env={'hc': 8})
        self.collect(later)
        env = json.loads(self.store().scalar('SELECT env FROM visitors'))
        self.assertTrue(env['me'] and env['hdr'] and env['hc'] == 8)
        facts = dict(env_facts(self.store().query('SELECT * FROM visitors')[0]))
        self.assertEqual(facts['指针'], '鼠标 / 触控板')
        self.assertIn('HDR', facts['屏幕能力'])
        self.login()
        overview = self.client.get('/admin/analytics?range=all').get_data(as_text=True)
        self.assertIn('an-kind-split', overview)
        self.assertIn('an-kind-owner', overview)
        page = self.client.get(f'/admin/analytics/visitor/{VID}').get_data(as_text=True)
        self.assertIn('操作 7 次', page)
        self.assertIn('Windows 11', page)
        with self.store().connect() as connection:
            connection.execute('UPDATE visitors SET bot = 0')
        token = self.csrf('/admin/analytics/data')
        response = self.client.post('/admin/analytics/reclassify', data={'csrf_token': token})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.store().scalar('SELECT bot FROM visitors'), 4)
        self.assertIn('本人 1', self.client.get('/admin/analytics/data').get_data(as_text=True))


    def test_huawei_phone_is_a_visitor(self):
        # Real HarmonyOS phone: ArkWeb shows the notification quirk that headless Chrome has.
        ua = ('Mozilla/5.0 (Phone; OpenHarmony 7.0; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 '
              'Safari/537.36  ArkWeb/7.0.0.111 Mobile HuaweiBrowser/6.1.9.323')
        env = {'al': 'zh-CN,zh;q=0.9', 'gpu': 'Maleoon 935F', 'h': 1, 'hc': 12, 'tp': 10, 'np': True, 'pl': 5,
               'pf': 'Linux x86_64', 'ptr': 'coarse', 'wd': False, 'hl': False}
        visitor = dict(ua=ua, lang='zh-CN', tz='Asia/Shanghai', screen='374x823@3.5', env=json.dumps(env), human=1)
        self.assertEqual(classify(visitor)[0], 0)
        self.assertEqual(classify(dict(visitor, human=0, tz='UTC'))[0], 2)  # The quirk still counts as weak evidence.

    def test_device_cookie_links_sites_and_shares_owner(self):
        client = self.app.test_client()
        works = batch()
        forum = batch(site='forum', vid='d' * 24, sid='e' * 24, pv=dict(batch()['pv'], id='f' * 24, path='/', url='https://liss.pythonanywhere.com/'))
        first = self.collect(works, ip='198.51.100.50', client=client)
        cookie = first.headers.get('Set-Cookie', '')
        self.assertIn('liss_d=', cookie)
        self.assertIn('HttpOnly', cookie)
        self.collect(forum, origin='https://liss.pythonanywhere.com', ip='203.0.113.60', client=client)
        rows = {r['id'][0]: r['device_id'] for r in self.store().query('SELECT id, device_id FROM visitors')}
        self.assertEqual(rows['a'], rows['d'])
        self.assertTrue(rows['a'])
        # Marking the forum browser as the owner carries over to its portfolio record.
        marked = batch(site='forum', vid='d' * 24, sid='e' * 24, pv=dict(forum['pv']))
        marked['ctx'] = dict(marked['ctx'], env={'me': True})
        self.collect(marked, origin='https://liss.pythonanywhere.com', ip='203.0.113.60', client=client)
        kinds = {r['id'][0]: (r['bot'], r['kind_reason']) for r in self.store().query('SELECT id, bot, kind_reason FROM visitors')}
        self.assertEqual(kinds['d'][0], 4)
        self.assertEqual(kinds['a'], (4, '同一访客的其他记录已标记为本人'))
        # Another browser (no cookie) stays separate.
        self.collect(batch(vid='g' * 24, sid='h' * 24, pv=dict(batch()['pv'], id='i' * 24)), ip='192.0.2.70')
        self.assertNotEqual(self.store().scalar('SELECT device_id FROM visitors WHERE id = ?', ('g' * 24,)), rows['a'])
        self.login()
        page = self.client.get(f'/admin/analytics/visitor/{VID}').get_data(as_text=True)
        self.assertIn('2 条记录合并', page)
        self.assertIn('同一浏览器（设备标识）', page)
        self.assertIn('d' * 24, page)
        visitors = self.client.get('/admin/analytics/visitors?range=all&who=all').get_data(as_text=True)
        self.assertIn('2 条记录', visitors)
        self.assertIn('共 <strong>2</strong> 位访客', visitors)  # The two linked records, plus the other browser.


    def test_evidence_network_and_proxy_hints(self):
        self.assertEqual(network_type('美国|0|弗吉尼亚|0|亚马逊'), 'dc')
        self.assertEqual(network_type('United States|Virginia|Ashburn|Amazon|US'), 'dc')
        self.assertEqual(network_type('中国|广东省|深圳市|电信|CN'), 'isp')
        self.assertEqual(network_type('Malaysia|Johor|Segamat|TM TECHNOLOGY SERVICES|MY'), 'isp')
        self.assertEqual(network_type(''), '')
        self.assertEqual(network_type('中国|香港特别行政区|0|0|HK', '43.130.59.209'), 'dc')
        self.assertEqual(network_type('', '170.106.161.78'), 'dc')
        self.assertEqual(network_type('', '8.8.8.8'), '')
        old_ios = signals(dict(ua='Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 Version/13.0.3 Mobile/15E148 Safari/604.1',
                               tz='Asia/Shanghai', screen='390x844@3', last_ip='43.130.59.209'), '中国|香港特别行政区|0|0|HK')
        self.assertIn('iOS 13 版本过旧', old_ios['weak'])
        self.assertIn('IP 属于云服务器 / 机房', old_ios['weak'])
        self.assertIs(tz_matches_region('Asia/Shanghai', '中国|广东省|深圳市|电信|CN'), True)
        self.assertIs(tz_matches_region('Asia/Shanghai', '中国|香港|0|0|HK'), False)
        self.assertIs(tz_matches_region('Asia/Shanghai', 'Taiwan|0|0|HiNet|TW'), False)
        self.assertIs(tz_matches_region('Asia/Kuala_Lumpur', 'Malaysia|Johor|0|TM|MY'), True)
        self.assertIsNone(tz_matches_region('Europe/Oslo', 'Norway|0|0|0|NO'))
        found = signals(dict(ua=CHROME, tz='Asia/Shanghai', screen='1920x1080', human=1,
                             env=json.dumps({'gpu': 'ANGLE (NVIDIA GeForce RTX 4070)', 'chp': 'Windows'})),
                        'Taiwan|0|0|HiNet|TW')
        self.assertTrue(any('真实显卡' in t for t in found['good']))
        self.assertTrue(any('真人操作' in t for t in found['good']))
        self.assertIn('请求头系统与 User-Agent 一致', found['good'])
        self.assertTrue(found['proxy'] and found['info'])
        self.assertEqual(parse_ua('Mozilla/5.0 (compatible; liss-ops-links)')['bot'], 1)
        body = batch()
        body['ctx'] = dict(body['ctx'], env={'gpu': 'ANGLE (NVIDIA GeForce RTX 4070)', 'cv': '1a2b3c4d'})
        body['pv'] = dict(body['pv'], hi=True)
        self.collect(body)
        self.login()
        page = self.client.get(f'/admin/analytics/visitor/{VID}').get_data(as_text=True)
        self.assertIn('类型与判断依据', page)
        self.assertIn('is-good', page)
        visitors = self.client.get('/admin/analytics/visitors?range=all').get_data(as_text=True)
        self.assertIn('an-kind-split', visitors)

    def test_server_log_page(self):
        log = Path(self.directory.name) / 'site.access.log'
        lines = [
            '10.0.0.1 - - [12/Nov/2026:19:50:01 +0000] "GET / HTTP/1.1" 200 5120 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "66.249.66.1" response-time=0.210',
            '10.0.0.1 - - [12/Nov/2026:19:50:02 +0000] "GET /wp-login.php HTTP/1.1" 404 900 "-" "Mozilla/5.0 zgrab" "45.1.2.3" response-time=0.010',
            '10.0.0.1 - - [12/Nov/2026:19:50:03 +0000] "GET /healthz HTTP/1.1" 200 15 "-" "liss-ops-uptime" "20.1.2.3" response-time=0.005',
            '10.0.0.1 - - [12/Nov/2026:19:50:04 +0000] "GET /post/5 HTTP/1.1" 200 8000 "https://www.bing.com/" "' + CHROME + '" "58.26.140.36" response-time=0.400',
            '10.0.0.1 - - [12/Nov/2026:19:50:05 +0000] "GET /static/liss.css HTTP/1.1" 304 0 "-" "' + CHROME + '" "58.26.140.36" response-time=0.002',
            '10.0.0.1 - - [12/Nov/2026:19:50:06 +0000] "GET /nope HTTP/1.1" 404 900 "-" "' + CHROME + '" "58.26.140.36" response-time=0.030',
            '10.0.0.1 - - [12/Nov/2026:19:50:07 +0000] "GET /welcome HTTP/1.1" 200 900 "-" "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1" "43.130.59.209" response-time=0.080',
            'garbage line',
        ]
        log.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        import gzip
        with gzip.open(str(log) + '.2.gz', 'wt', encoding='utf-8') as handle:
            handle.write(lines[0].replace('19:50:01', '18:00:00') + '\n')
        self.app.config['ANALYTICS_ACCESS_LOG'] = str(log)
        self.login()
        page = self.client.get('/admin/analytics/server').get_data(as_text=True)
        self.assertIn('服务器日志', page)
        self.assertIn('日志文件最后更新', page)
        self.assertIn('Googlebot', page)
        self.assertIn('/wp-login.php', page)
        self.assertIn('66.249.66.1', page)
        self.assertNotIn('/static/liss.css', page)  # Page requests only by default.
        self.assertIn('/static/liss.css', self.client.get('/admin/analytics/server?show=all').get_data(as_text=True))
        bots = self.client.get('/admin/analytics/server?k=bot').get_data(as_text=True)
        self.assertIn('66.249.66.1', bots)
        self.assertNotIn('GET /post/5', bots)  # Not in the request table; summary cards cover all kinds.
        self.assertIn('/nope', self.client.get('/admin/analytics/server?st=4&k=human').get_data(as_text=True))
        self.assertIn('liss-ops-uptime', self.client.get('/admin/analytics/server?show=all&k=monitor').get_data(as_text=True))
        cloud = self.client.get('/admin/analytics/server?k=cloud').get_data(as_text=True)
        self.assertIn('43.130.59.209', cloud)  # Tencent Cloud range with a browser User-Agent.
        self.assertIn('机房来源', cloud)
        from app import access_log
        hits = access_log.read(str(log))
        self.assertEqual(len(hits), 8)  # Seven current lines plus one rotated, garbage skipped.
        self.assertEqual(hits[-1]['ts'] < hits[0]['ts'], True)
        self.app.config['ANALYTICS_ACCESS_LOG'] = str(log) + '.missing'
        self.assertIn('没有找到访问日志', self.client.get('/admin/analytics/server').get_data(as_text=True))


    def test_sources_share_links_paths_and_engagement(self):
        from app.analytics_insights import classify_source, share_url
        self.assertEqual(classify_source('google.com.hk'), ('search', 'Google'))
        self.assertEqual(classify_source('chatgpt.com'), ('ai', 'ChatGPT'))
        self.assertEqual(classify_source('', '', '微信 8'), ('social', '微信（应用内打开）'))
        self.assertEqual(classify_source('bing.com', 'from=简历'), ('campaign', '简历'))
        self.assertEqual(classify_source('heroliss.github.io'), ('internal', '来自作品站'))
        self.assertEqual(share_url('https://heroliss.github.io/liss-works/?a=1', '微信群'),
                         'https://heroliss.github.io/liss-works/?a=1&from=%E5%BE%AE%E4%BF%A1%E7%BE%A4')
        # Visit 1 (Google): two pages, works -> forum. Visit 2 (share link): one short page, no interaction.
        first = batch()
        self.collect(first)
        second_page = batch(site='forum', pv=dict(batch()['pv'], id='z' * 24, path='/', url='https://liss.pythonanywhere.com/',
                                                  title='社区首页', active=3000))
        second_page.pop('sref')
        self.collect(second_page, origin='https://liss.pythonanywhere.com')
        shared = batch(vid='d' * 24, sid='e' * 24, pv=dict(batch()['pv'], id='f' * 24, active=2000), utm='from=简历',
                       sref='', ev=[])
        self.collect(shared, ip='203.0.113.9', client=self.app.test_client())
        self.login()
        overview = self.client.get('/admin/analytics?range=all').get_data(as_text=True)
        self.assertIn('有效访问', overview)
        self.assertIn('来源渠道', overview)
        self.assertIn('第一次看？', overview)
        sources = self.client.get('/admin/analytics/sources?range=all').get_data(as_text=True)
        self.assertIn('搜索引擎', sources)
        self.assertIn('分享链接', sources)
        self.assertIn('简历', sources)
        token = self.csrf('/admin/analytics/sources')
        response = self.client.post('/admin/analytics/campaign', data={'name': '简历', 'target': 'works', 'csrf_token': token})
        self.assertEqual(response.status_code, 302)
        listed = self.client.get('/admin/analytics/sources?range=all').get_data(as_text=True)
        self.assertIn('from=%E7%AE%80%E5%8E%86', listed)
        self.client.post('/admin/analytics/campaign', data={'name': 'bad&name', 'target': 'works', 'csrf_token': token})
        self.client.post('/admin/analytics/campaign', data={'name': '外站', 'target': 'custom', 'custom': 'https://evil.example/',
                                                             'csrf_token': token})
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM campaigns'), 1)
        self.client.post('/admin/analytics/campaign/delete', data={'name': '简历', 'csrf_token': token})
        self.assertEqual(self.store().scalar('SELECT COUNT(*) FROM campaigns'), 0)
        from_forum = batch(vid='k' * 24, sid='m' * 24, pv=dict(batch()['pv'], id='n' * 24), sref='https://liss.pythonanywhere.com/post/5')
        self.collect(from_forum, ip='203.0.113.11', client=self.app.test_client())
        journeys = self.client.get('/admin/analytics/journeys?range=all').get_data(as_text=True)
        self.assertRegex(journeys, r'an-site-forum[^<]*</span></span><span class="an-path-arrow"[^>]*>→</span><span><span class="an-site an-site-works')
        self.assertIn('最常见的路径', journeys)
        self.assertIn('社区首页', journeys)
        page = self.client.get('/admin/analytics/page?range=all&s=works&path=/liss-works/projects/glass-atoll/').get_data(as_text=True)
        self.assertIn('下一步去了哪', page)
        self.assertIn('离开', page)
        pages = self.client.get('/admin/analytics/pages?range=all&sort=rate').get_data(as_text=True)
        self.assertIn('有效浏览率', pages)
        self.assertIn('帮助', self.client.get('/admin/analytics/help').get_data(as_text=True))
        from app.analytics_admin import Filters, kpis
        with self.app.test_request_context('/admin/analytics?range=all'):
            numbers = kpis(Filters({'range': 'all'}))
        self.assertEqual((numbers['sessions'], numbers['engaged']), (3, 2))  # The shared visit bounced quickly.

    # ------------------------------------------------------------ unified visitors
    def pv(self, vid, sid, pid, site='works', **ctx):
        body = batch(site=site, vid=vid, sid=sid, pv=dict(batch()['pv'], id=pid))
        if ctx:
            body['ctx'] = dict(body['ctx'], **ctx)
        return body

    def person(self, vid):
        return self.store().scalar('SELECT person_id FROM visitors WHERE id = ?', (vid,))

    def test_minted_device_id_does_not_replace_stored_one(self):
        # A browser that drops the cross-site cookie gets a new id on every batch; the first one stays.
        self.collect(batch(), client=self.app.test_client())
        first = self.store().scalar('SELECT device_id FROM visitors WHERE id = ?', (VID,))
        self.collect(batch(), client=self.app.test_client())
        self.assertEqual(self.store().scalar('SELECT device_id FROM visitors WHERE id = ?', (VID,)), first)

    def signed(self, uid):
        from app.analytics import uid_signature
        with self.app.app_context():
            return uid_signature(str(uid))

    def test_community_account_links_records_and_counts_once(self):
        phone, sig = self.app.test_client(), self.signed(7)
        self.collect(self.pv('1' * 24, '2' * 24, '3' * 24, site='forum', uid='7', uname='mei', usig=sig),
                     origin='https://liss.pythonanywhere.com', ip='198.51.100.9', client=phone)
        self.collect(self.pv('4' * 24, '5' * 24, '6' * 24, site='forum', uid=7, uname='mei', usig=sig),
                     origin='https://liss.pythonanywhere.com', ip='203.0.113.80', client=self.app.test_client())
        self.assertEqual(self.person('4' * 24), '1' * 24)  # Earliest record names the visitor.
        self.assertEqual(self.store().scalar('SELECT COUNT(DISTINCT person_id) FROM pageviews'), 1)
        self.assertEqual(set(r['person_id'] for r in self.store().query('SELECT person_id FROM events')), {'1' * 24})
        self.login()
        listing = self.client.get('/admin/analytics/visitors?range=all&who=all').get_data(as_text=True)
        self.assertIn('共 <strong>1</strong> 位访客', listing)
        self.assertIn('@mei', listing)

    def test_same_ip_alone_never_merges(self):
        self.collect(self.pv('1' * 24, '2' * 24, '3' * 24), ip='198.51.100.20', client=self.app.test_client())
        self.collect(self.pv('4' * 24, '5' * 24, '6' * 24), ip='198.51.100.20', client=self.app.test_client())
        self.assertNotEqual(self.person('1' * 24), self.person('4' * 24))

    def test_manual_merge_detach_attach_and_dismiss(self):
        env = {'gpu': 'ANGLE (NVIDIA GeForce RTX 4070)', 'hc': 16, 'dm': 8}
        self.collect(self.pv('1' * 24, '2' * 24, '3' * 24, env=env), ip='198.51.100.30', client=self.app.test_client())
        self.collect(self.pv('4' * 24, '5' * 24, '6' * 24, env=env), ip='198.51.100.31', client=self.app.test_client())
        store = self.store()
        found = store.suggestions()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['label'], '同一网段')
        self.login()
        listing = self.client.get('/admin/analytics/visitors?by=suggest').get_data(as_text=True)
        self.assertIn('是同一人，合并', listing)
        token = self.csrf(f'/admin/analytics/visitor/{"1" * 24}')
        self.client.post('/admin/analytics/person', data={'csrf_token': token, 'action': 'merge',
                                                          'visitor': '1' * 24, 'other': '4' * 24})
        self.assertEqual(self.person('4' * 24), '1' * 24)
        self.assertEqual(store.scalar('SELECT COUNT(DISTINCT person_id) FROM sessions'), 1)
        self.assertEqual(store.suggestions(), [])
        page = self.client.get(f'/admin/analytics/visitor/{"4" * 24}').get_data(as_text=True)
        self.assertIn('手动合并', page)
        # Detach: back to two visitors, and automatic links no longer apply to that record.
        self.client.post('/admin/analytics/person', data={'csrf_token': token, 'action': 'detach', 'visitor': '4' * 24})
        self.assertEqual(self.person('4' * 24), '4' * 24)
        self.assertEqual(store.scalar("SELECT person_id FROM pageviews WHERE visitor_id = ?", ('4' * 24,)), '4' * 24)
        self.client.post('/admin/analytics/person', data={'csrf_token': token, 'action': 'attach', 'visitor': '4' * 24})
        self.assertEqual(store.scalar('SELECT COUNT(*) FROM person_detached'), 0)
        # Dismiss: the suggestion goes away for good.
        self.client.post('/admin/analytics/person', data={'csrf_token': token, 'action': 'dismiss',
                                                          'visitor': '1' * 24, 'other': '4' * 24})
        self.assertEqual(store.suggestions(), [])
        self.assertEqual(store.suggestions('1' * 24, strict=False), [])
        bad = self.client.post('/admin/analytics/person', data={'csrf_token': token, 'action': 'merge',
                                                                'visitor': '1' * 24, 'other': 'z' * 24})
        self.assertEqual(bad.status_code, 302)
        self.assertNotEqual(self.person('1' * 24), 'z' * 24)

    def test_deleting_first_record_renames_person(self):
        client = self.app.test_client()
        self.collect(self.pv('1' * 24, '2' * 24, '3' * 24), ip='198.51.100.40', client=client)
        self.collect(self.pv('4' * 24, '5' * 24, '6' * 24, site='forum'), origin='https://liss.pythonanywhere.com',
                     ip='198.51.100.40', client=client)
        self.assertEqual(self.person('4' * 24), '1' * 24)
        self.store().delete_where('visitor_id = ?', ('1' * 24,))
        self.assertEqual(self.person('4' * 24), '4' * 24)
        self.assertEqual(self.store().scalar('SELECT person_id FROM pageviews'), '4' * 24)


    def test_unsigned_account_id_is_dropped(self):
        # Beacons are unauthenticated: claiming someone's account must not join their visitor.
        self.collect(self.pv('1' * 24, '2' * 24, '3' * 24, site='forum', uid='7', uname='mei', usig=self.signed(7)),
                     origin='https://liss.pythonanywhere.com', client=self.app.test_client())
        for usig in ('', 'f' * 32, self.signed(8)):
            vid = secrets_hex()
            self.collect(self.pv(vid, secrets_hex(), secrets_hex(), uid='7', uname='mei', usig=usig),
                         client=self.app.test_client())
            row = self.store().query('SELECT user_id, username, person_id FROM visitors WHERE id = ?', (vid,))[0]
            self.assertEqual((row['user_id'], row['username'], row['person_id']), (None, '', vid))
        self.assertEqual(self.store().scalar('SELECT user_id FROM visitors WHERE id = ?', ('1' * 24,)), 7)

    def test_tracker_tag_carries_signed_account_and_visitor_cookie(self):
        self.login()
        self.client.set_cookie('liss_v', 'a' * 24)
        page = self.client.get('/').get_data(as_text=True)
        tag = re.search(r'<script[^>]+liss-analytics\.js[^>]*>', page).group(0)
        uid = re.search(r'data-uid="(\d+)"', tag).group(1)
        self.assertIn(f'data-usig="{self.signed(uid)}"', tag)
        self.assertIn('data-vid="' + 'a' * 24 + '"', tag)
        self.client.set_cookie('liss_v', 'not-a-visitor-id')
        self.assertIn('data-vid=""', self.client.get('/').get_data(as_text=True))

    def test_filtered_list_badge_uses_matching_record(self):
        client = self.app.test_client()
        bot = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
        self.collect(self.pv('1' * 24, '2' * 24, '3' * 24), ip='198.51.100.60', client=client)
        self.collect(self.pv('4' * 24, '5' * 24, '6' * 24, site='forum'), origin='https://liss.pythonanywhere.com',
                     ip='198.51.100.60', client=client, ua=bot)  # Same browser cookie, newer record is a bot.
        self.assertEqual(self.person('4' * 24), '1' * 24)
        self.login()
        page = self.client.get('/admin/analytics/visitors?range=all').get_data(as_text=True)
        row = page[page.index('/admin/analytics/visitor/' + '1' * 24):][:600]
        self.assertIn('an-kind-visitor', row)
        csv_text = self.client.get('/admin/analytics/export?kind=pageviews&range=all&who=all').get_data(as_text=True)
        self.assertIn('统一访客', csv_text.splitlines()[0])



@unittest.skipUnless(shutil.which('node'), 'Node.js is needed to run the tracker script')
class TrackerScriptTests(unittest.TestCase):
    """The browser tracker in a minimal fake DOM (tests/js/tracker_harness.cjs)."""
    def run_tracker(self, **state):
        harness = Path(__file__).with_name('js') / 'tracker_harness.cjs'
        out = subprocess.run(['node', str(harness), json.dumps(state)], capture_output=True, text=True,
                             encoding='utf-8', timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_new_visitor_gets_id_in_storage_and_cookie(self):
        result = self.run_tracker()
        vid = result['storage']['liss-a:vid']
        self.assertRegex(vid, r'^[a-f0-9]{24}$')
        self.assertEqual(result['cookies']['liss_vid'], vid)
        self.assertEqual(result['beacons'][0]['vid'], vid)

    def test_id_restored_from_cookie_or_server_copy(self):
        cookie = '0123456789abcdef01234567'
        result = self.run_tracker(storage={}, cookies={'other': 'x', 'liss_vid': cookie})
        self.assertEqual((result['storage']['liss-a:vid'], result['beacons'][0]['vid']), (cookie, cookie))
        server = 'fedcba9876543210fedcba98'
        result = self.run_tracker(storage={}, dataset={'site': 'forum', 'vid': server, 'uid': '7', 'usig': 'f' * 32})
        self.assertEqual(result['beacons'][0]['vid'], server)
        self.assertEqual(result['cookies']['liss_vid'], server)
        self.assertEqual((result['beacons'][0]['ctx']['uid'], result['beacons'][0]['ctx']['usig']), ('7', 'f' * 32))
        # Without storage at all (blocked), the cookie still keeps the id.
        result = self.run_tracker(storage=None, cookies={'liss_vid': cookie})
        self.assertEqual(result['beacons'][0]['vid'], cookie)

    def test_opt_out_and_owner_flags_survive_storage_cleanup(self):
        opted = self.run_tracker(search='?liss_analytics=off', cookies={'liss_vid': '0123456789abcdef01234567'})
        self.assertEqual(opted['beacons'], [])
        self.assertNotIn('liss_vid', opted['cookies'])
        self.assertEqual(opted['cookies']['liss_optout'], '1')
        later = self.run_tracker(storage={}, cookies=opted['cookies'])  # Storage cleared, cookie kept.
        self.assertEqual(later['beacons'], [])
        back = self.run_tracker(search='?liss_analytics=on', cookies=opted['cookies'])
        self.assertTrue(back['beacons'])
        self.assertNotIn('liss_optout', back['cookies'])
        me = self.run_tracker(search='?liss_analytics=me')
        self.assertEqual(me['cookies']['liss_me'], '1')
        restored = self.run_tracker(storage={}, cookies={'liss_me': '1'})
        self.assertEqual(restored['storage']['liss-a:me'], '1')
        self.assertIs(restored['beacons'][0]['ctx']['env']['me'], True)
        cleared = self.run_tracker(search='?liss_analytics=notme', cookies={'liss_me': '1'}, storage={'liss-a:me': '1'})
        self.assertNotIn('liss_me', cleared['cookies'])
        self.assertNotIn('me', cleared['beacons'][0]['ctx']['env'])


if __name__ == '__main__':
    unittest.main()

