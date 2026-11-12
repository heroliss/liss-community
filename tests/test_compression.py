"""gzip for static text and HTML; untouched without Accept-Encoding or for 304/206."""
import gzip
import unittest

from app import create_app, db


class CompressionTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app('testing')
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.ctx.pop()

    def test_static_text_is_gzipped_once_and_identical(self):
        plain = self.client.get('/static/liss-analytics.js')
        self.assertNotIn('Content-Encoding', plain.headers)
        body = plain.get_data()
        plain.close()
        for _ in range(2):
            zipped = self.client.get('/static/liss-analytics.js', headers={'Accept-Encoding': 'gzip, br'})
            self.assertEqual(zipped.headers['Content-Encoding'], 'gzip')
            self.assertIn('Accept-Encoding', zipped.headers['Vary'])
            self.assertEqual(gzip.decompress(zipped.get_data()), body)
            self.assertEqual(int(zipped.headers['Content-Length']), len(zipped.get_data()))
            zipped.close()

    def test_conditional_and_binary_responses_are_untouched(self):
        first = self.client.get('/static/liss-analytics.js')
        etag = first.headers.get('ETag')
        first.close()
        again = self.client.get('/static/liss-analytics.js', headers={'Accept-Encoding': 'gzip', 'If-None-Match': etag})
        self.assertEqual(again.status_code, 304)
        self.assertNotIn('Content-Encoding', again.headers)
        icon = self.client.get('/static/favicon.ico', headers={'Accept-Encoding': 'gzip'})
        self.assertNotIn('Content-Encoding', icon.headers)
        icon.close()

    def test_html_pages_are_gzipped(self):
        page = self.client.get('/', headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(page.headers.get('Content-Encoding'), 'gzip')
        self.assertIn(b'<html', gzip.decompress(page.get_data()))

    def test_indexnow_key_file(self):
        self.app.config['LISS_INDEXNOW_KEY'] = 'a' * 32
        self.assertEqual(self.client.get('/' + 'a' * 32 + '.txt').get_data(as_text=True), 'a' * 32)
        self.assertEqual(self.client.get('/' + 'b' * 32 + '.txt').status_code, 404)
        self.assertEqual(self.client.get('/robots.txt').status_code, 200)


if __name__ == '__main__':
    unittest.main()
