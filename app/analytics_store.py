"""Visitor analytics storage: a separate SQLite file beside the community data.

Kept apart from public-demo.sqlite so collection never waits on the community
write lock, never touches its schema, and can be cleared on its own. All times
are integer UTC milliseconds; display code converts them.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
import ipaddress
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import urlsplit

SCHEMA_VERSION = 1
_LOCK = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  first_ip TEXT NOT NULL DEFAULT '', last_ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '', bot INTEGER NOT NULL DEFAULT 0,
  lang TEXT NOT NULL DEFAULT '', tz TEXT NOT NULL DEFAULT '', screen TEXT NOT NULL DEFAULT '',
  user_id INTEGER, username TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, site TEXT NOT NULL,
  started_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '', bot INTEGER NOT NULL DEFAULT 0,
  referrer TEXT NOT NULL DEFAULT '', referrer_host TEXT NOT NULL DEFAULT '',
  landing TEXT NOT NULL DEFAULT '', utm TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '', tz TEXT NOT NULL DEFAULT '', screen TEXT NOT NULL DEFAULT '',
  user_id INTEGER, username TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS pageviews (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, site TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '', bot INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0, total_ms INTEGER NOT NULL DEFAULT 0,
  scroll INTEGER NOT NULL DEFAULT 0, viewport TEXT NOT NULL DEFAULT '',
  ttfb_ms INTEGER, dom_ms INTEGER, load_ms INTEGER, ended INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, pageview_id TEXT NOT NULL, session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL, site TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '',
  bot INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL, type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '', target TEXT NOT NULL DEFAULT '', href TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '', x INTEGER, y INTEGER, data TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS ignored_ips (
  ip TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pv_started ON pageviews(started_at);
CREATE INDEX IF NOT EXISTS pv_session ON pageviews(session_id);
CREATE INDEX IF NOT EXISTS pv_visitor ON pageviews(visitor_id);
CREATE INDEX IF NOT EXISTS pv_ip ON pageviews(ip);
CREATE INDEX IF NOT EXISTS pv_path ON pageviews(site, path);
CREATE INDEX IF NOT EXISTS pv_last ON pageviews(last_seen);
CREATE INDEX IF NOT EXISTS ss_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS ss_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS ss_ip ON sessions(ip);
CREATE INDEX IF NOT EXISTS ev_ts ON events(ts);
CREATE INDEX IF NOT EXISTS ev_pageview ON events(pageview_id);
CREATE INDEX IF NOT EXISTS ev_visitor ON events(visitor_id);
CREATE INDEX IF NOT EXISTS vi_last ON visitors(last_seen);
"""

SITES = {'forum': '社区', 'works': '作品站', 'atoll': '玻璃海'}
EVENT_TYPES = {'click': '点击', 'outbound': '外链', 'error': '脚本错误', 'custom': '自定义'}
ID = re.compile(r'[A-Za-z0-9_-]{8,40}')
BOT = re.compile(r'bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|python|curl|wget|'
                 r'httpclient|java/|go-http|okhttp|scrapy|phantom|selenium|puppeteer|playwright|'
                 r'bingpreview|facebookexternalhit|embedly|monitor|uptime', re.I)


def now_ms() -> int:
    return int(time.time() * 1000)


def clip(value, limit: int) -> str:
    if value is None:
        return ''
    text = str(value)
    text = ''.join(c for c in text if c >= ' ' or c in '\t')
    return text[:limit]


def as_int(value, low=0, high=10**10):
    try:
        number = int(float(value))
    except (TypeError, ValueError, OverflowError):
        return None
    return max(low, min(high, number))


