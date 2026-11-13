"""Read the web server's own access log (PythonAnywhere writes one per web app).

The JavaScript tracker only sees visitors that run scripts. Search engine crawlers that fetch raw
HTML, uptime checks, link checkers and vulnerability scanners only show up here. Nothing is copied
into the database: the log files are parsed on demand (current file plus PythonAnywhere's rotated
copies) and the parse is cached per file version.
"""
from __future__ import annotations

from datetime import datetime
import gzip
from pathlib import Path
import re
import threading

from .analytics_store import network_type, parse_ua

LINE = re.compile(r'^(?P<peer>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] "(?P<method>[A-Z]+) (?P<path>\S+) [^"]*" (?P<status>\d{3}) '
                  r'(?P<bytes>\d+|-) "(?P<ref>[^"]*)" "(?P<ua>[^"]*)"(?: "(?P<fwd>[^"]*)")?(?: response-time=(?P<rt>[\d.]+))?')
ASSET = re.compile(r'^/(static|favicon\.ico|robots\.txt|apple-touch-icon|analytics/collect|healthz|sitemap)', re.I)
PROBE = re.compile(r'\.(php|asp|aspx|jsp|cgi|env|git|bak|sql|ini|yml|yaml|xml\.bak)\b|wp-|/admin\.|phpmyadmin|/\.well-known/'
                   r'(?!security)|/vendor/|/cgi-bin|/boaform|/HNAP1|/actuator|/solr|/owa/|/autodiscover', re.I)
OWN_MONITORS = re.compile(r'liss-ops', re.I)
MAX_LINES = 60_000
_cache: dict = {}
_lock = threading.Lock()


def log_files(base: str) -> list[Path]:
    """The current log and rotated copies, oldest first."""
    path = Path(base)
    files = [p for p in path.parent.glob(path.name + '.*') if re.fullmatch(r'\.\d+(\.gz)?', p.name[len(path.name):])]
    files.sort(key=lambda p: -int(p.name[len(path.name) + 1:].split('.')[0]))
    if path.is_file():
        files.append(path)
    return files


def _parse_file(path: Path) -> list[dict]:
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    with _lock:
        cached = _cache.get(str(path))
        if cached and cached[0] == key:
            return cached[1]
    opener = gzip.open if path.suffix == '.gz' else open
    rows = []
    with opener(path, 'rt', encoding='utf-8', errors='replace') as handle:
        for line in handle:
            match = LINE.match(line)
            if not match:
                continue
            g = match.groupdict()
            try:
                when = datetime.strptime(g['time'], '%d/%b/%Y:%H:%M:%S %z')
            except ValueError:
                continue
            ip = (g.get('fwd') or '').split(',')[0].strip() or g['peer']
            rows.append(dict(ts=int(when.timestamp() * 1000), ip=ip, method=g['method'], path=g['path'][:500],
                             status=int(g['status']), bytes=0 if g['bytes'] == '-' else int(g['bytes']),
                             ref=g['ref'][:300], ua=g['ua'][:400], rt=float(g['rt']) if g.get('rt') else None))
    with _lock:
        _cache[str(path)] = (key, rows)
    return rows


def classify_hit(hit: dict, region=None) -> str:
    """'monitor' (own checks), 'bot', 'probe' (vulnerability scanning), 'cloud' (browser-like client on a
    cloud / hosting IP: usually a disguised crawler, sometimes a VPN) or 'human'."""
    if OWN_MONITORS.search(hit['ua']):
        return 'monitor'
    if PROBE.search(hit['path']):
        return 'probe'
    if parse_ua(hit['ua'])['bot']:
        return 'bot'
    if network_type(region(hit['ip']) if region else '', hit['ip']) == 'dc':
        return 'cloud'
    return 'human'


def read(base: str, region=None) -> list[dict]:
    """All parsed requests, newest first (at most MAX_LINES)."""
    rows = []
    for path in log_files(base):
        try:
            rows.extend(_parse_file(path))
        except OSError:
            continue
    rows = rows[-MAX_LINES:]
    rows.reverse()
    for row in rows:
        if 'kind' not in row:
            row['kind'] = classify_hit(row, region)
            row['page'] = not ASSET.match(row['path'])
            agent = parse_ua(row['ua'])
            row['agent'] = agent['browser'] if row['kind'] not in ('human', 'cloud') else f"{agent['browser']} · {agent['os']}"
    return rows
