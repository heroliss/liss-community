#!/usr/bin/env python3
"""Run repository checks without loading the operator's storage or mail settings."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

REPO = Path(__file__).resolve().parents[1]


def isolated_environment() -> dict[str, str]:
    blocked = {
        'SECRET_KEY', 'DATABASE_URL', 'TEST_DATABASE_URL', 'DEV_DATABASE_URL',
        'FLASK_CONFIG', 'FLASK_APP', 'FLASKY_ADMIN', 'PYTHONWARNINGS',
    }
    environment = {
        key: value for key, value in os.environ.items()
        if key.upper() not in blocked
        and not key.upper().startswith(('LISS_', 'LIHOU_', 'MAIL_'))
    }
    environment.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1',
                       LISS_EMAIL_ACCOUNTS='0', LISS_INDEXING_ENABLED='0')
    return environment


def digest(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def python_syntax() -> int:
    roots = ('app', 'tests', 'migrations', 'deploy', 'scripts')
    paths = [path for root in roots for path in (REPO / root).rglob('*.py')
             if '__pycache__' not in path.parts]
    paths += [REPO / 'config.py', REPO / 'manage.py']
    for path in sorted(paths):
        compile(path.read_bytes(), str(path.relative_to(REPO)), 'exec')
    print(f'Python syntax: {len(paths)} files')
    return len(paths)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--frontend-only', action='store_true', help='Generated assets, JS syntax and controller scenarios only')
    mode.add_argument('--python-only', action='store_true', help='Python syntax and unit tests only')
    parser.add_argument('--test', action='append', default=[], metavar='MODULE',
                        help='Run a named unittest module instead of full discovery; repeatable')
    parser.add_argument('--output-dir', type=Path, default=REPO / '.tmp' / 'checks',
                        help='Parent directory for a unique run folder with logs and summary')
    options = parser.parse_args()
    if options.frontend_only and options.test:
        parser.error('--test requires Python checks')
    run_name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    output = options.output_dir.resolve() / run_name
    output.mkdir(parents=True, exist_ok=False)
    environment = isolated_environment()
    protected = REPO / 'data-demo.sqlite'
    protected_before = digest(protected)
    checks: list[dict] = []
    report = {
        'started_utc': datetime.now(timezone.utc).isoformat(),
        'python': sys.version.split()[0], 'checks': checks,
        'mode': 'frontend' if options.frontend_only else 'python' if options.python_only else 'all',
        'selected_python_modules': options.test or None,
        'mail_disabled': True, 'operator_configuration_removed': True,
        'scope': 'Generated assets, Python/static syntax and VM controller state; no browser, GPU, inbox or deployment acceptance.',
    }

    def run(name: str, command: list[str], timeout: int = 180) -> bool:
        log_path = output / (name + '.log')
        started = time.monotonic()
        with log_path.open('w', encoding='utf-8') as log:
            try:
                process = subprocess.run(command, cwd=REPO, env=environment,
                                         stdout=log, stderr=subprocess.STDOUT,
                                         text=True, timeout=timeout, check=False)
                code = process.returncode
            except (OSError, subprocess.TimeoutExpired) as error:
                log.write(str(error) + '\n')
                code = 1
        entry = dict(name=name, passed=code == 0, exit_code=code,
                     seconds=round(time.monotonic() - started, 3), log=log_path.name)
        if name == 'python-tests':
            log_text = log_path.read_text(encoding='utf-8')
            total = re.search(r'Ran (\d+) tests? in ([\d.]+)s', log_text)
            # unittest reports skips on both success and failure, and may list
            # errors/failures before or after the skipped count.
            outcome = re.search(r'^(?:OK|FAILED) \(([^)]*)\)\s*$', log_text, re.MULTILINE)
            skipped = re.search(r'(?:^|,\s*)skipped=(\d+)(?:,|$)', outcome[1]) if outcome else None
            entry.update(tests_run=int(total[1]) if total else None,
                         unittest_seconds=float(total[2]) if total else None,
                         skipped=int(skipped[1]) if skipped else 0)
        checks.append(entry)
        print(f"{'PASS' if entry['passed'] else 'FAIL'} {name} ({entry['seconds']}s)", flush=True)
        if code:
            print(log_path.read_text(encoding='utf-8')[-16000:], flush=True)
        return code == 0

    exit_code = 0
    completed = False
    try:
        if not options.frontend_only:
            started = time.monotonic()
            count = python_syntax()
            checks.append(dict(name='python-syntax', passed=True, files=count,
                               seconds=round(time.monotonic() - started, 3)))
        if not options.python_only:
            node = shutil.which('node')
            if not node:
                raise RuntimeError('Node.js 24 or later is required for frontend checks.')
            npm = shutil.which('npm')
            if not npm or not (REPO / 'node_modules' / 'esbuild' / 'package.json').is_file():
                raise RuntimeError('Asset build dependencies are missing. Install Node.js 24 and run npm ci --ignore-scripts, then rerun checks.')
            # Use the same asset gate as CI. Never rebuild tracked outputs while checking.
            # On Windows npm is a .cmd shim; shell=False cannot execute that directly.
            # Call the npm CLI through Node so paths and arguments remain structured.
            npm_command = [npm, 'run', 'check:assets']
            if os.name == 'nt':
                npm_cli = Path(npm).parent / 'node_modules' / 'npm' / 'bin' / 'npm-cli.js'
                if not npm_cli.is_file():
                    raise RuntimeError('Cannot locate npm-cli.js beside npm. Run npm run check:assets explicitly and repair the Node.js installation.')
                npm_command = [node, str(npm_cli), 'run', 'check:assets']
            if not run('generated-assets', npm_command):
                raise RuntimeError('Generated assets are stale or invalid. Run npm run build, review the tracked outputs, and rerun checks.')
            js_files = sorted(path for path in (REPO / 'app' / 'static').rglob('*.js')
                              if 'vendor' not in path.parts and 'bundles' not in path.parts)
            js_files += sorted((REPO / 'scripts').glob('*.cjs'))
            js_files += sorted((REPO / 'scripts' / 'tests').glob('*.test.cjs'))
            for index, path in enumerate(js_files):
                if not run(f'js-syntax-{index:02d}-{path.stem}', [node, '--check', str(path)]):
                    raise RuntimeError('JavaScript syntax check failed; see retained log.')
            scenarios = sorted((REPO / 'scripts' / 'tests').glob('*.test.cjs'))
            if not scenarios:
                raise RuntimeError('No controller scenarios found in scripts/tests/*.test.cjs.')
            for path in scenarios:
                if not run(path.stem, [node, str(path)]):
                    raise RuntimeError('Controller check failed; see retained log.')
        if not options.frontend_only:
            command = [sys.executable, '-B', '-m', 'unittest']
            command += options.test + ['-v'] if options.test else ['discover', '-s', 'tests', '-v']
            if not run('python-tests', command, timeout=900):
                raise RuntimeError('Python tests failed; see retained log.')
        completed = True
    except Exception as error:
        checks.append(dict(name='check-runner', passed=False, error=str(error)))
        print(f'FAIL {error}', file=sys.stderr)
        exit_code = 1
    finally:
        report['protected_demo_database_unchanged'] = digest(protected) == protected_before
        report['completed_utc'] = datetime.now(timezone.utc).isoformat()
        report['passed'] = completed and bool(checks) and all(check['passed'] for check in checks) and report['protected_demo_database_unchanged']
        (output / 'summary.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(f'Report: {output / "summary.json"}', flush=True)
        if not report['protected_demo_database_unchanged']:
            print('FAIL tracked demonstration database changed during checks.', file=sys.stderr)
            exit_code = 1
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
