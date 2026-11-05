"""Rate limits must count real visitors behind PythonAnywhere's load balancer."""
import tempfile
import unittest
from unittest.mock import patch

from flask import request

from app import create_app, db


class ForwardedClientAddressTests(unittest.TestCase):
    def make_app(self, **environment):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        values = {'SECRET_KEY': 'client-address-tests-only-' * 2, 'LISS_DATA_DIR': directory.name,
                  'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0'}
        values.update(environment)
        with patch.dict('os.environ', values):
            if 'LIHOU_FORWARDED_FOR_HOPS' not in environment:
                import os
                os.environ.pop('LIHOU_FORWARDED_FOR_HOPS', None)
            app = create_app('public-demo')
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)

        @app.get('/address-probe')
        def probe():
            return {'address': request.remote_addr, 'scheme': request.scheme}

        def dispose():
            with app.app_context():
                db.session.remove()
                db.engine.dispose()
        self.addCleanup(dispose)
        return app

    def probe(self, app, **headers):
        return app.test_client().get('/address-probe', headers=headers,
                                     environ_base={'REMOTE_ADDR': '10.0.0.5'}).get_json()

    def test_load_balancer_address_is_kept_without_the_setting(self):
        app = self.make_app()
        self.assertEqual(self.probe(app, **{'X-Forwarded-For': '203.0.113.7'})['address'], '10.0.0.5')

    def test_one_forwarded_hop_uses_the_entry_the_balancer_appended(self):
        app = self.make_app(LIHOU_FORWARDED_FOR_HOPS='1')
        self.assertEqual(self.probe(app, **{'X-Forwarded-For': '203.0.113.7'})['address'], '203.0.113.7')
        # A client cannot pick its own identity by prepending addresses.
        spoofed = self.probe(app, **{'X-Forwarded-For': '198.51.100.1, 203.0.113.7'})
        self.assertEqual(spoofed['address'], '203.0.113.7')

    def test_forwarded_address_does_not_trust_the_scheme_header(self):
        app = self.make_app(LIHOU_FORWARDED_FOR_HOPS='1')
        result = self.probe(app, **{'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https'})
        self.assertEqual(result['scheme'], 'http')

    def test_legacy_proxy_hops_still_cover_both_headers(self):
        app = self.make_app(LIHOU_PROXY_HOPS='1')
        result = self.probe(app, **{'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https'})
        self.assertEqual((result['address'], result['scheme']), ('203.0.113.7', 'https'))

    def test_invalid_hop_count_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'LIHOU_FORWARDED_FOR_HOPS'):
            self.make_app(LIHOU_FORWARDED_FOR_HOPS='3')

    def test_separate_visitors_get_separate_rate_limit_buckets(self):
        app = self.make_app(LIHOU_FORWARDED_FOR_HOPS='1')
        app.config['PUBLIC_DEMO_AUTH_LIMIT'] = 2
        for visitor, expected in (('203.0.113.7', [200, 200, 429]), ('203.0.113.8', [200])):
            client = app.test_client()
            codes = []
            for _ in expected:
                response = client.post('/auth/login', data={}, environ_base={'REMOTE_ADDR': '10.0.0.5'},
                                       headers={'X-Forwarded-For': visitor})
                codes.append(429 if response.status_code == 429 else 200)
            self.assertEqual(codes, expected, visitor)


class AdminClientAddressStatusTests(unittest.TestCase):
    def test_status_classifies_public_local_and_proxy_addresses(self):
        from app.admin import client_address_status
        app = create_app('testing')
        cases = {'8.8.8.8': 'public', '203.0.113.7': 'proxy', '127.0.0.1': 'local', '10.0.0.5': 'proxy',
                 '192.168.1.4': 'proxy', 'not-an-ip': 'unknown'}
        for address, kind in cases.items():
            with app.test_request_context('/', environ_base={'REMOTE_ADDR': address}):
                self.assertEqual(client_address_status()['kind'], kind, address)


if __name__ == '__main__':
    unittest.main()
