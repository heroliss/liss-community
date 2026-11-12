"""Public collection endpoint for the visitor analytics tracker.

The tracker (static/liss-analytics.js) runs on the community and on the static
portfolio (heroliss.github.io). It posts small JSON batches with sendBeacon as
text/plain, so no CORS preflight is needed. The endpoint skips the community
sandbox lock and CSRF: it never reads the session and only writes analytics.
"""
from collections import OrderedDict
import ipaddress
import json
import os
from pathlib import Path
import secrets
import threading
import time

from flask import Blueprint, current_app, make_response, request
from flask_login import current_user

from .analytics_store import ID, AnalyticsStore, display_zone

analytics = Blueprint('analytics', __name__)
DEFAULT_ORIGINS = ('https://heroliss.github.io', 'https://liss.pythonanywhere.com')
DEVICE_COOKIE = 'liss_d'
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
    own = {request.host.split(':')[0].lower()} if site == 'forum' else {'heroliss.github.io'}
    # A long-lived cookie on this host links the same browser across the community and github.io
    # (Chromium browsers send it on cross-site beacons; Safari / Firefox keep it per site).
    device = request.cookies.get(DEVICE_COOKIE, '')
    if not ID.fullmatch(device):
        device = secrets.token_hex(12)
    try:
        store().ingest(payload, ip=ip, ua=request.headers.get('User-Agent', ''), own_hosts=own,
                       headers=request.headers, device_id=device)
    except Exception:  # Analytics must never break the visitor's page.
        current_app.logger.exception('analytics ingest failed')
        return '', 500
    response = make_response('', 204)
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    response.set_cookie(DEVICE_COOKIE, device, max_age=2 * 365 * 86400, path='/analytics/', httponly=True,
                        secure=secure, samesite='None' if secure else 'Lax')
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
    return dict(analytics_tracker=dict(site='forum', uid=uid, uname=uname,
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
