"""Public discovery and private reply handling, using the existing identities."""
from html.parser import HTMLParser
import re

from flask import abort, current_app, flash, has_request_context, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from flask_wtf import FlaskForm
from markdown import markdown
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import selectinload

from . import db
from .main import main
from .main.forms import CommentForm
from .models import Comment, Permission, Post, ReplyNotification, User, utcnow
from .writing_receipts import record_writing_receipt


def visible_comment(comment_id, post_id=None):
    query = Comment.query.join(Post, Comment.post_id == Post.id).filter(
        Comment.id == comment_id, Comment.disabled.is_(False), Post.hidden.is_(False))
    if post_id is not None:
        query = query.filter(Comment.post_id == post_id)
    return query.first_or_404()


def reply_notification_query(user_id):
    return ReplyNotification.query.join(Comment, ReplyNotification.comment_id == Comment.id).join(
        Post, Comment.post_id == Post.id).filter(
            ReplyNotification.recipient_id == user_id, Comment.disabled.is_(False), Post.hidden.is_(False))


def create_reply_notification(comment, parent=None):
    recipient = parent.author if parent is not None else comment.post.author
    if (recipient is not None and recipient.id != comment.author_id
            and not recipient.disabled and recipient.account_kind != 'system'):
        db.session.add(ReplyNotification(recipient_id=recipient.id, comment=comment))


def requested_page(value=None):
    value = request.args.get('page', '1') if value is None else value
    # Bound OFFSET arithmetic before the value reaches the SQLite driver.
    return int(value) if (value.isascii() and value.isdecimal()
                          and len(value) <= 9 and int(value) > 0) else 1


def comment_json_request():
    return (request.endpoint == 'main.post' and request.method == 'POST'
            and request.accept_mimetypes.best_match(['text/html', 'application/json']) == 'application/json')


class _PlainTextParser(HTMLParser):
    """Extract readable text without ever returning user-controlled markup."""
    blocks = {'p', 'div', 'br', 'li', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3',
              'h4', 'h5', 'h6', 'pre', 'tr', 'table', 'hr'}
    ignored = {'script', 'style', 'template', 'head'}
    voids = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
             'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
        self.stack = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        hidden = (tag in self.ignored or 'hidden' in values or values.get('aria-hidden', '').lower() == 'true'
                  or re.search(r'(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\b',
                               values.get('style', ''), re.IGNORECASE))
        if tag not in self.voids:
            self.stack.append((tag, bool(hidden)))
            self.skip += int(bool(hidden))
        if self.skip:
            return
        if tag in self.blocks:
            self.parts.append('\n')
        if tag == 'img':
            self.parts.append(dict(attrs).get('alt') or '')

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                self.skip -= sum(hidden for _, hidden in self.stack[index:])
                del self.stack[index:]
                break
        if not self.skip and tag in self.blocks:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def plain_content_lines(content):
    # Parse the source again rather than trusting a stored body_html value.
    parser = _PlainTextParser()
    parser.feed(markdown(content or '', output_format='html', extensions=['fenced_code']))
    parser.close()
    return [line for line in (re.sub(r'\s+', ' ', line).strip()
                             for line in ''.join(parser.parts).splitlines()) if line]


def shorten_text(text, limit):
    return text if len(text) <= limit else text[:limit - 1].rstrip() + '…'


def highlight_segments(text, terms):
    if not terms:
        return [{'text': text, 'matched': False}] if text else []
    expression = re.compile('|'.join(re.escape(term) for term in sorted(terms, key=len, reverse=True)), re.IGNORECASE)
    segments, cursor = [], 0
    for match in expression.finditer(text):
        if match.start() > cursor:
            segments.append({'text': text[cursor:match.start()], 'matched': False})
        segments.append({'text': match.group(), 'matched': True})
        cursor = match.end()
    if cursor < len(text):
        segments.append({'text': text[cursor:], 'matched': False})
    return segments


def search_excerpt(text, terms, limit=200):
    matches = [match for term in terms if (match := re.search(re.escape(term), text, re.IGNORECASE))]
    first = min(matches, key=lambda match: match.start()) if matches else None
    start = max(0, first.start() - min(48, limit - len(first.group()))) if first else 0
    excerpt = text[start:start + limit].strip()
    return ('…' if start else '') + excerpt + ('…' if start + limit < len(text) else '')


