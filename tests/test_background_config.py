"""The deployed upload budget is explicit, bounded and read at app creation."""
import os
import unittest
from unittest.mock import patch

from flask import Flask

from app import create_app
from config import Config


class BackgroundStorageConfigTests(unittest.TestCase):
    def configured_limit(self, value=None):
        with patch.dict(os.environ, {}, clear=True):
            if value is not None:
                os.environ['BACKGROUND_MAX_STORAGE_BYTES'] = value
            app = Flask(__name__)
            Config.init_app(app)
            return app.config['BACKGROUND_MAX_STORAGE_BYTES']

    def test_default_reserves_a_small_upload_budget(self):
        self.assertEqual(self.configured_limit(), 64 * 1024 * 1024)

    def test_environment_takes_effect_even_after_config_module_import(self):
        for value in ('1', '1048576', str(1024**4)):
            with self.subTest(value=value):
                self.assertEqual(self.configured_limit(value), int(value))
        with patch.dict(os.environ, {'BACKGROUND_MAX_STORAGE_BYTES': '1048576'}):
            app = create_app('testing')
            self.assertEqual(app.config['BACKGROUND_MAX_STORAGE_BYTES'], 1048576)

    def test_invalid_or_unbounded_budget_fails_before_serving(self):
        for value in ('', '0', '-1', '1.5', 'nan', 'inf', '1e6', ' 1024', '1024 ',
                      str(1024**4+1), '9'*10000):
            with self.subTest(value=value[:20]):
                with self.assertRaisesRegex(RuntimeError, 'BACKGROUND_MAX_STORAGE_BYTES'):
                    self.configured_limit(value)
