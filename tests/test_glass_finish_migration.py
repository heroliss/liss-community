"""The glass-finish catalog widens known databases without rewriting content."""
from contextlib import closing, contextmanager
import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa

from app.public_schema import migrate_glass_finishes, migrate_material_catalog
if __package__:
    from . import test_material_catalog_migration as catalog_tests
else:  # unittest discover -s tests imports modules at the top level.
    import test_material_catalog_migration as catalog_tests


PREVIOUS_CHECK = "card_material IN ('auto','glass','ceramic','paper','metal','leather','cork','slate')"


def migration(name):
    path = Path(__file__).resolve().parents[1] / 'migrations/versions' / (name + '.py')
    spec = importlib.util.spec_from_file_location('isolated_' + name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_previous(database):
    """Use the real historical migration to construct the v29/v30 schema."""
    with closing(sqlite3.connect(database)) as connection:
        catalog_tests.legacy_database(connection)
    engine = sa.create_engine(sa.URL.create('sqlite', database=str(database)))
    try:
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration('20261031_material_catalog').upgrade()
            connection.exec_driver_sql("UPDATE post_appearances SET card_material='slate' WHERE post_id=5")
    finally:
        engine.dispose()


def state(database):
    with closing(sqlite3.connect(database)) as connection:
        return (catalog_tests.snapshots(connection),
                connection.execute('PRAGMA table_info(post_appearances)').fetchall(),
                connection.execute("SELECT sql FROM sqlite_master WHERE name='post_appearances'").fetchone()[0])


class GlassFinishMigrationTests(unittest.TestCase):
    def check_guards(self, connection):
        connection.execute("UPDATE post_appearances SET card_material='frosted' WHERE post_id=1")
        self.assertEqual(connection.execute('SELECT card_material FROM post_appearances WHERE post_id=1').fetchone()[0], 'frosted')
        for invalid in ('Frosted', 'frost', 'frosted; DROP TABLE posts', 'unknown'):
            with self.subTest(invalid=invalid), self.assertRaises(sqlite3.IntegrityError):
                connection.execute('UPDATE post_appearances SET card_material=? WHERE post_id=1', (invalid,))
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute("UPDATE post_appearances SET theme_color='bad' WHERE post_id=1")
        self.assertIn('ix_catalog_test_color', {row[1] for row in connection.execute('PRAGMA index_list(post_appearances)')})
        self.assertTrue(any(row[2] == 'posts' and row[6] == 'CASCADE'
                            for row in connection.execute('PRAGMA foreign_key_list(post_appearances)')))
        self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_alembic_upgrade_preserves_values_columns_indexes_and_foreign_keys(self):
        with tempfile.TemporaryDirectory(prefix='liss-glass-alembic-') as directory:
            database = Path(directory) / 'old.sqlite'
            make_previous(database)
            before, columns, _ = state(database)
            engine = sa.create_engine(sa.URL.create('sqlite', database=str(database)))
            try:
                with engine.begin() as connection:
                    with Operations.context(MigrationContext.configure(connection)):
                        migration('20261031_glass_finishes').upgrade()
                        migration('20261031_glass_finishes').upgrade()
                after, after_columns, _ = state(database)
                self.assertEqual(after, before)
                self.assertEqual(after_columns, columns)
                with closing(sqlite3.connect(database)) as connection:
                    self.check_guards(connection)
            finally:
                engine.dispose()

    def test_public_upgrade_backs_up_previous_catalog_once_and_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix='liss-glass-startup-') as directory:
            database = Path(directory) / 'old.sqlite'
            make_previous(database)
            before, columns, _ = state(database)
            migrate_glass_finishes(database)
            checksum = hashlib.sha256(database.read_bytes()).hexdigest()
            migrate_glass_finishes(database)
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), checksum)
            backups = list(Path(directory).glob('before-material-catalog-*.sqlite'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(state(backups[0])[0], before)
            self.assertIn(PREVIOUS_CHECK, state(backups[0])[2])
            after, after_columns, _ = state(database)
            self.assertEqual(after, before)
            self.assertEqual(after_columns, columns)
            with closing(sqlite3.connect(database)) as connection:
                self.check_guards(connection)

    def test_oldest_public_catalog_can_upgrade_directly_in_one_backup(self):
        with tempfile.TemporaryDirectory(prefix='liss-glass-oldest-') as directory:
            database = Path(directory) / 'old.sqlite'
            with closing(sqlite3.connect(database)) as connection:
                catalog_tests.legacy_database(connection)
            before = state(database)[0]
            migrate_glass_finishes(database)
            self.assertEqual(state(database)[0], before)
            self.assertEqual(len(list(Path(directory).glob('before-material-catalog-*.sqlite'))), 1)
            with closing(sqlite3.connect(database)) as connection:
                self.check_guards(connection)

    def test_failure_after_table_rebuild_rolls_back_and_keeps_verified_backup(self):
        with tempfile.TemporaryDirectory(prefix='liss-glass-rollback-') as directory:
            database = Path(directory) / 'old.sqlite'
            make_previous(database)
            before = state(database)
            original = Operations.batch_alter_table

            @contextmanager
            def fail_after_recreate(operations, *args, **kwargs):
                with original(operations, *args, **kwargs) as batch:
                    yield batch
                raise RuntimeError('Injected failure after glass table recreation')

            with patch.object(Operations, 'batch_alter_table', fail_after_recreate):
                with self.assertRaisesRegex(RuntimeError, 'Injected failure'):
                    migrate_glass_finishes(database)
            self.assertEqual(state(database), before)
            backups = list(Path(directory).glob('before-material-catalog-*.sqlite'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(state(backups[0]), before)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE name LIKE '_alembic_tmp_%'").fetchall(), [])

    def test_unknown_check_logic_is_rejected_without_backup_or_mutation(self):
        with tempfile.TemporaryDirectory(prefix='liss-glass-unknown-') as directory:
            database = Path(directory) / 'unknown.sqlite'
            with closing(sqlite3.connect(database)) as connection:
                connection.execute('CREATE TABLE post_appearances(post_id INTEGER PRIMARY KEY, card_material TEXT, '
                    'CONSTRAINT ck_post_appearance_material CHECK (' + PREVIOUS_CHECK + ' OR 1=1))')
                connection.execute("INSERT INTO post_appearances VALUES (1, 'glass')")
                connection.commit()
            checksum = hashlib.sha256(database.read_bytes()).hexdigest()
            with self.assertRaises(RuntimeError):
                migrate_glass_finishes(database)
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), checksum)
            self.assertEqual(list(Path(directory).glob('before-material-catalog-*.sqlite')), [])

    def test_later_public_schema_can_be_adopted_by_the_full_known_migration_path(self):
        with tempfile.TemporaryDirectory(prefix='liss-glass-adoption-') as directory:
            database = Path(directory) / 'adopt.sqlite'
            make_previous(database)
            migrate_glass_finishes(database)
            before = state(database)
            # Explicit historical helper does not narrow a recognized later catalog.
            migrate_material_catalog(database)
            engine = sa.create_engine(sa.URL.create('sqlite', database=str(database)))
            try:
                with engine.begin() as connection:
                    with Operations.context(MigrationContext.configure(connection)):
                        migration('20261031_material_catalog').upgrade()
                        migration('20261031_glass_finishes').upgrade()
                self.assertEqual(state(database), before)
            finally:
                engine.dispose()

    def test_missing_file_or_missing_table_is_left_for_current_model_creation(self):
        with tempfile.TemporaryDirectory(prefix='liss-glass-missing-') as directory:
            database = Path(directory) / 'empty.sqlite'
            migrate_glass_finishes(database)
            self.assertFalse(database.exists())
            with closing(sqlite3.connect(database)) as connection:
                connection.execute('CREATE TABLE keep_me (body TEXT)')
                connection.execute("INSERT INTO keep_me VALUES ('Keep this row.')")
                connection.commit()
            checksum = hashlib.sha256(database.read_bytes()).hexdigest()
            migrate_glass_finishes(database)
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), checksum)


if __name__ == '__main__':
    unittest.main()
