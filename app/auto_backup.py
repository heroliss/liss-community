"""Daily backup without a scheduler (PythonAnywhere free accounts have no tasks).

On the first request of each UTC day, start deploy/daily_backup.py in a separate
process. It takes the community's file lock like the manual backup command, so
it never races the web worker, and visitors never wait for it. One attempt per
day per worker; a marker file prevents repeats after a reload.
Enable with LISS_AUTO_BACKUP=1 (the PythonAnywhere WSGI passes it through).
"""
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
import threading

_state = {'day': None}
_lock = threading.Lock()


def venv_python() -> str:
    for candidate in (Path(sys.prefix) / 'bin' / 'python', Path(sys.prefix) / 'Scripts' / 'python.exe'):
        if candidate.exists():
            return str(candidate)
    return sys.executable


def install(app):
    if os.environ.get('LISS_AUTO_BACKUP') != '1' or app.testing or os.environ.get('LISS_LOCAL_PREVIEW') == '1':
        return
    repo = Path(app.root_path).parent
    root = Path.home() / 'liss-backups' / 'daily'

    @app.before_request
    def daily_backup_trigger():
        day = datetime.now(timezone.utc).strftime('%Y%m%d')
        if _state['day'] == day:
            return
        with _lock:
            if _state['day'] == day:
                return
            _state['day'] = day
            marker = root / f'.started-{day}'
            if (root / day).is_dir() or marker.exists():
                return
            try:
                root.mkdir(parents=True, exist_ok=True)
                marker.write_text(datetime.now(timezone.utc).isoformat(), encoding='utf-8')
                for old in root.glob('.started-*'):
                    if old.name < marker.name:
                        old.unlink(missing_ok=True)
                log = (root / 'last-run.log').open('w', encoding='utf-8')
                subprocess.Popen([venv_python(), str(repo / 'deploy' / 'daily_backup.py')], cwd=repo,
                                 stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                 env={**os.environ}, start_new_session=True)
            except OSError:
                app.logger.exception('daily backup could not start')
