"""Persistent background administration and private native upload storage.

Only local, decoded raster uploads are accepted. Published files are newly
encoded WebP; native originals remain private and soft removal preserves data.
"""
import ast
import copy
import hashlib
import io
import json
import math
from pathlib import Path
import re
import secrets
import shutil
import time
import warnings

from flask import Blueprint, abort, current_app, jsonify, request, send_file, url_for
from flask_login import current_user
from PIL import Image, ImageOps, UnidentifiedImageError

from . import db
from .models import utcnow

assets = Blueprint('background_catalog', __name__)
MAX_UPLOAD = 20 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_ENTRIES = 200
ID = re.compile(r'[a-z][a-z0-9-]{0,79}\Z')
STAGE = re.compile(r'stage-[a-f0-9]{32}\Z')
FILE = re.compile(r'(?:image-(?:[0-9]{2,5})|thumb)\.webp\Z')
INTERNAL = {'enabled', 'deleted', 'paletteKey', 'sourceKind', '_storage', '_native'}


class BackgroundCatalog(db.Model):
    __tablename__ = 'background_catalog'
    id = db.Column(db.Integer, primary_key=True)
    revision = db.Column(db.Integer, nullable=False, default=1)
    data = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)
    __table_args__ = (db.CheckConstraint('id=1', name='ck_background_catalog_singleton'),)