def search_result(post, terms):
    from .community import PROJECTS, canonical_project_slug
    lines = plain_content_lines(post.body)
    title = shorten_text(lines[0] if lines else '一段新的分享', 100)
    excerpt = search_excerpt(' '.join(lines[1:] or lines), terms)
    visible_text = ' '.join(lines)
    if terms and not any(re.search(re.escape(term), title + ' ' + excerpt, re.IGNORECASE) for term in terms):
        # A hit beyond a shortened heading still needs a visible excerpt hit.
        excerpt = search_excerpt(visible_text, terms)
    note = ('匹配位于链接地址或正文标记中，可打开文章查看。'
            if terms and not any(re.search(re.escape(term), visible_text, re.IGNORECASE) for term in terms) else None)
    project = canonical_project_slug(post.project_entry.project_slug) if post.project_entry else None
    return dict(post=post, title=title, title_segments=highlight_segments(title, terms),
                excerpt=excerpt, excerpt_segments=highlight_segments(excerpt, terms), excerpt_note=note,
                author_label=post.author.display_name,
                project_label=PROJECTS[project][0] if project in PROJECTS else None)


def notification_filter(value):
    return 'unread' if value == 'unread' else 'all'


def notification_listing(user_id, selected):
    query = reply_notification_query(user_id)
    return query.filter(ReplyNotification.read_at.is_(None)) if selected == 'unread' else query


