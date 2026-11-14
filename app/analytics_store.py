"""Visitor analytics storage: a separate SQLite file beside the community data.

Kept apart from public-demo.sqlite so collection never waits on the community
write lock, never touches its schema, and can be cleared on its own. All times
are integer UTC milliseconds; display code converts them.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
import hashlib
from datetime import datetime, timedelta, timezone
import ipaddress
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import urlsplit

SCHEMA_VERSION = 5  # 5: unified visitors (person_id)
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
CREATE TABLE IF NOT EXISTS campaigns (
  name TEXT PRIMARY KEY, target TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS owner_marks (
  ip TEXT NOT NULL, hour INTEGER NOT NULL, PRIMARY KEY (ip, hour));
-- Unified visitors: browser records (visitors rows) joined into one person by strong links.
-- person_links: merges confirmed by the admin (a < b). person_detached: records kept out of
-- automatic links. person_dismissed: suggested pairs the admin said are different people.
CREATE TABLE IF NOT EXISTS person_links (
  a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS person_detached (visitor_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS person_dismissed (
  a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (a, b));
CREATE INDEX IF NOT EXISTS pl_b ON person_links(b);
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
# The `bot` column on every table holds the visitor type; 0 (real visitor) is the default view.
VISITOR, BOT_KIND, SUSPECT, TEST, OWNER = 0, 1, 2, 3, 4
KINDS = {VISITOR: '访客', OWNER: '本人', TEST: '测试', BOT_KIND: '机器人', SUSPECT: '疑似机器人'}
OWNER_WINDOW_HOURS = 12  # Visits from an IP within this many hours of admin activity there count as 本人.
VISITOR_COLUMNS = (('env', "TEXT NOT NULL DEFAULT ''"), ('human', 'INTEGER NOT NULL DEFAULT 0'),
                   ('kind_locked', 'INTEGER NOT NULL DEFAULT 0'), ('kind_reason', "TEXT NOT NULL DEFAULT ''"),
                   ('device_id', "TEXT NOT NULL DEFAULT ''"), ('fp', "TEXT NOT NULL DEFAULT ''"),
                   ('person_id', "TEXT NOT NULL DEFAULT ''"))
PAGEVIEW_COLUMNS = (('inputs', 'INTEGER NOT NULL DEFAULT 0'),)
PERSON_TABLES = ('sessions', 'pageviews', 'events')  # Carry a copy of person_id, like `bot`.
PERSON_COLUMN = ('person_id', "TEXT NOT NULL DEFAULT ''")
ENV_TEXT = {'cv': 16, 'pf': 40, 'langs': 80, 'gpu': 120, 'conn': 16, 'cs': 8, 'ptr': 8, 'uab': 120, 'pv': 24, 'mdl': 60,
            'arch': 16, 'al': 80, 'chua': 200, 'chp': 24, 'chm': 4}
ENV_INT = {'hc': (0, 1024), 'dm': (0, 1024), 'tp': (0, 64), 'cd': (0, 64), 'tzo': (-1000, 1000), 'pl': (0, 1000),
           'rtt': (0, 100_000), 'dl': (0, 100_000), 'h': (0, 1)}
ENV_BOOL = ('wd', 'oz', 'nc', 'hl', 'hdr', 'p3', 'rm', 'sd', 'np', 'me', 'hov')
UA_PLATFORMS = (('Windows', r'Windows'), ('macOS', r'Macintosh'), ('Android', r'Android'),
                ('Chrome OS', r'CrOS'), ('Linux', r'X11; Linux'))
EVENT_TYPES = {'click': '点击', 'outbound': '外链', 'error': '脚本错误', 'custom': '自定义'}
ID = re.compile(r'[A-Za-z0-9_-]{8,40}')
BOT = re.compile(r'bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|python|curl|wget|'
                 r'httpclient|java/|go-http|okhttp|scrapy|phantom|selenium|puppeteer|playwright|'
                 r'bingpreview|facebookexternalhit|embedly|monitor|uptime|google-|googleother|-google|'
                 r'inspectiontool|validator|scanner|zgrab|censys|masscan|nuclei|liss-ops|lychee', re.I)
DATACENTER = re.compile(r'amazon|亚马逊|\baws\b|google|谷歌|microsoft|微软|azure|阿里云|alibaba|aliyun|腾讯云|tencent|'
                        r'digitalocean|linode|akamai|\bovh|hetzner|vultr|choopa|oracle|甲骨文|cloudflare|m247|'
                        r'datacamp|cdn77|leaseweb|contabo|scaleway|ionos|colocrossing|psychz|quadranet|'
                        r'数据中心|机房', re.I)


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


def agent_name(ua: str) -> str:
    """Best short name for an automated client: Googlebot, liss-ops-uptime, python-requests, curl ..."""
    if not ua:
        return ''
    match = re.search(r'([A-Za-z][\w.-]*?(?:bot|spider|crawler|fetcher|checker|monitor|preview|inspectiontool|scanner))\b',
                      ua, re.I)
    if match:
        return match.group(1)[:40]
    match = re.search(r'compatible;\s*([^;/)]+)', ua)
    if match:
        return match.group(1).strip()[:40]
    if 'HeadlessChrome' in ua:
        return 'HeadlessChrome'
    if not ua.startswith('Mozilla/'):
        return re.split(r'[/\s;(]', ua.strip('"\' '), maxsplit=1)[0][:40]
    return ''


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
        name = agent_name(text)
        browser = '机器人' + (' · ' + name if name else '')
    device = ('机器人' if bot else '平板' if re.search(r'iPad|Tablet|Tab(?!le)|Android(?!.*Mobile)', text)
              else '手机' if re.search(r'Mobi|iPhone|Android', text) else '电脑')
    return dict(browser=browser[:40], os=os_name[:40], device=device, bot=int(bot))


def parse_env(raw) -> dict:
    """Browser signals sent by the tracker (ctx.env) or read from request headers; unknown keys are dropped."""
    if not isinstance(raw, dict):
        return {}
    env = {}
    for key, limit in ENV_TEXT.items():
        if isinstance(raw.get(key), str) and raw[key]:
            env[key] = clip(raw[key], limit)
    for key, (low, high) in ENV_INT.items():
        if raw.get(key) is not None and not isinstance(raw.get(key), bool):
            value = as_int(raw.get(key), low, high)
            if value is not None:
                env[key] = value
    for key in ENV_BOOL:
        if isinstance(raw.get(key), bool):
            env[key] = raw[key]
    return env


def header_env(headers) -> dict:
    """What the browser says about itself in request headers (beacons carry them too)."""
    get = headers.get
    return parse_env({'h': 1, 'al': get('Accept-Language', ''), 'chua': get('Sec-CH-UA', ''),
                      'chp': get('Sec-CH-UA-Platform', '').strip('"'), 'chm': get('Sec-CH-UA-Mobile', '')})


def refine_os(os_name: str, env: dict) -> str:
    """Client hints know what the User-Agent hides: Windows 11 vs 10, macOS version."""
    version = env.get('pv') or ''
    major = as_int(version.split('.')[0]) if version else None
    if os_name.startswith('Windows 10') and major is not None and env.get('chp', 'Windows') == 'Windows':
        return 'Windows 11' if major >= 13 else 'Windows 10'
    if os_name == 'macOS' and version and env.get('chp', 'macOS') == 'macOS':
        return 'macOS ' + '.'.join(version.split('.')[:2])
    return os_name


def fingerprint(visitor: dict) -> str:
    """Hash of hardware / setup signals. Equal values suggest (not prove) the same device: identical
    phone models with the same settings collide. Empty when the tracker sent no device signals."""
    try:
        env = json.loads(visitor.get('env') or '{}')
    except ValueError:
        env = {}
    if not env.get('gpu') and 'hc' not in env:
        return ''
    parts = [visitor.get('ua') or '', visitor.get('screen') or '', visitor.get('tz') or ''] + \
            [str(env.get(k, '')) for k in ('gpu', 'hc', 'dm', 'tp', 'langs', 'pf', 'cd', 'mdl', 'pv', 'cv')]
    return hashlib.sha1('|'.join(parts).encode('utf-8')).hexdigest()[:16]


CARRIER = re.compile(r'电信|联通|移动|铁通|广电|教育网|鹏博士|长城宽带|telecom|unicom|mobile|cellular|wireless|broadband|'
                     r'cable|\bTM\b|telekom|maxis|celcom|digi|unifi|singtel|starhub|softbank|kddi|ntt|docomo|comcast|'
                     r'verizon|at&t|t-mobile|vodafone|orange|chunghwa|hinet|pccw|hkbn|smartone|csl|china', re.I)
# Time zones and the region names an IP in that country gets from ip2region (Chinese or English).
TZ_COUNTRY = {
    ('Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi'): ('中国',),
    ('Asia/Hong_Kong',): ('香港', 'Hong Kong'), ('Asia/Taipei',): ('台湾', 'Taiwan'), ('Asia/Macau',): ('澳门', 'Macau', 'Macao'),
    ('Asia/Kuala_Lumpur', 'Asia/Kuching'): ('马来西亚', 'Malaysia'), ('Asia/Singapore',): ('新加坡', 'Singapore'),
    ('Asia/Tokyo',): ('日本', 'Japan'), ('Asia/Seoul',): ('韩国', 'Korea'), ('Asia/Bangkok',): ('泰国', 'Thailand'),
    ('Asia/Jakarta',): ('印度尼西亚', 'Indonesia'), ('Asia/Manila',): ('菲律宾', 'Philippines'),
    ('Asia/Ho_Chi_Minh', 'Asia/Saigon'): ('越南', 'Vietnam', 'Viet Nam'), ('Asia/Kolkata', 'Asia/Calcutta'): ('印度', 'India'),
    ('America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
     'America/Anchorage', 'Pacific/Honolulu'): ('美国', 'United States'),
    ('America/Toronto', 'America/Vancouver'): ('加拿大', 'Canada'), ('America/Sao_Paulo',): ('巴西', 'Brazil'),
    ('Europe/London',): ('英国', 'United Kingdom'), ('Europe/Amsterdam',): ('荷兰', 'Netherlands'),
    ('Europe/Berlin',): ('德国', 'Germany'), ('Europe/Paris',): ('法国', 'France'),
    ('Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth'): ('澳大利亚', 'Australia'),
}
GREATER_CHINA_SPECIAL = ('香港', '台湾', '澳门', 'Hong Kong', 'Taiwan', 'Macau', 'Macao')


# Cloud ranges ip2region labels only by place (e.g. Tencent Cloud's Hong Kong blocks show as "中国|香港").
CLOUD_NETS = tuple(ipaddress.ip_network(n) for n in (
    '43.128.0.0/10', '49.51.0.0/16', '101.32.0.0/16', '119.28.0.0/16', '129.226.0.0/16', '150.109.0.0/16',
    '162.62.0.0/16', '170.106.0.0/16'))  # Tencent Cloud overseas


def in_cloud_net(ip: str) -> bool:
    try:
        address = ipaddress.ip_address(ip or '')
    except ValueError:
        return False
    return address.version == 4 and any(address in net for net in CLOUD_NETS)


def network_type(region: str, ip: str = '') -> str:
    """'dc' for cloud / hosting, 'isp' for consumer carriers, '' when unknown."""
    if ip and in_cloud_net(ip):
        return 'dc'
    if not region or region in ('本机', '内网'):
        return ''
    if DATACENTER.search(region):
        return 'dc'
    isp = (region.split('|') + ['', '', '', ''])[3] if '|' in region else ''
    return 'isp' if isp not in ('', '0') and CARRIER.search(isp) else ''


def tz_matches_region(tz: str, region: str):
    """True / False when the browser time zone does / does not fit the IP's country; None when unknown."""
    if not tz or not region or '|' not in region:
        return None
    country = region.split('|')[0]
    for zones, names in TZ_COUNTRY.items():
        if tz in zones:
            if names == ('中国',):
                return '中国' in country and not any(x in region for x in GREATER_CHINA_SPECIAL)
            return any(name in region for name in names)
    return None


