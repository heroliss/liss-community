"""Baseline browser protections and production secret checks."""
import unittest
from unittest.mock import patch

from app import create_app, db


class SecurityHeaderTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app('testing')
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.app_context.pop()

    def assert_protected(self, response):
        self.assertEqual(response.headers.get('X-Frame-Options'), 'DENY')
        self.assertEqual(response.headers.get('Content-Security-Policy'), "frame-ancestors 'none'")
        self.assertEqual(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')

    def test_pages_errors_and_static_files_refuse_framing(self):
        for path in ('/', '/missing-page-for-header-check', '/static/favicon.ico'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assert_protected(response)
                response.close()

    def test_existing_header_values_are_kept(self):
        @self.app.get('/framed-on-purpose')
        def framed():
            return 'ok', 200, {'X-Frame-Options': 'SAMEORIGIN'}
        response = self.client.get('/framed-on-purpose')
        self.assertEqual(response.headers.get('X-Frame-Options'), 'SAMEORIGIN')
        self.assertEqual(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')


class ProductionSecretTests(unittest.TestCase):
    def test_production_configs_refuse_missing_or_published_secret(self):
        from config import DEVELOPMENT_SECRET_KEY
        for name in ('production', 'heroku'):
            for secret in ('', DEVELOPMENT_SECRET_KEY):
                with self.subTest(config=name, secret=bool(secret)), \
                        patch.dict('os.environ', {'SECRET_KEY': secret}), \
                        patch('config.ProductionConfig.SECRET_KEY', DEVELOPMENT_SECRET_KEY):
                    with self.assertRaisesRegex(RuntimeError, 'SECRET_KEY'):
                        create_app(name)

    def test_production_uses_the_configured_secret(self):
        secret = 'production-header-test-secret-' * 2
        with patch.dict('os.environ', {'SECRET_KEY': secret, 'DATABASE_URL': 'sqlite://'}):
            app = create_app('production')
        self.assertEqual(app.config['SECRET_KEY'], secret)


if __name__ == '__main__':
    unittest.main()
