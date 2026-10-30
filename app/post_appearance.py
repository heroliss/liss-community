"""Validated optional article presentation; content and permissions stay native."""
import colorsys
import math
import re

MATERIAL_CHOICES = (
    ('auto', '自动安排'), ('glass', '磨砂玻璃'), ('ceramic', '温润釉面'),
    ('paper', '纸册'), ('metal', '石墨金属'),
)
MATERIAL_KEYS = frozenset(value for value, _ in MATERIAL_CHOICES)
_COLOR = re.compile(r'#[0-9a-fA-F]{6}')


def normalize_color(value):
    if value is None or value == '':
        return ''
    if not isinstance(value, str) or _COLOR.fullmatch(value) is None:
        raise ValueError('请选择有效的六位十六进制颜色，例如 #80bfa1。')
    return value.lower()


def normalize_material(value):
    if value is None:
        return 'auto'
    if not isinstance(value, str) or value not in MATERIAL_KEYS:
        raise ValueError('请选择列表中的卡片材质。')
    return value


def post_appearance(post):
    """Only return validated tokens/numbers, even if legacy/raw data is invalid."""
    row = getattr(post, 'appearance', None)
    try:
        color = normalize_color(row.theme_color) if row else ''
    except ValueError:
        color = ''
    try:
        material = normalize_material(row.card_material) if row else 'auto'
    except ValueError:
        material = 'auto'
    hue, saturation = 0, 0
    if color:
        red, green, blue = (int(color[index:index + 2], 16) / 255 for index in (1, 3, 5))
        h, _lightness, s = colorsys.rgb_to_hls(red, green, blue)
        hue = math.floor(h * 360 + .5) % 360
        # Neutral selections stay neutral. Colorful selections share a bounded
        # chroma; raw lightness never controls the reading surface or text.
        saturation = 0 if s < .08 else math.floor(max(18, min(55, s * 100)) + .5)
    return {'material': material, 'color': color, 'hue': hue,
            'saturation': saturation, 'custom': bool(color or material != 'auto')}


def apply_post_appearance(post, color, material):
    """Apply inside the caller's existing transaction; no independent commit."""
    from . import db
    from .models import PostAppearance
    color, material = normalize_color(color), normalize_material(material)
    row = post.appearance
    if not color and material == 'auto':
        if row is not None:
            post.appearance = None
        return
    if row is None:
        row = PostAppearance()
        post.appearance = row
    row.theme_color, row.card_material = color, material
    db.session.add(post)
