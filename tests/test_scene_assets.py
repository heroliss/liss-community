import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check_scene_assets.py'
SPEC = importlib.util.spec_from_file_location('scene_assets', SCRIPT)
scene_assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scene_assets)


class SceneAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        self.static = self.repo / 'app/static'
        self.scenes = self.static / 'scenes'
        self.scenes.mkdir(parents=True)
        Image.new('RGB', (32, 20)).save(self.scenes / 'image.webp', 'WEBP')
        Image.new('RGB', (360, 240)).save(self.scenes / 'thumb.webp', 'WEBP')
        self.entries = [dict(id='scene', kind='image', src='scenes/image.webp',
            thumbnail='scenes/thumb.webp', variants=[dict(file='scenes/image.webp',
            width=32, height=20, bytes=(self.scenes / 'image.webp').stat().st_size)])]
        self.write_catalogue()

    def write_catalogue(self):
        (self.static / 'community-background-candidates-v40.js').write_text(
            'window.LissBackgroundCandidatesV40 = ' + json.dumps(self.entries) + ';', encoding='utf-8')

    def test_catalogue_checks_actual_images_and_detects_retired_files(self):
        (self.scenes / 'retired.webp').write_bytes(b'archive me')
        result = scene_assets.inspect_scenes(self.repo)
        self.assertEqual((result['images'], result['assets']), (1, 2))
        self.assertEqual(result['stale'], ['retired.webp'])

    def test_changed_bytes_and_wrong_dimensions_are_rejected(self):
        self.entries[0]['variants'][0]['bytes'] += 1
        self.write_catalogue()
        with self.assertRaisesRegex(ValueError, 'byte count'):
            scene_assets.inspect_scenes(self.repo)
        self.entries[0]['variants'][0]['bytes'] -= 1
        self.entries[0]['variants'][0]['width'] += 1
        self.write_catalogue()
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            scene_assets.inspect_scenes(self.repo)

    def test_path_escape_and_missing_runtime_fallback_are_rejected(self):
        self.entries[0]['variants'][0]['file'] = '../image.webp'
        self.entries[0]['src'] = '../image.webp'
        self.write_catalogue()
        with self.assertRaisesRegex(ValueError, 'relative scenes path'):
            scene_assets.inspect_scenes(self.repo)
        self.entries[0]['variants'][0]['file'] = 'scenes/image.webp'
        self.entries[0]['src'] = 'scenes/image.webp'
        self.write_catalogue()
        (self.repo / 'app/template.html').write_text('<img src="scenes/missing.webp">', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'runtime image reference'):
            scene_assets.inspect_scenes(self.repo)
