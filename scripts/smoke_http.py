#!/usr/bin/env python3
"""Anonymous GET-only deployment smoke check; no login, forms, mail or content writes."""
from __future__ import annotations

import argparse
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_url', help='Origin only, for example http://127.0.0.1:8896')
    parser.add_argument('--preview', action='store_true', help='Require local-preview marker and noindex on all pages')
    parser.add_argument('--post-id', type=int, help='Also read one known public article; never guesses an ID')
    options = parser.parse_args()
    origin = urlsplit(options.base_url)
    if (origin.scheme not in {'http', 'https'} or not origin.hostname or
            origin.username or origin.password or origin.path not in {'', '/'} or
            origin.query or origin.fragment):
        parser.error('base_url must be an http(s) origin without credentials, path, query or fragment')
    if options.post_id is not None and options.post_id < 1:
        parser.error('--post-id must be positive')
    base = options.base_url.rstrip('/')
    cases = [('/healthz', 200), ('/', 200), ('/welcome', 200),
             ('/auth/login', 200), ('/projects/ssframework/talk/', 200), ('/admin/', 403)]
    if options.post_id:
        cases.append((f'/post/{options.post_id}', 200))
    results = []
    for path, expected in cases:
        row = {'path': path, 'expected_status': expected}
        try:
            try:
                response = urlopen(Request(base + path, headers={'User-Agent': 'Liss-ReadOnly-Smoke/1'}), timeout=10)
            except HTTPError as error:
                response = error
            with response:
                body = response.read(2 * 1024 * 1024)
                row.update(status=response.status, bytes=len(body))
                checks = {'status': response.status == expected}
                if options.preview:
                    checks['preview_marker'] = response.headers.get('X-Liss-Preview') == 'local'
                    checks['noindex'] = 'noindex' in response.headers.get('X-Robots-Tag', '').lower()
                row['checks'] = checks
                row['passed'] = all(checks.values())
        except (OSError, URLError) as error:
            row.update(passed=False, error=str(error))
        results.append(row)
    report = {'passed': all(row['passed'] for row in results), 'results': results,
              'scope': 'Anonymous HTTP responses only. No browser, authenticated workflow, email delivery or data-migration proof.'}
    print(json.dumps(report, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
