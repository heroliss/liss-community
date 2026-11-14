"""访问统计 views on the admin blueprint (protected by the admin console checks)."""
from __future__ import annotations

import csv
from datetime import datetime, timedelta
import hashlib
import io
import json
import math
import re
from urllib.parse import urlencode

from flask import Response, abort, current_app, flash, redirect, render_template, request, url_for
from flask_login import current_user
from itsdangerous import BadData, URLSafeTimedSerializer

from . import db
from .admin import AdminAudit, admin
from collections import Counter

from . import access_log, analytics_insights as insights
from .analytics_store import (EVENT_TYPES, ID, KINDS, SITES, display_zone, env_facts, fmt_bytes, fmt_duration,
                              fmt_time, network_type, now_ms, signals, tz_matches_region, valid_ip)
from .models import Permission, Role, User

RANGES = [('today', '今天'), ('yesterday', '昨天'), ('7d', '近 7 天'), ('30d', '近 30 天'),
          ('90d', '近 90 天'), ('all', '全部'), ('custom', '自定义')]
LIVE_WINDOW_MS = 5 * 60 * 1000
# Visitor type filter: '' = real visitors only (default), 'all', or one type.
KIND_FILTERS = [('', '仅访客'), ('all', '全部类型'), ('owner', '本人'), ('test', '测试'), ('bot', '机器人'),
                ('suspect', '疑似机器人')]
KIND_CODES = {'owner': 4, 'test': 3, 'bot': 1, 'suspect': 2}
KIND_KEYS = {code: key for key, code in KIND_CODES.items()} | {0: 'visitor'}
_owner_seeded = {'done': False}
PER_PAGE = 30


def store():
    return current_app.extensions['analytics']


def zone():
    return display_zone(current_app.config['ANALYTICS_UTC_OFFSET_MINUTES'])


def offset_ms():
    return current_app.config['ANALYTICS_UTC_OFFSET_MINUTES'] * 60_000


# ------------------------------------------------------------------- filters
class Filters:
    """Range / site / bot filters shared by every statistics page."""

    def __init__(self, args):
        self.range = args.get('range', '7d')
        if self.range not in dict(RANGES):
            self.range = '7d'
        self.site = args.get('site', 'all')
        if self.site not in SITES:
            self.site = 'all'
        self.kind = args.get('who', '')
        if self.kind not in dict(KIND_FILTERS):
            self.kind = ''
        if args.get('bots') == '1' and not self.kind:  # Links from before visitor types existed.
            self.kind = 'all'
        self.date_from, self.date_to = args.get('from', ''), args.get('to', '')
        tz = zone()
        today = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
        day = timedelta(days=1)
        start, end = today, today + day
        if self.range == 'yesterday':
            start, end = today - day, today
        elif self.range in {'7d', '30d', '90d'}:
            start = today - day * (int(self.range[:-1]) - 1)
        elif self.range == 'all':
            first = store().scalar('SELECT MIN(started_at) FROM pageviews')
            start = (datetime.fromtimestamp(first / 1000, tz).replace(hour=0, minute=0, second=0, microsecond=0)
                     if first else today)
        elif self.range == 'custom':
            try:
                start = datetime.strptime(self.date_from, '%Y-%m-%d').replace(tzinfo=tz)
                end = datetime.strptime(self.date_to or self.date_from, '%Y-%m-%d').replace(tzinfo=tz) + day
                if end <= start or (end - start).days > 3660:
                    raise ValueError()
            except ValueError:
                self.range, start, end = '7d', today - day * 6, today + day
        self.start, self.end = int(start.timestamp() * 1000), int(end.timestamp() * 1000)
        if not self.date_from or self.range != 'custom':
            self.date_from = start.strftime('%Y-%m-%d')
            self.date_to = (end - day).strftime('%Y-%m-%d')

    @property
    def label(self):
        return dict(RANGES)[self.range] if self.range != 'custom' else f'{self.date_from} 至 {self.date_to}'

    @property
    def bots(self):
        return self.kind != ''

    @property
    def kind_label(self):
        return dict(KIND_FILTERS)[self.kind]

    @property
    def days(self):
        return max(1, round((self.end - self.start) / 86_400_000))

    def args(self, **extra):
        values = {'range': self.range, 'site': self.site}
        if self.range == 'custom':
            values.update({'from': self.date_from, 'to': self.date_to})
        if self.kind:
            values['who'] = self.kind
        values.update({key: value for key, value in extra.items() if value not in (None, '')})
        return values

    def where(self, alias='p', time_column='started_at', start=None, end=None):
        clauses = [f'{alias}.{time_column} >= ?', f'{alias}.{time_column} < ?']
        params = [self.start if start is None else start, self.end if end is None else end]
        if self.site != 'all':
            clauses.append(f'{alias}.site = ?')
            params.append(self.site)
        clause, extra = self.kind_clause(alias)
        if clause:
            clauses.append(clause)
            params.extend(extra)
        return ' AND '.join(clauses), tuple(params)

    def kind_clause(self, alias='p'):
        if self.kind == 'all':
            return '', []
        return f'{alias}.bot = ?', [KIND_CODES.get(self.kind, 0)]


def page_number():
    return max(1, min(100_000, request.args.get('page', 1, type=int)))


def paged(sql_rows, sql_count, params, page):
    total = store().scalar(sql_count, params) or 0
    pages = max(1, math.ceil(total / PER_PAGE))
    page = min(page, pages)
    rows = store().query(sql_rows + f' LIMIT {PER_PAGE} OFFSET {(page - 1) * PER_PAGE}', params)
    return dict(rows=rows, total=total, page=page, pages=pages)


def search_like(value):
    return '%' + value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def pct_change(current, previous):
    if not previous:
        return None
    return round((current - previous) / previous * 100)


def bars(rows, key='count'):
    peak = max([row[key] for row in rows] or [0]) or 1
    for row in rows:
        row['share'] = round(row[key] / peak * 100, 1)
    return rows


# ---------------------------------------------------------------- statistics
def kpis(f: Filters, start=None, end=None):
    where, params = f.where(start=start, end=end)
    row = store().query(f'SELECT COUNT(*) pv, COUNT(DISTINCT person_id) uv, COUNT(DISTINCT ip) ips, '
                        f'COUNT(DISTINCT session_id) sessions, COALESCE(SUM(active_ms),0) active, '
                        f'COALESCE(AVG(scroll),0) scroll, COALESCE(SUM(clicks),0) clicks FROM pageviews p WHERE {where}', params)[0]
    bounce = store().scalar(f'SELECT COUNT(*) FROM (SELECT session_id, COUNT(*) c FROM pageviews p WHERE {where} '
                            f'GROUP BY session_id) WHERE c = 1', params) or 0
    engaged = store().scalar(f'SELECT COUNT(*) FROM (SELECT session_id, COUNT(*) c, MAX(active_ms) a, MAX(inputs) i, '
                             f'SUM(clicks) k FROM pageviews p WHERE {where} GROUP BY session_id) '
                             f'WHERE c >= 2 OR a >= {insights.ENGAGED_MS} OR i > 0 OR k > 0', params) or 0
    first = f.start if start is None else start
    # person_id is the unified visitor's earliest record, so its first_seen is the visitor's first visit.
    new = store().scalar(f'SELECT COUNT(DISTINCT p.person_id) FROM pageviews p JOIN visitors v ON v.id = p.person_id '
                         f'WHERE {where} AND v.first_seen >= ?', params + (first,)) or 0
    sessions = row['sessions'] or 0
    row.update(bounce=round(bounce / sessions * 100) if sessions else 0, engaged=engaged,
               engaged_rate=round(engaged / sessions * 100) if sessions else 0,
               per_session=round(row['pv'] / sessions, 1) if sessions else 0,
               avg_session=row['active'] / sessions if sessions else 0,
               new=new, returning=max(0, (row['uv'] or 0) - new))
    return row


