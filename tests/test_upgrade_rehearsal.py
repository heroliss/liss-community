"""Failure reports from copied-store rehearsals never expose SQL parameters."""
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from scripts import rehearse_upgrade


class UpgradeRehearsalTests(unittest.TestCase):
    def test_parameterized_database_failure_is_private_and_returns_failure(self):
        marker = 'private-row-password-hash-and-token-should-never-leak'
        statement = 'INSERT INTO private_records (token) VALUES (?)'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / 'snapshot.sqlite'
            output = root / 'new-private-rehearsal'
            with closing(sqlite3.connect(snapshot)) as connection:
                connection.execute('CREATE TABLE private_records (token TEXT NOT NULL)')
                connection.execute('INSERT INTO private_records VALUES (?)', (marker,))
                connection.commit()
            original_hash = rehearse_upgrade.digest(snapshot)
            command = '''
import os
import sys
from unittest.mock import patch
from sqlalchemy.exc import IntegrityError
from scripts import rehearse_upgrade
snapshot, output, marker, statement = sys.argv[1:]
sys.argv = ['rehearse_upgrade.py', '--snapshot', snapshot, '--output-dir', output]
failure = IntegrityError(statement, (marker,), ValueError('private original: ' + marker))
with patch.dict(os.environ, {}, clear=True), patch('app.create_app', side_effect=failure):
    raise SystemExit(rehearse_upgrade.main())
'''
            result = subprocess.run([sys.executable, '-B', '-c', command,
                                     str(snapshot), str(output), marker, statement],
                                    cwd=rehearse_upgrade.REPO, capture_output=True, text=True,
                                    encoding='utf-8', env={**os.environ, 'PYTHONUTF8': '1'}, timeout=30)
            report_text = (output / 'rehearsal.json').read_text(encoding='utf-8')
            report = json.loads(report_text)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(report['passed'])
            self.assertEqual(report['error_type'], 'IntegrityError')
            self.assertTrue(report['source_snapshot_unchanged'])
            self.assertEqual(rehearse_upgrade.digest(snapshot), original_hash)
            for captured in (report_text, result.stdout, result.stderr):
                self.assertNotIn(marker, captured)
                self.assertNotIn(statement, captured)
                self.assertNotIn('private original', captured)
            self.assertTrue((output / 'public-demo.sqlite').is_file())


if __name__ == '__main__':
    unittest.main()
