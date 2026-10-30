"""Validated optional article presentation; content and permissions stay native."""
import re

MATERIAL_CHOICES = (
    ('glass', '晶透玻璃'), ('frosted', '磨砂玻璃'), ('ceramic', '温润釉面'),
    ('paper', '纸册'), ('metal', '石墨金属'), ('leather', '皮革'),
    ('cork', '软木'), ('slate', '岩板'), ('auto', '随站点安排'),
)
MATERIAL_KEYS = frozenset(value for value, _ in MATERIAL_CHOICES)
_COLOR = re.compile(r'#[0-9a-fA-F]{6}')
THEME_ROLE_SPECS = {
    'dark': {'accent': (72, None), 'hover': (82, None), 'ink': (10, 24),
             'background': (7, 22), 'surface': (11, 14), 'raised': (16, 14),
             'input': (9, 12), 'line': (28, 10), 'muted': (74, 8), 'subtle': (66, 8)},
    'light': {'accent': (27, None), 'hover': (21, None), 'ink': (99, 12),
              'background': (96, 16), 'surface': (98, 6), 'raised': (92, 10),
              'input': (99, 6), 'line': (74, 9), 'muted': (34, 8), 'subtle': (39, 8)},
}
THEME_READING_INK = {'dark': '#e9edec', 'light': '#24282a'}
DISPLAY_PALETTE = ('#88c8b3', '#7ab8dd', '#b4a0dd', '#ddb17f', '#d69db3', '#86bbc3')


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


def _color_hs(color):
    if not color:
        return 0, 0
    red, green, blue = (int(color[index:index + 2], 16) for index in (1, 3, 5))
    high, low = max(red, green, blue), min(red, green, blue)
    delta = high - low
    if not delta:
        return 0, 0
    numerator = (60 * (green - blue) if high == red else
                 120 * delta + 60 * (blue - red) if high == green else
                 240 * delta + 60 * (red - green)) % (360 * delta)
    hue = ((2 * numerator + delta) // (2 * delta)) % 360
    denominator = high + low if high + low <= 255 else 510 - high - low
    saturation = (0 if 100 * delta < 8 * denominator else
                  max(18, min(55, (200 * delta + denominator) // (2 * denominator))))
    return hue, saturation


def _hsl_hex(hue, saturation, lightness):
    # Integer rational arithmetic agrees with JavaScript at half-byte and
    # half-degree boundaries; no binary-float .499999 rounding drift.
    chroma = (100 - abs(2 * lightness - 100)) * saturation
    secondary = chroma * (60 - abs(hue % 120 - 60)) * 2
    primary, base = chroma * 120, (200 * lightness - chroma) * 60
    channels = ((primary, secondary, 0) if hue < 60 else
                (secondary, primary, 0) if hue < 120 else
                (0, primary, secondary) if hue < 180 else
                (0, secondary, primary) if hue < 240 else
                (secondary, 0, primary) if hue < 300 else (primary, 0, secondary))
    return '#' + ''.join(f'{(2 * (channel + base) * 255 + 1200000) // 2400000:02x}'
                         for channel in channels)


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
    hue, saturation = _color_hs(color)
    return {'material': material, 'color': color, 'hue': hue,
            'saturation': saturation, 'custom': bool(color or material != 'auto')}


def color_theme(value):
    """A page theme uses the same bounded hue/chroma as its saved article.

    Fixed role lightness deliberately ignores the chosen color's lightness:
    white, black and saturated yellows cannot make controls unreadable.
    """
    color = normalize_color(value)
    hue, saturation = _color_hs(color)

    result = {'color': color, 'hue': hue, 'saturation': saturation, 'active': bool(color)}
    for mode, specs in THEME_ROLE_SPECS.items():
        result[mode] = {role: _hsl_hex(hue, saturation if cap is None else min(saturation, cap), lightness)
                        for role, (lightness, cap) in specs.items()}
        result[mode]['text'] = THEME_READING_INK[mode]
    return result


def page_theme(post=None):
    color = post_appearance(post)['color'] if post is not None else ''
    return dict(color_theme(color), post_id=post.id if post is not None else None)


def automatic_post_color(post):
    identifier = getattr(post, 'id', 0)
    identifier = identifier if isinstance(identifier, int) else 0
    author = getattr(post, 'author_id', 0)
    author = author if isinstance(author, int) else 0
    seed = (identifier * 2654435761 + author * 2246822519) & 0xffffffff
    seed ^= seed >> 16
    return DISPLAY_PALETTE[seed % len(DISPLAY_PALETTE)]


def display_post_appearance(post):
    """A stable display tint never writes or replaces the author's settings."""
    look = post_appearance(post)
    color = look['color'] or automatic_post_color(post)
    hue, saturation = _color_hs(color)
    return dict(look, color=color, hue=hue, saturation=saturation)


def display_page_theme(post=None):
    color = display_post_appearance(post)['color'] if post is not None else ''
    return dict(color_theme(color), post_id=post.id if post is not None else None,
                automatic_color=automatic_post_color(post) if post is not None else '')


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
