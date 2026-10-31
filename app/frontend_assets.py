"""Use verified generated assets, with a current-source fallback during local editing."""
from pathlib import Path
import hashlib
import json

from flask import url_for


def install(app):
    static = Path(app.static_folder)
    groups_file = Path(app.root_path).parent / 'assets/sources.json'
    groups = json.loads(groups_file.read_text(encoding='utf-8'))
    manifest_file = static / 'asset-manifest.json'
    cache = {'stamp': None, 'manifest': {}}
    digests = {}

    def digest(filename):
        path = static / filename
        stat = path.stat()
        stamp = (stat.st_mtime_ns, stat.st_size)
        cached = digests.get(filename)
        if cached is None or cached[0] != stamp:
            cached = (stamp, hashlib.sha256(path.read_bytes()).hexdigest())
            digests[filename] = cached
        return cached[1]

    def asset_urls(group):
        files = groups[group]
        try:
            stat = manifest_file.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
            if cache['stamp'] != stamp:
                cache.update(stamp=stamp, manifest=json.loads(manifest_file.read_text(encoding='utf-8')))
            manifest = cache['manifest']
            built_groups = manifest.get('groups', {}) if isinstance(manifest, dict) else {}
            built = built_groups.get(group, {}) if isinstance(built_groups, dict) else {}
            if not isinstance(built, dict):
                built = {}
            filename = built.get('file', '')
            if (app.config.get('LISS_USE_BUILT_ASSETS', True)
                    and isinstance(filename, str)
                    and filename.startswith('bundles/') and '..' not in filename
                    and built.get('sources') == {name: digest(name) for name in files}
                    and digest(filename) == built.get('sha256')):
                return [url_for('static', filename=filename)]
        except (OSError, ValueError, KeyError):
            # Editing a source must never keep serving an old bundle silently.
            pass
        return [url_for('static', filename=name, v=digest(name)[:16]) for name in files]

    app.jinja_env.globals['asset_urls'] = asset_urls
