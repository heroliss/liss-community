"""Private, self-verifying database and immutable-upload directory snapshots.

No archive is extracted and no executable configuration is copied. Restores only
add missing, verified image files; existing files must match and are never replaced.
The caller holds the public-demo lease across database and file operations.
"""
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import tempfile

from .public_demo_storage import backup_database, inspect_backup

FORMAT = 'liss-public-demo-bundle'
DATABASE = 'database.sqlite'
MANIFEST = 'manifest.json'
MAX_FILES = 1600
MAX_BYTES = 4 * 1024**3
MAX_CATALOGUE_BYTES = 2 * 1024**2
UPLOAD = re.compile(r'upload-[a-f0-9]{24}\Z')
IMAGE = re.compile(r'(?:image-[0-9]{2,5}|thumb)\.webp\Z')
NATIVE = re.compile(r'original\.(?:png|jpg|webp)\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')


def absolute(path):
    return Path(os.path.abspath(Path(path).expanduser()))


def plain(path, directory=False):
    """Refuse links, junctions and other Windows reparse points before following."""
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
        raise ValueError('Backup paths must not contain symbolic links or junctions.')
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise ValueError('Backup path has an unsupported file type.')
    return info


def plain_parents(path):
    """Validate existing ancestors as well as the explicitly named root.

    A plain leaf below a linked parent would otherwise silently read or publish
    outside the directory checked by the caller. Missing output parents are
    permitted, but all existing ancestors must be real directories.
    """
    for parent in reversed(absolute(path).parents):
        try:
            plain(parent, directory=True)
        except FileNotFoundError:
            continue


def within(root, relative):
    if not isinstance(relative, str):
        raise ValueError('Invalid backup file path.')
    value = PurePosixPath(relative)
    if (not value.parts or value.is_absolute() or '\\' in relative
            or ':' in relative or str(value) != relative
            or any(part in {'', '.', '..'} for part in value.parts)):
        raise ValueError('Invalid backup file path.')
    plain_parents(root)
    plain(root, directory=True)
    path = root
    for part in value.parts[:-1]:
        path /= part
        plain(path, directory=True)
    path /= value.parts[-1]
    plain(path)
    return path


def file_info(path):
    info = plain(path)
    if info.st_size > MAX_BYTES:
        raise ValueError('Backup file exceeds the supported size.')
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            checksum.update(block)
    return dict(bytes=info.st_size, sha256=checksum.hexdigest())


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate backup metadata key.')
        result[key] = value
    return result


def required_uploads(database):
    """Read references from the snapshot, including disabled/soft-removed entries."""
    required = {}
    try:
        with closing(sqlite3.connect(database.as_uri()+'?mode=ro', uri=True)) as connection:
            # Enforce SQLite's own value bound before fetching/parsing a damaged
            # multi-gigabyte JSON cell, as well as a Python-side catalogue limit.
            connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_CATALOGUE_BYTES)
            exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='background_catalog'").fetchone()
            if not exists:
                return required
            size = connection.execute('SELECT length(data),typeof(data) FROM background_catalog WHERE id=1').fetchone()
            if size is not None and (size[1] != 'text' or not 0 < size[0] <= MAX_CATALOGUE_BYTES):
                raise ValueError('Background catalogue in backup exceeds the supported size.')
            row = connection.execute('SELECT data FROM background_catalog WHERE id=1').fetchone()
    except sqlite3.DatabaseError as error:
        raise ValueError('Invalid or oversized background catalogue in backup.') from error
    if row is None:
        return required
    try:
        document = json.loads(row[0], object_pairs_hook=unique_object)
        entries = document['entries']
        if not isinstance(entries, list) or len(entries) > 200:
            raise ValueError('Invalid background catalogue in backup.')
        seen = set()
        for entry in entries:
            if entry.get('sourceKind') != 'upload':
                continue
            name = entry['id']
            if not isinstance(name, str) or not UPLOAD.fullmatch(name) or entry['_storage'] != name or name in seen:
                raise ValueError('Invalid uploaded background identifier in backup.')
            seen.add(name)
            prefix = 'backgrounds/items/'+name+'/'
            native = entry['_native']
            filename = native['file']
            if not NATIVE.fullmatch(filename) or not SHA.fullmatch(native['sha256']):
                raise ValueError('Invalid native image metadata in backup.')
            required[prefix+filename] = dict(bytes=native['bytes'], sha256=native['sha256'])
            variants = entry['variants']
            if not isinstance(variants, list) or not 1 <= len(variants) <= 6:
                raise ValueError('Invalid background variants in backup.')
            filenames = set()
            for variant in variants:
                filename = variant['file'].rsplit('/', 1)[-1]
                if (not IMAGE.fullmatch(filename) or filename == 'thumb.webp' or filename in filenames
                        or variant['file'] != '/background-assets/'+name+'/'+filename):
                    raise ValueError('Invalid uploaded background URL in backup.')
                filenames.add(filename)
                required[prefix+filename] = dict(bytes=variant['bytes'])
            if (entry['thumbnail'] != '/background-assets/'+name+'/thumb.webp'
                    or entry['src'] not in {variant['file'] for variant in variants}):
                raise ValueError('Invalid uploaded background URL in backup.')
            required[prefix+'thumb.webp'] = {}
        for expected in required.values():
            if 'bytes' in expected and (type(expected['bytes']) is not int or not 0 < expected['bytes'] <= MAX_BYTES):
                raise ValueError('Invalid background file size in backup.')
        return required
    except (KeyError, TypeError, AttributeError, json.JSONDecodeError) as error:
        raise ValueError('Invalid background catalogue in backup.') from error