def signals(visitor: dict, region: str = '') -> dict:
    """Every observation about a visitor: strong / weak signs of automation, signs of a real person, hints."""
    ua = visitor.get('ua') or ''
    try:
        env = json.loads(visitor.get('env') or '{}')
    except ValueError:
        env = {}
    strong, weak, good, info = [], [], [], []
    gpu = env.get('gpu', '')
    if env.get('wd'):
        strong.append('浏览器自报被自动化控制（webdriver）')
    if re.search(r'swiftshader|llvmpipe|softpipe|mesa offscreen', gpu, re.I):
        strong.append('软件渲染，没有真实显卡')
    elif gpu:
        good.append(f'真实显卡：{gpu[:60]}')
    lang, tz, screen = visitor.get('lang') or '', visitor.get('tz') or '', visitor.get('screen') or ''
    if '@posix' in lang:
        strong.append('语言为 posix（服务器环境）')
    if screen.split('@')[0] == '800x600':
        strong.append('屏幕 800×600（无界面浏览器默认值）')
    mobile = bool(re.search(r'iPhone|iPod|Android.*Mobile|Phone;', ua))
    size = re.match(r'(\d+)x(\d+)', screen)
    if mobile and size and min(int(size.group(1)), int(size.group(2))) > 1000:
        strong.append('自称手机，屏幕却是电脑尺寸')
    if mobile and env.get('tp') == 0:
        strong.append('自称手机，却不支持触摸')
    elif mobile and env.get('tp'):
        good.append(f'支持 {env["tp"]} 点触摸，与手机标识一致')
    if ua.startswith(('"', "'")):
        strong.append('User-Agent 格式异常')
    if tz == 'Etc/Unknown':
        strong.append('时区未知')
    chua = env.get('chua', '')
    if env.get('hl') or 'headless' in chua.lower():
        strong.append('客户端提示显示为无界面浏览器')
    if env.get('oz'):  # Also true in some embedded app browsers, so only supporting evidence.
        weak.append('窗口外框尺寸为 0')
    if env.get('np'):  # Headless Chrome does this, but so does Huawei's ArkWeb on real phones.
        weak.append('通知权限状态前后矛盾')
    if chua and not re.search(r'Chrome|Chromium|Edg|OPR', ua):
        strong.append('自称非 Chromium 浏览器，却发送了 Chromium 客户端提示')
    claimed = next((name for name, pattern in UA_PLATFORMS if re.search(pattern, ua)), '')
    if env.get('chp') not in (None, '', 'Unknown') and claimed:
        if env['chp'] != claimed:
            strong.append(f'请求头系统为 {env["chp"]}，User-Agent 却是 {claimed}')
        else:
            good.append('请求头系统与 User-Agent 一致')
    if env.get('nc'):
        weak.append('Chrome 缺少 window.chrome 对象')
    if env.get('pl') == 0 and claimed in ('Windows', 'macOS', 'Linux') and 'Chrome/' in ua and 'Edg' not in ua:
        weak.append('桌面 Chrome 却没有任何插件')
    if env.get('h') and not env.get('al'):
        weak.append('请求缺少 Accept-Language')
    if tz in ('UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Etc/Universal'):
        weak.append('时区为 UTC')
    chrome = re.search(r'Chrome/(\d+)', ua)
    if chrome and int(chrome.group(1)) < 120:
        weak.append(f'Chrome {chrome.group(1)} 版本过旧')
    ios = re.search(r'(?:iPhone|CPU) OS (\d+)_', ua)
    if ios and int(ios.group(1)) <= 14:
        weak.append(f'iOS {ios.group(1)} 版本过旧')
    if 'X11; Linux' in ua and 'Android' not in ua:
        weak.append('桌面 Linux')
    net = network_type(region, visitor.get('last_ip') or '')
    if net == 'dc':
        weak.append('IP 属于云服务器 / 机房')
    elif net == 'isp':
        good.append('IP 属于运营商网络（家庭宽带或手机网络）')
    if visitor.get('human'):
        good.append('有真人操作（移动鼠标、触摸、滚轮或按键）')
    match = tz_matches_region(tz, region)
    if match is True:
        good.append('时区与 IP 所在地一致')
    elif match is False:
        info.append(f'时区 {tz} 与 IP 所在地不一致，可能在使用代理或 VPN')
    return dict(strong=strong, weak=weak, good=good, info=info, env=env,
                automation=bool(BOT.search(ua)) or not ua, proxy=match is False, net=net)


