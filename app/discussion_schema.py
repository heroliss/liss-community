"""Add reply metadata to legacy public SQLite stores with a verified backup."""
from contextlib import closing
from pathlib import Path
import secrets
import sqlite3
import time

from .public_demo_storage import backup_database


def migrate_discussion_schema(database):
    database = Path(database)
    if not database.is_file():
        return
    with closing(sqlite3.connect(database)) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'comments' not in tables:
            return
        columns = {row[1] for row in connection.execute('PRAGMA table_info(comments)')}
        pending = [(name, definition) for name, definition in (
            ('parent_id', 'INTEGER REFERENCES comments(id)'), ('edited_at', 'DATETIME'),
        ) if name not in columns]
        missing_notifications = 'reply_notifications' not in tables
        if not pending and not missing_notifications:
            return
        backup_database(database, database.parent / ('before-discussions-'
            + time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3) + '.sqlite'))
        connection.execute('BEGIN IMMEDIATE')
        try:
            for name, definition in pending:
                connection.execute(f'ALTER TABLE comments ADD COLUMN {name} {definition}')
            if missing_notifications:
                connection.execute('CREATE TABLE reply_notifications ('
                    'id INTEGER PRIMARY KEY, recipient_id INTEGER NOT NULL REFERENCES users(id), '
                    'comment_id INTEGER NOT NULL REFERENCES comments(id), created_at DATETIME NOT NULL, '
                    'read_at DATETIME, CONSTRAINT uq_reply_notification_recipient_comment '
                    'UNIQUE (recipient_id, comment_id))')
                connection.execute('CREATE INDEX ix_reply_notifications_recipient_id ON reply_notifications (recipient_id)')
                connection.execute('CREATE INDEX ix_reply_notifications_comment_id ON reply_notifications (comment_id)')
                connection.execute('CREATE INDEX ix_reply_notifications_recipient_read ON reply_notifications (recipient_id, read_at)')
            connection.commit()
        except Exception:
            connection.rollback()
            raise