def trend(f: Filters):
    hourly = f.end - f.start <= 2 * 86_400_000
    bucket = 3_600_000 if hourly else 86_400_000
    where, params = f.where()
    rows = store().query(f'SELECT (started_at + ?) / ? b, COUNT(*) pv, COUNT(DISTINCT person_id) uv, '
                         f'COUNT(DISTINCT session_id) sessions FROM pageviews p WHERE {where} GROUP BY b',
                         (offset_ms(), bucket) + params)
    found = {row['b']: row for row in rows}
    first, last = (f.start + offset_ms()) // bucket, (f.end - 1 + offset_ms()) // bucket
    if last - first > 400:  # "全部" over long histories: keep the most recent 400 buckets.
        first = last - 400
    points = []
    tz = zone()
    for b in range(first, last + 1):
        row = found.get(b, {})
        moment = datetime.fromtimestamp((b * bucket - offset_ms()) / 1000, tz)
        points.append(dict(label=moment.strftime('%H:00' if hourly else '%m-%d'),
                           full=moment.strftime('%Y-%m-%d %H:00' if hourly else '%Y-%m-%d'),
                           pv=row.get('pv', 0), uv=row.get('uv', 0), sessions=row.get('sessions', 0)))
    peak = max([point['pv'] for point in points] or [0]) or 1
    width, height = 720, 200
    step = width / max(1, len(points))
    for index, point in enumerate(points):
        point['x'] = round(index * step, 2)
        point['w'] = round(max(1.0, step * 0.72), 2)
        point['h'] = round(point['pv'] / peak * height, 2)
        point['uy'] = round(height - point['uv'] / peak * height, 2)
        point['cx'] = round(index * step + step * 0.36, 2)
    ticks = [dict(y=round(height - height * i / 4, 2), value=round(peak * i / 4)) for i in range(5)]
    label_every = max(1, math.ceil(len(points) / 12))
    return dict(points=points, hourly=hourly, peak=peak, ticks=ticks, width=width, height=height,
                label_every=label_every, line=' '.join(f"{p['cx']},{p['uy']}" for p in points))


PAGE_SORTS = {'pv': 'pv DESC, uv DESC', 'engaged': 'engaged DESC, pv DESC', 'active': 'active DESC',
              'scroll': 'scroll DESC', 'rate': 'engaged * 1.0 / pv DESC, pv DESC'}


def top_pages(f: Filters, limit=15, q='', sort='pv'):
    where, params = f.where()
    if q:
        where += ' AND (p.path LIKE ? ESCAPE char(92) OR p.title LIKE ? ESCAPE char(92))'
        params += (search_like(q), search_like(q))
    rows = store().query(f'SELECT site, path, MAX(title) title, COUNT(*) pv, COUNT(DISTINCT person_id) uv, '
                         f'AVG(NULLIF(active_ms,0)) active, AVG(scroll) scroll, SUM(clicks) clicks, MAX(last_seen) last, '
                         f'SUM(CASE WHEN {insights.ENGAGED_VIEW_SQL} THEN 1 ELSE 0 END) engaged '
                         f'FROM pageviews p WHERE {where} GROUP BY site, path ORDER BY {PAGE_SORTS.get(sort, PAGE_SORTS["pv"])} '
                         f'LIMIT {int(limit)}', params)
    for row in rows:
        row['rate'] = round((row['engaged'] or 0) / row['pv'] * 100) if row['pv'] else 0
    return rows


def entry_exit(f: Filters):
    where, params = f.where()
    entries = store().query(f'SELECT site, path, MAX(title) title, COUNT(*) count FROM (SELECT p.*, ROW_NUMBER() OVER '
                            f'(PARTITION BY session_id ORDER BY started_at) rn FROM pageviews p WHERE {where}) WHERE rn = 1 '
                            f'GROUP BY site, path ORDER BY count DESC LIMIT 10', params)
    exits = store().query(f'SELECT site, path, MAX(title) title, COUNT(*) count FROM (SELECT p.*, ROW_NUMBER() OVER '
                          f'(PARTITION BY session_id ORDER BY started_at DESC) rn FROM pageviews p WHERE {where}) WHERE rn = 1 '
                          f'GROUP BY site, path ORDER BY count DESC LIMIT 10', params)
    return bars(entries), bars(exits)


def breakdown(f: Filters, column, limit=10, empty='（未知）'):
    where, params = f.where('s')
    rows = store().query(f'SELECT {column} name, COUNT(*) count, COUNT(DISTINCT person_id) visitors FROM sessions s '
                         f'WHERE {where} GROUP BY {column} ORDER BY count DESC LIMIT {int(limit)}', params)
    for row in rows:
        row['name'] = row['name'] or empty
    return bars(rows)


def heatmap(f: Filters):
    where, params = f.where()
    minutes = current_app.config['ANALYTICS_UTC_OFFSET_MINUTES']
    rows = store().query(f"SELECT CAST(strftime('%w', started_at/1000, 'unixepoch', '{minutes:+d} minutes') AS INTEGER) d, "
                         f"CAST(strftime('%H', started_at/1000, 'unixepoch', '{minutes:+d} minutes') AS INTEGER) h, "
                         f"COUNT(*) c FROM pageviews p WHERE {where} GROUP BY d, h", params)
    grid = {(row['d'], row['h']): row['c'] for row in rows}
    peak = max(grid.values() or [0]) or 1
    names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    return [dict(name=names[i], cells=[dict(hour=h, count=grid.get(((i + 1) % 7, h), 0),
                                            level=math.ceil(grid.get(((i + 1) % 7, h), 0) / peak * 4))
                                       for h in range(24)]) for i in range(7)]


def top_clicks(f: Filters, limit=15, path=None, site=None):
    where, params = f.where('e', 'ts')
    where += " AND e.type IN ('click', 'outbound')"
    if path is not None:
        where += ' AND e.path = ? AND e.site = ?'
        params += (path, site)
    return bars(store().query(f'SELECT site, path, label, target, MAX(href) href, type, COUNT(*) count, '
                              f'COUNT(DISTINCT person_id) visitors FROM events e WHERE {where} '
                              f'GROUP BY site, path, label, target, type ORDER BY count DESC LIMIT {int(limit)}', params))


def performance(f: Filters):
    where, params = f.where()
    return store().query(f'SELECT site, COUNT(ttfb_ms) samples, AVG(ttfb_ms) ttfb, AVG(dom_ms) dom, AVG(load_ms) load '
                         f'FROM pageviews p WHERE {where} AND load_ms IS NOT NULL GROUP BY site ORDER BY site', params)


def recent_errors(f: Filters, limit=10):
    where, params = f.where('e', 'ts')
    return store().query(f"SELECT label, site, path, MAX(data) data, COUNT(*) count, MAX(ts) last FROM events e "
                         f"WHERE {where} AND e.type = 'error' GROUP BY label, site, path ORDER BY last DESC LIMIT {int(limit)}", params)


