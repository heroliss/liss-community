#!/usr/bin/env python3
"""Upgrade a private COPY of an SQLite backup and verify original data retention."""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys

REPO = Path(__file__).resolve().parents[1]


def quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def catalogue(connection: sqlite3.Connection) -> dict:
    tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    result = {}
    for (table,) in tables:
        if table == 'alembic_version':
            continue
        columns = [row[1] for row in connection.execute('PRAGMA table_info(' + quoted(table) + ')')]
        if table == 'users':
            columns = [name for name in columns if name != 'last_seen']
        result[table] = {'columns': columns, **table_digest(connection, table, columns)}
    return result


def table_digest(connection: sqlite3.Connection, table: str, columns: list[str]) -> dict:
    rows = connection.execute('SELECT ' + ','.join(map(quoted, columns)) + ' FROM ' + quoted(table)).fetchall()
    hashes = sorted(hashlib.sha256(repr(row).encode('utf-8')).hexdigest() for row in rows)
    return {'rows': len(rows), 'digest': hashlib.sha256('\n'.join(hashes).encode('ascii')).hexdigest()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True, help='Existing consistent private SQLite backup')
    parser.add_argument('--output-dir', type=Path, required=True, help='New private folder; must not already exist')
    options = parser.parse_args()
    snapshot = options.snapshot.resolve()
    output = options.output_dir.resolve()
    if not snapshot.is_file():
        parser.error('The snapshot must be an existing file.')
    if output.exists():
        parser.error('The output directory already exists; choose a new path to preserve earlier rehearsal data.')
    source_hash = digest(snapshot)
    # The source is opened read-only; backup() copies committed WAL as well.
    with closing(sqlite3.connect(snapshot.as_uri() + '?mode=ro', uri=True)) as original:
        original.execute('PRAGMA query_only=ON')
        if original.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Snapshot quick_check failed; preserve it and inspect before upgrade.')
        before = catalogue(original)
        appearance_definition_before = original.execute("SELECT sql FROM sqlite_master WHERE name='post_appearances'").fetchone()
        output.mkdir(parents=True, exist_ok=False)
        candidate = output / 'public-demo.sqlite'
        with closing(sqlite3.connect(candidate)) as destination:
            original.backup(destination)
    for key in list(os.environ):
        if key.upper().startswith(('LISS_', 'LIHOU_', 'MAIL_')) or key.upper() in {
                'SECRET_KEY', 'DATABASE_URL', 'TEST_DATABASE_URL', 'DEV_DATABASE_URL',
                'FLASK_CONFIG', 'FLASK_APP', 'FLASKY_ADMIN'}:
            os.environ.pop(key, None)
    os.environ.update(SECRET_KEY=secrets.token_hex(32), LISS_DATA_DIR=str(output),
                      LIHOU_DEMO_COOKIE_SECURE='0', LISS_EMAIL_ACCOUNTS='0',
                      LISS_INDEXING_ENABLED='0', LISS_LOCAL_PREVIEW='1')
    sys.path.insert(0, str(REPO))
    report = {'scope': 'Private copied-store preparation only; no production access, HTTP, mail or deployment.',
              'source_snapshot_unchanged': False, 'tables': {}, 'passed': False}
    try:
        from app import create_app, db
        app = create_app('public-demo')
        app.config.update(MAIL_SUPPRESS_SEND=True, LISS_LOCAL_PREVIEW=True)
        with app.app_context():
            sandbox = app.extensions['public_demo']
            with sandbox.exclusive():
                sandbox.prepare()
            db.session.remove()
            db.engine.dispose()
        with closing(sqlite3.connect(candidate.as_uri() + '?mode=ro', uri=True)) as upgraded:
            upgraded.execute('PRAGMA query_only=ON')
            tables = {row[0] for row in upgraded.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table, prior in before.items():
                columns = [row[1] for row in upgraded.execute('PRAGMA table_info(' + quoted(table) + ')')]
                preserved = table in tables and set(prior['columns']).issubset(columns)
                current = table_digest(upgraded, table, prior['columns']) if preserved else None
                report['tables'][table] = {'original_columns_preserved': preserved,
                                           'original_rows': prior['rows'],
                                           'added_columns': sorted(set(columns) - set(prior['columns']) - ({'last_seen'} if table == 'users' else set())),
                                           'rows_equal': bool(current and current == {key: prior[key] for key in ('rows', 'digest')})}
            appearance_definition_after = upgraded.execute("SELECT sql FROM sqlite_master WHERE name='post_appearances'").fetchone()
            report['appearance_table_definition_changed'] = appearance_definition_before != appearance_definition_after
            report['quick_check_ok'] = upgraded.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
            report['foreign_key_violations'] = len(upgraded.execute('PRAGMA foreign_key_check').fetchall())
            report['added_tables'] = sorted(tables - set(before) - {'sqlite_sequence', 'alembic_version'})
            report['safety_backups_created'] = sorted(path.name for path in output.glob('before-*.sqlite'))
        report['source_snapshot_unchanged'] = digest(snapshot) == source_hash
        report['passed'] = (report['source_snapshot_unchanged'] and report['quick_check_ok']
                            and report['foreign_key_violations'] == 0
                            and all(row['original_columns_preserved'] and row['rows_equal']
                                    for row in report['tables'].values()))
    except Exception as error:
        # Database exceptions can include SQL parameters and private row values.
        # Retain the failure class for diagnosis without serializing its message.
        report['error'] = 'Store preparation or retention verification failed. Inspect the private rehearsal copy locally.'
        report['error_type'] = type(error).__name__
        report['source_snapshot_unchanged'] = digest(snapshot) == source_hash
    (output / 'rehearsal.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    print(f'Private rehearsal copy and report retained: {output}', file=sys.stderr)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