def parse_ua(ua: str) -> dict:
    """Small, dependency-free classification good enough for a personal site."""
    text = ua or ''
    bot = bool(BOT.search(text)) or not text
    os_name = ('iOS' if re.search(r'iPhone|iPad|iPod', text) else
               'Android' if 'Android' in text else
               'HarmonyOS' if 'HarmonyOS' in text or 'OpenHarmony' in text else
               'Windows' if 'Windows' in text else
               'macOS' if 'Mac OS X' in text or 'Macintosh' in text else
               'ChromeOS' if 'CrOS' in text else
               'Linux' if 'Linux' in text else '其他')
    match = re.search(r'Windows NT (\d+\.\d+)', text)
    if match:
        os_name = 'Windows ' + {'10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7'}.get(match.group(1), match.group(1))
    match = re.search(r'Android (\d+)', text)
    if match:
        os_name = 'Android ' + match.group(1)
    match = re.search(r'OS (\d+)[_.]\d+.* like Mac OS X', text)
    if match:
        os_name = 'iOS ' + match.group(1)
    rules = [('微信', r'MicroMessenger/([\d.]+)'), ('QQ', r' QQ/([\d.]+)'), ('钉钉', r'DingTalk/([\d.]+)'),
             ('飞书', r'Lark/([\d.]+)|Feishu/([\d.]+)'), ('QQ浏览器', r'MQQBrowser/([\d.]+)|QQBrowser/([\d.]+)'),
             ('UC浏览器', r'UCBrowser/([\d.]+)'), ('夸克', r'Quark/([\d.]+)'), ('百度', r'baiduboxapp/([\d.]+)'),
             ('360浏览器', r'360SE|360EE|QihooBrowser'), ('搜狗浏览器', r'SE 2\.X MetaSr|SogouMobileBrowser'),
             ('华为浏览器', r'HuaweiBrowser/([\d.]+)'), ('小米浏览器', r'MiuiBrowser/([\d.]+)'),
             ('三星浏览器', r'SamsungBrowser/([\d.]+)'), ('Opera', r'OPR/([\d.]+)|Opera'),
             ('Edge', r'Edg(?:e|A|iOS)?/([\d.]+)'), ('Firefox', r'Firefox/([\d.]+)|FxiOS/([\d.]+)'),
             ('Chrome', r'Chrome/([\d.]+)|CriOS/([\d.]+)'), ('Safari', r'Version/([\d.]+).*Safari')]
    browser = '其他'
    for name, pattern in rules:
        match = re.search(pattern, text)
        if match:
            version = next((group for group in match.groups() if group), '') if match.groups() else ''
            browser = name + (' ' + version.split('.')[0] if version else '')
            break
    if bot:
        name = re.search(r'([A-Za-z][A-Za-z0-9_-]*(?:bot|spider|crawler))', text, re.I)
        browser = '机器人' + (' · ' + name.group(1) if name else '')
    device = ('机器人' if bot else '平板' if re.search(r'iPad|Tablet|Tab(?!le)|Android(?!.*Mobile)', text)
              else '手机' if re.search(r'Mobi|iPhone|Android', text) else '电脑')
    return dict(browser=browser[:40], os=os_name[:40], device=device, bot=int(bot))


def referrer_host(referrer: str, own_hosts=()) -> str:
    if not referrer:
        return ''
    try:
        host = (urlsplit(referrer).hostname or '').lower()
    except ValueError:
        return ''
    if host.startswith('www.'):
        host = host[4:]
    return '' if host in own_hosts else host[:120]


def valid_ip(value: str) -> str:
    try:
        return str(ipaddress.ip_address((value or '').strip()))
    except ValueError:
        return ''


class AnalyticsStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._ready = False
        self._ignored = None

    @contextmanager
    def connect(self):
        with _LOCK:
            connection = sqlite3.connect(self.path, timeout=10)
            connection.row_factory = sqlite3.Row
            try:
                connection.execute('PRAGMA foreign_keys=OFF')
                connection.execute('PRAGMA synchronous=NORMAL')
                if not self._ready:
                    connection.executescript(SCHEMA)
                    connection.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', ?)", (str(SCHEMA_VERSION),))
                    connection.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('created_at', ?)", (str(now_ms()),))
                    connection.commit()
                    self._ready = True
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
            finally:
                connection.close()

    # ------------------------------------------------------------------ ingest
    def ignored_ips(self) -> set[str]:
        if self._ignored is None:
            with self.connect() as db:
                self._ignored = {row['ip'] for row in db.execute('SELECT ip FROM ignored_ips')}
        return self._ignored

    def ingest(self, payload: dict, *, ip: str, ua: str, own_hosts=(), server_now=None) -> dict:
        """Record one tracker batch. Returns a small status dict; never raises on bad input."""
        server_now = server_now or now_ms()
        if not isinstance(payload, dict):
            return {'stored': False, 'reason': 'payload'}
        site = payload.get('site')
        vid, sid = payload.get('vid'), payload.get('sid')
        page = payload.get('pv') if isinstance(payload.get('pv'), dict) else None
        if site not in SITES or not all(isinstance(v, str) and ID.fullmatch(v) for v in (vid, sid)):
            return {'stored': False, 'reason': 'identity'}
        if page is None or not isinstance(page.get('id'), str) or not ID.fullmatch(page['id']):
            return {'stored': False, 'reason': 'pageview'}
        if ip in self.ignored_ips():
            return {'stored': False, 'reason': 'ignored'}
        client_now = as_int(payload.get('now'), 0, 10**14) or server_now
        offset = server_now - client_now
        ctx = payload.get('ctx') if isinstance(payload.get('ctx'), dict) else {}
        info = parse_ua(ua)
        lang, tz, screen = clip(ctx.get('lang'), 24), clip(ctx.get('tz'), 48), clip(ctx.get('screen'), 24)
        user_id = as_int(ctx.get('uid'), 1, 2**62)
        username = clip(ctx.get('uname'), 64)
        ua = clip(ua, 400)
        with self.connect() as db:
            visitor = db.execute('SELECT id FROM visitors WHERE id=?', (vid,)).fetchone()
            if visitor is None:
                db.execute('INSERT INTO visitors (id, first_seen, last_seen, first_ip, last_ip, ua, browser, os, device, bot, '
                           'lang, tz, screen, user_id, username) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (vid, server_now, server_now, ip, ip, ua, info['browser'], info['os'], info['device'],
                            info['bot'], lang, tz, screen, user_id, username))
            else:
                db.execute('UPDATE visitors SET last_seen=?, last_ip=?, ua=?, browser=?, os=?, device=?, bot=?, '
                           'lang=COALESCE(?, lang), tz=COALESCE(?, tz), '
                           'screen=COALESCE(?, screen), user_id=COALESCE(?, user_id), '
                           'username=COALESCE(?, username) WHERE id=?',
                           (server_now, ip, ua, info['browser'], info['os'], info['device'], info['bot'],
                            lang or None, tz or None, screen or None, user_id, username or None, vid))
            session = db.execute('SELECT id, visitor_id FROM sessions WHERE id=?', (sid,)).fetchone()
            if session is not None and session['visitor_id'] != vid:
                return {'stored': False, 'reason': 'session-owner'}
            if session is None:
                referrer = clip(payload.get('sref'), 600)
                landing = clip(payload.get('landing') or page.get('path'), 600)
                db.execute('INSERT INTO sessions (id, visitor_id, site, started_at, last_seen, ip, ua, browser, os, device, bot, '
                           'referrer, referrer_host, landing, utm, lang, tz, screen, user_id, username) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (sid, vid, site, server_now, server_now, ip, ua, info['browser'], info['os'], info['device'],
                            info['bot'], referrer, referrer_host(referrer, own_hosts), landing,
                            clip(payload.get('utm'), 200), lang, tz, screen, user_id, username))
            else:
                db.execute('UPDATE sessions SET last_seen=?, ip=?, user_id=COALESCE(?, user_id), '
                           'username=COALESCE(?, username) WHERE id=?',
                           (server_now, ip, user_id, username or None, sid))
            perf = page.get('perf') if isinstance(page.get('perf'), dict) else {}
            values = dict(active=as_int(page.get('active'), 0, 86_400_000) or 0,
                          total=as_int(page.get('total'), 0, 86_400_000) or 0,
                          scroll=as_int(page.get('scroll'), 0, 100) or 0,
                          ttfb=as_int(perf.get('ttfb'), 0, 600_000), dom=as_int(perf.get('dom'), 0, 600_000),
                          load=as_int(perf.get('load'), 0, 600_000))
            row = db.execute('SELECT session_id, visitor_id FROM pageviews WHERE id=?', (page['id'],)).fetchone()
            if row is not None and (row['session_id'] != sid or row['visitor_id'] != vid):
                return {'stored': False, 'reason': 'pageview-owner'}
            if row is None:
                url = clip(page.get('url'), 1000)
                path = clip(page.get('path'), 600) or (urlsplit(url).path if url else '/')
                started = server_now - min(values['total'], 86_400_000)
                db.execute('INSERT INTO pageviews (id, session_id, visitor_id, site, ip, bot, url, path, title, referrer, '
                           'started_at, last_seen, active_ms, total_ms, scroll, viewport, ttfb_ms, dom_ms, load_ms, ended) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (page['id'], sid, vid, site, ip, info['bot'], url, path, clip(page.get('title'), 300),
                            clip(page.get('ref'), 600), started, server_now, values['active'], values['total'],
                            values['scroll'], clip(page.get('vp'), 24), values['ttfb'], values['dom'], values['load'],
                            1 if page.get('end') else 0))
            else:
                db.execute('UPDATE pageviews SET last_seen=?, active_ms=MAX(active_ms, ?), total_ms=MAX(total_ms, ?), '
                           'scroll=MAX(scroll, ?), ttfb_ms=COALESCE(ttfb_ms, ?), dom_ms=COALESCE(dom_ms, ?), '
                           'load_ms=COALESCE(load_ms, ?), ended=MAX(ended, ?), '
                           'title=CASE WHEN length(title)=0 THEN ? ELSE title END WHERE id=?',
                           (server_now, values['active'], values['total'], values['scroll'], values['ttfb'],
                            values['dom'], values['load'], 1 if page.get('end') else 0,
                            clip(page.get('title'), 300), page['id']))
            path = db.execute('SELECT path FROM pageviews WHERE id=?', (page['id'],)).fetchone()['path']
            events = payload.get('ev') if isinstance(payload.get('ev'), list) else []
            stored_events = clicks = 0
            existing = db.execute('SELECT COUNT(*) FROM events WHERE pageview_id=?', (page['id'],)).fetchone()[0]
            for event in events[:100]:
                if existing + stored_events >= 500 or not isinstance(event, dict):
                    break
                kind = event.get('type')
                if kind not in EVENT_TYPES:
                    continue
                ts = (as_int(event.get('t'), 0, 10**14) or client_now) + offset
                ts = max(server_now - 86_400_000, min(server_now, ts))
                data = event.get('data')
                data = clip(json.dumps(data, ensure_ascii=False, separators=(',', ':')), 1500) if isinstance(data, (dict, list)) else clip(data, 1500)
                db.execute('INSERT INTO events (pageview_id, session_id, visitor_id, site, ip, bot, ts, type, label, target, href, path, x, y, data) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (page['id'], sid, vid, site, ip, info['bot'], ts, kind, clip(event.get('label'), 200),
                            clip(event.get('target'), 200), clip(event.get('href'), 600), path,
                            as_int(event.get('x'), -100000, 1000000), as_int(event.get('y'), -100000, 10000000), data))
                stored_events += 1
                clicks += kind in {'click', 'outbound'}
            if clicks:
                db.execute('UPDATE pageviews SET clicks=clicks+? WHERE id=?', (clicks, page['id']))
        return {'stored': True, 'events': stored_events}

    # ----------------------------------------------------------------- queries
    def query(self, sql, params=()):
        with self.connect() as db:
            return [dict(row) for row in db.execute(sql, params)]

    def scalar(self, sql, params=()):
        with self.connect() as db:
            row = db.execute(sql, params).fetchone()
            return row[0] if row else None

    def storage_stats(self) -> dict:
        size = self.path.stat().st_size if self.path.exists() else 0
        counts = {}
        with self.connect() as db:
            for table in ('visitors', 'sessions', 'pageviews', 'events', 'ignored_ips'):
                counts[table] = db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
            first = db.execute('SELECT MIN(started_at) FROM pageviews').fetchone()[0]
            last = db.execute('SELECT MAX(last_seen) FROM pageviews').fetchone()[0]
        return dict(bytes=size, first=first, last=last, **counts)

    # ---------------------------------------------------------------- mutations
    def deletion_counts(self, where: str, params: tuple) -> dict:
        """`where` filters pageviews; sessions/visitors left empty are removed too."""
        with self.connect() as db:
            pageviews = db.execute(f'SELECT COUNT(*) FROM pageviews WHERE {where}', params).fetchone()[0]
            events = db.execute(f'SELECT COUNT(*) FROM events WHERE pageview_id IN (SELECT id FROM pageviews WHERE {where})', params).fetchone()[0]
        return dict(pageviews=pageviews, events=events)

    def delete_where(self, where: str, params: tuple) -> dict:
        with self.connect() as db:
            events = db.execute(f'DELETE FROM events WHERE pageview_id IN (SELECT id FROM pageviews WHERE {where})', params).rowcount
            pageviews = db.execute(f'DELETE FROM pageviews WHERE {where}', params).rowcount
            # Orphaned events of pageviews deleted earlier, then empty sessions / visitors.
            db.execute('DELETE FROM events WHERE pageview_id NOT IN (SELECT id FROM pageviews)')
            sessions = db.execute('DELETE FROM sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM pageviews)').rowcount
            visitors = db.execute('DELETE FROM visitors WHERE id NOT IN (SELECT DISTINCT visitor_id FROM pageviews)').rowcount
        self.vacuum()
        return dict(pageviews=pageviews, events=events, sessions=sessions, visitors=visitors)

    def vacuum(self):
        with _LOCK:
            connection = sqlite3.connect(self.path, timeout=10)
            try:
                connection.execute('VACUUM')
            finally:
                connection.close()

    def set_ignored(self, ip: str, ignored: bool, note: str = '') -> bool:
        ip = valid_ip(ip)
        if not ip:
            return False
        with self.connect() as db:
            if ignored:
                db.execute('INSERT OR REPLACE INTO ignored_ips (ip, note, created_at) VALUES (?,?,?)', (ip, clip(note, 100), now_ms()))
            else:
                db.execute('DELETE FROM ignored_ips WHERE ip=?', (ip,))
        self._ignored = None
        return True

    def set_note(self, visitor_id: str, note: str) -> bool:
        if not ID.fullmatch(visitor_id or ''):
            return False
        with self.connect() as db:
            return db.execute('UPDATE visitors SET note=? WHERE id=?', (clip(note, 200), visitor_id)).rowcount == 1


# --------------------------------------------------------------------- helpers
def display_zone(offset_minutes: int):
    return timezone(timedelta(minutes=offset_minutes))


def fmt_time(ms, zone, pattern='%Y-%m-%d %H:%M:%S'):
    if not ms:
        return '—'
    return datetime.fromtimestamp(ms / 1000, zone).strftime(pattern)


def fmt_duration(ms) -> str:
    if ms is None:
        return '—'
    seconds = int(round((ms or 0) / 1000))
    if seconds < 60:
        return f'{seconds} 秒'
    minutes, seconds = divmod(seconds, 60)
    if minutes < 60:
        return f'{minutes} 分 {seconds:02d} 秒'
    hours, minutes = divmod(minutes, 60)
    return f'{hours} 小时 {minutes:02d} 分'


def fmt_bytes(size) -> str:
    size = float(size or 0)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return f'{size:.0f} {unit}' if unit == 'B' else f'{size:.1f} {unit}'
        size /= 1024