NOT_FOUND = "(p.title LIKE '%没有找到页面%' OR p.title LIKE '%· 404' OR p.title LIKE '%· 404 %')"


def not_found(f: Filters, limit=10):
    """Pages that rendered a 404: broken links and where visitors found them."""
    where, params = f.where()
    rows = store().query(f"SELECT site, path, COUNT(*) count, COUNT(DISTINCT person_id) visitors, MAX(started_at) last, "
                         f"GROUP_CONCAT(DISTINCT NULLIF(referrer, '')) refs FROM pageviews p WHERE {where} AND {NOT_FOUND} "
                         f"GROUP BY site, path ORDER BY count DESC LIMIT {int(limit)}", params)
    for row in rows:
        row['ref_list'] = [ref for ref in (row.pop('refs') or '').split(',') if ref][:3]
    return rows


def site_split(f: Filters):
    where, params = f.where()
    rows = store().query(f'SELECT site, COUNT(*) count, COUNT(DISTINCT person_id) visitors FROM pageviews p '
                         f'WHERE {where} GROUP BY site ORDER BY count DESC', params)
    for row in rows:
        row['name'] = SITES.get(row['site'], row['site'])
    return bars(rows)


def timeline(where_sql, params, page=1, per_page=15):
    """Sessions with their pageviews and events, newest first."""
    total = store().scalar(f'SELECT COUNT(*) FROM sessions s WHERE {where_sql}', params) or 0
    pages = max(1, math.ceil(total / per_page))
    page = min(page, pages)
    sessions = store().query(f'SELECT s.* FROM sessions s WHERE {where_sql} ORDER BY s.started_at DESC '
                             f'LIMIT {per_page} OFFSET {(page - 1) * per_page}', params)
    if sessions:
        ids = [s['id'] for s in sessions]
        marks = ','.join('?' * len(ids))
        views = store().query(f'SELECT * FROM pageviews WHERE session_id IN ({marks}) ORDER BY started_at', tuple(ids))
        events = store().query(f'SELECT * FROM events WHERE session_id IN ({marks}) ORDER BY ts', tuple(ids))
        by_view = {}
        for event in events:
            by_view.setdefault(event['pageview_id'], []).append(event)
        by_session = {}
        for view in views:
            view['events'] = by_view.get(view['id'], [])
            by_session.setdefault(view['session_id'], []).append(view)
        for session in sessions:
            session['views'] = by_session.get(session['id'], [])
            session['active'] = sum(v['active_ms'] for v in session['views'])
            session['span'] = max([v['last_seen'] for v in session['views']] or [session['last_seen']]) - session['started_at']
    return dict(rows=sessions, total=total, page=page, pages=pages)


# ---------------------------------------------------------------------- views
def render(template, **context):
    if not _owner_seeded['done']:
        # Once per process: IPs where administrator accounts were tracked count as owner IPs (covers
        # visits recorded before owner marking existed). Admin page views themselves are marked by
        # analytics.tracker_context.
        _owner_seeded['done'] = True
        admins = User.query.join(Role).filter(
            Role.permissions.op('&')(Permission.ADMINISTER) == Permission.ADMINISTER).with_entities(User.id).all()
        store().mark_owner_users([row[0] for row in admins])
    return render_template(template, admin_section='analytics', sites=SITES, ranges=RANGES, kinds=KINDS,
                           kind_keys=KIND_KEYS, kind_filters=KIND_FILTERS, event_types=EVENT_TYPES, **context)


@admin.app_template_filter('at')
def at_filter(ms, pattern='%Y-%m-%d %H:%M:%S'):
    return fmt_time(ms, zone(), pattern)


@admin.app_template_filter('dur')
def dur_filter(ms):
    return fmt_duration(ms)


