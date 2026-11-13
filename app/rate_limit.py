"""Per-IP request limit for pages, so one aggressive crawler cannot tie up the single web worker.

Counts every request except static files, the analytics collector (which has its own limit) and
health checks, in one-minute windows. Normal reading never comes close; well-behaved crawlers slow
down when they get 429 + Retry-After. Set LISS_PAGE_RATE_LIMIT (requests per IP per minute, 0 to
disable); off under app.testing unless PAGE_RATE_LIMIT_IN_TESTS is set.
"""
from collections import OrderedDict
import os
import re
import threading
import time

from flask import request

EXEMPT = re.compile(r'^/(static/|analytics/collect|healthz|favicon\.ico|robots\.txt|sitemap)')
_hits = OrderedDict()
_lock = threading.Lock()

PAGE = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>请求过于频繁</title><style>body{font:16px/1.7 system-ui,sans-serif;background:#0d1415;color:#dfe8ea;
display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem}</style></head>
<body><main><h1>请求过于频繁</h1><p>这个网络在一分钟内打开了太多页面，请稍等一分钟后再试。</p></main></body></html>"""


def install(app):
    app.config.setdefault('PAGE_RATE_LIMIT', int(os.environ.get('LISS_PAGE_RATE_LIMIT', '60')))

    @app.before_request
    def page_rate_limit():
        limit = app.config.get('PAGE_RATE_LIMIT') or 0
        if limit <= 0 or (app.testing and not app.config.get('PAGE_RATE_LIMIT_IN_TESTS')) or EXEMPT.match(request.path):
            return None
        key = (request.remote_addr or '', int(time.time() // 60))
        with _lock:
            _hits[key] = _hits.get(key, 0) + 1
            _hits.move_to_end(key)
            while len(_hits) > 20000:
                _hits.popitem(last=False)
            count = _hits[key]
        if count <= limit:
            return None
        return app.response_class(PAGE, status=429, mimetype='text/html',
                                  headers={'Retry-After': str(60 - int(time.time()) % 60 or 60), 'Cache-Control': 'no-store'})
