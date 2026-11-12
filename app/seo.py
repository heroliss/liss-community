"""Explicit public indexing, fixed-origin sharing metadata and bounded sitemaps."""
import math
import re
from ipaddress import ip_address
from urllib.parse import urlsplit, urlencode
from xml.etree import ElementTree as ET

from flask import Blueprint, abort, before_render_template, current_app, has_request_context, request, Response, url_for

from .models import Post
from .post_preview import post_preview

seo = Blueprint('seo', __name__)
PUBLIC_PAGES = {'main.index', 'main.post', 'main.user', 'community.project_talk'}
SITEMAP_SIZE = 1000
XMLNS = 'http://www.sitemaps.org/schemas/sitemap/0.9'


def public_base():
    value = current_app.config.get('LISS_PUBLIC_BASE_URL', '')
    if not isinstance(value, str) or any(c.isspace() for c in value) or '\\' in value:
        return ''
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.port is not None or parsed.path not in ('', '/')
                or parsed.query or parsed.fragment or parsed.hostname in {'localhost'}
                or parsed.hostname.endswith(('.localhost', '.local', '.internal'))
                or len(parsed.hostname) > 253
                or '.' not in parsed.hostname or parsed.netloc.lower() != parsed.hostname
                or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part)
                           for part in parsed.hostname.split('.'))):
            return ''
        try:
            if not ip_address(parsed.hostname).is_global:
                return ''
        except ValueError:
            pass  # A validated DNS name rather than an IP literal.
        return 'https://' + parsed.hostname
    except ValueError:
        return ''


def indexing_enabled():
    return (current_app.config.get('LISS_INDEXING_ENABLED') is True
            and not current_app.config.get('LISS_LOCAL_PREVIEW') and bool(public_base()))


def public_request():
    if (not has_request_context() or request.method not in {'GET', 'HEAD'}
            or request.endpoint not in PUBLIC_PAGES):
        return False
    if set(request.args) - {'page'} or any(len(request.args.getlist(key)) != 1 for key in request.args):
        return False
    page = request.args.get('page', '1')
    if not page.isascii() or not page.isdecimal() or len(page) > 8 or int(page) < 1:
        return False
    return not (request.endpoint == 'main.index' and request.cookies.get('show_followed'))


def robots_policy(status=200):
    allowed = has_request_context() and (public_request() or ((request.endpoint or '').startswith('seo.')
                                  and request.method in {'GET', 'HEAD'} and not request.args))
    return 'index, follow' if indexing_enabled() and allowed and status == 200 else 'noindex, nofollow'


def metadata(context, *, is_error=False):
    settings = context.get('site_settings') or {}
    name = settings.get('site_name') or 'Liss Community'
    title, description = name, settings.get('tagline') or '记录想法，分享发现，让对话继续。'
    kind, image = 'website', None
    if not has_request_context():
        # Mail and offline template rendering have no endpoint or URL to index.
        return dict(title=title, description=description[:200], canonical=None,
                    image=None, kind=kind, robots='noindex, nofollow')
    if request.endpoint == 'main.post' and context.get('posts'):
        post = context['posts'][0]
        if not post.hidden:
            preview = post_preview(post)
            title, description, image = preview.title + ' · ' + name, preview.excerpt or preview.title, preview.image
            kind = 'article'
    elif request.endpoint == 'main.user' and context.get('user'):
        user = context['user']
        title = (user.display_name or user.username) + ' · ' + name
        description = user.about_me or description
    elif request.endpoint == 'community.project_talk' and context.get('project'):
        title = context['project'][0] + ' · 项目交流 · ' + name
        description = context['project'][1]
    canonical = None
    base = public_base()
    if base and public_request():
        canonical = base + request.path
        page = request.args.get('page', '1')
        if request.endpoint != 'main.post' and int(page) > 1:
            canonical += '?' + urlencode({'page': int(page)})
    if image and image.startswith('/'):
        image = base + image if base else None
    # Private forms, search terms and notifications never become share previews.
    if request.endpoint not in PUBLIC_PAGES or is_error:
        title, description, image = name, settings.get('tagline') or '记录想法，分享发现，让对话继续。', None
        kind = 'website'
    if is_error:
        canonical = None
    return dict(title=title, description=description[:200], canonical=canonical,
                image=image, kind=kind, robots=robots_policy(404 if is_error else 200))


