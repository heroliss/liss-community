"""Optical choices upgrade isolated stores without changing saved content."""
from contextlib import closing, contextmanager
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa

from app.public_schema import (migrate_glass_finishes, migrate_material_catalog,
                               migrate_reflective_materials)
if __package__:
    from . import test_material_catalog_migration as catalog_tests
    from .test_glass_finish_migration import migration, state
else:
    import test_material_catalog_migration as catalog_tests
    from test_glass_finish_migration import migration, state


PREVIOUS_CHECK = "card_material IN ('auto','glass','ceramic','paper','metal','leather','cork','slate','frosted')"


def apply_migration(database, name='20261031_reflective_materials', method='upgrade'):
    engine = sa.create_engine(sa.URL.create('sqlite', database=str(database)))
    try:
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                getattr(migration(name), method)()
    finally:
        engine.dispose()


def make_previous(database):
    with closing(sqlite3.connect(database)) as connection:
        catalog_tests.legacy_database(connection)
    apply_migration(database, '20261031_material_catalog')
    apply_migration(database, '20261031_glass_finishes')
    with closing(sqlite3.connect(database)) as connection:
        for identifier, material in enumerate(('leather', 'cork', 'slate', 'frosted'), 6):
            connection.execute('INSERT INTO posts VALUES (?, ?, ?)',
                               (identifier, '# Saved ' + material, 29))
            connection.execute('INSERT INTO comments VALUES (?, ?, ?)',
                               (identifier, 'Keep this existing reply.', identifier))
            connection.execute('INSERT INTO post_appearances VALUES (?, ?, ?)',
                               (identifier, '#7ab8dd', material))
        connection.commit()


