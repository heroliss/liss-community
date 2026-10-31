"""Persistent loopback preview with synthetic content and a separate identity store."""
from pathlib import Path
import argparse
import json
import os
import secrets
import sys

REPO = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8896)
    parser.add_argument('--data-dir', type=Path, default=REPO / 'instance/local-preview')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Choose an unprivileged local port between 1024 and 65535.')
    storage = args.data_dir.resolve()
    storage.mkdir(parents=True, exist_ok=True)
    keyfile = storage / 'preview-key.json'
    if not keyfile.exists():
        # Exclusive creation prevents two first launches from replacing each other's key.
        try:
            with keyfile.open('x', encoding='utf-8') as stream:
                json.dump({'SECRET_KEY': secrets.token_hex(32)}, stream)
        except FileExistsError:
            pass
    secret = json.loads(keyfile.read_text(encoding='utf-8'))['SECRET_KEY']
    if not isinstance(secret, str) or len(secret) < 32:
        raise RuntimeError('Invalid local preview key. Preserve the existing data and repair its key file.')
    for name in list(os.environ):
        if name.upper().startswith(('LISS_', 'LIHOU_', 'MAIL_')) or name.upper() in {
            'SECRET_KEY', 'DATABASE_URL', 'TEST_DATABASE_URL', 'DEV_DATABASE_URL',
            'FLASK_CONFIG', 'FLASK_APP', 'FLASKY_ADMIN',
        }:
            os.environ.pop(name, None)
    os.environ.update(SECRET_KEY=secret, LISS_DATA_DIR=str(storage),
                      LIHOU_DEMO_COOKIE_SECURE='0', LIHOU_PROXY_HOPS='0',
                      LISS_EMAIL_ACCOUNTS='0', LISS_LOCAL_PREVIEW='1',
                      LISS_INDEXING_ENABLED='0')
    sys.path.insert(0, str(REPO))
    from app import create_app, db
    from app.models import Role, User, Post, Comment

    app = create_app('public-demo')
    # Preserve the existing preview identity and isolate simultaneous QA ports.
    cookie_name = 'liss_v17_preview' if args.port == 8896 else f'liss_preview_{args.port}'
    app.config.update(SESSION_COOKIE_NAME=cookie_name, TEMPLATES_AUTO_RELOAD=True,
                      MAIL_SUPPRESS_SEND=True, LISS_LOCAL_PREVIEW=True,
                      PUBLIC_DEMO_AUTH_LIMIT=200, PUBLIC_DEMO_WRITE_LIMIT=300)
    app.jinja_env.auto_reload = True
    with app.app_context():
        sandbox = app.extensions['public_demo']
        with sandbox.exclusive():
            sandbox.prepare()
            if not User.query.filter_by(username='qa_liss').first():
                admin = Role.query.filter_by(permissions=0xff).one()
                role = Role.query.filter_by(default=True).one()
                owner = User(username='qa_liss', name='Liss · 本地预览',
                             password='Local-Preview-Only-17!', account_kind='account',
                             role=admin, confirmed=True, is_site_owner=True,
                             about_me='隔离本地预览账号，内容不会发布到正式论坛。')
                reader = User(username='qa_reader', name='预览读者',
                              password='Local-Preview-Only-17!', account_kind='account',
                              role=role, confirmed=True)
                db.session.add_all([owner, reader])
                db.session.flush()
                for name in ('welcome', 'writing', 'works'):
                    body = (REPO / 'docs/starter-posts' / (name + '.md')).read_text(encoding='utf-8')
                    post = Post(body=body, author=owner)
                    db.session.add(post)
                    db.session.flush()
                    db.session.add(Comment(post=post, author=reader,
                                           body='本地预览评论：欢迎在这里试用阅读与讨论。'))
                reader.follow(owner)
                db.session.commit()

    @app.after_request
    def local_marker(response):
        response.headers['X-Liss-Preview'] = 'local'
        return response

    print(f'Local preview: http://127.0.0.1:{args.port}/', flush=True)
    print(f'Persistent isolated storage: {storage}', flush=True)
    app.run(host='127.0.0.1', port=args.port, use_reloader=False, threaded=True)


if __name__ == '__main__':
    main()
