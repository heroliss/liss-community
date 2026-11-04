"""Consistent private upload bundles and failure-safe restore acceptance."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app import create_app, db
from app.background_catalog import BackgroundCatalog, document
from app.public_demo_bundle import (backup_bundle, inspect_bundle, install_uploads,
                                    MAX_CATALOGUE_BYTES, required_uploads, rollback_uploads)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.storage = self.root/'source'
        self.storage.mkdir()
        self.database = self.storage/'public-demo.sqlite'
        with closing(sqlite3.connect(self.database)) as connection:
            for name in ('users', 'roles', 'posts', 'comments', 'follows'):
                connection.execute('CREATE TABLE '+name+' (id INTEGER PRIMARY KEY, value TEXT)')
            connection.execute('INSERT INTO posts VALUES (1,?)', ('retained content',))
            connection.execute('CREATE TABLE public_demo_state (id INTEGER PRIMARY KEY, identity_epoch TEXT, created_at REAL)')
            connection.execute("INSERT INTO public_demo_state VALUES (1,'original-epoch',1)")
            connection.execute('CREATE TABLE background_catalog (id INTEGER PRIMARY KEY, data TEXT)')
            connection.commit()

    def tearDown(self):
        self.directory.cleanup()

    def add_upload(self, deleted=False):
        name = 'upload-'+'a'*24
        folder = self.storage/'backgrounds/items'/name
        folder.mkdir(parents=True)
        raw = b'retained-native-bytes'
        values = {'original.png': raw, 'image-640.webp': b'private-webp-variant', 'thumb.webp': b'private-thumb'}
        for filename, data in values.items():
            (folder/filename).write_bytes(data)
        (folder/'stage.json').write_text('{"privateActorInformation":true}', encoding='utf-8')
        base = '/background-assets/'+name+'/'
        entry = dict(id=name, sourceKind='upload', _storage=name, deleted=deleted, enabled=not deleted,
                     _native=dict(file='original.png', bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()),
                     variants=[dict(file=base+'image-640.webp', width=640, height=400, bytes=len(values['image-640.webp']))],
                     src=base+'image-640.webp', thumbnail=base+'thumb.webp')
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute('INSERT OR REPLACE INTO background_catalog VALUES (1,?)',
                               (json.dumps(dict(entries=[entry])),))
            connection.commit()
        return name, folder, entry

    def bundle(self):
        output = self.root/'snapshot.bundle'
        backup_bundle(self.database, self.storage, output)
        return output

    def change_manifest(self, bundle, change):
        filename = bundle/'manifest.json'
        value = json.loads(filename.read_text(encoding='utf-8'))
        change(value)
        filename.write_text(json.dumps(value), encoding='utf-8')

    def test_empty_legacy_database_bundle_and_no_overwrite(self):
        output = self.bundle()
        database, files = inspect_bundle(output)
        self.assertEqual(set(files), {'database.sqlite'})
        self.assertEqual(required_uploads(database), {})
        with self.assertRaises(FileExistsError):
            backup_bundle(self.database, self.storage, output)
        self.assertTrue((output/'manifest.json').is_file())

    def test_native_variants_and_soft_removed_files_included_without_configuration(self):
        _, folder, _ = self.add_upload(deleted=True)
        (self.storage/'private-config.json').write_text('{"SECRET_KEY":"never-copy"}', encoding='utf-8')
        (self.storage/'backgrounds/staging').mkdir()
        (self.storage/'backgrounds/staging/pending').write_bytes(b'never-copy-pending')
        output = self.bundle()
        _, files = inspect_bundle(output)
        self.assertEqual(len(files), 4)
        self.assertFalse(any('stage' in name or 'config' in name for name in files))
        for source in folder.iterdir():
            if source.name != 'stage.json':
                self.assertEqual((output/source.relative_to(self.storage)).read_bytes(), source.read_bytes())

    def test_missing_source_and_changed_native_refuse_backup_and_remove_only_owned_output(self):
        _, folder, _ = self.add_upload()
        (folder/'original.png').write_bytes(b'changed-native')
        with self.assertRaisesRegex(ValueError, 'metadata'):
            self.bundle()
        self.assertFalse((self.root/'snapshot.bundle').exists())
        self.assertTrue((folder/'image-640.webp').is_file())
        (folder/'original.png').unlink()
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.bundle()
        self.assertFalse((self.root/'snapshot.bundle').exists())

    def test_broken_hash_missing_file_and_unlisted_file_are_rejected(self):
        _, _, _ = self.add_upload()
        original = self.bundle()
        for kind in ('changed', 'missing', 'extra'):
            sample = self.root/kind
            shutil.copytree(original, sample)
            file = next(sample.glob('backgrounds/items/*/thumb.webp'))
            if kind == 'changed':
                file.write_bytes(b'changed')
            elif kind == 'missing':
                file.unlink()
            else:
                (sample/'unlisted-private-file').write_bytes(b'not-in-manifest')
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                inspect_bundle(sample)

    def test_manifest_path_traversal_absolute_and_windows_paths_are_rejected(self):
        original = self.bundle()
        for index, relative in enumerate(('../outside', '/absolute', 'C:/absolute', r'backgrounds\..\outside', '.', '')):
            sample = self.root/str(index)
            shutil.copytree(original, sample)
            self.change_manifest(sample, lambda value: value['files'].update({relative: dict(bytes=0, sha256='0'*64)}))
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                inspect_bundle(sample)
        self.assertFalse((self.root/'outside').exists())

    def test_manifest_cannot_omit_a_database_reference_or_duplicate_a_key(self):
        _, _, _ = self.add_upload()
        original = self.bundle()
        self.change_manifest(original, lambda value: value['files'].pop(next(name for name in value['files'] if name.endswith('thumb.webp'))))
        with self.assertRaisesRegex(ValueError, 'references'):
            inspect_bundle(original)
        (original/'manifest.json').write_text('{"version":1,"version":1}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            inspect_bundle(original)

    def test_linked_bundle_file_and_linked_source_directory_are_rejected(self):
        _, folder, _ = self.add_upload()
        original = self.bundle()
        target = next(original.glob('backgrounds/items/*/thumb.webp'))
        target.unlink()
        try:
            target.symlink_to(folder/'thumb.webp')
        except (OSError, NotImplementedError):
            self.skipTest('Creating symlinks is unavailable for this test user.')
        with self.assertRaisesRegex(ValueError, 'links'):
            inspect_bundle(original)
        target.unlink()
        target.write_bytes(b'private-thumb')
        moved = self.root/'moved'
        folder.rename(moved)
        folder.symlink_to(moved, target_is_directory=True)
        try:
            with self.assertRaisesRegex(ValueError, 'links'):
                backup_bundle(self.database, self.storage, self.root/'linked.bundle')
        finally:
            folder.unlink()

    def test_install_is_idempotent_preserves_extra_files_and_rolls_back_only_additions(self):
        name, _, _ = self.add_upload()
        original = self.bundle()
        _, files = inspect_bundle(original)
        destination = self.root/'destination'
        destination.mkdir()
        additions, directories = install_uploads(original, destination, files)
        self.assertEqual(len(additions), 3)
        extra = destination/'backgrounds/items'/name/'stage.json'
        extra.write_text('preserve-extra', encoding='utf-8')
        repeated, _ = install_uploads(original, destination, files)
        self.assertEqual(repeated, [])
        rollback_uploads(additions, directories)
        self.assertEqual(extra.read_text(encoding='utf-8'), 'preserve-extra')
        self.assertFalse((extra.parent/'thumb.webp').exists())

    def test_linked_ancestors_are_rejected_for_source_output_and_destination(self):
        self.add_upload()
        original = self.bundle()
        _, files = inspect_bundle(original)
        alias = self.root/'alias'
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('Creating symlinks is unavailable for this test user.')
        destination = self.root/'destination'
        destination.mkdir()
        try:
            for operation in (
                    lambda: inspect_bundle(alias/original.name),
                    lambda: backup_bundle(self.database, self.storage, alias/'new.bundle'),
                    lambda: backup_bundle(self.database, alias/'source', self.root/'new.bundle'),
                    lambda: install_uploads(original, alias/'destination', files)):
                with self.subTest(operation=operation), self.assertRaisesRegex(ValueError, 'links'):
                    operation()
            self.assertFalse((self.root/'new.bundle').exists())
            self.assertEqual(list(destination.iterdir()), [])
        finally:
            alias.unlink()

    def test_oversized_or_invalid_catalogue_is_rejected_before_json_parsing(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute('INSERT INTO background_catalog VALUES (1,?)',
                               ('{"entries":[]}'+(' ' * MAX_CATALOGUE_BYTES),))
            connection.commit()
        with patch('app.public_demo_bundle.json.loads', side_effect=AssertionError('oversized JSON must not be parsed')):
            with self.assertRaisesRegex(ValueError, 'catalogue'):
                required_uploads(self.database)
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute('DROP TABLE background_catalog')
            connection.execute('CREATE TABLE background_catalog (id INTEGER PRIMARY KEY)')
            connection.commit()
        with self.assertRaisesRegex(ValueError, 'catalogue'):
            required_uploads(self.database)

    def test_conflicting_existing_file_preserves_contents_and_removes_partial_additions(self):
        name, _, _ = self.add_upload()
        original = self.bundle()
        _, files = inspect_bundle(original)
        destination = self.root/'destination'
        folder = destination/'backgrounds/items'/name
        folder.mkdir(parents=True)
        (folder/'thumb.webp').write_bytes(b'existing-conflict')
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            install_uploads(original, destination, files)
        self.assertEqual({path.name for path in folder.iterdir()}, {'thumb.webp'})
        self.assertEqual((folder/'thumb.webp').read_bytes(), b'existing-conflict')

    def test_copy_failure_never_changes_existing_destination(self):
        self.add_upload()
        original = self.bundle()
        _, files = inspect_bundle(original)
        destination = self.root/'destination'
        destination.mkdir()
        sentinel = destination/'saved.txt'
        sentinel.write_bytes(b'keep')
        with patch('app.public_demo_bundle.os.link', side_effect=OSError('simulated filesystem failure')):
            with self.assertRaises(OSError):
                install_uploads(original, destination, files)
        self.assertEqual(list(destination.iterdir()), [sentinel])

    def test_source_growth_after_verification_is_rejected_before_unbounded_copy(self):
        from app.public_demo_bundle import copy_exclusive
        self.add_upload()
        def grow_source(source, destination, **kwargs):
            if source.name == 'thumb.webp':
                with source.open('ab') as stream:
                    stream.write(b'changed-after-verification')
            return copy_exclusive(source, destination, **kwargs)
        with patch('app.public_demo_bundle.copy_exclusive', side_effect=grow_source):
            with self.assertRaisesRegex(ValueError, 'changed while copying'):
                self.bundle()
        self.assertFalse((self.root/'snapshot.bundle').exists())


class BundleIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.environment = patch.dict('os.environ', {
            'SECRET_KEY': 'bundle-test-secret-'*4, 'LISS_DATA_DIR': str(self.root/'live'),
            'LIHOU_PROXY_HOPS': '0', 'LISS_EMAIL_ACCOUNTS': '0'})
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.client = self.app.test_client()
        self.assertEqual(self.client.get('/').status_code, 200)
        self.sandbox = self.app.extensions['public_demo']

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def state(self):
        with self.app.app_context():
            return document(db.session.get(BackgroundCatalog, 1))

    def upload_snapshot(self):
        fixtures = BundleTests()
        fixtures.setUp()
        self.addCleanup(fixtures.tearDown)
        _, folder, entry = fixtures.add_upload(deleted=True)
        # Keep a real app schema and authored builtin catalogue for prepare().
        database = fixtures.database
        database.unlink()
        with self.app.app_context(), self.sandbox.exclusive():
            self.sandbox.backup(database)
        state = self.state()
        state['entries'].append({**state['entries'][0], **entry, 'title': 'Retained upload'})
        with closing(sqlite3.connect(database)) as connection:
            connection.execute('UPDATE background_catalog SET data=? WHERE id=1', (json.dumps(state),))
            connection.commit()
        return fixtures.bundle(), entry, folder

    def test_complete_restore_installs_images_preserves_native_and_revokes_identity(self):
        original, entry, folder = self.upload_snapshot()
        epoch = self.sandbox.epoch
        with self.app.app_context(), self.sandbox.exclusive():
            safety = self.sandbox.restore(original)
            self.assertNotEqual(self.sandbox.epoch, epoch)
            self.assertEqual(len(document()['entries']), 52)
        inspect_bundle(safety)
        restored = self.root/'live/backgrounds/items'/entry['id']
        self.assertEqual((restored/'original.png').read_bytes(), (folder/'original.png').read_bytes())
        self.assertFalse((restored/'stage.json').exists())
        self.assertEqual(self.client.get('/').status_code, 200)

    def test_legacy_sqlite_missing_uploaded_images_is_rejected_before_mutation(self):
        original, _, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        with self.app.app_context(), self.sandbox.exclusive():
            with self.assertRaisesRegex(ValueError, 'missing'):
                self.sandbox.restore(original/'database.sqlite')
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sandbox.epoch, epoch)
        self.assertEqual(list((self.root/'live').glob('before-restore-*')), [])

    def test_failed_database_write_rolls_back_new_files_and_preserves_live_data(self):
        original, entry, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        with self.app.app_context(), self.sandbox.exclusive(), patch('app.public_demo_storage.restore_database', side_effect=OSError('failed write')):
            with self.assertRaises(OSError):
                self.sandbox.restore(original)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sandbox.epoch, epoch)
        self.assertFalse((self.root/'live/backgrounds/items'/entry['id']).exists())
        self.assertEqual(len(list((self.root/'live').glob('before-restore-*.bundle'))), 1)

    def test_failed_preparation_restores_original_database_epoch_and_removes_new_files(self):
        original, entry, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        prepare, calls = self.sandbox.prepare, []
        def fail_on_restored_catalogue():
            calls.append(1)
            if len(calls) == 3:  # preflight, safety backup, then restored preparation
                raise ValueError('simulated migration failure')
            return prepare()
        with self.app.app_context(), self.sandbox.exclusive(), patch.object(self.sandbox, 'prepare', side_effect=fail_on_restored_catalogue):
            with self.assertRaisesRegex(ValueError, 'migration'):
                self.sandbox.restore(original)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sandbox.epoch, epoch)
        self.assertFalse((self.root/'live/backgrounds/items'/entry['id']).exists())
        self.assertEqual(self.client.get('/').status_code, 200)

    def test_error_after_database_publication_rolls_back_database_epoch_and_images(self):
        from app.public_demo_storage import restore_database
        original, entry, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        calls = []
        def late_error(*args, **kwargs):
            calls.append(kwargs)
            restore_database(*args, **kwargs)
            if len(calls) == 1:
                raise OSError('simulated cleanup error after committed restore')
        with self.app.app_context(), self.sandbox.exclusive(), patch('app.public_demo_storage.restore_database', side_effect=late_error):
            with self.assertRaisesRegex(OSError, 'cleanup error'):
                self.sandbox.restore(original)
        self.assertEqual(len(calls), 2)
        self.assertFalse(calls[-1]['rotate_identity'])
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sandbox.epoch, epoch)
        self.assertFalse((self.root/'live/backgrounds/items'/entry['id']).exists())
        self.assertEqual(self.client.get('/').status_code, 200)

    def test_legacy_sqlite_output_parent_link_is_rejected(self):
        alias = self.root/'alias'
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('Creating symlinks is unavailable for this test user.')
        try:
            with self.app.app_context(), self.sandbox.exclusive():
                with self.assertRaisesRegex(ValueError, 'links'):
                    self.sandbox.backup(alias/'legacy.sqlite')
            self.assertFalse((self.root/'legacy.sqlite').exists())
        finally:
            alias.unlink()

    def test_bundle_database_changed_after_inspection_is_not_restored(self):
        from app.public_demo_storage import restore_database
        original, entry, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        calls = []
        def change_source_before_copy(source, destination, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                with closing(sqlite3.connect(source)) as connection:
                    connection.execute('UPDATE background_catalog SET revision=revision+99 WHERE id=1')
                    connection.commit()
            return restore_database(source, destination, **kwargs)
        with self.app.app_context(), self.sandbox.exclusive(), patch('app.public_demo_storage.restore_database', side_effect=change_source_before_copy):
            with self.assertRaisesRegex(ValueError, 'integrity changed'):
                self.sandbox.restore(original)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sandbox.epoch, epoch)
        self.assertFalse((self.root/'live/backgrounds/items'/entry['id']).exists())
        self.assertEqual(self.client.get('/').status_code, 200)

    def test_bundle_database_growth_after_inspection_is_rejected(self):
        from app.public_demo_storage import restore_database
        original, entry, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        calls = []
        def grow_source_before_copy(source, destination, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                with Path(source).open('ab') as stream:
                    stream.write(b'changed-after-inspection')
            return restore_database(source, destination, **kwargs)
        with self.app.app_context(), self.sandbox.exclusive(), patch('app.public_demo_storage.restore_database', side_effect=grow_source_before_copy):
            with self.assertRaisesRegex(ValueError, 'integrity changed'):
                self.sandbox.restore(original)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sandbox.epoch, epoch)
        self.assertFalse((self.root/'live/backgrounds/items'/entry['id']).exists())

    def test_changed_legacy_snapshot_revalidates_actual_frozen_upload_references(self):
        from app.public_demo_storage import restore_database
        original, entry, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        legacy = self.root/'legacy-race.sqlite'
        with self.app.app_context(), self.sandbox.exclusive():
            self.sandbox.backup(legacy)
        calls = []
        def change_source_before_copy(source, destination, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                with closing(sqlite3.connect(original/'database.sqlite')) as connection:
                    changed = connection.execute('SELECT data FROM background_catalog WHERE id=1').fetchone()[0]
                with closing(sqlite3.connect(source)) as connection:
                    connection.execute('UPDATE background_catalog SET data=? WHERE id=1', (changed,))
                    connection.commit()
            return restore_database(source, destination, **kwargs)
        with self.app.app_context(), self.sandbox.exclusive(), patch('app.public_demo_storage.restore_database', side_effect=change_source_before_copy):
            with self.assertRaisesRegex(ValueError, 'missing'):
                self.sandbox.restore(legacy)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sandbox.epoch, epoch)
        self.assertFalse((self.root/'live/backgrounds/items'/entry['id']).exists())

    def test_cli_bundle_option_and_existing_sqlite_mode_remain_available(self):
        with patch.dict('os.environ', {'FLASK_CONFIG': 'public-demo'}):
            namespace = runpy.run_path(str(Path(__file__).resolve().parents[1]/'manage.py'), run_name='bundle_cli_test')
        cli_app = namespace['app']
        try:
            runner = cli_app.test_cli_runner()
            bundle = self.root/'cli.bundle'
            result = runner.invoke(args=['backup-public-demo', '--bundle', '--output', str(bundle)])
            self.assertEqual(result.exit_code, 0, result.output)
            inspect_bundle(bundle)
            result = runner.invoke(args=['backup-public-demo', '--output', str(self.root/'legacy.sqlite')])
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertIn('SQLite-only', result.output)
            self.assertNotIn('bundle-test-secret-', result.output)
        finally:
            with cli_app.app_context():
                db.session.remove()
                db.engine.dispose()

    def test_check_only_verifies_without_restoring_or_creating_safety_backup(self):
        original, entry, _ = self.upload_snapshot()
        before, epoch = self.state(), self.sandbox.epoch
        with patch.dict('os.environ', {'FLASK_CONFIG': 'public-demo'}):
            namespace = runpy.run_path(str(Path(__file__).resolve().parents[1]/'manage.py'), run_name='bundle_check_cli_test')
        cli_app = namespace['app']
        try:
            result = cli_app.test_cli_runner().invoke(args=['restore-public-demo', '--input', str(original), '--check'])
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertIn('Check only', result.output)
            self.assertEqual(self.state(), before)
            self.assertEqual(self.sandbox.epoch, epoch)
            self.assertFalse((self.root/'live/backgrounds/items'/entry['id']).exists())
            self.assertEqual(list((self.root/'live').glob('before-restore-*')), [])
        finally:
            with cli_app.app_context():
                db.session.remove()
                db.engine.dispose()


if __name__ == '__main__':
    unittest.main()
