"""Public collection endpoint for the visitor analytics tracker.

The tracker (static/liss-analytics.js) runs on the community and on the static
portfolio (heroliss.github.io). It posts small JSON batches with sendBeacon as
text/plain, so no CORS preflight is needed. The endpoint skips the community
sandbox lock and CSRF: it never reads the session and only writes analytics.
"""
from collections import OrderedDict
import hashlib
import hmac
import ipaddress
import json
import os
import re
from pathlib import Path
import secrets
import threading
import time

from flask import Blueprint, current_app, has_request_context, make_response, request
from flask_login import current_user

from .analytics_store import ID, AnalyticsStore, display_zone

analytics = Blueprint('analytics', __name__)
DEFAULT_ORIGINS = ('https://heroliss.github.io', 'https://liss.pythonanywhere.com')
DEVICE_COOKIE = 'liss_d'
# Community only: the visitor id again, as a first-party cookie set by the server. Safari clears a
# site's script storage after 7 days without a visit; this cookie lets the tracker restore its id.
VISITOR_COOKIE = 'liss_v'
VID = re.compile(r'[a-f0-9]{24}')
_rates = OrderedDict()
_rates_lock = threading.Lock()


def store() -> AnalyticsStore:
    return current_app.extensions['analytics']


def allowed_origin(origin: str) -> bool:
    if not origin:
        return True  # Some browsers omit Origin on beacons; identity checks still apply.
    allowed = set(DEFAULT_ORIGINS) | set(current_app.config.get('ANALYTICS_ALLOWED_ORIGINS', ()))
    allowed.add(request.host_url.rstrip('/'))
    if origin in allowed:
        return True
    try:
        from urllib.parse import urlsplit
        host = urlsplit(origin).hostname or ''
        loopback = ipaddress.ip_address(request.remote_addr or '0.0.0.0').is_loopback
    except ValueError:
        return False
    # Local previews of the portfolio may post to a local community preview.
    return loopback and host in {'localhost', '127.0.0.1', '::1'}


def uid_signature(uid) -> str:
    """HMAC of a community account id, rendered into that user's own pages. The tracker sends it back
    with the id; beacons are unauthenticated, so an unsigned id is dropped instead of trusted (it links
    records into one visitor and feeds owner detection)."""
    key = str(current_app.config.get('SECRET_KEY') or '').encode('utf-8')
    return hmac.new(key, f'liss-analytics-uid:{uid}'.encode('utf-8'), hashlib.sha256).hexdigest()[:32]


def verified_ctx(payload):
    """Remove the account id / name from a beacon unless its signature matches."""
    ctx = payload.get('ctx') if isinstance(payload, dict) else None
    if not isinstance(ctx, dict) or not (ctx.get('uid') or ctx.get('uname')):
        return
    uid, signature = str(ctx.get('uid') or '').strip(), ctx.get('usig')
    if not (uid.isdigit() and isinstance(signature, str) and hmac.compare_digest(signature, uid_signature(uid))):
        ctx.pop('uid', None)
        ctx.pop('uname', None)
    ctx.pop('usig', None)


def rate_limited(ip: str) -> bool:
    limit = current_app.config.get('ANALYTICS_RATE_LIMIT', 240)  # batches per IP per minute
    window = int(time.time() // 60)
    with _rates_lock:
        key = (ip, window)
        _rates[key] = _rates.get(key, 0) + 1
        _rates.move_to_end(key)
        while len(_rates) > 5000:
            _rates.popitem(last=False)
        return _rates[key] > limit


@analytics.post('/analytics/collect')
def collect():
    if not current_app.config.get('ANALYTICS_ENABLED', True):
        return '', 204
    if not allowed_origin(request.headers.get('Origin', '')):
        return '', 403
    ip = request.remote_addr or ''
    if rate_limited(ip):
        return '', 429
    raw = request.get_data(cache=False, as_text=False)
    if not raw or len(raw) > 64 * 1024:
        return '', 413 if raw else 400
    try:
        payload = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        return '', 400
    site = payload.get('site') if isinstance(payload, dict) else None
    verified_ctx(payload)
    own = {request.host.split(':')[0].lower()} if site == 'forum' else {'heroliss.github.io'}
    # A long-lived cookie on this host links the same browser across the community and github.io
    # (Chromium browsers send it on cross-site beacons; Safari / Firefox keep it per site).
    device = request.cookies.get(DEVICE_COOKIE, '')
    fresh = not ID.fullmatch(device)
    if fresh:
        device = secrets.token_hex(12)
    try:
        store().ingest(payload, ip=ip, ua=request.headers.get('User-Agent', ''), own_hosts=own,
                       headers=request.headers, device_id=device, device_fresh=fresh)
    except Exception:  # Analytics must never break the visitor's page.
        current_app.logger.exception('analytics ingest failed')
        return '', 500
    response = make_response('', 204)
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    response.set_cookie(DEVICE_COOKIE, device, max_age=2 * 365 * 86400, path='/analytics/', httponly=True,
                        secure=secure, samesite='None' if secure else 'Lax')
    vid = payload.get('vid')
    if site == 'forum' and isinstance(vid, str) and VID.fullmatch(vid) and request.cookies.get(VISITOR_COOKIE) != vid:
        response.set_cookie(VISITOR_COOKIE, vid, max_age=2 * 365 * 86400, path='/', httponly=True, secure=secure,
                            samesite='Lax')
    return response


def tracker_context():
    """Template values for the tracker tag on community pages."""
    if not current_app.config.get('ANALYTICS_ENABLED', True):
        return dict(analytics_tracker=None)
    uid = uname = ''
    try:
        if current_user.is_authenticated:
            uid, uname = current_user.id, (current_user.username or '')
            if current_user.is_administrator():
                store().mark_owner(request.remote_addr or '')  # Visits from here count as 本人.
    except Exception:
        pass
    vid = request.cookies.get(VISITOR_COOKIE, '') if has_request_context() else ''  # Mail renders have no request.
    return dict(analytics_tracker=dict(site='forum', uid=uid, uname=uname, usig=uid_signature(uid) if uid else '',
                                       vid=vid if VID.fullmatch(vid) else '',
                                       endpoint=current_app.config.get('ANALYTICS_ENDPOINT') or '/analytics/collect'))


def install(app):
    data_dir = Path(app.config.get('PUBLIC_DEMO_DIR') or app.instance_path)
    data_dir.mkdir(parents=True, exist_ok=True)
    app.extensions['analytics'] = AnalyticsStore(data_dir / 'analytics.sqlite')
    from .ip_region import RegionLookup
    app.extensions['ip_region'] = RegionLookup(data_dir)  # Optional ip2region_v4.xdb in the data directory.
    app.extensions['analytics'].region = app.extensions['ip_region'].lookup
    app.config.setdefault('ANALYTICS_ENABLED', os.environ.get('LISS_ANALYTICS', '1') != '0')
    extra = [origin.strip().rstrip('/') for origin in os.environ.get('LISS_ANALYTICS_ORIGINS', '').split(',') if origin.strip()]
    app.config.setdefault('ANALYTICS_ALLOWED_ORIGINS', tuple(extra))
    app.config.setdefault('ANALYTICS_UTC_OFFSET_MINUTES', int(os.environ.get('LISS_ANALYTICS_UTC_OFFSET', '480')))
    app.register_blueprint(analytics)
    csrf = app.extensions.get('csrf')
    if csrf is not None:
        csrf.exempt(collect)
    app.context_processor(tracker_context)
    app.jinja_env.globals['analytics_zone'] = lambda: display_zone(app.config['ANALYTICS_UTC_OFFSET_MINUTES'])
