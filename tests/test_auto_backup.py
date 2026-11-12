"""Daily backup trigger: once per UTC day, never in tests or local previews."""
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from flask import Flask

from app import auto_backup


class AutoBackupTests(unittest.TestCase):
    def make_app(self, home, **env):
        app = Flask('trigger-test')
        app.root_path = str(Path(auto_backup.__file__).parent)
        with patch.dict('os.environ', env, clear=False), patch.object(Path, 'home', return_value=home):
            auto_backup.install(app)

        @app.get('/')
        def index():
            return 'ok'
        return app

    def setUp(self):
        auto_backup._state['day'] = None
        self.home = Path(tempfile.mkdtemp())

    def test_starts_once_per_day(self):
        app = self.make_app(self.home, LISS_AUTO_BACKUP='1', LISS_LOCAL_PREVIEW='0')
        with patch.object(Path, 'home', return_value=self.home), patch('subprocess.Popen') as popen:
            client = app.test_client()
            client.get('/')
            client.get('/')
            self.assertEqual(popen.call_count, 1)
            self.assertTrue(popen.call_args.args[0][-1].endswith('daily_backup.py'))
            auto_backup._state['day'] = None  # A reloaded worker sees the marker file.
            client.get('/')
            self.assertEqual(popen.call_count, 1)

    def test_existing_backup_and_disabled_modes_do_not_start(self):
        day = datetime.now(timezone.utc).strftime('%Y%m%d')
        (self.home / 'liss-backups' / 'daily' / day).mkdir(parents=True)
        app = self.make_app(self.home, LISS_AUTO_BACKUP='1', LISS_LOCAL_PREVIEW='0')
        with patch.object(Path, 'home', return_value=self.home), patch('subprocess.Popen') as popen:
            app.test_client().get('/')
            self.assertEqual(popen.call_count, 0)
        for env in ({'LISS_AUTO_BACKUP': '0'}, {'LISS_AUTO_BACKUP': '1', 'LISS_LOCAL_PREVIEW': '1'}):
            auto_backup._state['day'] = None
            app = self.make_app(Path(tempfile.mkdtemp()), **env)
            with patch('subprocess.Popen') as popen:
                app.test_client().get('/')
                self.assertEqual(popen.call_count, 0)


if __name__ == '__main__':
    unittest.main()
