"""Consistent SQLite snapshots for the persistent, browser-visitor showcase."""
from contextlib import closing
import os
from pathlib import Path
import secrets
import sqlite3
import tempfile
import time


REQUIRED_TABLES = {'users', 'roles', 'posts', 'comments', 'follows'}


def inspect_backup(path):
    source = Path(path).expanduser().resolve(strict=True)
    if not source.is_file():
        raise ValueError('Backup must be a SQLite file.')
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as connection:
            if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise ValueError('Backup failed SQLite integrity verification.')
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not REQUIRED_TABLES <= tables:
                raise ValueError('Backup does not contain the visitor showcase schema.')
            if 'public_demo_state' in tables and connection.execute(
                    'SELECT identity_epoch FROM public_demo_state WHERE id=1').fetchone() is None:
                raise ValueError('Backup has invalid visitor identity metadata.')
    except sqlite3.DatabaseError as error:
        raise ValueError('Input is not a valid visitor SQLite backup.') from error
    return source


def backup_database(source, output):
    """SQLite's online backup API, never a file copy of a running database."""
    source = Path(source).resolve(strict=True)
    output = Path(output).expanduser().resolve()
    if source == output:
        raise ValueError('Backup output must differ from the live database.')
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
            with closing(sqlite3.connect(output)) as destination:
                original.backup(destination)
        inspect_backup(output)
    except BaseException:
        output.unlink(missing_ok=True)  # Only the new file reserved by this call.
        raise
    return output


def restore_database(source, destination, *, rotate_identity=True,
                     expected_source=None, validate_snapshot=None):
    """Replace the database through SQLite, revoking all pre-restore logins."""
    source = inspect_backup(source)
    destination = Path(destination).resolve()
    if source == destination:
        raise ValueError('Restore input must differ from the live database.')
    descriptor, filename = tempfile.mkstemp(prefix='.restore-', suffix='.sqlite', dir=destination.parent)
    os.close(descriptor)
    prepared = Path(filename)
    try:
        if expected_source is not None:
            # A bundle contains a closed immutable SQLite snapshot. Freeze its
            # exact bytes and verify the earlier manifest before consuming it;
            # never restore a source changed since the bundle was inspected.
            from .public_demo_bundle import file_info
            with source.open('rb') as original, prepared.open('wb') as staged_file:
                remaining = expected_source['bytes']
                while block := original.read(min(1024*1024, remaining+1)):
                    if len(block) > remaining:
                        raise ValueError('Backup database integrity changed before restoration.')
                    staged_file.write(block)
                    remaining -= len(block)
                if remaining:
                    raise ValueError('Backup database integrity changed before restoration.')
            if file_info(prepared) != expected_source:
                raise ValueError('Backup database integrity changed before restoration.')
        else:
            with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
                with closing(sqlite3.connect(prepared)) as staged:
                    original.backup(staged)
        inspect_backup(prepared)
        if validate_snapshot is not None:
            validate_snapshot(prepared)
        with closing(sqlite3.connect(prepared)) as staged:
            # Rotate identity in the staging snapshot, so data + identity
            # arrive in one SQLite backup transaction, even after a crash.
            if rotate_identity:
                staged.execute('CREATE TABLE IF NOT EXISTS public_demo_state '
                               '(id INTEGER PRIMARY KEY CHECK (id=1), '
                               'identity_epoch TEXT NOT NULL, created_at REAL NOT NULL)')
                staged.execute('INSERT INTO public_demo_state (id, identity_epoch, created_at) VALUES (1, ?, ?) '
                               'ON CONFLICT(id) DO UPDATE SET identity_epoch=excluded.identity_epoch',
                               (secrets.token_urlsafe(24), time.time()))
            staged.commit()
            with closing(sqlite3.connect(destination)) as restored:
                staged.backup(restored)
    finally:
        for owned in (prepared, Path(str(prepared) + '-wal'), Path(str(prepared) + '-shm')):
            owned.unlink(missing_ok=True)
