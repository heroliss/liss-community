"""gzip for text responses without an extra dependency.

PythonAnywhere serves this app's static files through Flask and does not
compress them. Static text files are compressed once per (path, mtime, size)
and cached in memory; HTML pages are compressed per response. Conditional
(304), partial (206) and already-encoded responses are left untouched.
"""
import gzip
from pathlib import Path
import threading

from flask import request

TEXT_TYPES = {'text/css', 'text/javascript', 'application/javascript', 'application/json',
              'image/svg+xml', 'text/plain', 'text/html', 'application/xml', 'text/xml'}
MIN_BYTES = 1024
_cache = {}
_lock = threading.Lock()


def accepts_gzip() -> bool:
    return 'gzip' in request.headers.get('Accept-Encoding', '').lower()


def install(app):
    static_root = Path(app.static_folder).resolve()

    @app.after_request
    def compress(response):
        if (response.status_code != 200 or response.mimetype not in TEXT_TYPES or not accepts_gzip()
                or 'Content-Encoding' in response.headers or request.method != 'GET'):
            return response
        if response.direct_passthrough:
            if request.endpoint != 'static':
                return response
            path = (static_root / (request.view_args or {}).get('filename', '')).resolve()
            if not path.is_file() or not path.is_relative_to(static_root):
                return response
            stat = path.stat()
            key = (str(path), stat.st_mtime_ns, stat.st_size)
            with _lock:
                body = _cache.get(key)
            if body is None:
                if stat.st_size < MIN_BYTES:
                    return response
                body = gzip.compress(path.read_bytes(), compresslevel=6, mtime=0)
                with _lock:
                    if len(_cache) > 512:
                        _cache.clear()
                    _cache[key] = body
            response.close()
            response.direct_passthrough = False
            response.set_data(body)
        else:
            data = response.get_data()
            if len(data) < MIN_BYTES:
                return response
            response.set_data(gzip.compress(data, compresslevel=6, mtime=0))
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Content-Length'] = str(len(response.get_data()))
        response.vary.add('Accept-Encoding')
        return response
