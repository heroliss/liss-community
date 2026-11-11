from flask import render_template, redirect, url_for, abort, flash, request, \
    current_app, make_response, g, jsonify
from flask_login import login_required, current_user
from flask_sqlalchemy.record_queries import get_recorded_queries
from flask_wtf.csrf import validate_csrf
from wtforms.validators import ValidationError
from . import main
from .forms import EditProfileForm, EditProfileAdminForm, PostForm, \
    CommentForm
from .. import db
from ..models import Permission, Role, User, Post, Comment
from ..discussions import comment_destination, comment_json_request, visible_comment, create_reply_notification, requested_page
from ..writing_receipts import record_writing_receipt
from ..decorators import admin_required, permission_required
from urllib.parse import urlencode


def profile_identity(username):
    if current_app.config.get('PUBLIC_DEMO'):
        from ..owner_identity import user_for_username
        return user_for_username(username)
    return User.query.filter_by(username=username).first()


def canonical_profile_redirect(user, username, endpoint):
    if user.username != username and request.method in {'GET', 'HEAD'}:
        destination = url_for(endpoint, username=user.username)
        if request.args:
            destination += '?' + urlencode(list(request.args.items(multi=True)))
        return redirect(destination, code=301)
    return None


@main.after_app_request
def after_request(response):
    for query in get_recorded_queries():
        if query.duration >= current_app.config['FLASKY_SLOW_DB_QUERY_TIME']:
            current_app.logger.warning(
                'Slow query: %s\nParameters: %s\nDuration: %fs\nContext: %s\n'
                % (query.statement, query.parameters, query.duration,
                   query.location))
    return response


@main.route('/shutdown')
def server_shutdown():
    if not current_app.testing:
        abort(404)
    shutdown = request.environ.get('werkzeug.server.shutdown')
    if not shutdown:
        abort(500)
    shutdown()
    return 'Shutting down...'


@main.route('/', methods=['GET', 'POST'])
def index():
    form = PostForm()
    if current_user.can(Permission.WRITE_ARTICLES) and \
            form.validate_on_submit():
        post = Post(body=form.body.data,
                    author=current_user._get_current_object())
        db.session.add(post)
        form.save_appearance(post)
        db.session.commit()
        record_writing_receipt()
        return redirect(url_for('.index'))
    page = requested_page()
    show_followed = False
    if current_user.is_authenticated:
        show_followed = bool(request.cookies.get('show_followed', ''))
    if show_followed:
        query = current_user.followed_posts
    else:
        query = Post.query.filter_by(hidden=False)
    pagination = query.order_by(Post.timestamp.desc()).paginate(
        page=page, per_page=current_app.config['FLASKY_POSTS_PER_PAGE'],
        error_out=False)
    posts = pagination.items
    return render_template('index.html', form=form, posts=posts,
                           show_followed=show_followed, pagination=pagination)


@main.route('/write', methods=['GET', 'POST'])
def write():
    """A focused page for a new article: editor on the left, appearance and publish on the right."""
    if not current_user.is_authenticated:
        if current_app.config.get('PUBLIC_DEMO'):
            return redirect(url_for('public_demo.entry', next=url_for('.write')))
        return redirect(url_for('auth.login', next=url_for('.write')))
    if not current_user.can(Permission.WRITE_ARTICLES):
        abort(403)
    from ..admin import settings_values
    closed = bool(getattr(current_user, 'is_visitor', False)) and not settings_values()['guest_posting_open']
    form = PostForm()
    if request.method == 'POST' and closed:
        abort(403)
    if not closed and form.validate_on_submit():
        post = Post(body=form.body.data, author=current_user._get_current_object())
        db.session.add(post)
        form.save_appearance(post)
        db.session.commit()
        record_writing_receipt()
        return redirect(url_for('.post', id=post.id))
    return render_template('write.html', form=form, closed=closed)


@main.route('/user/<username>')
def user(username):
    user = profile_identity(username)
    if user is None:
        abort(404)
    canonical = canonical_profile_redirect(user, username, '.user')
    if canonical is not None:
        return canonical
    page = requested_page()
    pagination = user.posts.filter_by(hidden=False).order_by(Post.timestamp.desc()).paginate(
        page=page, per_page=current_app.config['FLASKY_POSTS_PER_PAGE'],
        error_out=False)
    posts = pagination.items
    return render_template('user.html', user=user, posts=posts,
                           pagination=pagination)


