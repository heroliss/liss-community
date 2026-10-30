"""Data-preserving catalog upgrades, including the public-demo startup path."""
from contextlib import closing, contextmanager
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa

from app.public_schema import migrate_material_catalog


OLD_CHECK = "card_material IN ('auto','glass','ceramic','paper','metal')"


def legacy_database(connection):
    connection.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE posts(id INTEGER PRIMARY KEY, body TEXT NOT NULL, author_id INTEGER);
        CREATE TABLE comments(id INTEGER PRIMARY KEY, body TEXT, post_id INTEGER REFERENCES posts(id));
        CREATE TABLE identity(id INTEGER PRIMARY KEY, token TEXT NOT NULL);
        CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE roles(id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE follows(follower_id INTEGER, followed_id INTEGER);
        CREATE TABLE post_appearances(
            post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
            theme_color VARCHAR(7) NOT NULL DEFAULT '',
            card_material VARCHAR(16) NOT NULL DEFAULT 'auto',
            CONSTRAINT ck_post_appearance_material CHECK (card_material IN ('auto','glass','ceramic','paper','metal')),
            CONSTRAINT ck_post_appearance_color_shape CHECK (theme_color = '' OR (length(theme_color) = 7 AND substr(theme_color,1,1) = '#'))
        );
        CREATE INDEX ix_catalog_test_color ON post_appearances(theme_color);
        INSERT INTO identity VALUES (1, 'keep-this-identity');
        INSERT INTO users VALUES (29, 'Unchanged author');
        INSERT INTO roles VALUES (1, 'Unchanged role');
        INSERT INTO follows VALUES (29, 29);
    """)
    for identifier, material in enumerate(('auto', 'glass', 'ceramic', 'paper', 'metal'), 1):
        connection.execute('INSERT INTO posts VALUES (?, ?, ?)', (identifier, '# Unchanged ' + material, 29))
        connection.execute('INSERT INTO comments VALUES (?, ?, ?)', (identifier, 'Keep this reply.', identifier))
        connection.execute('INSERT INTO post_appearances VALUES (?, ?, ?)', (identifier, '#7ab8dd', material))
    connection.commit()


def snapshots(connection):
    return {table: connection.execute('SELECT * FROM ' + table + ' ORDER BY 1').fetchall()
            for table in ('posts', 'comments', 'identity', 'post_appearances', 'users', 'roles', 'follows')}


class MaterialCatalogMigrationTests(unittest.TestCase):
    def migration(self):
        path = Path(__file__).resolve().parents[1] / 'migrations/versions/20261031_material_catalog.py'
        spec = importlib.util.spec_from_file_location('material_catalog_migration', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def assert_new_materials_and_guards(self, connection):
        for material in ('leather', 'cork', 'slate'):
            connection.execute('UPDATE post_appearances SET card_material=? WHERE post_id=1', (material,))
            self.assertEqual(connection.execute('SELECT card_material FROM post_appearances WHERE post_id=1').fetchone()[0], material)
        for bad in ('unknown', 'Leather', 'cork; DROP TABLE posts'):
            with self.subTest(bad=bad), self.assertRaises(sqlite3.IntegrityError):
                connection.execute('UPDATE post_appearances SET card_material=? WHERE post_id=1', (bad,))
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute("UPDATE post_appearances SET theme_color='not-a-color' WHERE post_id=1")
        self.assertTrue(any(row[2] == 'posts' and row[6] == 'CASCADE'
                            for row in connection.execute('PRAGMA foreign_key_list(post_appearances)')))
        self.assertIn('ix_catalog_test_color', {row[1] for row in connection.execute('PRAGMA index_list(post_appearances)')})

    def test_alembic_upgrade_preserves_every_field_record_constraint_and_index(self):
        engine = sa.create_engine('sqlite:///:memory:')
        try:
            with engine.connect() as connection:
                raw = connection.connection.driver_connection
                legacy_database(raw)
                before = snapshots(raw)
                columns = raw.execute('PRAGMA table_info(post_appearances)').fetchall()
                with Operations.context(MigrationContext.configure(connection)):
                    self.migration().upgrade()
                    self.migration().upgrade()
                self.assertEqual(snapshots(raw), before)
                self.assertEqual(raw.execute('PRAGMA table_info(post_appearances)').fetchall(), columns)
                self.assert_new_materials_and_guards(raw)
        finally:
            engine.dispose()

    def test_public_upgrade_has_one_usable_backup_and_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix='liss-catalog-schema-') as directory:
            database = Path(directory) / 'old.sqlite'
            with closing(sqlite3.connect(database)) as connection:
                legacy_database(connection)
                before = snapshots(connection)
                columns = connection.execute('PRAGMA table_info(post_appearances)').fetchall()
            migrate_material_catalog(database)
            migrate_material_catalog(database)
            backups = list(Path(directory).glob('before-material-catalog-*.sqlite'))
            self.assertEqual(len(backups), 1)
            with closing(sqlite3.connect(backups[0])) as backup:
                self.assertEqual(snapshots(backup), before)
                self.assertIn(OLD_CHECK, backup.execute("SELECT sql FROM sqlite_master WHERE name='post_appearances'").fetchone()[0])
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(snapshots(connection), before)
                self.assertEqual(connection.execute('PRAGMA table_info(post_appearances)').fetchall(), columns)
                self.assert_new_materials_and_guards(connection)

    def test_failed_copy_rolls_back_original_table_and_keeps_safety_backup(self):
        with tempfile.TemporaryDirectory(prefix='liss-catalog-rollback-') as directory:
            database = Path(directory) / 'invalid.sqlite'
            with closing(sqlite3.connect(database)) as connection:
                legacy_database(connection)
                before = snapshots(connection)
            original = Operations.batch_alter_table

            @contextmanager
            def fail_after_recreate(operations, *args, **kwargs):
                with original(operations, *args, **kwargs) as batch:
                    yield batch
                raise RuntimeError('Injected interruption after table recreation')

            with patch.object(Operations, 'batch_alter_table', fail_after_recreate):
                with self.assertRaisesRegex(RuntimeError, 'Injected interruption'):
                    migrate_material_catalog(database)
            self.assertEqual(len(list(Path(directory).glob('before-material-catalog-*.sqlite'))), 1)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(snapshots(connection), before)
                self.assertIn(OLD_CHECK, connection.execute("SELECT sql FROM sqlite_master WHERE name='post_appearances'").fetchone()[0])
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '_alembic_tmp_%'").fetchone()[0], 0)

    def test_fresh_missing_table_and_unknown_schema_are_not_replaced(self):
        with tempfile.TemporaryDirectory(prefix='liss-catalog-empty-') as directory:
            database = Path(directory) / 'missing.sqlite'
            migrate_material_catalog(database)
            self.assertFalse(database.exists())
            with closing(sqlite3.connect(database)) as connection:
                connection.execute('CREATE TABLE keep_me (value TEXT)')
                connection.execute("INSERT INTO keep_me VALUES ('unchanged')")
                connection.commit()
            migrate_material_catalog(database)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute('SELECT value FROM keep_me').fetchall(), [('unchanged',)])
                connection.execute('CREATE TABLE post_appearances(post_id INTEGER PRIMARY KEY, card_material TEXT)')
                connection.commit()
            with self.assertRaises(RuntimeError):
                migrate_material_catalog(database)
            self.assertEqual(list(Path(directory).glob('before-material-catalog-*.sqlite')), [])

    def test_unrecognized_check_logic_is_not_mistaken_for_the_known_catalog(self):
        with tempfile.TemporaryDirectory(prefix='liss-catalog-unknown-check-') as directory:
            database = Path(directory) / 'unknown.sqlite'
            with closing(sqlite3.connect(database)) as connection:
                connection.execute('CREATE TABLE post_appearances (post_id INTEGER PRIMARY KEY, card_material TEXT, '
                    'CONSTRAINT ck_post_appearance_material CHECK (' + OLD_CHECK + ' OR 1=1))')
                connection.commit()
                before = connection.execute("SELECT sql FROM sqlite_master WHERE name='post_appearances'").fetchone()
            with self.assertRaises(RuntimeError):
                migrate_material_catalog(database)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT sql FROM sqlite_master WHERE name='post_appearances'").fetchone(), before)
            self.assertEqual(list(Path(directory).glob('before-material-catalog-*.sqlite')), [])


if __name__ == '__main__':
    unittest.main()