class ReflectiveMaterialMigrationTests(unittest.TestCase):
    def check_guards_and_cascade(self, database):
        with closing(sqlite3.connect(database)) as connection:
            connection.execute('PRAGMA foreign_keys=ON')
            for material in ('mirror', 'water'):
                connection.execute('UPDATE post_appearances SET card_material=? WHERE post_id=1', (material,))
                self.assertEqual(connection.execute('SELECT card_material FROM post_appearances WHERE post_id=1').fetchone()[0], material)
            for invalid in ('Mirror', 'Water', 'mirror; DROP TABLE posts', 'unknown'):
                with self.subTest(invalid=invalid), self.assertRaises(sqlite3.IntegrityError):
                    connection.execute('UPDATE post_appearances SET card_material=? WHERE post_id=1', (invalid,))
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute("UPDATE post_appearances SET theme_color='invalid' WHERE post_id=1")
            self.assertIn('ix_catalog_test_color', {row[1] for row in connection.execute('PRAGMA index_list(post_appearances)')})
            self.assertTrue(any(row[2] == 'posts' and row[6] == 'CASCADE'
                                for row in connection.execute('PRAGMA foreign_key_list(post_appearances)')))
            connection.execute('DELETE FROM comments WHERE post_id=1')
            connection.execute('DELETE FROM posts WHERE id=1')
            self.assertIsNone(connection.execute('SELECT post_id FROM post_appearances WHERE post_id=1').fetchone())
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_alembic_preserves_all_previous_choices_rows_columns_indexes_and_cascade(self):
        with tempfile.TemporaryDirectory(prefix='liss-reflective-alembic-') as directory:
            database = Path(directory) / 'old.sqlite'
            make_previous(database)
            before, columns, _ = state(database)
            self.assertEqual({row[2] for row in before['post_appearances']},
                             {'auto', 'glass', 'ceramic', 'paper', 'metal', 'leather', 'cork', 'slate', 'frosted'})
            apply_migration(database)
            apply_migration(database)
            after, after_columns, _ = state(database)
            self.assertEqual(after, before)
            self.assertEqual(after_columns, columns)
            self.check_guards_and_cascade(database)

    def test_public_upgrade_has_usable_original_backup_and_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix='liss-reflective-backup-') as directory:
            database = Path(directory) / 'old.sqlite'
            make_previous(database)
            before = state(database)
            migrate_reflective_materials(database)
            checksum = hashlib.sha256(database.read_bytes()).hexdigest()
            migrate_reflective_materials(database)
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), checksum)
            self.assertEqual(state(database)[:2], before[:2])
            backups = list(Path(directory).glob('before-material-catalog-*.sqlite'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(state(backups[0]), before)
            self.assertIn(PREVIOUS_CHECK, before[2])
            self.check_guards_and_cascade(database)

    def test_public_can_upgrade_each_earlier_known_catalog_in_one_backup(self):
        for stage in ('oldest', 'catalog'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory(prefix='liss-reflective-history-') as directory:
                database = Path(directory) / 'old.sqlite'
                with closing(sqlite3.connect(database)) as connection:
                    catalog_tests.legacy_database(connection)
                if stage == 'catalog':
                    apply_migration(database, '20261031_material_catalog')
                before = state(database)[:2]
                migrate_reflective_materials(database)
                self.assertEqual(state(database)[:2], before)
                self.assertEqual(len(list(Path(directory).glob('before-material-catalog-*.sqlite'))), 1)
                self.check_guards_and_cascade(database)

    def test_public_failure_rolls_back_table_and_retains_original_backup(self):
        with tempfile.TemporaryDirectory(prefix='liss-reflective-rollback-') as directory:
            database = Path(directory) / 'old.sqlite'
            make_previous(database)
            before = state(database)
            original = Operations.batch_alter_table

            @contextmanager
            def fail_after_rebuild(operations, *args, **kwargs):
                with original(operations, *args, **kwargs) as batch:
                    yield batch
                raise RuntimeError('Injected failure after reflective table rebuild')

            with patch.object(Operations, 'batch_alter_table', fail_after_rebuild):
                with self.assertRaisesRegex(RuntimeError, 'Injected failure'):
                    migrate_reflective_materials(database)
            self.assertEqual(state(database), before)
            backups = list(Path(directory).glob('before-material-catalog-*.sqlite'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(state(backups[0]), before)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE name LIKE '_alembic_tmp_%'").fetchall(), [])

    def test_unknown_check_logic_is_rejected_without_mutation_or_backup(self):
        with tempfile.TemporaryDirectory(prefix='liss-reflective-unknown-') as directory:
            database = Path(directory) / 'unknown.sqlite'
            with closing(sqlite3.connect(database)) as connection:
                connection.execute('CREATE TABLE post_appearances(post_id INTEGER PRIMARY KEY, card_material TEXT, '
                    'CONSTRAINT ck_post_appearance_material CHECK (' + PREVIOUS_CHECK + ' OR 1=1))')
                connection.execute("INSERT INTO post_appearances VALUES (1, 'glass')")
                connection.commit()
            checksum = hashlib.sha256(database.read_bytes()).hexdigest()
            for operation in (lambda: migrate_reflective_materials(database), lambda: apply_migration(database),
                              lambda: apply_migration(database, method='downgrade')):
                with self.assertRaisesRegex(RuntimeError, 'Unrecognized'):
                    operation()
                self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), checksum)
            self.assertEqual(list(Path(directory).glob('before-material-catalog-*.sqlite')), [])

    def test_new_public_schema_is_adopted_by_historical_paths_without_narrowing(self):
        with tempfile.TemporaryDirectory(prefix='liss-reflective-adoption-') as directory:
            database = Path(directory) / 'new.sqlite'
            make_previous(database)
            migrate_reflective_materials(database)
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE post_appearances SET card_material='mirror' WHERE post_id=1")
                connection.execute("UPDATE post_appearances SET card_material='water' WHERE post_id=2")
                connection.commit()
            before = state(database)
            migrate_material_catalog(database)
            migrate_glass_finishes(database)
            apply_migration(database, '20261031_material_catalog')
            apply_migration(database, '20261031_glass_finishes')
            apply_migration(database)
            self.assertEqual(state(database), before)

    def test_downgrade_without_new_choices_preserves_all_rows_and_is_reversible(self):
        with tempfile.TemporaryDirectory(prefix='liss-reflective-downgrade-') as directory:
            database = Path(directory) / 'safe.sqlite'
            make_previous(database)
            before = state(database)[:2]
            apply_migration(database)
            apply_migration(database, method='downgrade')
            apply_migration(database, method='downgrade')
            self.assertEqual(state(database)[:2], before)
            self.assertIn(PREVIOUS_CHECK, state(database)[2])
            with closing(sqlite3.connect(database)) as connection:
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute("UPDATE post_appearances SET card_material='mirror' WHERE post_id=1")
            apply_migration(database)
            self.assertEqual(state(database)[:2], before)
            self.check_guards_and_cascade(database)

    def test_downgrade_refuses_saved_new_choices_without_rewriting_or_deleting(self):
        for material in ('mirror', 'water'):
            with self.subTest(material=material), tempfile.TemporaryDirectory(prefix='liss-reflective-keeps-user-data-') as directory:
                database = Path(directory) / 'saved.sqlite'
                make_previous(database)
                apply_migration(database)
                with closing(sqlite3.connect(database)) as connection:
                    connection.execute('UPDATE post_appearances SET card_material=? WHERE post_id=1', (material,))
                    connection.commit()
                before = state(database)
                with self.assertRaisesRegex(RuntimeError, 'Saved mirror or water choices are user data'):
                    apply_migration(database, method='downgrade')
                self.assertEqual(state(database), before)

    def test_missing_file_or_appearance_table_is_left_for_current_model_creation(self):
        with tempfile.TemporaryDirectory(prefix='liss-reflective-missing-') as directory:
            database = Path(directory) / 'empty.sqlite'
            migrate_reflective_materials(database)
            self.assertFalse(database.exists())
            with closing(sqlite3.connect(database)) as connection:
                connection.execute('CREATE TABLE keep_me (body TEXT)')
                connection.execute("INSERT INTO keep_me VALUES ('Keep this row.')")
                connection.commit()
            checksum = hashlib.sha256(database.read_bytes()).hexdigest()
            migrate_reflective_materials(database)
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), checksum)


if __name__ == '__main__':
    unittest.main()