@admin.app_template_filter('ago')
def ago_filter(ms):
    if not ms:
        return '—'
    seconds = max(0, (now_ms() - ms) // 1000)
    if seconds < 60:
        return f'{seconds} 秒前'
    if seconds < 3600:
        return f'{seconds // 60} 分钟前'
    if seconds < 86400:
        return f'{seconds // 3600} 小时前'
    return f'{seconds // 86400} 天前'


def raw_region(ip):
    lookup = current_app.extensions.get('ip_region')
    return lookup.lookup(ip) if lookup and ip else ''


@admin.app_template_filter('nettype')
def nettype_filter(ip):
    return network_type(raw_region(ip), ip or '')


@admin.app_template_filter('region')
def region_filter(ip):
    from .ip_region import pretty
    lookup = current_app.extensions.get('ip_region')
    return pretty(lookup.lookup(ip)) if lookup and ip else ''


def regions(f: Filters, limit=12):
    """Visits grouped by province (China) or country, via the offline IP database."""
    from .ip_region import area
    lookup = current_app.extensions.get('ip_region')
    if not lookup or not lookup.available:
        return None
    where, params = f.where('s')
    counts, visitors = {}, {}
    for row in store().query(f'SELECT ip, COUNT(*) c, COUNT(DISTINCT person_id) v FROM sessions s WHERE {where} GROUP BY ip', params):
        name = area(lookup.lookup(row['ip']))
        counts[name] = counts.get(name, 0) + row['c']
        visitors[name] = visitors.get(name, 0) + row['v']
    rows = [dict(name=name, count=count, visitors=visitors[name]) for name, count in counts.items()]
    rows.sort(key=lambda row: -row['count'])
    return bars(rows[:limit])


@admin.app_template_filter('site_name')
def site_name_filter(value):
    return SITES.get(value, value or '—')


@admin.app_template_filter('page_url')
def page_url_filter(row):
    """Open the original page in a new tab."""
    if row.get('url'):
        return row['url']
    base = {'forum': url_for('main.index', _external=True).rstrip('/'),
            'works': 'https://heroliss.github.io', 'atoll': 'https://heroliss.github.io'}.get(row.get('site'), '')
    return base + (row.get('path') or '')


@admin.get('/analytics', strict_slashes=False)
def analytics():
    f = Filters(request.args)
    span = f.end - f.start
    current, previous = kpis(f), kpis(f, f.start - span, f.start)
    changes = {key: pct_change(current[key] or 0, previous[key] or 0) for key in ('pv', 'uv', 'sessions', 'ips', 'active', 'engaged')}
    entries, exits = entry_exit(f)
    live = store().scalar('SELECT COUNT(DISTINCT person_id) FROM pageviews WHERE last_seen >= ? AND bot = 0',
                          (now_ms() - LIVE_WINDOW_MS,)) or 0
    return render('admin/analytics/overview.html', analytics_page='overview', f=f, kpi=current, changes=changes,
                  trend=trend(f), pages=top_pages(f), entries=entries, exits=exits,
                  referrers=breakdown(f, 'referrer_host', empty='直接访问 / 站内'), channels=insights.channels(store(), f),
                  browsers=breakdown(f, 'browser'), systems=breakdown(f, 'os'), devices=breakdown(f, 'device'),
                  screens=breakdown(f, 'screen', 8), languages=breakdown(f, 'lang', 8), zones=breakdown(f, 'tz', 8),
                  sites_split=site_split(f), heat=heatmap(f), clicks=top_clicks(f, 12), perf=performance(f),
                  errors=recent_errors(f), missing=not_found(f), areas=regions(f), live_count=live, kind_split=store().kind_split(f.start, f.end, f.site), storage=store().storage_stats())


@admin.get('/analytics/live')
def analytics_live():
    f = Filters(request.args)
    since = now_ms() - LIVE_WINDOW_MS
    kind_p, params = f.kind_clause('p')
    kind_e, _ = f.kind_clause('e')
    where_p = f' AND {kind_p}' if kind_p else ''
    active = store().query('SELECT p.*, v.browser, v.os, v.device, v.username, v.note FROM pageviews p '
                           f'JOIN visitors v ON v.id = p.visitor_id WHERE p.last_seen >= ?{where_p} '
                           'AND p.last_seen = (SELECT MAX(last_seen) FROM pageviews q WHERE q.person_id = p.person_id) '
                           'ORDER BY p.last_seen DESC LIMIT 100', (since, *params))
    recent = store().query('SELECT p.*, v.browser, v.device, v.username FROM pageviews p JOIN visitors v ON v.id = p.visitor_id '
                           f'WHERE 1 = 1{where_p} ORDER BY p.started_at DESC LIMIT 60', tuple(params))
    events = store().query(f'SELECT * FROM events e WHERE 1 = 1{" AND " + kind_e if kind_e else ""} '
                           'ORDER BY ts DESC LIMIT 40', tuple(params))
    return render('admin/analytics/live.html', analytics_page='live', f=f, active=active, recent=recent,
                  events=events, window_minutes=LIVE_WINDOW_MS // 60000)


VISITOR_MODES = ('visitor', 'record', 'ip', 'suggest')


def describe_people(rows, kind=None):
    """Add the records of each unified visitor in `rows` (keyed by visitor_id = person id). Device and type
    come from its most recent record, preferring records of `kind` when the list is filtered by type."""
    persons = [row['visitor_id'] for row in rows]
    if not persons:
        return
    members = {}
    for member in store().query(f"SELECT * FROM visitors WHERE person_id IN ({','.join('?' * len(persons))}) "
                                'ORDER BY last_seen DESC', tuple(persons)):
        members.setdefault(member['person_id'], []).append(member)
    for row in rows:
        group = members.get(row['visitor_id']) or store().query('SELECT * FROM visitors WHERE id = ?', (row['visitor_id'],))
        latest = next((m for m in group if m['bot'] == kind), group[0]) if group else {}
        for key in ('browser', 'os', 'device', 'screen', 'tz', 'last_ip', 'kind_reason', 'kind_locked'):
            row[key] = latest.get(key)
        row['kind'] = latest.get('bot')
        row['username'] = next((m['username'] for m in group if m['username']), '')
        row['user_id'] = next((m['user_id'] for m in group if m['user_id']), None)
        row['note'] = '；'.join(dict.fromkeys(m['note'] for m in group if m['note']))
        row['records'] = len(group)
        row['agents'] = list(dict.fromkeys(f"{m['browser']} · {m['os']} · {m['device']}" for m in group))


def suggestion_rows(found):
    """Attach both records' details to store().suggestions() pairs."""
    ids = list({x for item in found for x in (item['a'], item['b'])})
    records = {r['id']: r for r in store().query(
        "SELECT v.*, (SELECT GROUP_CONCAT(DISTINCT site) FROM pageviews WHERE visitor_id = v.id) sites, "
        "(SELECT COUNT(*) FROM pageviews WHERE visitor_id = v.id) pv FROM visitors v "
        f"WHERE v.id IN ({','.join('?' * len(ids))})", tuple(ids))} if ids else {}
    for item in found:
        item['left'], item['right'] = records.get(item['a'], {}), records.get(item['b'], {})
    return [item for item in found if item['left'] and item['right']]


@admin.get('/analytics/visitors')
def analytics_visitors():
    f = Filters(request.args)
    mode = request.args.get('by') if request.args.get('by') in VISITOR_MODES else 'visitor'  # Old 'device' links: unified.
    q = request.args.get('q', '').strip()[:100]
    sort = request.args.get('sort', 'last')
    split = store().kind_split(f.start, f.end, f.site)
    pending = store().suggestions(limit=100)
    if mode == 'suggest':
        return render('admin/analytics/visitors.html', analytics_page='visitors', f=f, mode=mode, q='', sort=sort,
                      result=dict(rows=[], total=len(pending)), suggestions=suggestion_rows(pending),
                      kind_split=split, pending=len(pending))
    where, params = f.where()
    if q:
        like = search_like(q)
        where += (' AND (p.ip LIKE ? ESCAPE char(92) OR p.person_id IN (SELECT person_id FROM visitors WHERE id LIKE ? '
                  'ESCAPE char(92) OR username LIKE ? ESCAPE char(92) OR note LIKE ? ESCAPE char(92)))')
        params += (like, like, like, like)
    order = {'last': 'last DESC', 'pv': 'pv DESC', 'active': 'active DESC', 'first': 'first ASC',
             'sessions': 'sessions DESC'}.get(sort, 'last DESC')
    if mode == 'ip':
        sql = (f'SELECT p.ip, MIN(p.started_at) first, MAX(p.last_seen) last, COUNT(*) pv, COUNT(DISTINCT p.session_id) sessions, '
               f'COUNT(DISTINCT p.person_id) visitors, SUM(p.active_ms) active, GROUP_CONCAT(DISTINCT p.site) sites, '
               f'(SELECT GROUP_CONCAT(DISTINCT v.browser || char(32,183,32) || v.os) FROM visitors v WHERE v.id IN '
               f'(SELECT visitor_id FROM pageviews WHERE ip = p.ip)) agents, '
               f'EXISTS(SELECT 1 FROM ignored_ips i WHERE i.ip = p.ip) ignored '
               f'FROM pageviews p WHERE {where} GROUP BY p.ip ORDER BY {order}')
        count = f'SELECT COUNT(DISTINCT p.ip) FROM pageviews p WHERE {where}'
    elif mode == 'record':
        # One row per browser record (the raw id in each site's storage), before unification.
        sql = (f'SELECT p.visitor_id, MIN(p.started_at) first, MAX(p.last_seen) last, COUNT(*) pv, '
               f'COUNT(DISTINCT p.session_id) sessions, SUM(p.active_ms) active, GROUP_CONCAT(DISTINCT p.ip) ips, '
               f'GROUP_CONCAT(DISTINCT p.site) sites, v.browser, v.os, v.device, v.screen, v.username, v.user_id, '
               f'v.note, v.first_seen, v.last_ip, v.tz, v.bot kind, v.kind_reason, v.kind_locked, v.person_id, '
               f'(SELECT COUNT(*) FROM visitors m WHERE m.person_id = v.person_id) members '
               f'FROM pageviews p JOIN visitors v ON v.id = p.visitor_id '
               f'WHERE {where} GROUP BY p.visitor_id ORDER BY {order}')
        count = f'SELECT COUNT(DISTINCT p.visitor_id) FROM pageviews p WHERE {where}'
    else:
        # One row per unified visitor: records joined by device cookie, community account or a confirmed merge.
        sql = (f'SELECT p.person_id visitor_id, MIN(p.started_at) first, MAX(p.last_seen) last, COUNT(*) pv, '
               f'COUNT(DISTINCT p.session_id) sessions, SUM(p.active_ms) active, GROUP_CONCAT(DISTINCT p.ip) ips, '
               f'GROUP_CONCAT(DISTINCT p.site) sites, v.first_seen FROM pageviews p LEFT JOIN visitors v ON v.id = p.person_id '
               f'WHERE {where} GROUP BY p.person_id ORDER BY {order}')
        count = f'SELECT COUNT(DISTINCT p.person_id) FROM pageviews p WHERE {where}'
    result = paged(sql, count, params, page_number())
    if mode == 'visitor':
        describe_people(result['rows'], None if f.kind == 'all' else KIND_CODES.get(f.kind, 0))
    for row in result['rows']:
        row['site_list'] = [s for s in (row.get('sites') or '').split(',') if s]
        if mode != 'ip':
            row['ip_list'] = [ip for ip in (row.get('ips') or '').split(',') if ip]
            row['proxy'] = tz_matches_region(row.get('tz') or '', raw_region(row.get('last_ip') or '')) is False
            row['is_new'] = (row.get('first_seen') or 0) >= f.start
    return render('admin/analytics/visitors.html', analytics_page='visitors', f=f, mode=mode, q=q, sort=sort, result=result,
                  kind_split=split, pending=len(pending), suggestions=[])


@admin.get('/analytics/visitor/<visitor_id>')
def analytics_visitor(visitor_id):
    """A unified visitor, entered through any of its records. `visitor` is the record in the URL, whose
    device, type and note are shown; totals, IPs and the timeline cover every record of the visitor."""
    if not ID.fullmatch(visitor_id):
        abort(404)
    rows = store().query('SELECT * FROM visitors WHERE id = ?', (visitor_id,))
    if not rows:
        abort(404)
    visitor = rows[0]
    person = visitor['person_id'] or visitor_id
    totals = store().query('SELECT COUNT(*) pv, COUNT(DISTINCT session_id) sessions, COALESCE(SUM(active_ms),0) active, '
                           'COALESCE(SUM(clicks),0) clicks, MIN(started_at) first, MAX(last_seen) last, '
                           'COUNT(DISTINCT path) pages FROM pageviews WHERE person_id = ?', (person,))[0]
    ips = store().query('SELECT ip, COUNT(*) pv, MIN(started_at) first, MAX(last_seen) last, '
                        'EXISTS(SELECT 1 FROM ignored_ips i WHERE i.ip = p.ip) ignored FROM pageviews p '
                        'WHERE person_id = ? GROUP BY ip ORDER BY last DESC', (person,))
    favourite = store().query('SELECT site, path, MAX(title) title, COUNT(*) pv, SUM(active_ms) active FROM pageviews '
                              'WHERE person_id = ? GROUP BY site, path ORDER BY active DESC LIMIT 8', (person,))
    visitor['facts'] = env_facts(visitor)
    visitor['evidence'] = signals(visitor, raw_region(visitor['last_ip']))
    members = store().person_members(person) or [dict(visitor, reasons=[], detached=False, sites='', pv=totals['pv'])]
    username = next((m['username'] for m in members if m['username']), '')
    return render('admin/analytics/visitor.html', analytics_page='visitors', visitor=visitor, person=person,
                  members=members, username=username, first_seen=min(m['first_seen'] for m in members),
                  totals=totals, ips=ips, favourite=favourite,
                  suggestions=suggestion_rows(store().suggestions(person, limit=20, strict=False)),
                  sessions=timeline('s.person_id = ?', (person,), page_number()))


@admin.get('/analytics/ip/<address>')
def analytics_ip(address):
    ip = valid_ip(address)
    if not ip:
        abort(404)
    totals = store().query('SELECT COUNT(*) pv, COUNT(DISTINCT session_id) sessions, COUNT(DISTINCT person_id) visitors, '
                           'COALESCE(SUM(active_ms),0) active, COALESCE(SUM(clicks),0) clicks, MIN(started_at) first, '
                           'MAX(last_seen) last FROM pageviews WHERE ip = ?', (ip,))[0]
    visitors = store().query('SELECT v.*, v.bot kind, COUNT(p.id) pv, SUM(p.active_ms) active, MAX(p.last_seen) last, '
                             '(SELECT COUNT(*) FROM visitors m WHERE m.person_id = v.person_id) members FROM pageviews p '
                             'JOIN visitors v ON v.id = p.visitor_id WHERE p.ip = ? GROUP BY v.id ORDER BY last DESC', (ip,))
    ignored = bool(store().scalar('SELECT 1 FROM ignored_ips WHERE ip = ?', (ip,)))
    return render('admin/analytics/ip.html', analytics_page='visitors', ip=ip, totals=totals, visitors=visitors,
                  ignored=ignored, sessions=timeline('s.id IN (SELECT DISTINCT session_id FROM pageviews WHERE ip = ?)',
                                                     (ip,), page_number()))


@admin.get('/analytics/pages')
def analytics_pages():
    f = Filters(request.args)
    q = request.args.get('q', '').strip()[:100]
    sort = request.args.get('sort', 'pv') if request.args.get('sort') in PAGE_SORTS else 'pv'
    return render('admin/analytics/pages.html', analytics_page='pages', f=f, q=q, sort=sort, pages=top_pages(f, 300, q, sort))


SHARE_TARGETS = [('works', '作品站首页', 'https://heroliss.github.io/liss-works/'),
                 ('atoll', '玻璃海（直接进入场景）', 'https://heroliss.github.io/liss-works/play/glass-atoll/'),
                 ('projects', '作品站 · 工程库', 'https://heroliss.github.io/liss-works/projects/'),
                 ('forum', '社区首页', 'https://liss.pythonanywhere.com/')]
SHARE_HOSTS = ('heroliss.github.io', 'liss.pythonanywhere.com', 'localhost', '127.0.0.1')


@admin.get('/analytics/sources')
def analytics_sources():
    f = Filters(request.args)
    data = insights.channels(store(), f)
    campaigns = store().query('SELECT * FROM campaigns ORDER BY created_at DESC')
    seen = {row['name']: row for row in data['sources'] if row['group'] == 'campaign'}
    for row in campaigns:
        row['url'] = insights.share_url(row['target'], row['name'])
        row['stats'] = seen.get(row['name'])
    group = request.args.get('g', '')
    sources = [row for row in data['sources'] if not group or row['group'] == group]
    return render('admin/analytics/sources.html', analytics_page='sources', f=f, data=data, sources=sources, group=group,
                  groups=insights.GROUPS, campaigns=campaigns, targets=SHARE_TARGETS)


@admin.post('/analytics/campaign')
def analytics_campaign():
    name = (request.form.get('name') or '').strip()
    target_key = request.form.get('target', 'works')
    target = request.form.get('custom', '').strip() if target_key == 'custom' else dict((k, u) for k, _, u in SHARE_TARGETS).get(target_key, '')
    parts = None
    try:
        from urllib.parse import urlsplit
        parts = urlsplit(target)
    except ValueError:
        pass
    if not name or len(name) > 40 or any(c in name for c in '&=#?/\\') or any(ord(c) < 32 for c in name):
        flash('渠道名称需要 1–40 个字，不能包含 & = # ? / 等符号。')
    elif not parts or parts.scheme not in ('https', 'http') or (parts.hostname or '') not in SHARE_HOSTS:
        flash('目标地址必须是作品站（heroliss.github.io）或社区（liss.pythonanywhere.com）上的页面。')
    else:
        with store().connect() as connection:
            connection.execute('INSERT OR REPLACE INTO campaigns (name, target, note, created_at) VALUES (?, ?, ?, ?)',
                               (name, target, (request.form.get('note') or '').strip()[:100], now_ms()))
        audit('analytics.campaign', f'分享链接 {name}', [dict(label='目标', before='—', after=target)])
        flash(f'已生成分享链接“{name}”，复制下面列表中的链接去分享即可。')
    return redirect(url_for('admin.analytics_sources', **({'range': request.form['range']} if request.form.get('range') else {})))


@admin.post('/analytics/campaign/delete')
def analytics_campaign_delete():
    name = request.form.get('name', '')
    with store().connect() as connection:
        connection.execute('DELETE FROM campaigns WHERE name = ?', (name,))
    flash(f'已从列表移除“{name}”。已有的访问记录保留，仍会在来源统计中显示。')
    return redirect(url_for('admin.analytics_sources'))


@admin.get('/analytics/journeys')
def analytics_journeys():
    f = Filters(request.args)
    return render('admin/analytics/journeys.html', analytics_page='journeys', f=f, j=insights.journeys(store(), f))


@admin.get('/analytics/help')
def analytics_help():
    return render('admin/analytics/help.html', analytics_page='help', engaged_seconds=insights.ENGAGED_MS // 1000)


@admin.get('/analytics/page')
def analytics_page():
    f = Filters(request.args)
    site, path = request.args.get('s', ''), request.args.get('path', '')[:600]
    if site not in SITES or not path:
        abort(404)
    where, params = f.where()
    where += ' AND p.site = ? AND p.path = ?'
    params += (site, path)
    summary = store().query(f'SELECT COUNT(*) pv, COUNT(DISTINCT person_id) uv, COUNT(DISTINCT ip) ips, '
                            f'AVG(NULLIF(active_ms,0)) active, AVG(scroll) scroll, SUM(clicks) clicks, MAX(title) title, '
                            f'MAX(url) url FROM pageviews p WHERE {where}', params)[0]
    scroll = store().query(f'SELECT CASE WHEN scroll >= 90 THEN 4 WHEN scroll >= 75 THEN 3 WHEN scroll >= 50 THEN 2 '
                           f'WHEN scroll >= 25 THEN 1 ELSE 0 END b, COUNT(*) count FROM pageviews p WHERE {where} GROUP BY b', params)
    scroll_rows = bars([dict(name=['0–24%', '25–49%', '50–74%', '75–89%', '90–100%'][i],
                             count=next((r['count'] for r in scroll if r['b'] == i), 0)) for i in range(5)])
    referrers = store().query(f"SELECT CASE WHEN referrer = '' THEN '直接访问' ELSE referrer END name, COUNT(*) count "
                              f"FROM pageviews p WHERE {where} GROUP BY name ORDER BY count DESC LIMIT 12", params)
    visits = paged(f'SELECT p.*, v.browser, v.os, v.device, v.username FROM pageviews p JOIN visitors v ON v.id = p.visitor_id '
                   f'WHERE {where} ORDER BY p.started_at DESC', f'SELECT COUNT(*) FROM pageviews p WHERE {where}', params, page_number())
    before, after = insights.neighbours(insights.journeys(store(), f), site, path)
    return render('admin/analytics/page.html', analytics_page='pages', f=f, site=site, path=path, summary=summary,
                  scroll=scroll_rows, referrers=bars(referrers), clicks=top_clicks(f, 30, path, site), visits=visits,
                  before=before, after=after)


@admin.get('/analytics/events')
def analytics_events():
    f = Filters(request.args)
    kind = request.args.get('type', 'all')
    q = request.args.get('q', '').strip()[:100]
    where, params = f.where('e', 'ts')
    if kind in EVENT_TYPES:
        where += ' AND e.type = ?'
        params += (kind,)
    else:
        kind = 'all'
    if q:
        like = search_like(q)
        where += (' AND (e.label LIKE ? ESCAPE char(92) OR e.target LIKE ? ESCAPE char(92) OR e.href LIKE ? ESCAPE char(92) '
                  'OR e.path LIKE ? ESCAPE char(92) OR e.ip LIKE ? ESCAPE char(92))')
        params += (like,) * 5
    result = paged(f'SELECT e.* FROM events e WHERE {where} ORDER BY e.ts DESC',
                   f'SELECT COUNT(*) FROM events e WHERE {where}', params, page_number())
    return render('admin/analytics/events.html', analytics_page='events', f=f, kind=kind, q=q, result=result,
                  summary=top_clicks(f, 20))


@admin.get('/analytics/data')
def analytics_data():
    stats = store().storage_stats()
    ignored = store().query('SELECT * FROM ignored_ips ORDER BY created_at DESC')
    lookup = current_app.extensions.get('ip_region')
    ip_db = [dict(name=s.path.name, bytes=fmt_bytes(s.path.stat().st_size)) for s in (lookup.searchers.values() if lookup else [])]
    from . import weekly_digest
    digest = dict(enabled=weekly_digest.enabled(current_app), to=weekly_digest.recipient(),
                  status=store().scalar("SELECT value FROM meta WHERE key = 'digest_status'") or '尚未发送',
                  week=store().scalar("SELECT value FROM meta WHERE key = 'digest_week'") or '')
    return render('admin/analytics/data.html', analytics_page='data', stats=stats, ignored=ignored, ip_db=ip_db,
                  size=fmt_bytes(stats['bytes']), my_ip=request.remote_addr or '', digest=digest,
                  rate_limit=current_app.config.get('PAGE_RATE_LIMIT') or 0,
                  community_root=url_for('main.index', _external=True))


@admin.get('/analytics/digest/preview')
def analytics_digest_preview():
    from . import weekly_digest
    start, end = weekly_digest.week_bounds(datetime.now(zone()).replace(tzinfo=None))
    message = weekly_digest.render_message(weekly_digest.recipient() or '（未设置）', start, end)
    return message['html']


@admin.post('/analytics/digest/test')
def analytics_digest_test():
    from . import weekly_digest
    if not weekly_digest.enabled(current_app):
        flash('邮件服务未配置或已关闭，无法发送摘要。')
        return redirect(url_for('admin.analytics_data'))
    to = weekly_digest.recipient()
    if not to:
        flash('站长账号没有已验证的邮箱：请先在个人资料中绑定并验证邮箱。')
        return redirect(url_for('admin.analytics_data'))
    start, end = weekly_digest.week_bounds(datetime.now(zone()).replace(tzinfo=None))
    app = current_app._get_current_object()
    weekly_digest.send(app, weekly_digest.render_message(to, start, end), None, wait=True)
    flash(f"测试摘要（上周数据）：{app.extensions.get('weekly_digest_last', '未知')} → {to}")
    return redirect(url_for('admin.analytics_data'))


@admin.get('/analytics/export')
def analytics_export():
    f = Filters(request.args)
    kind = request.args.get('kind', 'pageviews')
    tz = zone()
    if kind == 'events':
        where, params = f.where('e', 'ts')
        rows = store().query(f'SELECT e.* FROM events e WHERE {where} ORDER BY e.ts', params)
        columns = [('时间', lambda r: fmt_time(r['ts'], tz)), ('类型', lambda r: EVENT_TYPES.get(r['type'], r['type'])),
                   ('站点', lambda r: SITES.get(r['site'])), ('页面', 'path'), ('内容', 'label'), ('元素', 'target'),
                   ('链接', 'href'), ('X', 'x'), ('Y', 'y'), ('附加', 'data'), ('IP', 'ip'), ('访客', 'visitor_id'), ('统一访客', 'person_id'),
                   ('会话', 'session_id')]
    elif kind == 'sessions':
        where, params = f.where('s')
        rows = store().query(f'SELECT s.*, (SELECT COUNT(*) FROM pageviews p WHERE p.session_id = s.id) pv, '
                             f'(SELECT SUM(active_ms) FROM pageviews p WHERE p.session_id = s.id) active FROM sessions s '
                             f'WHERE {where} ORDER BY s.started_at', params)
        columns = [('开始', lambda r: fmt_time(r['started_at'], tz)), ('最后活动', lambda r: fmt_time(r['last_seen'], tz)),
                   ('站点', lambda r: SITES.get(r['site'])), ('IP', 'ip'), ('浏览量', 'pv'),
                   ('停留(秒)', lambda r: round((r['active'] or 0) / 1000)), ('来源', 'referrer'), ('入口', 'landing'),
                   ('浏览器', 'browser'), ('系统', 'os'), ('设备', 'device'), ('屏幕', 'screen'), ('语言', 'lang'),
                   ('时区', 'tz'), ('用户', 'username'), ('访客', 'visitor_id'), ('统一访客', 'person_id'), ('会话', 'id'), ('UA', 'ua')]
    else:
        kind = 'pageviews'
        where, params = f.where()
        rows = store().query(f'SELECT p.*, v.browser, v.os, v.device, v.username FROM pageviews p '
                             f'JOIN visitors v ON v.id = p.visitor_id WHERE {where} ORDER BY p.started_at', params)
        columns = [('时间', lambda r: fmt_time(r['started_at'], tz)), ('站点', lambda r: SITES.get(r['site'])),
                   ('页面', 'path'), ('标题', 'title'), ('停留(秒)', lambda r: round(r['active_ms'] / 1000)),
                   ('总时长(秒)', lambda r: round(r['total_ms'] / 1000)), ('滚动%', 'scroll'), ('点击', 'clicks'),
                   ('来源', 'referrer'), ('IP', 'ip'), ('浏览器', 'browser'), ('系统', 'os'), ('设备', 'device'),
                   ('视口', 'viewport'), ('首字节ms', 'ttfb_ms'), ('加载ms', 'load_ms'), ('用户', 'username'),
                   ('访客', 'visitor_id'), ('统一访客', 'person_id'), ('会话', 'session_id'), ('网址', 'url')]
    buffer = io.StringIO()
    buffer.write('﻿')
    writer = csv.writer(buffer)
    writer.writerow([name for name, _ in columns])
    for row in rows:
        writer.writerow([getter(row) if callable(getter) else row.get(getter) for _, getter in columns])
    name = f'liss-analytics-{kind}-{f.date_from}-{f.date_to}.csv'
    return Response(buffer.getvalue(), mimetype='text/csv; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="{name}"', 'Cache-Control': 'no-store'})


# ------------------------------------------------------------------ mutations
def audit(action, label, rows):
    db.session.add(AdminAudit(actor_id=current_user.id, actor_name=current_user.display_name[:64], action=action,
                              target_type='analytics', target_id=None, target_label=label[:100],
                              details=json.dumps({'before': {}, 'after': {}, 'rows': rows}, ensure_ascii=False)))
    db.session.commit()


def serializer():
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt='liss-analytics-delete')


def deletion_plan(form):
    """Map a deletion request to a pageview filter, a title and a description."""
    scope = form.get('scope')
    tz = zone()
    if scope == 'before':
        try:
            day = datetime.strptime(form.get('date', ''), '%Y-%m-%d').replace(tzinfo=tz)
        except ValueError:
            abort(400, description='请选择有效的日期。')
        cutoff = int(day.timestamp() * 1000)
        return dict(scope=scope, value=form['date'], where='started_at < ?', params=[cutoff],
                    title='删除较早的访问数据', label=f'{form["date"]} 之前的全部记录')
    if scope == 'ip':
        ip = valid_ip(form.get('ip', ''))
        if not ip:
            abort(400, description='请输入有效的 IP 地址。')
        return dict(scope=scope, value=ip, where='ip = ?', params=[ip], title='删除某个 IP 的访问数据', label=f'IP {ip}')
    if scope == 'visitor':
        visitor = form.get('visitor', '')
        if not ID.fullmatch(visitor):
            abort(400, description='访客编号无效。')
        person = store().scalar('SELECT person_id FROM visitors WHERE id = ?', (visitor,)) or visitor
        return dict(scope=scope, value=visitor, where='person_id = ?', params=[person],
                    title='删除某个访客的访问数据', label=f'访客 {visitor[:12]}（含同一访客的全部记录）')
    if scope == 'bots':
        return dict(scope=scope, value='', where='bot IN (1, 2)', params=[], title='删除机器人访问',
                    label='全部机器人与疑似机器人访问记录')
    if scope == 'self':
        return dict(scope=scope, value='', where='bot IN (3, 4)', params=[], title='删除本人与测试访问',
                    label='全部本人与测试访问记录')
    if scope == 'all':
        return dict(scope=scope, value='', where='1 = 1', params=[], title='清空全部访问统计', label='全部访问统计数据')
    abort(400, description='未知的清理范围。')


def safe_return(value, fallback):
    if isinstance(value, str) and value.startswith('/admin/analytics') and '//' not in value and len(value) < 2000 \
            and not any(ord(c) < 32 for c in value):
        return value
    return fallback


@admin.post('/analytics/delete/preview')
def analytics_delete_preview():
    plan = deletion_plan(request.form)
    counts = store().deletion_counts(plan['where'], tuple(plan['params']))
    if not counts['pageviews']:
        flash('没有符合条件的访问记录，未作更改。')
        return redirect(safe_return(request.form.get('return_to'), url_for('admin.analytics_data')))
    token = serializer().dumps(dict(uid=current_user.id, scope=plan['scope'], value=plan['value'],
                                    counts=counts, return_to=safe_return(request.form.get('return_to'),
                                                                         url_for('admin.analytics_data'))))
    return render('admin/analytics/confirm.html', analytics_page='data', plan=plan, counts=counts, token=token)


@admin.post('/analytics/delete/apply')
def analytics_delete_apply():
    try:
        payload = serializer().loads(request.form.get('token', ''), max_age=600)
    except (BadData, ValueError, TypeError):
        abort(400, description='确认已过期或无效，请重新预览。')
    if not isinstance(payload, dict) or payload.get('uid') != current_user.id:
        abort(400, description='确认已失效，请重新预览。')
    plan = deletion_plan({'scope': payload.get('scope'), 'date': payload.get('value'), 'ip': payload.get('value'),
                          'visitor': payload.get('value')})
    result = store().delete_where(plan['where'], tuple(plan['params']))
    audit('analytics.delete', plan['label'], [
        dict(label='清理范围', before='—', after=plan['label']),
        dict(label='删除浏览记录', before=str(result['pageviews']), after='0'),
        dict(label='删除事件', before=str(result['events']), after='0'),
        dict(label='删除会话 / 访客', before=f"{result['sessions']} / {result['visitors']}", after='0')])
    flash(f"已删除 {result['pageviews']} 条浏览记录、{result['events']} 条事件。")
    return redirect(safe_return(payload.get('return_to'), url_for('admin.analytics_data')))


@admin.post('/analytics/ignore')
def analytics_ignore():
    ip = valid_ip(request.form.get('ip', ''))
    ignored = request.form.get('ignored') == '1'
    if not ip:
        abort(400, description='请输入有效的 IP 地址。')
    store().set_ignored(ip, ignored, request.form.get('note', ''))
    audit('analytics.ignore' if ignored else 'analytics.unignore', f'IP {ip}',
          [dict(label='统计状态', before='记录' if ignored else '不记录', after='不记录' if ignored else '记录')])
    flash(f'已{"排除" if ignored else "恢复记录"} IP {ip}。' + ('此后来自该 IP 的访问不会被记录；已有记录保留。' if ignored else ''))
    return redirect(safe_return(request.form.get('return_to'), url_for('admin.analytics_data')))


SERVER_KINDS = [('', '全部'), ('human', '浏览器'), ('cloud', '机房来源'), ('bot', '爬虫'), ('probe', '漏洞扫描'),
                ('monitor', '本站监控')]


@admin.get('/analytics/server')
def analytics_server():
    """Requests from the web server's own access log, including clients that never run JavaScript."""
    base = current_app.config.get('ANALYTICS_ACCESS_LOG') or f"/var/log/{request.host.split(':')[0]}.access.log"
    files = access_log.log_files(base)
    hits = access_log.read(base, raw_region) if files else []
    show = 'all' if request.args.get('show') == 'all' else 'pages'
    kind = request.args.get('k', '') if request.args.get('k', '') in dict(SERVER_KINDS) else ''
    status = request.args.get('st', '') if request.args.get('st', '') in ('2', '3', '4', '5') else ''
    q = request.args.get('q', '').strip()[:100]
    scope = [h for h in hits if show == 'all' or h['page']]
    rows = [h for h in scope if (not kind or h['kind'] == kind) and (not status or str(h['status'])[0] == status)
            and (not q or q in h['ip'] or q in h['path'] or q.lower() in h['ua'].lower())]
    page = page_number()
    per_page = 50
    pages = max(1, math.ceil(len(rows) / per_page))
    page = min(page, pages)
    times = [h['rt'] for h in scope if h['rt'] is not None]
    summary = dict(
        total=len(scope), first=scope[-1]['ts'] if scope else None, last=scope[0]['ts'] if scope else None,
        kinds=Counter(h['kind'] for h in scope), statuses=Counter(str(h['status'])[0] + 'xx' for h in scope),
        ips=len({h['ip'] for h in scope}), avg_ms=round(sum(times) / len(times) * 1000) if times else None,
        bots=bars([dict(name=name, count=count) for name, count in
                   Counter(h['agent'] for h in scope if h['kind'] in ('bot', 'monitor')).most_common(10)]),
        clouds=bars([dict(name=name, count=count) for name, count in
                     Counter(h['ip'] for h in scope if h['kind'] == 'cloud').most_common(8)]),
        probes=bars([dict(name=name, count=count) for name, count in
                     Counter(h['path'].split('?')[0] for h in scope if h['kind'] == 'probe').most_common(10)]),
        missing=bars([dict(name=name, count=count) for name, count in
                      Counter(h['path'].split('?')[0] for h in scope if h['status'] == 404 and h['kind'] != 'probe').most_common(10)]),
        slow=sorted((h for h in scope if h['rt'] is not None and h['kind'] == 'human'), key=lambda h: -h['rt'])[:8])
    args = {key: value for key, value in dict(show=show if show == 'all' else '', k=kind, st=status, q=q).items() if value}
    updated = max((int(p.stat().st_mtime * 1000) for p in files), default=None)
    return render('admin/analytics/server.html', analytics_page='server', base=base, files=files, summary=summary,
                  updated=updated, stale=bool(updated and now_ms() - updated > 2 * 3_600_000),
                  rows=rows[(page - 1) * per_page: page * per_page], result=dict(page=page, pages=pages, total=len(rows)),
                  show=show, kind=kind, status=status, q=q, args=args, server_kinds=SERVER_KINDS)


@admin.post('/analytics/reclassify')
def analytics_reclassify():
    store().reclassify_all()
    counts = store().query('SELECT bot, COUNT(*) n FROM visitors GROUP BY bot')
    summary = '、'.join(f"{KINDS.get(r['bot'], r['bot'])} {r['n']}" for r in counts) or '没有访客'
    audit('analytics.reclassify', '全部访客', [dict(label='重新判断后', before='—', after=summary)])
    flash(f'已重新判断全部访客类型：{summary}。手动设置过的访客保持不变。')
    return redirect(url_for('admin.analytics_data'))


@admin.post('/analytics/kind')
def analytics_kind():
    visitor = request.form.get('visitor', '')
    value = request.form.get('kind', '')
    kind = None if value == 'auto' else int(value) if value.isdigit() and int(value) in KINDS else -1
    if kind == -1 or not store().set_kind(visitor, kind):
        abort(400, description='访客或类型无效。')
    label = '自动判断' if kind is None else KINDS[kind]
    audit('analytics.kind', f'访客 {visitor[:12]}', [dict(label='访客类型', before='—', after=label)])
    flash(f'访客类型已设为：{label}。')
    return redirect(url_for('admin.analytics_visitor', visitor_id=visitor))


@admin.post('/analytics/note')
def analytics_note():
    visitor = request.form.get('visitor', '')
    if not store().set_note(visitor, request.form.get('note', '').strip()):
        abort(404)
    audit('analytics.note', f'访客 {visitor[:12]}', [dict(label='备注', before='—', after=request.form.get('note', '')[:200] or '（清除）')])
    flash('访客备注已保存。')
    return redirect(url_for('admin.analytics_visitor', visitor_id=visitor))


PERSON_ACTIONS = {'merge': '合并为同一访客', 'detach': '拆出为单独访客', 'attach': '恢复自动关联', 'dismiss': '标记为不同访客'}
PERSON_DONE = {'merge': '已合并为同一访客。', 'detach': '已拆出为单独的访客；这条记录不再自动关联。',
               'attach': '已恢复自动关联。', 'dismiss': '已标记为不同的访客，不再提示。'}


@admin.post('/analytics/person')
def analytics_person():
    """Merge two records, take a record out of its visitor, undo that, or reject a suggestion."""
    action = request.form.get('action', '')
    visitor = request.form.get('visitor', '').strip()
    other = request.form.get('other', '').strip().lower()  # Ids are lower-case hex; pasted ones may not be.
    handlers = {'merge': lambda: store().merge(visitor, other), 'dismiss': lambda: store().dismiss(visitor, other),
                'detach': lambda: store().detach(visitor), 'attach': lambda: store().attach(visitor)}
    done = action in handlers and handlers[action]()
    if done:
        target = f'访客 {visitor[:12]}' + (f' 与 {other[:12]}' if action in ('merge', 'dismiss') else '')
        audit('analytics.person', target, [dict(label='访客归并', before='—', after=PERSON_ACTIONS[action])])
        flash(PERSON_DONE[action])
    else:
        flash('访客编号无效，或两条记录相同，未作更改。')
    fallback = url_for('admin.analytics_visitor', visitor_id=visitor) if ID.fullmatch(visitor) else url_for('admin.analytics_visitors')
    return redirect(safe_return(request.form.get('return_to'), fallback))
