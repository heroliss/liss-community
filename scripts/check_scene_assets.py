#!/usr/bin/env python3
"""Validate the published background catalogue without loading application data."""
import argparse
import json
from pathlib import Path
import re

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
SCENE = re.compile(r'scenes/[a-zA-Z0-9._-]+\.(?:webp|png|jpg|svg)')


def inspect_scenes(repo=REPO):
    app = Path(repo) / 'app'
    static = app / 'static'
    folder = static / 'scenes'
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('Scene directory must be a real directory.')
    source = (static / 'community-background-candidates-v40.js').read_text(encoding='utf-8')
    match = re.search(r'window\.LissBackgroundCandidatesV40\s*=\s*(\[[\s\S]*\])\s*;\s*\Z', source)
    if not match:
        raise ValueError('Cannot read the background catalogue.')
    entries = json.loads(match[1])
    ids, used = set(), set()
    for entry in entries:
        if entry['id'] in ids or entry['kind'] != 'image':
            raise ValueError('Duplicate or non-image catalogue entry.')
        ids.add(entry['id'])
        variants = entry['variants']
        if not variants or entry['src'] not in {item['file'] for item in variants}:
            raise ValueError('Catalogue source must be one of its responsive variants.')
        for item in variants:
            name = item['file']
            if not SCENE.fullmatch(name):
                raise ValueError('Catalogue asset must be a flat relative scenes path.')
            path = static / name
            if path.is_symlink() or not path.is_file():
                raise ValueError('Missing or linked catalogue asset: ' + name)
            if path.stat().st_size != item['bytes']:
                raise ValueError('Catalogue byte count differs: ' + name)
            with Image.open(path) as image:
                if image.size != (item['width'], item['height']):
                    raise ValueError('Catalogue image dimensions differ: ' + name)
                image.verify()
            used.add(name)
        name = entry['thumbnail']
        if not SCENE.fullmatch(name):
            raise ValueError('Invalid thumbnail path.')
        path = static / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing or linked thumbnail: ' + name)
        with Image.open(path) as image:
            if image.size != (360, 240):
                raise ValueError('Thumbnail dimensions differ: ' + name)
            image.verify()
        used.add(name)
    # Include runtime fallbacks and template/CSS references. Retired bundles and
    # third-party code do not define the currently published image catalogue.
    for path in app.rglob('*'):
        if path.suffix not in {'.js', '.css', '.html', '.json'} or not path.is_file():
            continue
        if {'bundles', 'vendor', 'scenes'} & set(path.relative_to(app).parts):
            continue
        used.update(SCENE.findall(path.read_text(encoding='utf-8')))
    for name in used:
        path = static / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing or linked runtime image reference: ' + name)
    files = list(folder.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in files):
        raise ValueError('Unexpected link or directory in published scenes.')
    stale = sorted(path.name for path in files if 'scenes/' + path.name not in used)
    return dict(images=len(entries), assets=len(used),
                bytes=sum((static / name).stat().st_size for name in used),
                referenced=sorted(used), stale=stale)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--strict', action='store_true', help='Fail if retired files remain in public scenes')
    args = parser.parse_args()
    report = inspect_scenes()
    print(json.dumps(report, indent=2))
    if args.strict and report['stale']:
        raise SystemExit('Retired scene assets must be archived outside the public directory.')


if __name__ == '__main__':
    main()
