"""Weekly visitor summary by email, sent by the community itself (no scheduler on free PythonAnywhere).

On the first request of each week (display time zone, weeks start Monday) the previous Monday-to-
Sunday is summarised and mailed to the site owner's confirmed address through the configured
transactional-mail provider. Rendering happens in that request; the provider call runs in a
background thread so the visitor never waits. State lives in the analytics meta table. Active only
when account mail is configured; LISS_WEEKLY_DIGEST=0 turns it off, LISS_DIGEST_EMAIL overrides
the recipient.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
import os
import threading

from flask import current_app, render_template, request

_lock = threading.Lock()
_state = {'week': None}


def week_key(moment: datetime) -> str:
    year, week, _ = moment.isocalendar()
    return f'{year}-W{week:02d}'


def recipient() -> str:
    override = os.environ.get('LISS_DIGEST_EMAIL', '') or current_app.config.get('LISS_DIGEST_EMAIL', '')
    if override and '@' in override:
        return override
    from .models import Permission, Role, User
    owners = (User.query.filter(User.is_site_owner.is_(True), User.confirmed.is_(True), User.email.isnot(None)).all()
              or User.query.join(Role).filter(Role.permissions.op('&')(Permission.ADMINISTER) == Permission.ADMINISTER,
                                              User.confirmed.is_(True), User.email.isnot(None)).all())
    for user in owners:
        if user.email and '@' in user.email and not user.email.endswith('.invalid'):
            return user.email
    return ''


def build_summary(start: datetime, end: datetime) -> dict:
    """Numbers for [start, end) in the display time zone; real visitors only unless noted."""
    from . import access_log
    from .analytics_admin import Filters, breakdown, kpis, pct_change, regions, store, top_pages
    day = timedelta(days=1)
    f = Filters({'range': 'custom', 'from': start.strftime('%Y-%m-%d'), 'to': (end - day).strftime('%Y-%m-%d')})
    span = f.end - f.start
    current, previous = kpis(f), kpis(f, f.start - span, f.start)
    changes = {key: pct_change(current[key] or 0, previous[key] or 0) for key in ('uv', 'pv', 'sessions')}
    split = store().kind_split(f.start, f.end)
    base = current_app.config.get('ANALYTICS_ACCESS_LOG') or '/var/log/liss.pythonanywhere.com.access.log'
    lookup = current_app.extensions.get('ip_region')
    hits = ([h for h in access_log.read(base, lookup.lookup if lookup else None) if f.start <= h['ts'] < f.end and h['page']]
            if access_log.log_files(base) else [])
    errors = store().scalar("SELECT COUNT(*) FROM events WHERE type = 'error' AND bot = 0 AND ts >= ? AND ts < ?",
                            (f.start, f.end)) or 0
    return dict(
        start=start, end=end - day, kpi=current, changes=changes, previous=previous,
        pages=top_pages(f, 8), referrers=breakdown(f, 'referrer_host', 6, '直接访问 / 站内'),
        devices=breakdown(f, 'device', 4), areas=(regions(f, 6) or [])[:6], split=split, errors=errors,
        crawlers=Counter(h['agent'] for h in hits if h['kind'] in ('bot', 'monitor')).most_common(6),
        server=dict(total=len(hits), bots=sum(h['kind'] == 'bot' for h in hits), probes=sum(h['kind'] == 'probe' for h in hits),
                    clouds=sum(h['kind'] == 'cloud' for h in hits),
                    errors=sum(h['status'] >= 500 for h in hits), limited=sum(h['status'] == 429 for h in hits)))


def render_message(to: str, start: datetime, end: datetime) -> dict:
    summary = build_summary(start, end)
    base = (current_app.config.get('LISS_PUBLIC_BASE_URL') or request.host_url).rstrip('/')
    context = dict(s=summary, admin_url=base + '/admin/analytics', kinds={0: '访客', 4: '本人', 3: '测试', 1: '机器人', 2: '疑似机器人'})
    subject = f"[LISS] 每周访问摘要 · {start:%m-%d} 至 {(end - timedelta(days=1)):%m-%d} · 访客 {summary['kpi']['uv']}"
    return dict(to=to, subject=subject, text=render_template('admin/analytics/email/weekly.txt', **context),
                html=render_template('admin/analytics/email/weekly.html', **context))


def send(app, message: dict, week: str, wait=False):
    from .analytics_admin import store, zone
    from .transactional_mail import send_message
    config = dict(app.config)

    def run():
        with app.app_context():
            try:
                result = send_message(config, message)
                status = '已发送' if result.accepted else f'发送失败（{result.reason}）'
            except Exception:  # Never let mail problems break anything.
                app.logger.exception('weekly digest failed')
                status = '发送失败（异常）'
            label = '' if week else '测试：'
            set_meta(store(), week, f"{label}{status} · {message['to']} · {datetime.now(zone()):%Y-%m-%d %H:%M}")
            app.extensions['weekly_digest_last'] = status
    if wait:
        run()
    else:
        threading.Thread(target=run, daemon=True).start()


def set_meta(analytics, week, status):
    with analytics.connect() as db:
        if week:
            db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('digest_week', ?)", (week,))
        db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('digest_status', ?)", (status,))


def week_bounds(now_local: datetime):
    monday = (now_local - timedelta(days=now_local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday - timedelta(days=7), monday


def enabled(app) -> bool:
    if os.environ.get('LISS_WEEKLY_DIGEST', '1') == '0' or app.config.get('LISS_WEEKLY_DIGEST') is False:
        return False
    from .transactional_mail import email_accounts_enabled
    return email_accounts_enabled()


def install(app):
    @app.before_request
    def weekly_digest_trigger():
        if app.testing and not app.config.get('WEEKLY_DIGEST_IN_TESTS'):
            return
        from .analytics_admin import store, zone
        now_local = datetime.now(zone())
        week = week_key(now_local)
        if _state['week'] == week or (request.path or '').startswith(('/static/', '/analytics/collect')):
            return
        with _lock:
            if _state['week'] == week:
                return
            _state['week'] = week
            try:
                if store().scalar("SELECT value FROM meta WHERE key = 'digest_week'") == week or not enabled(app):
                    return
                to = recipient()
                if not to:
                    set_meta(store(), week, '未发送：站长账号没有已验证的邮箱')
                    return
                start, end = week_bounds(now_local.replace(tzinfo=None))
                message = render_message(to, start, end)
                set_meta(store(), week, '发送中')
                send(app, message, week, wait=bool(app.config.get('WEEKLY_DIGEST_IN_TESTS')))
            except Exception:
                app.logger.exception('weekly digest could not start')
