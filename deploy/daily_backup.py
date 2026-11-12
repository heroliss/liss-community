"""Daily backup for PythonAnywhere's scheduled task (Tasks tab, once a day).

    /home/<user>/.virtualenvs/<env>/bin/python /home/<user>/<checkout>/deploy/daily_backup.py

Creates ~/liss-backups/daily/<date>/ with
  community.bundle  verified database + private images (backup-public-demo --bundle)
  analytics.sqlite  consistent copy of the visitor statistics (SQLite backup API)
and keeps the newest KEEP days. Older manual backups in ~/liss-backups are untouched.
Download them off the server regularly (scripts/pull_forum_backups.ps1 on a PC).
"""
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

KEEP = int(os.environ.get('LISS_BACKUP_KEEP', '7'))
REPO = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('LISS_DATA_DIR', Path.home() / 'lihou-demo-data'))
ROOT = Path.home() / 'liss-backups' / 'daily'


def main() -> int:
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d')
    target = ROOT / stamp
    staging = ROOT / (stamp + '.partial')
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    result = subprocess.run([sys.executable, str(REPO / 'deploy' / 'manage_public.py'), 'backup-public-demo',
                             '--bundle', '--output', str(staging / 'community.bundle')],
                            cwd=REPO, capture_output=True, text=True)
    print(result.stdout.strip() or result.stderr.strip())
    if result.returncode != 0:
        shutil.rmtree(staging, ignore_errors=True)
        return result.returncode
    analytics = DATA / 'analytics.sqlite'
    if analytics.exists():
        source = sqlite3.connect(f'file:{analytics}?mode=ro', uri=True, timeout=30)
        copy = sqlite3.connect(staging / 'analytics.sqlite')
        try:
            source.backup(copy)
            if copy.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('analytics copy failed quick_check')
        finally:
            copy.close()
            source.close()
        print('analytics.sqlite copied and checked')
    shutil.rmtree(target, ignore_errors=True)
    staging.rename(target)
    days = sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name.isdigit())
    for old in days[:-KEEP]:
        shutil.rmtree(old)
        print('removed', old.name)
    size = sum(f.stat().st_size for f in target.rglob('*') if f.is_file())
    print(f'daily backup {stamp}: {size / 1048576:.1f} MB, keeping {min(len(days), KEEP)} day(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