@main.route('/edit-profile', methods=['GET', 'POST'])
@login_required
def edit_profile():
    form = EditProfileForm()
    if form.validate_on_submit():
        current_user.name = form.name.data
        current_user.location = form.location.data
        current_user.about_me = form.about_me.data
        db.session.add(current_user)
        db.session.commit()
        flash('你的资料修改成功！')
        return redirect(url_for('.user', username=current_user.username))
    form.name.data = current_user.name
    form.location.data = current_user.location
    form.about_me.data = current_user.about_me
    return render_template('edit_profile.html', form=form)


@main.route('/edit-profile/<int:id>', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_profile_admin(id):
    user = db.get_or_404(User, id)
    form = EditProfileAdminForm(user=user)
    if form.validate_on_submit():
        user.email = form.email.data
        user.username = form.username.data
        user.confirmed = form.confirmed.data
        user.role = db.session.get(Role, form.role.data)
        user.name = form.name.data
        user.location = form.location.data
        user.about_me = form.about_me.data
        db.session.add(user)
        db.session.commit()
        flash('用户资料修改成功！')
        return redirect(url_for('.user', username=user.username))
    form.email.data = user.email
    form.username.data = user.username
    form.confirmed.data = user.confirmed
    form.role.data = user.role_id
    form.name.data = user.name
    form.location.data = user.location
    form.about_me.data = user.about_me
    return render_template('edit_profile.html', form=form, user=user)


@main.route('/post/<int:id>', methods=['GET', 'POST'])
def post(id):
    post = Post.query.filter_by(id=id, hidden=False).first_or_404()
    g.page_theme_post = post
    wants_json = comment_json_request()
    form = CommentForm()
    reply_to = form.reply_to.data if request.method == 'POST' else request.args.get('reply_to', '')
    parent = None
    if reply_to:
        if not reply_to.isdecimal() or len(reply_to) > 19 or int(reply_to) > 9223372036854775807:
            abort(404)
        parent = visible_comment(int(reply_to), post_id=post.id)
        form.reply_to.data = str(parent.id)
    if form.validate_on_submit():
        if not current_user.is_authenticated or not current_user.can(Permission.COMMENT):
            abort(403)
        comment = Comment(body=form.body.data,
                          post=post,
                          author=current_user._get_current_object(), parent=parent)
        db.session.add(comment)
        db.session.flush()
        create_reply_notification(comment, parent)
        db.session.commit()
        if wants_json:
            receipt = record_writing_receipt(store=False)
            return jsonify(ok=True, id=comment.id, parent_id=comment.parent_id,
                           count=post.visible_comment_count, destination=comment_destination(comment),
                           comment_html=render_template('_comment.html', comment=comment),
                           writing_receipt=receipt), 201
        record_writing_receipt()
        flash('评论已提交')
        return redirect(url_for('main.comment_anchor', id=comment.id))
    if wants_json:
        return jsonify(ok=False, errors=form.errors), 400
    page = request.args.get('page', 1, type=int)
    if page == -1:
        page = max(1, (post.comments.filter(Comment.disabled.is_not(True)).count() - 1) //
                   current_app.config['FLASKY_COMMENTS_PER_PAGE'] + 1)
    else:
        page = requested_page()
    pagination = post.comments.filter(Comment.disabled.is_not(True)).order_by(Comment.timestamp.asc().nullsfirst(), Comment.id.asc()).paginate(
        page=page, per_page=current_app.config['FLASKY_COMMENTS_PER_PAGE'],
        error_out=False)
    comments = pagination.items
    return render_template('post.html', posts=[post], form=form,
                           comments=comments, pagination=pagination, reply_parent=parent,
                           thread_json_ready=True)


@main.route('/edit/<int:id>', methods=['GET', 'POST'])
@login_required
def edit(id):
    post = Post.query.filter_by(id=id, hidden=False).first_or_404()
    if current_user != post.author and \
            not current_user.can(Permission.ADMINISTER):
        abort(403)
    g.page_theme_post = post
    form = PostForm()
    if form.validate_on_submit():
        post.body = form.body.data
        form.save_appearance(post)
        db.session.add(post)
        db.session.commit()
        record_writing_receipt()
        flash('修改已提交！')
        return redirect(url_for('.post', id=post.id))
    if not form.is_submitted():
        form.body.data = post.body
    form.load_appearance(post)
    return render_template('edit_post.html', form=form)


@main.route('/follow/<username>', methods=['GET', 'POST'])
@login_required
@permission_required(Permission.FOLLOW)
def follow(username):
    if request.method == 'POST' and current_app.config.get('WTF_CSRF_ENABLED', True):
        try:
            validate_csrf(request.form.get('csrf_token'))
        except ValidationError:
            abort(400)
    user = profile_identity(username)
    if user is None:
        flash('无此用户！')
        return redirect(url_for('.index'))
    if current_user.is_following(user):
        flash('你已经关注了这个用户')
        return redirect(url_for('.user', username=user.username))
    current_user.follow(user)
    db.session.commit()
    flash('关注 %s 成功！' % username)
    return redirect(url_for('.user', username=user.username))


@main.route('/unfollow/<username>', methods=['GET', 'POST'])
@login_required
@permission_required(Permission.FOLLOW)
def unfollow(username):
    if request.method == 'POST' and current_app.config.get('WTF_CSRF_ENABLED', True):
        try:
            validate_csrf(request.form.get('csrf_token'))
        except ValidationError:
            abort(400)
    user = profile_identity(username)
    if user is None:
        flash('无此用户！')
        return redirect(url_for('.index'))
    if not current_user.is_following(user):
        flash('你没有关注这个用户')
        return redirect(url_for('.user', username=user.username))
    current_user.unfollow(user)
    db.session.commit()
    flash('你对 %s 的关注取消成功.' % username)
    return redirect(url_for('.user', username=user.username))


@main.route('/followers/<username>')
def followers(username):
    user = profile_identity(username)
    if user is None:
        flash('无此用户！')
        return redirect(url_for('.index'))
    canonical = canonical_profile_redirect(user, username, '.followers')
    if canonical is not None:
        return canonical
    page = request.args.get('page', 1, type=int)
    pagination = user.followers.paginate(
        page=page, per_page=current_app.config['FLASKY_FOLLOWERS_PER_PAGE'],
        error_out=False)
    follows = [{'user': item.follower, 'timestamp': item.timestamp}
               for item in pagination.items]
    return render_template('followers.html', user=user, title="关注列表",
                           endpoint='.followers', pagination=pagination,
                           follows=follows)


@main.route('/followed-by/<username>')
def followed_by(username):
    user = profile_identity(username)
    if user is None:
        flash('无此用户！')
        return redirect(url_for('.index'))
    canonical = canonical_profile_redirect(user, username, '.followed_by')
    if canonical is not None:
        return canonical
    page = request.args.get('page', 1, type=int)
    pagination = user.followed.paginate(
        page=page, per_page=current_app.config['FLASKY_FOLLOWERS_PER_PAGE'],
        error_out=False)
    follows = [{'user': item.followed, 'timestamp': item.timestamp}
               for item in pagination.items]
    return render_template('followers.html', user=user, title="被关注列表",
                           endpoint='.followed_by', pagination=pagination,
                           follows=follows)


@main.route('/all')
@login_required
def show_all():
    resp = make_response(redirect(url_for('.index')))
    resp.set_cookie('show_followed', '', max_age=30 * 24 * 60 * 60)
    return resp


@main.route('/followed')
@login_required
def show_followed():
    resp = make_response(redirect(url_for('.index')))
    resp.set_cookie('show_followed', '1', max_age=30 * 24 * 60 * 60)
    return resp


@main.route('/moderate')
@login_required
@permission_required(Permission.MODERATE_COMMENTS)
def moderate():
    page = request.args.get('page', 1, type=int)
    pagination = Comment.query.order_by(Comment.timestamp.desc()).paginate(
        page=page, per_page=current_app.config['FLASKY_COMMENTS_PER_PAGE'],
        error_out=False)
    comments = pagination.items
    return render_template('moderate.html', comments=comments,
                           pagination=pagination, page=page)


@main.route('/moderate/enable/<int:id>')
@login_required
@permission_required(Permission.MODERATE_COMMENTS)
def moderate_enable(id):
    comment = db.get_or_404(Comment, id)
    comment.disabled = False
    db.session.add(comment)
    db.session.commit()
    return redirect(url_for('.moderate',
                            page=request.args.get('page', 1, type=int)))


@main.route('/moderate/disable/<int:id>')
@login_required
@permission_required(Permission.MODERATE_COMMENTS)
def moderate_disable(id):
    comment = db.get_or_404(Comment, id)
    comment.disabled = True
    db.session.add(comment)
    db.session.commit()
    return redirect(url_for('.moderate',
                            page=request.args.get('page', 1, type=int)))