class CatalogError(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def seed_data(copy_data=True):
    cached = current_app.extensions.get('background_seed')
    if cached is None:
        static = Path(current_app.static_folder)
        source = (static/'community-background-candidates-v40.js').read_text(encoding='utf-8')
        match = re.search(r'window\.LissBackgroundCandidatesV40\s*=\s*(\[[\s\S]*\])\s*;\s*\Z', source)
        entries = json.loads(match.group(1))
        text = (static/'community-background-palettes-v40.js').read_text(encoding='utf-8')
        seed = re.search(r'var seeds\s*=\s*\{([\s\S]*?)\},profiles=', text).group(1)
        palettes = {}
        pattern = r"(?:'([^']+)'|\"([^\"]+)\"|([a-z][a-z0-9-]*))\s*:\s*(\[[^\[\]]+\])"
        for item in re.finditer(pattern, seed):
            key = item.group(1) or item.group(2) or item.group(3)
            values = ast.literal_eval(item.group(4))
            palettes[key] = dict(hue=values[0], saturation=values[1], warmHue=values[2],
                                 warmSaturation=values[3], name=values[4],
                                 readingTone=values[5] if len(values) > 5 else None)
        assert len(entries) >= 1 and len({entry['id'] for entry in entries}) == len(entries)
        assert all(entry['kind'] == 'image' and entry['id'] in palettes for entry in entries)
        for entry in entries:
            entry.update(enabled=True, deleted=False, paletteKey=entry['id'], sourceKind='builtin')
        cached = dict(entries=entries, palettes=palettes)
        current_app.extensions['background_seed'] = cached
    return copy.deepcopy(cached) if copy_data else cached


def initial_document():
    entries = seed_data()['entries']
    return dict(entries=entries, randomEnabled=True, poolIds=[entry['id'] for entry in entries])


def initialize_catalog():
    if db.session.get(BackgroundCatalog, 1) is None:
        db.session.add(BackgroundCatalog(id=1, revision=1,
            data=json.dumps(initial_document(), ensure_ascii=False)))
        db.session.commit()


def catalog_row():
    row = db.session.get(BackgroundCatalog, 1)
    if row is None:
        raise RuntimeError('Background catalogue has not been prepared.')
    return row


def document(row=None):
    if row is not None:
        return json.loads(row.data)
    sandbox = current_app.extensions.get('public_demo')
    if current_app.config.get('PUBLIC_DEMO') and sandbox and sandbox.initialized:
        return json.loads(catalog_row().data)
    return initial_document()


def palette_choices():
    return [dict(id=entry['id'], title=entry['title']) for entry in seed_data(False)['entries']]


def palette(key):
    allowed = {entry['id'] for entry in seed_data(False)['entries']}
    if key not in allowed:
        raise CatalogError('请选择已有的背景配色方案。')
    return copy.deepcopy(seed_data(False)['palettes'][key])


def public_entry(entry):
    result = {key: copy.deepcopy(value) for key, value in entry.items() if key not in INTERNAL}
    key = entry.get('paletteKey', 'coast')
    profile = palette(key)
    result.update(paletteKey=key, palette=profile)
    result['readingTone'] = profile['readingTone'] or result.get('readingTone', 'dark')
    return result


def public_payload():
    data = document()
    active = [entry for entry in data['entries'] if entry_available(entry)]
    available = {entry['id'] for entry in active}
    pool = [name for name in data['poolIds'] if name in available]
    sandbox = current_app.extensions.get('public_demo')
    revision = catalog_row().revision if sandbox and sandbox.initialized else 0
    return dict(revision=revision, entries=[public_entry(entry) for entry in active],
                defaultRandom=dict(enabled=bool(data['randomEnabled'] and pool), ids=pool))


def entry_available(entry):
    if not entry['enabled'] or entry['deleted']:
        return False
    if entry.get('sourceKind') != 'upload':
        return True
    name = entry['id']
    if not ID.fullmatch(name) or entry.get('_storage') != name:
        return False
    folder = (storage_root()/'items'/name).resolve()
    filenames = [Path(variant['file']).name for variant in entry['variants']]+['thumb.webp']
    return folder.is_relative_to(storage_root()) and all(FILE.fullmatch(filename) and (folder/filename).is_file() for filename in filenames)


def display_url(value):
    return value if value.startswith('/') else url_for('static', filename=value)


def admin_context(data=None):
    row = catalog_row()
    data = copy.deepcopy(data if data is not None else document(row))
    for position, entry in enumerate(data['entries']):
        entry['order'] = position
        entry['inPool'] = entry['id'] in data['poolIds']
        entry['thumbnailUrl'] = display_url(entry.get('thumbnail', entry['src']))
        preview = next((variant['file'] for variant in entry.get('variants', []) if variant['width'] >= 1440), entry['src'])
        entry['previewUrl'] = display_url(preview)
        if entry.get('sourceKind') == 'upload':
            entry['thumbnailUrl'] = url_for('admin.background_asset', image_id=entry['id'], filename='thumb.webp')
            entry['previewUrl'] = url_for('admin.background_asset', image_id=entry['id'], filename=Path(preview).name)
        entry['sourceWidth'] = entry.get('originalWidth', entry['width'])
        entry['sourceHeight'] = entry.get('originalHeight', entry['height'])
    return dict(revision=row.revision, entries=data['entries'], randomEnabled=data['randomEnabled'],
                poolIds=data['poolIds'], paletteChoices=palette_choices())


def text_value(value, label, maximum, required=False, multiline=False):
    value = value.strip() if isinstance(value, str) else ''
    if multiline:
        value = value.replace('\r\n', '\n').replace('\r', '\n')
    if (required and not value) or len(value) > maximum or any(ord(c) < 32 and not (multiline and c in '\n\t') for c in value):
        raise CatalogError(f'{label}须为{1 if required else 0}至{maximum}字，不能包含控制字符。')
    return value


def flag(form, key):
    if form.get(key) not in {'0', '1'}:
        raise CatalogError('请选择有效的启用或关闭状态。')
    return form[key] == '1'


def normalize_pool(data):
    available = {entry['id'] for entry in data['entries'] if entry['enabled'] and not entry['deleted']}
    data['poolIds'] = list(dict.fromkeys(name for name in data['poolIds'] if name in available))
    if not data['poolIds']:
        data['randomEnabled'] = False  # The preview explicitly includes this state change.


def parse_update(form):
    before = document(catalog_row())
    data, errors = copy.deepcopy(before), {}
    by_id = {entry['id']: entry for entry in data['entries']}
    order = form.getlist('ordered_ids')
    if len(order) != len(by_id) or len(set(order)) != len(order) or set(order) != set(by_id):
        errors['ordered_ids'] = '排序必须完整包含图库中每张图片一次。'
    else:
        data['entries'] = [by_id[name] for name in order]
    for name, entry in by_id.items():
        for key, maximum in (('title', 80), ('description', 240)):
            raw = form.get(key+'_'+name, '')
            entry[key] = raw.strip()
            try:
                entry[key] = text_value(raw, '名称' if key == 'title' else '说明', maximum, key == 'title', key == 'description')
            except CatalogError as error:
                errors[key+'_'+name] = str(error)
        for key in ('enabled', 'deleted'):
            try:
                entry[key] = flag(form, key+'_'+name)
            except CatalogError as error:
                errors[key+'_'+name] = str(error)
        selected = form.get('palette_'+name, '')
        try:
            palette(selected)
            entry['paletteKey'] = selected
        except CatalogError as error:
            errors['palette_'+name] = str(error)
        for key in ('anchorX', 'anchorY', 'mobileAnchorX'):
            if key+'_'+name not in form:
                continue
            try:
                value = float(form[key+'_'+name])
                if not math.isfinite(value) or not 0 <= value <= 1:
                    raise ValueError()
                entry[key] = value
            except (ValueError, TypeError):
                errors[key+'_'+name] = '图像焦点须为0至1之间的有限数值。'
    try:
        data['randomEnabled'] = flag(form, 'random_enabled')
    except CatalogError as error:
        errors['random_enabled'] = str(error)
    selected_pool = form.getlist('pool_ids')
    if not set(selected_pool).issubset(by_id):
        errors['pool_ids'] = '默认随机名单包含未知的图片。'
    data['poolIds'] = list(dict.fromkeys(name for name in selected_pool if name in by_id))
    normalize_pool(data)
    return data, errors


def summary(data, revision=None):
    result = dict(image_count=len(data['entries']),
                  available_count=sum(entry['enabled'] and not entry['deleted'] for entry in data['entries']),
                  random_enabled=data['randomEnabled'], pool_count=len(data['poolIds']))
    if revision is not None:
        result['revision'] = revision
    return result


def operation(before, after, upload=None):
    rows = []
    old = {entry['id']: entry for entry in before['entries']}
    choices = {entry['id']: entry['title'] for entry in seed_data(False)['entries']}
    def display(key, value):
        if key == 'enabled':
            return '启用' if value else '停用'
        if key == 'deleted':
            return '已移除（可恢复）' if value else '保留展示'
        if key == 'paletteKey':
            return choices.get(value, value)
        if key in {'anchorX', 'anchorY', 'mobileAnchorX'}:
            return f'{float(value or 0):.1%}'
        return str(value or '—')
    for entry in after['entries']:
        previous = old.get(entry['id'])
        if previous is None:
            rows.append(dict(label='添加图片', before='—', after=entry['title']+'（保留原生像素，不进行 AI 超分）'))
            continue
        for key, label in (('title', '名称'), ('description', '说明'), ('enabled', '启用状态'),
                    ('deleted', '移除/恢复状态'), ('paletteKey', '配色'), ('anchorX', '横向焦点'),
                    ('anchorY', '纵向焦点'), ('mobileAnchorX', '手机横向焦点')):
            if previous.get(key) != entry.get(key):
                rows.append(dict(label=previous['title']+' · '+label,
                    before=display(key, previous.get(key)), after=display(key, entry.get(key))))
    if [entry['id'] for entry in before['entries']] != [entry['id'] for entry in after['entries']]:
        rows.append(dict(label='图片排序', before=' → '.join(entry['title'] for entry in before['entries']),
                         after=' → '.join(entry['title'] for entry in after['entries'])))
    if before['poolIds'] != after['poolIds']:
        old_titles = {entry['id']: entry['title'] for entry in before['entries']}
        new_titles = {entry['id']: entry['title'] for entry in after['entries']}
        rows.append(dict(label='默认随机名单',
            before=f'{len(before["poolIds"])} 张：'+('、'.join(old_titles[name] for name in before['poolIds']) or '无'),
            after=f'{len(after["poolIds"])} 张：'+('、'.join(new_titles[name] for name in after['poolIds']) or '无')))
    if before['randomEnabled'] != after['randomEnabled']:
        rows.append(dict(label='站点默认随机', before='开启' if before['randomEnabled'] else '关闭',
                         after='开启' if after['randomEnabled'] else '关闭（随机名单为空时自动关闭）' if not after['poolIds'] else '关闭'))
    value = dict(title='添加背景图片' if upload else '更新背景图库', target_label='背景图库', changes=rows,
                 description='移除只停止公开展示，原始文件继续保留，可以恢复。禁用或移除的图片会退出默认随机名单。')
    if upload:
        value['preview_image'] = url_for('admin.background_pending', stage_id=upload['stageId'], filename='thumb.webp')
    return value


def storage_root():
    return (Path(current_app.config.get('PUBLIC_DEMO_DIR', current_app.instance_path))/'backgrounds').resolve()


def remove_owned(path):
    root, path = storage_root(), Path(path).resolve()
    if not path.is_relative_to(root) or path == root or path.parent not in (root/'staging', root/'items'):
        raise RuntimeError('Refusing cleanup outside owned background upload directory.')
    if path.exists():
        shutil.rmtree(path)


def cleanup_expired():
    root = storage_root()/'staging'
    if not root.exists():
        return
    for path in root.iterdir():
        if path.is_dir() and STAGE.fullmatch(path.name) and time.time()-path.stat().st_mtime > 1200:
            remove_owned(path)


def storage_bytes():
    root = storage_root()
    return sum(path.stat().st_size for path in root.rglob('*') if path.is_file()) if root.exists() else 0


def stage_upload(upload, form):
    cleanup_expired()
    if len(document(catalog_row())['entries']) >= MAX_ENTRIES:
        raise CatalogError('图库最多保留200张图片，已移除的图片也会保留以便恢复。')
    title = text_value(form.get('title'), '名称', 80, True)
    description = text_value(form.get('description'), '说明', 240, multiline=True)
    key = form.get('palette_key', 'coast')
    profile = palette(key)
    include = flag(form, 'include_pool')
    if upload is None or not upload.filename or '/' in upload.filename or '\\' in upload.filename:
        raise CatalogError('请选择本机 PNG、JPG 或 WebP 图片，文件名不能包含路径。')
    suffix = Path(upload.filename).suffix.lower()
    expected = {'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP'}.get(suffix)
    if expected is None:
        raise CatalogError('仅支持 PNG、JPG 和 WebP；不接受 SVG 或外部网址。')
    raw = upload.stream.read(MAX_UPLOAD+1)
    if not raw or len(raw) > MAX_UPLOAD:
        raise CatalogError('图片文件须小于或等于20 MiB。')
    budget = current_app.config['BACKGROUND_MAX_STORAGE_BYTES']
    if storage_bytes()+len(raw) > budget:
        raise CatalogError('背景图库文件容量已满，已有原图继续保留，请联系维护者扩容。')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as check:
                if check.format != expected or getattr(check, 'n_frames', 1) != 1:
                    raise CatalogError('文件内容与格式不符，或包含多帧动画。')
                width, height = check.size
                native_size = (width, height)
                if width < 320 or height < 180 or max(width, height) > 16000 or width*height > MAX_PIXELS:
                    raise CatalogError('图片至少320×180，最长边不超过16000像素，总像素不超过4000万。')
                check.verify()
            with Image.open(io.BytesIO(raw)) as source:
                source.load()
                oriented = ImageOps.exif_transpose(source)
                clean = oriented.convert('RGBA' if 'A' in oriented.getbands() else 'RGB')
                clean.info.clear()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        if isinstance(error, CatalogError):
            raise
        raise CatalogError('图片无法安全解码，请重新导出为 PNG、JPG 或 WebP。') from error
    stage_id, image_id = 'stage-'+secrets.token_hex(16), 'upload-'+secrets.token_hex(12)
    stage = storage_root()/'staging'/stage_id
    stage.mkdir(parents=True, exist_ok=False)
    try:
        source_name = 'original'+('.jpg' if expected == 'JPEG' else suffix)
        (stage/source_name).write_bytes(raw)
        cap = min(clean.width, 3840)
        widths = sorted(set([width for width in (960, 1440, 1920, 2560, 3840) if width <= cap]+[cap]))
        variants = []
        for width in widths:
            height = max(1, round(clean.height*width/clean.width))
            filename = f'image-{width}.webp'
            clean.resize((width, height), Image.Resampling.LANCZOS).save(stage/filename, 'WEBP', quality=92, method=6)
            variants.append(dict(file=url_for('background_catalog.asset', image_id=image_id, filename=filename),
                                 width=width, height=height, bytes=(stage/filename).stat().st_size))
        ImageOps.fit(clean, (360, 240), Image.Resampling.LANCZOS).save(stage/'thumb.webp', 'WEBP', quality=88, method=6)
        entry = dict(id=image_id, kind='image', title=title, description=description,
            src=variants[-1]['file'], variants=variants, width=variants[-1]['width'], height=variants[-1]['height'],
            bytes=variants[-1]['bytes'], thumbnail=url_for('background_catalog.asset', image_id=image_id, filename='thumb.webp'),
            originalWidth=clean.width, originalHeight=clean.height, nativeHighResolution=clean.width >= 3840,
            enhancement='原生像素重编码（未 AI 超分）', revision='upload-'+image_id,
            tall=True, scrollReserve=.1, autoDprCap=1.25, anchorX=.5, anchorY=.5, mobileAnchorX=.5,
            theme=profile['name'], group='uploaded', readingTone=profile['readingTone'] or 'dark',
            enabled=True, deleted=False, paletteKey=key, sourceKind='upload', _storage=image_id,
            _native=dict(file=source_name, sha256=digest(raw), bytes=len(raw), width=native_size[0], height=native_size[1]))
        files = {path.name: digest(path.read_bytes()) for path in stage.iterdir() if path.is_file()}
        meta = dict(actorId=current_user.id, created=time.time(), entry=entry, files=files)
        (stage/'stage.json').write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
        if storage_bytes() > budget:
            raise CatalogError('背景图库文件容量不足，未发布此图片；请联系维护者扩容。')
        return dict(stageId=stage_id, entry=entry, includePool=include, files=files)
    except CatalogError:
        remove_owned(stage)
        raise
    except (OSError, ValueError) as error:
        remove_owned(stage)
        raise CatalogError('图片重编码失败，未保存任何公开背景；请重试。') from error
    except BaseException:
        remove_owned(stage)
        raise
    finally:
        clean.close()


def load_stage(change):
    name = change.get('stageId', '')
    if not STAGE.fullmatch(name):
        raise CatalogError('上传预览已失效。')
    path = storage_root()/'staging'/name
    try:
        meta = json.loads((path/'stage.json').read_text(encoding='utf-8'))
        if meta['actorId'] != current_user.id or time.time()-meta['created'] > 600:
            raise CatalogError('上传预览已过期，请重新选择文件。')
        if meta['entry'] != change['entry'] or meta['files'] != change['files']:
            raise CatalogError('上传预览记录不匹配。')
        for filename, expected in meta['files'].items():
            if Path(filename).name != filename or digest((path/filename).read_bytes()) != expected:
                raise CatalogError('上传预览文件已变化，请重新上传。')
    except (OSError, ValueError, KeyError) as error:
        raise CatalogError('上传预览已失效，请重新上传。') from error
    return path, meta


def changes_for_upload(upload):
    data = document(catalog_row())
    data['entries'].append(upload['entry'])
    if upload['includePool']:
        data['poolIds'].append(upload['entry']['id'])
    normalize_pool(data)
    return data


def apply_change(row, changes):
    moved = None
    if changes['action'] == 'upload':
        stage, meta = load_stage(changes['upload'])
        destination = storage_root()/'items'/meta['entry']['id']
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise CatalogError('上传文件标识冲突，请重新上传。')
        stage.rename(destination)  # Same-filesystem atomic publication of the owned folder.
        moved = destination
    row.data = json.dumps(changes['document'], ensure_ascii=False)
    row.revision += 1
    row.updated_at = utcnow()
    return moved


@assets.get('/background-catalog.json')
def public_catalog():
    response = jsonify(public_payload())
    response.headers['Cache-Control'] = 'no-store'
    return response


@assets.get('/background-assets/<image_id>/<filename>')
def asset(image_id, filename):
    path = item_asset_path(image_id, filename)
    response = send_file(path, mimetype='image/webp', conditional=True, max_age=3600)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


def item_asset_path(image_id, filename, include_inactive=False):
    if not ID.fullmatch(image_id) or not image_id.startswith('upload-') or not FILE.fullmatch(filename):
        abort(404)
    entry = next((entry for entry in document()['entries'] if entry['id'] == image_id), None)
    if not entry or entry.get('_storage') != image_id or (not include_inactive and (not entry['enabled'] or entry['deleted'])):
        abort(404)
    allowed = {Path(value['file']).name for value in entry['variants']} | {'thumb.webp'}
    if filename not in allowed:
        abort(404)
    path = (storage_root()/'items'/image_id/filename).resolve()
    if not path.is_relative_to(storage_root()) or not path.is_file():
        abort(404)
    return path


def install(app):
    app.config.setdefault('BACKGROUND_MAX_STORAGE_BYTES', 64*1024*1024)
    app.register_blueprint(assets)
    @app.before_request
    def upload_body_limit():
        if request.endpoint == 'admin.preview' and request.mimetype == 'multipart/form-data':
            request.max_content_length = MAX_UPLOAD+512*1024
    @app.context_processor
    def site_backgrounds():
        return dict(background_site_payload=public_payload())