def classify(visitor: dict, *, owner=False, region='', linked_me=False) -> tuple[int, list[str]]:
    """Visitor type and the reasons, from what the visitor row recorded."""
    ua = visitor.get('ua') or ''
    found = signals(visitor, region)
    strong, weak, env, automation = found['strong'], found['weak'], found['env'], found['automation']
    if 'Claude/' in ua:
        return TEST, ['Claude 应用内置浏览器']
    if env.get('me') and not owner:
        owner, owner_reason = True, '此浏览器已标记为本人'
    elif linked_me and not owner:
        owner, owner_reason = True, '同一访客的其他记录已标记为本人'
    else:
        owner_reason = f'与后台登录同一 IP（前后 {OWNER_WINDOW_HOURS} 小时内）'
    if owner:
        if automation or strong:
            return TEST, ['来自本人 IP 的自动化访问'] + strong[:2]
        return OWNER, [owner_reason]
    if automation:
        return BOT_KIND, ['User-Agent 自报为爬虫或自动化工具']
    if strong or (len(weak) >= 2 and not visitor.get('human')):
        return SUSPECT, strong + weak
    return VISITOR, weak


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


def network_of(ip: str) -> str:
    """The /24 (IPv4) or /64 (IPv6) an address belongs to; '' when not an address."""
    try:
        address = ipaddress.ip_address(ip or '')
    except ValueError:
        return ''
    return str(ipaddress.ip_network(f'{address}/{24 if address.version == 4 else 64}', strict=False))


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
        self.region = None  # Optional ip -> region string callable (ip2region), set by install().

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
                    columns = {row[1] for row in connection.execute('PRAGMA table_info(visitors)')}
                    for name, spec in VISITOR_COLUMNS:
                        if name not in columns:
                            connection.execute(f'ALTER TABLE visitors ADD COLUMN {name} {spec}')
                    connection.execute('CREATE INDEX IF NOT EXISTS vi_device ON visitors(device_id)')
                    connection.execute('CREATE INDEX IF NOT EXISTS vi_fp ON visitors(fp)')
                    columns = {row[1] for row in connection.execute('PRAGMA table_info(pageviews)')}
                    for name, spec in PAGEVIEW_COLUMNS:
                        if name not in columns:
                            connection.execute(f'ALTER TABLE pageviews ADD COLUMN {name} {spec}')
                    for table in PERSON_TABLES:
                        if PERSON_COLUMN[0] not in {row[1] for row in connection.execute(f'PRAGMA table_info({table})')}:
                            connection.execute(f'ALTER TABLE {table} ADD COLUMN {PERSON_COLUMN[0]} {PERSON_COLUMN[1]}')
                    for table in PERSON_TABLES + ('visitors',):
                        connection.execute(f'CREATE INDEX IF NOT EXISTS {table[:2]}_person ON {table}(person_id)')
                    connection.execute('CREATE INDEX IF NOT EXISTS vi_user ON visitors(user_id)')
                    connection.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('created_at', ?)", (str(now_ms()),))
                    version = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
                    if version is None or int(version[0]) < SCHEMA_VERSION:
                        self._relink(connection)  # Rows written before unified visitors have no person_id.
                        self._reclassify(connection)  # Rows written before types existed only knew bot / not bot.
                        connection.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema', ?)",
                                           (str(SCHEMA_VERSION),))
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

    def ingest(self, payload: dict, *, ip: str, ua: str, own_hosts=(), server_now=None, headers=None,
               device_id: str = '', device_fresh: bool = False) -> dict:
        """Record one tracker batch. Returns a small status dict; never raises on bad input.
        `device_fresh` means the browser did not send the device cookie and `device_id` was just
        minted: it is stored only for a record that has none yet (Safari / Firefox drop the cookie on
        github.io, and a new id on every batch would break the link to the earlier one)."""
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
        env = parse_env(ctx.get('env'))
        if headers is not None:
            env.update(header_env(headers))
        human = 1 if page.get('hi') is True else 0
        inputs = as_int(page.get('inp'), 0, 100_000) or 0
        device_id = device_id if ID.fullmatch(device_id or '') else ''
        ua = clip(ua, 400)
        with self.connect() as db:
            visitor = db.execute('SELECT bot, env, device_id, user_id FROM visitors WHERE id=?', (vid,)).fetchone()
            if visitor is not None and env:
                try:  # Keep signals from earlier batches (client hints arrive later than the first beacon).
                    env = {**json.loads(visitor['env'] or '{}'), **env}
                except ValueError:
                    pass
            env_json = json.dumps(env, ensure_ascii=False, sort_keys=True) if env else None
            info['os'] = refine_os(info['os'], env)
            if visitor is None:
                kind = classify(dict(ua=ua, lang=lang, tz=tz, screen=screen, env=env_json, human=human),
                                region=self._region(ip))[0]
                db.execute('INSERT INTO visitors (id, first_seen, last_seen, first_ip, last_ip, ua, browser, os, device, bot, '
                           'lang, tz, screen, user_id, username, env, human, device_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (vid, server_now, server_now, ip, ip, ua, info['browser'], info['os'], info['device'],
                            kind, lang, tz, screen, user_id, username, env_json or '', human, device_id))
                relink = True
            else:
                kind = visitor['bot']
                if device_fresh and visitor['device_id']:
                    device_id = ''  # Keep the stored id; this one was minted for a browser that drops the cookie.
                relink = bool(device_id and device_id != visitor['device_id']) or \
                    bool(user_id and user_id != visitor['user_id'])
                db.execute('UPDATE visitors SET last_seen=?, last_ip=?, ua=?, browser=?, os=?, device=?, '
                           'lang=COALESCE(?, lang), tz=COALESCE(?, tz), '
                           'screen=COALESCE(?, screen), user_id=COALESCE(?, user_id), '
                           'username=COALESCE(?, username), env=COALESCE(?, env), human=MAX(human, ?), '
                           'device_id=COALESCE(?, device_id) WHERE id=?',
                           (server_now, ip, ua, info['browser'], info['os'], info['device'],
                            lang or None, tz or None, screen or None, user_id, username or None, env_json, human,
                            device_id or None, vid))
            if relink:
                self._relink(db, [vid])
            person = db.execute('SELECT person_id FROM visitors WHERE id=?', (vid,)).fetchone()[0] or vid
            session = db.execute('SELECT id, visitor_id FROM sessions WHERE id=?', (sid,)).fetchone()
            if session is not None and session['visitor_id'] != vid:
                return {'stored': False, 'reason': 'session-owner'}
            if session is None:
                referrer = clip(payload.get('sref'), 600)
                landing = clip(payload.get('landing') or page.get('path'), 600)
                db.execute('INSERT INTO sessions (id, visitor_id, site, started_at, last_seen, ip, ua, browser, os, device, bot, '
                           'referrer, referrer_host, landing, utm, lang, tz, screen, user_id, username, person_id) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (sid, vid, site, server_now, server_now, ip, ua, info['browser'], info['os'], info['device'],
                            kind, referrer, referrer_host(referrer, own_hosts), landing,
                            clip(payload.get('utm'), 200), lang, tz, screen, user_id, username, person))
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
                           'started_at, last_seen, active_ms, total_ms, scroll, viewport, ttfb_ms, dom_ms, load_ms, ended, inputs, person_id) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (page['id'], sid, vid, site, ip, kind, url, path, clip(page.get('title'), 300),
                            clip(page.get('ref'), 600), started, server_now, values['active'], values['total'],
                            values['scroll'], clip(page.get('vp'), 24), values['ttfb'], values['dom'], values['load'],
                            1 if page.get('end') else 0, inputs, person))
            else:
                db.execute('UPDATE pageviews SET last_seen=?, active_ms=MAX(active_ms, ?), total_ms=MAX(total_ms, ?), '
                           'scroll=MAX(scroll, ?), ttfb_ms=COALESCE(ttfb_ms, ?), dom_ms=COALESCE(dom_ms, ?), '
                           'load_ms=COALESCE(load_ms, ?), ended=MAX(ended, ?), inputs=MAX(inputs, ?), '
                           'title=CASE WHEN length(title)=0 THEN ? ELSE title END WHERE id=?',
                           (server_now, values['active'], values['total'], values['scroll'], values['ttfb'],
                            values['dom'], values['load'], 1 if page.get('end') else 0, inputs,
                            clip(page.get('title'), 300), page['id']))
            path = db.execute('SELECT path FROM pageviews WHERE id=?', (page['id'],)).fetchone()['path']
            events = payload.get('ev') if isinstance(payload.get('ev'), list) else []
            stored_events = clicks = 0
            existing = db.execute('SELECT COUNT(*) FROM events WHERE pageview_id=?', (page['id'],)).fetchone()[0]
            for event in events[:100]:
                if existing + stored_events >= 500 or not isinstance(event, dict):
                    break
                etype = event.get('type')
                if etype not in EVENT_TYPES:
                    continue
                ts = (as_int(event.get('t'), 0, 10**14) or client_now) + offset
                ts = max(server_now - 86_400_000, min(server_now, ts))
                data = event.get('data')
                data = clip(json.dumps(data, ensure_ascii=False, separators=(',', ':')), 1500) if isinstance(data, (dict, list)) else clip(data, 1500)
                db.execute('INSERT INTO events (pageview_id, session_id, visitor_id, site, ip, bot, ts, type, label, target, href, path, x, y, data, person_id) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (page['id'], sid, vid, site, ip, kind, ts, etype, clip(event.get('label'), 200),
                            clip(event.get('target'), 200), clip(event.get('href'), 600), path,
                            as_int(event.get('x'), -100000, 1000000), as_int(event.get('y'), -100000, 10000000), data, person))
                stored_events += 1
                clicks += etype in {'click', 'outbound'}
            if clicks:
                db.execute('UPDATE pageviews SET clicks=clicks+? WHERE id=?', (clicks, page['id']))
            self._reclassify(db, [vid])
        return {'stored': True, 'events': stored_events}

    # ----------------------------------------------------------- visitor types
    def _region(self, ip: str) -> str:
        try:
            return self.region(ip) if self.region and ip else ''
        except Exception:
            return ''

    def _reclassify(self, db, visitor_ids=None):
        """Recompute the type of the given visitors (all when None) and copy it onto their rows.
        Records of one unified visitor (same device cookie, same community account or merged by the
        admin) share owner evidence, so they are recomputed together."""
        if visitor_ids is None:
            rows = db.execute('SELECT * FROM visitors').fetchall()
        else:
            ids = list(dict.fromkeys(visitor_ids))
            if not ids:
                return
            marks = ','.join('?' * len(ids))
            persons = [r[0] for r in db.execute(f"SELECT DISTINCT person_id FROM visitors WHERE id IN ({marks}) "
                                                f"AND person_id <> ''", ids)]
            if persons:
                ids += [r[0] for r in db.execute(f'SELECT id FROM visitors WHERE person_id IN ({",".join("?" * len(persons))})',
                                                 persons)]
                ids = list(dict.fromkeys(ids))
            rows = db.execute(f'SELECT * FROM visitors WHERE id IN ({",".join("?" * len(ids))})', ids).fetchall()
        window = OWNER_WINDOW_HOURS
        evidence = {}  # Owner evidence is shared by a unified visitor's records: look it up once per visitor.
        for row in rows:
            visitor = dict(row)
            fp = fingerprint(visitor)
            if fp != visitor['fp']:
                db.execute('UPDATE visitors SET fp=? WHERE id=?', (fp, visitor['id']))
            if visitor['kind_locked']:
                kind, reason = visitor['bot'], visitor['kind_reason'] or '手动设置'
            else:
                key, column = (visitor['person_id'], 'person_id') if visitor['person_id'] else (visitor['id'], 'visitor_id')
                if key not in evidence:
                    owner = db.execute('SELECT 1 FROM pageviews p JOIN owner_marks o ON o.ip = p.ip '
                                       f'AND o.hour BETWEEN p.started_at / 3600000 - {window} AND p.started_at / 3600000 + {window} '
                                       f'WHERE p.{column} = ? LIMIT 1', (key,)).fetchone() is not None
                    marked = {r[0] for r in db.execute(f"SELECT id FROM visitors WHERE {'person_id' if column == 'person_id' else 'id'} = ? "
                                                       'AND env LIKE ?', (key, '%"me": true%'))}
                    evidence[key] = (owner, marked)
                owner, marked = evidence[key]
                linked_me = bool(marked - {visitor['id']})
                kind, reasons = classify(visitor, owner=owner, region=self._region(visitor['last_ip']), linked_me=linked_me)
                reason = '；'.join(reasons)
            if kind != visitor['bot'] or reason != visitor['kind_reason']:
                db.execute('UPDATE visitors SET bot=?, kind_reason=? WHERE id=?', (kind, reason, visitor['id']))
            for table in ('sessions', 'pageviews', 'events'):
                db.execute(f'UPDATE {table} SET bot=? WHERE visitor_id=? AND bot<>?', (kind, visitor['id'], kind))

    def reclassify_all(self):
        with self.connect() as db:
            self._reclassify(db)

    # --------------------------------------------------------- unified visitors
    # A visitors row is one browser record (random id in that site's storage). Records are joined
    # into one unified visitor (person_id) only by strong links: the same device cookie (one browser
    # on the community and on github.io), the same community account, or a merge confirmed by the
    # admin. IP addresses never join records on their own: carrier NAT and shared Wi-Fi put strangers
    # behind one address. person_id is the record seen first, so it stays put as records join.
    @staticmethod
    def _component(db, start, detached):
        seen, todo = {start}, [start]
        while todo:
            vid = todo.pop()
            found = []
            if vid not in detached:
                row = db.execute('SELECT device_id, user_id FROM visitors WHERE id=?', (vid,)).fetchone()
                if row is not None and row['device_id']:
                    found += [r[0] for r in db.execute('SELECT id FROM visitors WHERE device_id=?', (row['device_id'],))]
                if row is not None and row['user_id']:
                    found += [r[0] for r in db.execute('SELECT id FROM visitors WHERE user_id=?', (row['user_id'],))]
                found = [other for other in found if other not in detached]
            found += [r[0] for r in db.execute('SELECT b FROM person_links WHERE a=? UNION SELECT a FROM person_links WHERE b=?',
                                               (vid, vid))]
            for other in found:
                if other not in seen:
                    seen.add(other)
                    todo.append(other)
        return seen

    def _relink(self, db, seeds=None) -> list[str]:
        """Recompute person_id for the groups of `seeds` (every record when None); returns moved records."""
        detached = {r[0] for r in db.execute('SELECT visitor_id FROM person_detached')}
        if seeds is None:
            pending = [r[0] for r in db.execute('SELECT id FROM visitors')]
        else:
            pending = list(dict.fromkeys(seeds))
            if not pending:
                return []
            # A record leaving a group can split it, so everyone who shared its person is recomputed.
            olds = [r[0] for r in db.execute(f"SELECT DISTINCT person_id FROM visitors WHERE id IN ({','.join('?' * len(pending))}) "
                                             "AND person_id <> ''", pending)]
            if olds:
                pending += [r[0] for r in db.execute(f"SELECT id FROM visitors WHERE person_id IN ({','.join('?' * len(olds))})", olds)]
        done, moved_all = set(), []
        for start in pending:
            if start in done:
                continue
            group = self._component(db, start, detached)
            done |= group
            ids = list(group)
            rows = db.execute(f"SELECT id, first_seen, person_id FROM visitors WHERE id IN ({','.join('?' * len(ids))})",
                              ids).fetchall()
            if not rows:
                continue
            person = min(rows, key=lambda r: (r['first_seen'], r['id']))['id']
            moved = [r['id'] for r in rows if r['person_id'] != person]
            if not moved:
                continue
            marks = ','.join('?' * len(moved))
            db.execute(f'UPDATE visitors SET person_id=? WHERE id IN ({marks})', (person, *moved))
            for table in PERSON_TABLES:
                db.execute(f'UPDATE {table} SET person_id=? WHERE visitor_id IN ({marks})', (person, *moved))
            moved_all += moved
        return moved_all

    def relink_all(self):
        with self.connect() as db:
            self._relink(db)
            self._reclassify(db)

    def _members(self, db, ids):
        persons = {r[0] for r in db.execute(f"SELECT person_id FROM visitors WHERE id IN ({','.join('?' * len(ids))})", ids)}
        persons.discard('')
        if not persons:
            return list(ids)
        return list(dict.fromkeys(list(ids) + [r[0] for r in db.execute(
            f"SELECT id FROM visitors WHERE person_id IN ({','.join('?' * len(persons))})", list(persons))]))

    def _exist(self, db, *ids) -> bool:
        return all(ID.fullmatch(i or '') for i in ids) and \
            db.execute(f"SELECT COUNT(*) FROM visitors WHERE id IN ({','.join('?' * len(ids))})", ids).fetchone()[0] == len(set(ids))

    def merge(self, first: str, second: str) -> bool:
        """Admin-confirmed: these two records belong to the same person."""
        if first == second:
            return False
        a, b = sorted((first, second))
        with self.connect() as db:
            if not self._exist(db, a, b):
                return False
            db.execute('INSERT OR IGNORE INTO person_links (a, b, created_at) VALUES (?,?,?)', (a, b, now_ms()))
            db.execute('DELETE FROM person_dismissed WHERE a=? AND b=?', (a, b))
            self._relink(db, [a, b])
            self._reclassify(db, self._members(db, [a, b]))
        return True

    def detach(self, visitor_id: str) -> bool:
        """Take one record out of its unified visitor (drops its merges and automatic links)."""
        with self.connect() as db:
            if not self._exist(db, visitor_id):
                return False
            before = self._members(db, [visitor_id])
            db.execute('DELETE FROM person_links WHERE a=? OR b=?', (visitor_id, visitor_id))
            db.execute('INSERT OR REPLACE INTO person_detached (visitor_id, created_at) VALUES (?,?)', (visitor_id, now_ms()))
            self._relink(db, before)
            self._reclassify(db, before)
        return True

    def attach(self, visitor_id: str) -> bool:
        """Undo detach: automatic links apply to this record again."""
        with self.connect() as db:
            if not self._exist(db, visitor_id):
                return False
            db.execute('DELETE FROM person_detached WHERE visitor_id=?', (visitor_id,))
            self._relink(db, [visitor_id])
            self._reclassify(db, self._members(db, [visitor_id]))
        return True

    def dismiss(self, first: str, second: str) -> bool:
        """Admin says a suggested pair are different people; the suggestion is not shown again."""
        if first == second:
            return False
        a, b = sorted((first, second))
        with self.connect() as db:
            if not self._exist(db, a, b):
                return False
            db.execute('INSERT OR IGNORE INTO person_dismissed (a, b, created_at) VALUES (?,?,?)', (a, b, now_ms()))
        return True

    def person_members(self, person_id: str) -> list[dict]:
        """Records of one unified visitor, newest first, each with why it belongs to the group."""
        with self.connect() as db:
            rows = [dict(r) for r in db.execute(
                'SELECT v.*, (SELECT GROUP_CONCAT(DISTINCT site) FROM pageviews WHERE visitor_id = v.id) sites, '
                '(SELECT COUNT(*) FROM pageviews WHERE visitor_id = v.id) pv FROM visitors v WHERE v.person_id = ? '
                'ORDER BY v.last_seen DESC', (person_id,))]
            detached = {r[0] for r in db.execute('SELECT visitor_id FROM person_detached')}
            ids = [r['id'] for r in rows]
            links = db.execute(f"SELECT a, b FROM person_links WHERE a IN ({','.join('?' * len(ids))}) "
                               f"OR b IN ({','.join('?' * len(ids))})", ids + ids).fetchall() if ids else []
        manual = {x for link in links for x in link}
        for row in rows:
            row['detached'] = row['id'] in detached
        for row in rows:
            reasons = []
            if not row['detached']:
                others = [r for r in rows if r['id'] != row['id'] and not r['detached']]
                if row['device_id'] and any(r['device_id'] == row['device_id'] for r in others):
                    reasons.append('同一浏览器（设备标识）')
                if row['user_id'] and any(r['user_id'] == row['user_id'] for r in others):
                    reasons.append('同一社区账号')
            if row['id'] in manual:
                reasons.append('手动合并')
            row['reasons'] = reasons
        return rows

    def suggestions(self, person_id: str = '', limit: int = 50, strict: bool = True) -> list[dict]:
        """Records in different unified visitors with the same hardware fingerprint. With `strict`, only
        pairs that also used the same IP or network (/24, IPv6 /64); identical phones share a fingerprint,
        so these are offered for the admin to confirm, never merged automatically."""
        with self.connect() as db:
            sql = ("SELECT a.id ai, b.id bi, a.person_id ap, b.person_id bp, MAX(a.last_seen, b.last_seen) last "
                   "FROM visitors a JOIN visitors b ON b.fp = a.fp AND b.person_id <> a.person_id "
                   "WHERE a.fp <> '' AND a.bot NOT IN (1, 2) AND b.bot NOT IN (1, 2) "
                   "AND NOT EXISTS (SELECT 1 FROM person_dismissed d JOIN visitors x ON x.id = d.a JOIN visitors y ON y.id = d.b "
                   "WHERE (x.person_id = a.person_id AND y.person_id = b.person_id) "
                   "OR (x.person_id = b.person_id AND y.person_id = a.person_id)) ")
            params = []
            if person_id:
                sql += 'AND a.person_id = ? '
                params.append(person_id)
            else:
                sql += 'AND a.person_id < b.person_id '
            pairs = db.execute(sql + 'ORDER BY last DESC LIMIT 2000', params).fetchall()
            ips = {}
            def addresses(vid):
                if vid not in ips:
                    ips[vid] = {r[0] for r in db.execute('SELECT DISTINCT ip FROM pageviews WHERE visitor_id=? AND ip<>?', (vid, ''))}
                return ips[vid]
            best = {}
            for pair in pairs:
                left, right = addresses(pair['ai']), addresses(pair['bi'])
                shared = sorted(left & right)
                if shared:
                    level, label = 2, '同一 IP'
                else:
                    nets = {network_of(ip) for ip in left} & {network_of(ip) for ip in right}
                    nets.discard('')
                    level, label = (1, '同一网段') if nets else (0, '仅硬件相同')
                if strict and level == 0:
                    continue
                key = (pair['ap'], pair['bp'])
                if key not in best or level > best[key]['level']:
                    best[key] = dict(a=pair['ai'], b=pair['bi'], person_a=pair['ap'], person_b=pair['bp'], level=level,
                                     label=label, shared=shared[:3], last=pair['last'])
        found = sorted(best.values(), key=lambda s: (-s['level'], -s['last']))
        return found[:limit]

    def mark_owner(self, ip: str, when=None) -> bool:
        """Remember that the site owner (an administrator) used this IP now; returns True when new."""
        ip = valid_ip(ip)
        if not ip:
            return False
        hour = (when or now_ms()) // 3_600_000
        with self.connect() as db:
            if db.execute('INSERT OR IGNORE INTO owner_marks (ip, hour) VALUES (?, ?)', (ip, hour)).rowcount != 1:
                return False
            window = OWNER_WINDOW_HOURS * 3_600_000
            ids = [r[0] for r in db.execute('SELECT DISTINCT visitor_id FROM pageviews WHERE ip = ? AND started_at BETWEEN ? AND ?',
                                            (ip, hour * 3_600_000 - window, (hour + 1) * 3_600_000 + window))]
            self._reclassify(db, ids)
        return True

    def mark_owner_users(self, user_ids) -> int:
        """Treat the IPs where these (administrator) accounts were seen by the tracker as owner IPs."""
        ids = [int(i) for i in user_ids if isinstance(i, int)]
        if not ids:
            return 0
        with self.connect() as db:
            marks = db.execute(f'SELECT DISTINCT p.ip, p.started_at / 3600000 FROM pageviews p JOIN visitors v ON v.id = p.visitor_id '
                               f'WHERE v.user_id IN ({",".join("?" * len(ids))}) AND length(p.ip) > 0', ids).fetchall()
            added = sum(db.execute('INSERT OR IGNORE INTO owner_marks (ip, hour) VALUES (?, ?)', tuple(m)).rowcount for m in marks)
            if added:
                self._reclassify(db)
        return added

    def set_kind(self, visitor_id: str, kind) -> bool:
        """Pin a visitor to a type (manual correction), or None to return to automatic."""
        if not ID.fullmatch(visitor_id or '') or (kind is not None and kind not in KINDS):
            return False
        with self.connect() as db:
            if kind is None:
                changed = db.execute('UPDATE visitors SET kind_locked=0 WHERE id=?', (visitor_id,)).rowcount
            else:
                changed = db.execute('UPDATE visitors SET kind_locked=1, bot=?, kind_reason=? WHERE id=?',
                                     (kind, '手动设置', visitor_id)).rowcount
            if changed:
                self._reclassify(db, [visitor_id])
        return bool(changed)

    def kind_split(self, start: int, end: int, site: str = 'all') -> dict:
        """Visitors per type. A unified visitor counts once, under the type of its latest view in range
        (records of one visitor can differ, e.g. a test browser logged into the owner's account)."""
        sql = 'SELECT person_id, bot, MAX(last_seen) FROM pageviews WHERE started_at >= ? AND started_at < ?'
        params = [start, end]
        if site != 'all':
            sql += ' AND site = ?'
            params.append(site)
        # SQLite takes bare columns of an aggregate query from the row holding MAX().
        return {row['bot']: row['n'] for row in self.query(f'SELECT bot, COUNT(*) n FROM ({sql} GROUP BY person_id) GROUP BY bot',
                                                           params)}

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
            if visitors:  # A removed record may have been a group's first record or its only link.
                for table, columns in (('person_links', ('a', 'b')), ('person_dismissed', ('a', 'b')),
                                       ('person_detached', ('visitor_id',))):
                    for column in columns:
                        db.execute(f'DELETE FROM {table} WHERE {column} NOT IN (SELECT id FROM visitors)')
                self._relink(db)
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
def env_facts(visitor: dict) -> list[tuple[str, str]]:
    """Readable (label, value) pairs for the visitor detail page."""
    try:
        e = json.loads(visitor.get('env') or '{}')
    except ValueError:
        e = {}
    facts = []
    def add(label, value):
        if value not in (None, ''):
            facts.append((label, str(value)))
    add('设备型号', e.get('mdl'))
    if e.get('pv'):
        name = e.get('chp') or ''
        if name == 'Windows':
            name = refine_os('Windows 10/11', e)
        add('系统版本', f"{name}（平台版本 {e['pv']}）".strip())
    add('架构', e.get('arch'))
    add('平台', e.get('pf'))
    if 'hc' in e or 'dm' in e:
        add('CPU / 内存', ' · '.join(x for x in (f"{e['hc']} 核" if 'hc' in e else '', f"{e['dm']} GB" if 'dm' in e else '') if x))
    add('显卡', e.get('gpu'))
    add('指针', {'fine': '鼠标 / 触控板', 'coarse': '触摸', 'none': '无'}.get(e.get('ptr')))
    add('触摸点', e.get('tp'))
    display = [x for x, k in (('HDR', 'hdr'), ('广色域 P3', 'p3')) if e.get(k)]
    add('屏幕能力', ' · '.join(display + [f"{e['cd']} 位色深"] if 'cd' in e else display))
    add('配色', {'dark': '深色', 'light': '浅色'}.get(e.get('cs')))
    if e.get('rm'):
        add('减弱动画', '开启')
    net = ' · '.join(x for x in (e.get('conn') or '', f"延迟 {e['rtt']} ms" if 'rtt' in e else '',
                                 f"约 {e['dl']} Mbps" if 'dl' in e else '', '省流量' if e.get('sd') else '') if x)
    add('网络', net)
    add('语言列表', e.get('langs'))
    add('Accept-Language', e.get('al'))
    add('客户端提示', ' · '.join(x for x in (e.get('chua') or e.get('uab') or '', e.get('chp') or '') if x))
    add('插件数', e.get('pl'))
    if e:
        add('自动化标记', '是（webdriver）' if e.get('wd') else '否')
        if e.get('me'):
            add('本人标记', '此浏览器已标记为本人')
    return facts

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