def xml_response(root):
    ET.register_namespace('', XMLNS)
    return Response(ET.tostring(root, encoding='utf-8', xml_declaration=True), mimetype='application/xml')


def require_indexing():
    if not indexing_enabled():
        abort(404)


def location(root, tag, path, modified=None):
    entry = ET.SubElement(root, '{' + XMLNS + '}' + tag)
    ET.SubElement(entry, '{' + XMLNS + '}loc').text = public_base() + path
    if modified:
        ET.SubElement(entry, '{' + XMLNS + '}lastmod').text = modified.date().isoformat()


@seo.get('/robots.txt')
def robots():
    if not indexing_enabled():
        return Response('User-agent: *\nDisallow: /\n', mimetype='text/plain')
    private = ('/auth/', '/admin/', '/edit', '/notifications', '/search', '/welcome', '/join', '/api/')
    text = 'User-agent: *\nAllow: /\n' + ''.join('Disallow: ' + path + '\n' for path in private)
    return Response(text + 'Sitemap: ' + public_base() + '/sitemap.xml\n', mimetype='text/plain')


@seo.get('/google<token>.html')
def google_verification(token):
    """Search Console HTML-file ownership check; tokens come from LISS_GOOGLE_VERIFICATION."""
    allowed = {value.strip() for value in str(current_app.config.get('LISS_GOOGLE_VERIFICATION') or '').split(',')}
    if not re.fullmatch(r'[0-9a-f]{16}', token) or token not in allowed:
        abort(404)
    return Response(f'google-site-verification: google{token}.html', mimetype='text/html')


@seo.get('/<token>.txt')
def indexnow_key(token):
    """IndexNow ownership key file (https://www.indexnow.org); value from LISS_INDEXNOW_KEY."""
    key = str(current_app.config.get('LISS_INDEXNOW_KEY') or '')
    if not re.fullmatch(r'[0-9a-f]{32}', token) or token != key:
        abort(404)
    return Response(key, mimetype='text/plain')


@seo.get('/sitemap.xml')
def sitemap():
    require_indexing()
    root = ET.Element('{' + XMLNS + '}sitemapindex')
    location(root, 'sitemap', url_for('seo.sitemap_pages'))
    count = Post.query.filter_by(hidden=False).count()
    for page in range(1, math.ceil(count / SITEMAP_SIZE) + 1):
        location(root, 'sitemap', url_for('seo.sitemap_posts', page=page))
    return xml_response(root)


@seo.get('/sitemaps/pages.xml')
def sitemap_pages():
    require_indexing()
    from .community import PROJECTS
    root = ET.Element('{' + XMLNS + '}urlset')
    location(root, 'url', url_for('main.index'))
    for slug in PROJECTS:
        location(root, 'url', url_for('community.project_talk', slug=slug))
    return xml_response(root)


@seo.get('/sitemaps/posts/<page>.xml')
def sitemap_posts(page):
    require_indexing()
    if not page.isascii() or not page.isdecimal() or len(page) > 9:
        abort(404)
    page = int(page)
    count = Post.query.filter_by(hidden=False).count()
    if page < 1 or page > math.ceil(count / SITEMAP_SIZE):
        abort(404)
    posts = Post.query.filter_by(hidden=False).order_by(Post.id).offset((page - 1) * SITEMAP_SIZE).limit(SITEMAP_SIZE)
    root = ET.Element('{' + XMLNS + '}urlset')
    for post in posts:
        location(root, 'url', url_for('main.post', id=post.id), post.timestamp)
    return xml_response(root)


def install(app):
    app.register_blueprint(seo)

    def enrich(sender, template, context, **extra):
        is_error = template.name in {'403.html', '404.html', '500.html',
                                     'error_page.html', 'public_demo/message.html'}
        context['page_meta'] = metadata(context, is_error=is_error)

    before_render_template.connect(enrich, sender=app, weak=False)

    @app.after_request
    def indexing_headers(response):
        response.headers['X-Robots-Tag'] = robots_policy(response.status_code)
        if response.status_code == 200 and request.endpoint == 'static' and '/bundles/' in request.path:
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response