def verify_uploads(root, required):
    files = {}
    for relative, expected in required.items():
        try:
            actual = file_info(within(root, relative))
        except OSError as error:
            raise ValueError('A background file referenced by this backup is missing.') from error
        if any(actual[key] != value for key, value in expected.items()):
            raise ValueError('A background file does not match the backup metadata.')
        files[relative] = actual
    return files


def copy_exclusive(source, destination, *, expected_bytes=None):
    plain_parents(source)
    info = plain(source)
    size = info.st_size if expected_bytes is None else expected_bytes
    if type(size) is not int or not 0 <= size <= MAX_BYTES or info.st_size != size:
        raise ValueError('Background file changed while copying.')
    plain_parents(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    plain_parents(destination)
    with source.open('rb') as original:
        descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'wb') as target:
            remaining = size
            while block := original.read(min(1024*1024, remaining+1)):
                if len(block) > remaining:
                    raise ValueError('Background file changed while copying.')
                target.write(block)
                remaining -= len(block)
            if remaining:
                raise ValueError('Background file changed while copying.')


def backup_bundle(database, storage, output):
    storage, output = absolute(storage), absolute(output)
    plain_parents(storage)
    plain(storage, directory=True)
    if output == storage or output.is_relative_to(storage/'backgrounds'):
        raise ValueError('Bundle output must be outside the background image directory.')
    plain_parents(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    plain_parents(output)
    output.mkdir(mode=0o700)  # Reserve once; never replace any existing output.
    try:
        backup_database(database, output/DATABASE)
        required = required_uploads(output/DATABASE)
        source_files = verify_uploads(storage, required)
        files = {DATABASE: file_info(output/DATABASE)}
        if sum(value['bytes'] for value in [*files.values(), *source_files.values()]) > MAX_BYTES:
            raise ValueError('Backup exceeds the supported total size.')
        for relative in sorted(required):
            original = within(storage, relative)
            before = source_files[relative]
            copy_exclusive(original, output/relative, expected_bytes=before['bytes'])
            files[relative] = file_info(output/relative)
            if files[relative] != before:
                raise ValueError('Background file changed while making a backup.')
        manifest = dict(format=FORMAT, version=1,
                        createdAt=datetime.now(timezone.utc).isoformat(), files=files)
        with (output/MANIFEST).open('x', encoding='utf-8') as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        inspect_bundle(output)
        return output
    except BaseException:
        shutil.rmtree(output)  # Only the directory exclusively reserved above.
        raise


def inspect_bundle(source):
    root = absolute(source)
    plain_parents(root)
    plain(root, directory=True)
    metadata = within(root, MANIFEST)
    if metadata.stat().st_size > 2*1024*1024:
        raise ValueError('Backup manifest is too large.')
    try:
        manifest = json.loads(metadata.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
        files = manifest['files']
        if (manifest['format'] != FORMAT or type(manifest['version']) is not int
                or manifest['version'] != 1 or not isinstance(files, dict)
                or not 1 <= len(files) <= MAX_FILES):
            raise ValueError('Unsupported backup manifest.')
        total = 0
        for relative, expected in files.items():
            if (not isinstance(expected, dict) or set(expected) != {'bytes', 'sha256'}
                    or type(expected['bytes']) is not int or not 0 <= expected['bytes'] <= MAX_BYTES
                    or not isinstance(expected['sha256'], str) or not SHA.fullmatch(expected['sha256'])):
                raise ValueError('Invalid backup file manifest.')
            total += expected['bytes']
            if total > MAX_BYTES:
                raise ValueError('Backup exceeds the supported total size.')
            if file_info(within(root, relative)) != expected:
                raise ValueError('Backup file integrity check failed.')
        database = inspect_backup(within(root, DATABASE))
        required = required_uploads(database)
        if set(files) != {DATABASE, *required}:
            raise ValueError('Backup file list differs from its database references.')
        actual = set()
        allowed_directories = {str(parent) for filename in files
                               for parent in PurePosixPath(filename).parents if str(parent) != '.'}
        for folder, directories, names in os.walk(root, followlinks=False):
            for name in directories:
                directory = Path(folder)/name
                plain(directory, directory=True)
                if directory.relative_to(root).as_posix() not in allowed_directories:
                    raise ValueError('Backup contains an unlisted directory.')
            for name in names:
                path = Path(folder)/name
                plain(path)
                actual.add(path.relative_to(root).as_posix())
        if actual != {*files, MANIFEST}:
            raise ValueError('Backup contains unlisted files.')
        verify_uploads(root, required)
        return database, files
    except (OSError, KeyError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError('Invalid or incomplete backup bundle.') from error


def install_uploads(bundle, storage, files):
    """Return owned additions for rollback; preserve every existing image file."""
    root, storage = absolute(bundle), absolute(storage)
    plain_parents(storage)
    plain(storage, directory=True)
    check_destination(storage, files)
    additions, directories = [], []
    staging = Path(tempfile.mkdtemp(prefix='.restore-images-', dir=storage))
    try:
        for relative, expected in sorted(files.items()):
            if relative == DATABASE:
                continue
            destination = storage/relative
            # Check every existing parent; create only the missing plain folders.
            parent = storage
            for part in PurePosixPath(relative).parts[:-1]:
                parent /= part
                if parent.exists() or parent.is_symlink():
                    plain(parent, directory=True)
                else:
                    parent.mkdir(mode=0o700)
                    directories.append(parent)
            if destination.exists() or destination.is_symlink():
                if file_info(destination) != expected:
                    raise ValueError('An existing background file conflicts with this backup; nothing is overwritten.')
                continue
            temporary = staging/str(len(additions))
            copy_exclusive(within(root, relative), temporary, expected_bytes=expected['bytes'])
            if file_info(temporary) != expected:
                raise ValueError('Backup image changed while restoring.')
            # Hard-link publication is atomic and refuses any existing target.
            os.link(temporary, destination)
            additions.append((destination, expected))
        return additions, directories
    except BaseException:
        rollback_uploads(additions, directories)
        raise
    finally:
        shutil.rmtree(staging)


def check_destination(storage, files):
    """Read-only conflict/link preflight; no directory or safety backup is made."""
    storage = absolute(storage)
    plain_parents(storage)
    plain(storage, directory=True)
    for relative, expected in files.items():
        if relative == DATABASE:
            continue
        parent = storage
        for part in PurePosixPath(relative).parts[:-1]:
            parent /= part
            if not parent.exists() and not parent.is_symlink():
                break
            plain(parent, directory=True)
        else:
            destination = storage/relative
            if destination.exists() or destination.is_symlink():
                if file_info(destination) != expected:
                    raise ValueError('An existing background file conflicts with this backup; nothing is overwritten.')


def rollback_uploads(additions, directories):
    for path, expected in reversed(additions):
        if file_info(path) != expected:
            raise RuntimeError('A newly restored file changed; refusing to remove it.')
        path.unlink()
    for folder in reversed(directories):
        try:
            folder.rmdir()
        except OSError:
            pass  # Preserve concurrent/unfamiliar contents; never recurse here.