def notification_return():
    selected = notification_filter(request.form.get('filter'))
    total = notification_listing(current_user.id, selected).count()
    last = max(1, (total + 19) // 20)
    return url_for('main.notifications', filter=selected,
                   page=min(requested_page(request.form.get('page', '1')), last))


def notification_item(notification):
    comment = notification.comment
    parent = comment.parent
    title = plain_content_lines(comment.post.body)
    parent_excerpt = None
    if parent is not None and parent.post_id == comment.post_id and not parent.disabled:
        parent_excerpt = shorten_text(' '.join(plain_content_lines(parent.body)), 140)
    return dict(notification=notification,
                post_title=shorten_text(title[0] if title else '一段新的分享', 100),
                reply_excerpt=shorten_text(' '.join(plain_content_lines(comment.body)), 220),
                parent_excerpt=parent_excerpt)


def comment_destination(comment):
    earlier = (and_(Comment.timestamp.is_(None), Comment.id < comment.id)
               if comment.timestamp is None else
               or_(Comment.timestamp.is_(None), Comment.timestamp < comment.timestamp,
                   and_(Comment.timestamp == comment.timestamp, Comment.id < comment.id)))
    before = Comment.query.filter(Comment.post_id == comment.post_id, Comment.disabled.is_(False)).filter(
        earlier).count()
    page = before // current_app.config['FLASKY_COMMENTS_PER_PAGE'] + 1
    return url_for('main.post', id=comment.post_id, page=page, _anchor=f'comment-{comment.id}')


@main.app_context_processor
def discussion_context():
    unread = (reply_notification_query(current_user.id).filter(ReplyNotification.read_at.is_(None)).count()
              if has_request_context() and current_user is not None and current_user.is_authenticated else 0)
    return {'unread_reply_count': unread}


@main.get('/search')
def search():
    from .community import PROJECTS, PROJECT_SLUG_ALIASES, ProjectEntry, canonical_project_slug
    query = request.args.get('q', '').strip()
    error = '搜索内容请控制在 160 字以内。' if len(query) > 160 else ''
    author = request.args.get('author', '').strip()
    raw_project = request.args.get('project', '').strip()
    project = canonical_project_slug(raw_project)
    if len(author) > 64:
        error = error or '作者名称请控制在 64 字以内。'
    if len(raw_project) > 80 or (project and project not in PROJECTS):
        error = error or '请选择有效的项目。'
    authors = User.query.join(Post, Post.author_id == User.id).filter(Post.hidden.is_(False)).order_by(
        func.lower(User.username), User.id).distinct().all()
    author_options = [dict(value=user.username, label=f'{user.display_name} (@{user.username})') for user in authors]
    author = next((user.username for user in authors if user.username.lower() == author.lower()), author)
    project_options = [dict(value=slug, label=value[0]) for slug, value in PROJECTS.items()]
    terms = list(dict.fromkeys(query.split())) if not error else []
    has_search = bool(query or author or project)
    pagination = None
    if has_search and not error:
        # Treat %, _ and backslashes literally; query strings never become SQL.
        matches = Post.query.filter(Post.hidden.is_(False))
        for term in terms:
            matches = matches.filter(Post.body.contains(term, autoescape=True))
        if author:
            matches = matches.join(User, Post.author_id == User.id).filter(func.lower(User.username) == author.lower())
        if project:
            related = [project] + [old for old, current in PROJECT_SLUG_ALIASES.items() if current == project]
            matches = matches.filter(Post.project_entry.has(ProjectEntry.project_slug.in_(related)))
        pagination = matches.options(selectinload(Post.author), selectinload(Post.project_entry)).order_by(
            Post.timestamp.desc(), Post.id.desc()).paginate(
                page=requested_page(),
                per_page=current_app.config['FLASKY_POSTS_PER_PAGE'], error_out=False)
    posts = pagination.items if pagination else []
    return render_template('search.html', q=query, search_error=error,
                           posts=posts, pagination=pagination, has_search=has_search,
                           author_filter=author, project_filter=project, author_options=author_options,
                           project_options=project_options,
                           search_results=[search_result(post, terms) for post in posts]), 400 if error else 200


@main.get('/comments/<int:id>')
def comment_anchor(id):
    return redirect(comment_destination(visible_comment(id)))


@main.route('/comments/<int:id>/edit', methods=['GET', 'POST'])
@login_required
def edit_comment(id):
    comment = visible_comment(id)
    if comment.author_id != current_user.id or not current_user.can(Permission.COMMENT):
        abort(403)
    form = CommentForm()
    if form.validate_on_submit():
        # A correction never changes the author, parent, target or unread state.
        comment.body = form.body.data
        comment.edited_at = utcnow()
        db.session.commit()
        record_writing_receipt()
        flash('评论已更新。')
        return redirect(comment_destination(comment))
    if not form.is_submitted():
        form.body.data = comment.body
    return render_template('edit_comment.html', form=form, comment=comment)


@main.get('/notifications')
@login_required
def notifications():
    selected = notification_filter(request.args.get('filter'))
    pagination = notification_listing(current_user.id, selected).options(
        selectinload(ReplyNotification.comment).selectinload(Comment.author),
        selectinload(ReplyNotification.comment).selectinload(Comment.post),
        selectinload(ReplyNotification.comment).selectinload(Comment.parent)).order_by(
        ReplyNotification.created_at.desc(), ReplyNotification.id.desc()).paginate(
            page=requested_page(), per_page=20, error_out=False)
    return render_template('notifications.html', notifications=pagination.items, pagination=pagination,
                           notification_filter=selected, notification_form=FlaskForm(),
                           notification_items=[notification_item(item) for item in pagination.items])


@main.post('/notifications/<int:id>/read')
@login_required
def notification_read(id):
    if not FlaskForm().validate_on_submit():
        abort(400)
    notification = reply_notification_query(current_user.id).filter(ReplyNotification.id == id).first_or_404()
    action = request.form.get('action')
    notification.read_at = None if action == 'unread' else notification.read_at or utcnow()
    db.session.commit()
    if action in {'stay', 'unread'}:
        return redirect(notification_return())
    return redirect(comment_destination(notification.comment))


@main.post('/notifications/read-all')
@login_required
def notifications_read_all():
    if not FlaskForm().validate_on_submit():
        abort(400)
    visible_ids = notification_listing(current_user.id, 'unread').with_entities(ReplyNotification.id)
    ReplyNotification.query.filter(ReplyNotification.id.in_(visible_ids)).update(
        {'read_at': utcnow()}, synchronize_session=False)
    db.session.commit()
    flash('已将回复提醒标记为已读。')
    return redirect(notification_return())
