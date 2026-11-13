"""Derived views on the visitor data: source channels, share links, visit paths and engagement.

Everything here reads the same tables as the dashboards and respects the dashboard filters (time
range, site, visitor type). Nothing is stored except the list of share links an admin creates.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# A view counts as engaged when the visitor stayed 10 s, interacted, or clicked; a visit when it has
# an engaged view or reached a second page.
ENGAGED_MS = 10_000
ENGAGED_VIEW_SQL = f'(active_ms >= {ENGAGED_MS} OR inputs > 0 OR clicks > 0)'
ENGAGED_SESSIONS_SQL = (f'SELECT session_id, CASE WHEN COUNT(*) >= 2 OR MAX(active_ms) >= {ENGAGED_MS} OR MAX(inputs) > 0 '
                        f'OR SUM(clicks) > 0 THEN 1 ELSE 0 END engaged FROM pageviews GROUP BY session_id')

GROUPS = [('campaign', '分享链接'), ('search', '搜索引擎'), ('ai', 'AI 助手'), ('social', '社交与社区'),
          ('internal', '站内互跳'), ('other', '其他网站'), ('direct', '直接访问')]
GROUP_HELP = {
    'campaign': '通过你在“来源”页生成的专用链接进入，最准确。',
    'search': '从搜索结果点进来。',
    'ai': '从 ChatGPT、Perplexity 等 AI 助手给出的链接点进来。',
    'social': '从社交平台或社区点进来；微信、QQ 里打开的链接常常不带来源，按浏览器识别为“应用内打开”。',
    'internal': '在作品站和社区之间互相跳转。',
    'other': '其他网站上的链接。',
    'direct': '直接输入网址、书签，或来源被浏览器隐藏。',
}
AI = [('chatgpt.com', 'ChatGPT'), ('chat.openai.com', 'ChatGPT'), ('perplexity.ai', 'Perplexity'), ('claude.ai', 'Claude'),
      ('gemini.google', 'Gemini'), ('copilot.microsoft', 'Copilot'), ('doubao.com', '豆包'), ('kimi.', 'Kimi'),
      ('moonshot.', 'Kimi'), ('deepseek.', 'DeepSeek'), ('yuanbao.tencent', '腾讯元宝'), ('tongyi.aliyun', '通义'),
      ('poe.com', 'Poe'), ('you.com', 'You.com')]
SEARCH = [('google.', 'Google'), ('bing.com', 'Bing'), ('baidu.com', '百度'), ('sogou.com', '搜狗'), ('so.com', '360 搜索'),
          ('sm.cn', '神马'), ('yandex.', 'Yandex'), ('duckduckgo.com', 'DuckDuckGo'), ('yahoo.', 'Yahoo'),
          ('ecosia.org', 'Ecosia'), ('naver.com', 'Naver'), ('startpage.com', 'Startpage'), ('brave.com', 'Brave 搜索')]
SOCIAL = [('weixin.qq.com', '微信'), ('wx.qq.com', '微信'), ('qq.com', 'QQ'), ('zhihu.com', '知乎'), ('bilibili.com', 'B 站'),
          ('b23.tv', 'B 站'), ('weibo.', '微博'), ('douban.com', '豆瓣'), ('xiaohongshu.com', '小红书'), ('xhslink.com', '小红书'),
          ('douyin.com', '抖音'), ('x.com', 'X'), ('t.co', 'X'), ('twitter.com', 'X'), ('facebook.com', 'Facebook'),
          ('instagram.com', 'Instagram'), ('reddit.com', 'Reddit'), ('linkedin.com', 'LinkedIn'), ('youtube.com', 'YouTube'),
          ('v2ex.com', 'V2EX'), ('github.com', 'GitHub'), ('juejin.cn', '掘金'), ('csdn.net', 'CSDN'), ('t.me', 'Telegram'),
          ('telegram.', 'Telegram'), ('discord.', 'Discord'), ('news.ycombinator.com', 'Hacker News')]
OWN = {'heroliss.github.io': '作品站', 'liss.pythonanywhere.com': '社区'}
APPS = ('微信', 'QQ', '钉钉', '飞书', '百度')


def _match(host: str, table) -> str:
    """Needles ending in '.' match a label anywhere (google. -> google.com.hk); others match the domain or a subdomain."""
    for needle, name in table:
        if needle.endswith('.'):
            if host.startswith(needle) or ('.' + needle) in host:
                return name
        elif host == needle or host.endswith('.' + needle) or host.startswith(needle + '.'):
            return name
    return ''


def campaign_name(utm: str) -> str:
    params = dict(parse_qsl(utm or '', keep_blank_values=False))
    return (params.get('from') or params.get('utm_source') or params.get('ref') or '').strip()[:60]


def classify_source(host: str, utm: str = '', browser: str = '') -> tuple[str, str]:
    """(group key, readable name) for one visit."""
    name = campaign_name(utm)
    if name:
        return 'campaign', name
    host = (host or '').lower()
    if host:
        if host in OWN:
            return 'internal', '来自' + OWN[host]
        for group, table in (('ai', AI), ('search', SEARCH), ('social', SOCIAL)):
            found = _match(host, table)
            if found:
                return group, found
        return 'other', host
    app = next((a for a in APPS if (browser or '').startswith(a)), '')
    if app:
        return 'social', f'{app}（应用内打开）'
    return 'direct', '直接访问'


def channels(store, f) -> dict:
    """Visits per channel group and per source, with engaged visits, for the filtered range."""
    where, params = f.where('s')
    rows = store.query(f'SELECT s.referrer_host host, s.utm, s.browser, COUNT(*) visits, COUNT(DISTINCT s.visitor_id) visitors, '
                       f'COALESCE(SUM(e.engaged), 0) engaged, MAX(s.last_seen) last FROM sessions s '
                       f'LEFT JOIN ({ENGAGED_SESSIONS_SQL}) e ON e.session_id = s.id WHERE {where} '
                       f'GROUP BY s.referrer_host, s.utm, s.browser', params)
    groups, sources = defaultdict(lambda: Counter()), defaultdict(lambda: Counter())
    last = {}
    for row in rows:
        key = classify_source(row['host'], row['utm'], row['browser'])
        for metric in ('visits', 'visitors', 'engaged'):
            groups[key[0]][metric] += row[metric] or 0
            sources[key][metric] += row[metric] or 0
        last[key] = max(last.get(key) or 0, row['last'] or 0)
    total = sum(g['visits'] for g in groups.values()) or 0
    peak = max([g['visits'] for g in groups.values()] or [1]) or 1
    group_rows = [dict(key=key, name=label, help=GROUP_HELP[key], count=groups[key]['visits'], visitors=groups[key]['visitors'],
                       engaged=groups[key]['engaged'], share=round(groups[key]['visits'] / peak * 100, 1),
                       pct=round(groups[key]['visits'] / total * 100) if total else 0)
                  for key, label in GROUPS if groups[key]['visits']]
    source_rows = sorted((dict(group=key[0], group_name=dict(GROUPS)[key[0]], name=key[1], visits=v['visits'],
                               visitors=v['visitors'], engaged=v['engaged'], last=last.get(key))
                          for key, v in sources.items()), key=lambda r: (-r['visits'], r['name']))
    for row in source_rows:
        row['rate'] = round(row['engaged'] / row['visits'] * 100) if row['visits'] else 0
    for row in group_rows:
        row['rate'] = round(row['engaged'] / row['count'] * 100) if row['count'] else 0
    return dict(groups=group_rows, sources=source_rows, total=total)


def share_url(target: str, name: str) -> str:
    """target with ?from=name added (keeps existing query and fragment)."""
    parts = urlsplit(target)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != 'from'] + [('from', name)]
    return urlunsplit((parts.scheme, parts.netloc, parts.path or '/', urlencode(query), parts.fragment))


SITE_NAMES = {'liss', 'liss community', 'liss works', 'liss works · 工程展厅', '工程展厅', '网站管理'}


def _label(title: str, path: str) -> str:
    """Page title without the site-name parts: 'Liss Community · 文章' -> '文章'."""
    parts = [part.strip() for part in (title or '').split(' · ') if part.strip()]
    useful = [part for part in parts if part.lower() not in SITE_NAMES]
    return ' · '.join(useful) or path or (parts[0] if parts else '')


def journeys(store, f, max_rows=60_000) -> dict:
    """Common page sequences per visit, cross-site moves and page-to-page steps."""
    where, params = f.where()
    rows = store.query(f'SELECT session_id, site, path, title FROM pageviews p WHERE {where} '
                       f'ORDER BY session_id, started_at LIMIT {int(max_rows)}', params)
    titles, visits = {}, defaultdict(list)
    for row in rows:
        key = (row['site'], row['path'])
        if row['title']:
            titles[key] = row['title']
        steps = visits[row['session_id']]
        if not steps or steps[-1] != key:
            steps.append(key)
    paths, flows, moves = Counter(), Counter(), Counter()
    single = 0
    for steps in visits.values():
        if len(steps) == 1:
            single += 1
        else:
            paths[tuple(steps[:5])] += 1
        for a, b in zip(steps, steps[1:]):
            moves[(a, b)] += 1
            if a[0] != b[0]:
                flows[(a[0], b[0])] += 1

    def step(key):
        return dict(site=key[0], path=key[1], title=_label(titles.get(key, ''), key[1]))
    total = len(visits)
    top = [dict(steps=[step(k) for k in seq], more=False, count=count, pct=round(count / total * 100) if total else 0)
           for seq, count in paths.most_common(20)]
    return dict(total=total, single=single, multi=total - single, top=top, visits=visits, titles=titles,
                flows=[dict(a=a, b=b, count=c) for (a, b), c in flows.most_common()],
                moves=[dict(a=step(a), b=step(b), count=c) for (a, b), c in moves.most_common(15)])


def neighbours(journey: dict, site: str, path: str) -> tuple[list, list]:
    """Where visitors came from before this page, and where they went next (or left)."""
    before, after = Counter(), Counter()
    key = (site, path)
    for steps in journey['visits'].values():
        for i, item in enumerate(steps):
            if item != key:
                continue
            before[steps[i - 1] if i else ('', '入口')] += 1
            after[steps[i + 1] if i + 1 < len(steps) else ('', '离开')] += 1

    def rows(counter):
        peak = max(counter.values() or [1])
        return [dict(site=k[0], path=k[1], title=(k[1] if not k[0] else _label(journey['titles'].get(k, ''), k[1])),
                     marker=not k[0], count=c, share=round(c / peak * 100, 1)) for k, c in counter.most_common(10)]
    return rows(before), rows(after)
