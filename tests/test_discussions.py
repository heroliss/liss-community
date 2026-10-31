"""Public search, directed replies and private notifications use real CSRF routes."""
from contextlib import closing
from datetime import datetime
import html
from html.parser import HTMLParser
from pathlib import Path
import re
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import importlib.util

from flask import template_rendered

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa

from app import create_app, db
from app.community import ProjectEntry
from app.discussion_schema import migrate_discussion_schema
from app.models import Comment, Post, ReplyNotification, User


class TextParser(HTMLParser):
    def __init__(self, content):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.elements = []
        self.feed(content)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

    def handle_data(self, value):
        self.parts.append(value)


def page_text(content):
    return re.sub(r'\s+', ' ', ' '.join(TextParser(content).parts))


class DiscussionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict('os.environ', {
            'SECRET_KEY': 'discussion-test-secret-' * 3, 'LISS_DATA_DIR': self.directory.name,
            'LISS_EMAIL_ACCOUNTS': '0', 'LIHOU_PROXY_HOPS': '0',
        })
        self.environment.start()
        self.app = create_app('public-demo')
        self.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.client = self.app.test_client()
        self.owner_id = self.start(self.client)
        self.submit(self.client, '/', {'body': '# Searchable article\n\n中文精确搜索 needle 50%_done'})
        with self.app.app_context():
            self.post_id = Post.query.filter_by(author_id=self.owner_id).one().id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.environment.stop()
        self.directory.cleanup()

    def token(self, client, path='/'):
        response = client.get(path)
        self.assertEqual(response.status_code, 200)
        match = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', response.get_data(as_text=True))
        self.assertIsNotNone(match)
        return html.unescape(match[1])

    def start(self, client):
        response = client.post('/welcome', data={'csrf_token': self.token(client, '/welcome')})
        self.assertEqual(response.status_code, 302)
        with client.session_transaction() as session:
            return int(session['public_demo_uid'])

    def submit(self, client, path, data, token_path='/'):
        return client.post(path, data={**data, 'csrf_token': self.token(client, token_path)})

    def rendered_get(self, client, path, **kwargs):
        contexts = []
        def capture(sender, template, context, **extra):
            contexts.append(context)
        with template_rendered.connected_to(capture, self.app):
            response = client.get(path, **kwargs)
        return response, contexts[-1]

    def reader(self):
        client = self.app.test_client()
        uid = self.start(client)
        return client, uid

    def comment(self, client, body='A public reply', parent=None):
        data = {'body': body}
        if parent:
            data['reply_to'] = str(parent)
        response = self.submit(client, f'/post/{self.post_id}', data)
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            return Comment.query.filter_by(post_id=self.post_id).order_by(Comment.id.desc()).first().id

    def test_search_is_public_literal_and_excludes_hidden_articles(self):
        anonymous = self.app.test_client()
        for query in ('中文精确搜索', 'needle', '50%_done'):
            response = anonymous.get('/search', query_string={'q': query})
            self.assertEqual(response.status_code, 200)
            self.assertIn(f'/post/{self.post_id}', response.get_data(as_text=True))
        self.assertIn('找到 0 篇文章', page_text(anonymous.get('/search?q=50%25Xdone').get_data(as_text=True)))
        with self.app.app_context():
            db.session.get(Post, self.post_id).hidden = True
            db.session.commit()
        page = anonymous.get('/search?q=needle').get_data(as_text=True)
        self.assertIn('找到 0 篇文章', page_text(page))
        self.assertNotIn('Searchable article', page)

    def test_empty_oversized_and_html_search_queries_are_safe(self):
        self.assertEqual(self.client.get('/search').status_code, 200)
        self.assertEqual(self.client.get('/search', query_string={'q': 'x' * 161}).status_code, 400)
        response = self.client.get('/search', query_string={'q': '<script>alert(1)</script>'})
        self.assertNotIn('<script>alert(1)</script>', response.get_data(as_text=True))

    def test_search_combines_whitespace_terms_author_and_project_with_public_pagination(self):
        self.app.config['FLASKY_POSTS_PER_PAGE'] = 1
        with self.app.app_context():
            writer = User(username='SearchWriter', name='Search Writer', password='test-only', confirmed=True)
            hidden_writer = User(username='HiddenWriterOnly', password='test-only', confirmed=True)
            rows = [Post(body=f'# Matched title {index}\n\nbeta in another order alpha', author=writer)
                    for index in range(3)]
            rows += [Post(body='# One term only\n\nalpha', author=writer),
                     Post(body='# Both outside project\n\nalpha beta', author=writer),
                     Post(body='# Hidden matched\n\nalpha beta', author=hidden_writer, hidden=True)]
            db.session.add_all(rows)
            db.session.flush()
            db.session.add_all([ProjectEntry(project_slug='dubforge', post=post) for post in rows[:4]])
            db.session.commit()
            expected = [post.id for post in rows[:3]][::-1]
        response, context = self.rendered_get(self.app.test_client(), '/search', query_string={
            'q': ' beta \t alpha beta ', 'author': 'searchwriter', 'project': 'dubforge', 'page': '2'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(context['has_search'])
        self.assertEqual(context['author_filter'], 'SearchWriter')
        self.assertEqual(context['pagination'].total, 3)
        self.assertEqual([post.id for post in context['posts']], [expected[1]])
        self.assertNotIn('HiddenWriterOnly', [option['value'] for option in context['author_options']])
        page = html.unescape(response.get_data(as_text=True))
        self.assertIn('value="SearchWriter" selected', page)
        self.assertIn('value="dubforge" selected', page)
        self.assertIn('author=SearchWriter', page)
        self.assertIn('project=dubforge', page)
        self.assertIn('page=3', page)

    def test_search_filters_work_without_words_and_project_aliases_keep_older_articles(self):
        with self.app.app_context():
            post = Post(body='# Historical project discussion', author_id=self.owner_id)
            db.session.add(ProjectEntry(project_slug='aoe4-autovillager-tool', post=post))
            db.session.commit()
            post_id = post.id
            author = db.session.get(User, self.owner_id).username
        for values in ({'author': author}, {'project': 'aoe4-flow'},
                       {'project': 'aoe4-autovillager-tool', 'author': author}):
            with self.subTest(values=values):
                response, context = self.rendered_get(self.app.test_client(), '/search', query_string=values)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(context['has_search'])
                self.assertIn(post_id, [post.id for post in context['posts']])
                if values.get('project'):
                    self.assertEqual(context['project_filter'], 'aoe4-flow')

    def test_search_words_preserve_sql_wildcards_backslashes_and_do_not_expand_filters(self):
        with self.app.app_context():
            literal = Post(body='# Literal characters\n\n50%_done C:\\work', author_id=self.owner_id)
            wildcard = Post(body='# Wildcard near miss\n\n50XXXXdone C:work', author_id=self.owner_id)
            db.session.add_all([literal, wildcard])
            db.session.commit()
            literal_id = literal.id
        response, context = self.rendered_get(self.app.test_client(), '/search', query_string={
            'q': '50%_done C:\\work'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([post.id for post in context['posts']], [literal_id])
        for values, status in (({'author': "' OR 1=1 --"}, 200),
                               ({'author': 'x' * 65}, 400),
                               ({'project': "dubforge' OR 1=1 --"}, 400),
                               ({'project': 'x' * 81}, 400)):
            with self.subTest(values=values):
                response, context = self.rendered_get(self.app.test_client(), '/search', query_string=values)
                self.assertEqual(response.status_code, status)
                self.assertEqual(context['posts'], [])

    def test_search_highlight_is_plain_text_escaped_and_finds_code_after_a_long_prefix(self):
        with self.app.app_context():
            post = Post(body='# **Safe title**\n\n' + 'prefix ' * 70
                + '\n\n```html\n<img src=x onerror=alert(1)> CODE%_done C:\\work\n```\n\n'
                + '<script>NeverRenderScript()</script><span hidden>NeverRenderHidden</span>',
                author_id=self.owner_id)
            db.session.add(post)
            db.session.commit()
        response, context = self.rendered_get(self.app.test_client(), '/search', query_string={
            'q': 'CODE%_done C:\\work'})
        result = context['search_results'][0]
        self.assertEqual(result['title'], 'Safe title')
        self.assertIn('CODE%_done', result['excerpt'])
        self.assertEqual(''.join(segment['text'] for segment in result['excerpt_segments']), result['excerpt'])
        self.assertEqual([segment['text'] for segment in result['excerpt_segments'] if segment['matched']],
                         ['CODE%_done', 'C:\\work'])
        self.assertNotIn('NeverRender', result['excerpt'])
        self.assertTrue(all(type(segment['text']) is str for segment in result['excerpt_segments']))
        page = response.get_data(as_text=True)
        self.assertNotIn('<img src=x onerror=alert(1)>', page)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt;', page)
        self.assertIn('<mark class="search-hit">CODE%_done</mark>', page)

    def test_search_distant_words_highlight_a_complete_match_and_explain_markup_only_matches(self):
        long_word = 'L' * 160
        with self.app.app_context():
            rows = [Post(body='# Distant words\n\n' + 'before ' * 40 + 'alpha ' + 'between ' * 90 + 'beta',
                         author_id=self.owner_id),
                    Post(body='# Long word\n\n' + 'before ' * 40 + long_word, author_id=self.owner_id),
                    Post(body='# Link label\n\n[Readable label](https://example.invalid/url-only-term)',
                         author_id=self.owner_id),
                    Post(body='# Hidden markup\n\nVisible body. <span style="display:none">hidden-only-term PAYLOAD_SENTINEL</span>',
                         author_id=self.owner_id),
                    Post(body='# ' + 'heading ' * 40 + 'title-only-term\n\nOrdinary body.',
                         author_id=self.owner_id)]
            db.session.add_all(rows)
            db.session.commit()
        for query, expected in (('alpha beta', 'alpha'), (long_word, long_word), ('title-only-term', 'title-only-term')):
            response, context = self.rendered_get(self.app.test_client(), '/search', query_string={'q': query})
            self.assertEqual(response.status_code, 200)
            result = context['search_results'][0]
            self.assertIn(expected, [segment['text'] for segment in result['excerpt_segments'] if segment['matched']])
            self.assertIsNone(result['excerpt_note'])
        for query in ('url-only-term', 'hidden-only-term'):
            response, context = self.rendered_get(self.app.test_client(), '/search', query_string={'q': query})
            result = context['search_results'][0]
            self.assertTrue(result['excerpt_note'])
            self.assertFalse(any(segment['matched'] for segment in result['excerpt_segments']))
            self.assertNotIn('PAYLOAD_SENTINEL', response.get_data(as_text=True))

    def test_top_level_comment_notifies_author_and_get_does_not_mark_read(self):
        reader, reader_id = self.reader()
        cid = self.comment(reader)
        with self.app.app_context():
            notification = ReplyNotification.query.one()
            self.assertEqual((notification.recipient_id, notification.comment_id), (self.owner_id, cid))
            self.assertIsNone(notification.read_at)
        page = self.client.get('/notifications').get_data(as_text=True)
        self.assertIn('A public reply', page)
        self.assertIn('1 条未读', page_text(page))
        with self.app.app_context():
            self.assertIsNone(ReplyNotification.query.one().read_at)

    def test_directed_reply_only_notifies_target_and_preserves_relationship(self):
        first, first_id = self.reader()
        parent = self.comment(first, 'Original question')
        second, second_id = self.reader()
        cid = self.comment(second, 'Directed answer', parent)
        with self.app.app_context():
            reply = db.session.get(Comment, cid)
            self.assertEqual((reply.parent_id, reply.post_id, reply.author_id), (parent, self.post_id, second_id))
            self.assertEqual([n.recipient_id for n in ReplyNotification.query.filter_by(comment_id=cid)], [first_id])
        page = self.client.get(f'/post/{self.post_id}').get_data(as_text=True)
        self.assertIn(f'/comments/{parent}', page)
        self.assertIn('Directed answer', page)

    def test_self_comment_and_self_reply_do_not_notify(self):
        parent = self.comment(self.client)
        self.comment(self.client, 'Reply to myself', parent)
        with self.app.app_context():
            self.assertEqual(ReplyNotification.query.count(), 0)

    def test_comment_body_trims_edges_but_preserves_internal_spacing(self):
        parent = self.comment(self.client, 'Parent comment')
        raw = '  \n\tFirst line  with  spaces\nSecond line\t\n  '
        expected = 'First line  with  spaces\nSecond line'
        html_response = self.submit(self.client, f'/post/{self.post_id}',
                                    {'body': raw, 'reply_to': str(parent)})
        self.assertEqual(html_response.status_code, 302)
        json_response = self.client.post(f'/post/{self.post_id}', data={
            'body': raw, 'reply_to': str(parent), 'csrf_token': self.token(self.client)},
            headers={'Accept': 'application/json'})
        self.assertEqual(json_response.status_code, 201)
        with self.app.app_context():
            replies = Comment.query.filter_by(parent_id=parent).order_by(Comment.id.asc()).all()
            self.assertEqual([reply.body for reply in replies], [expected, expected])

    def test_whitespace_only_comments_are_rejected_before_creating_replies(self):
        parent = self.comment(self.client, 'Parent comment')
        for raw in ('   ', '\n\t  \r\n', '\u3000\n  '):
            with self.subTest(raw=repr(raw)):
                html_response = self.submit(self.client, f'/post/{self.post_id}',
                                            {'body': raw, 'reply_to': str(parent)})
                self.assertEqual(html_response.status_code, 200)
                json_response = self.client.post(f'/post/{self.post_id}', data={
                    'body': raw, 'reply_to': str(parent), 'csrf_token': self.token(self.client)},
                    headers={'Accept': 'application/json'})
                self.assertEqual(json_response.status_code, 400)
                self.assertIn('body', json_response.get_json()['errors'])
        with self.app.app_context():
            self.assertEqual(Comment.query.filter_by(parent_id=parent).count(), 0)
            self.assertEqual(ReplyNotification.query.count(), 0)

    def test_edit_comment_trims_edges_and_rejects_whitespace_only_body(self):
        cid = self.comment(self.client, 'Original body')
        path = f'/comments/{cid}/edit'
        response = self.submit(self.client, path, {'body': ' \n Updated  body\nagain\t '})
        self.assertEqual(response.status_code, 302)
        response = self.submit(self.client, path, {'body': ' \t\n '})
        self.assertEqual(response.status_code, 200)
        with self.app.app_context():
            self.assertEqual(db.session.get(Comment, cid).body, 'Updated  body\nagain')

    def test_cross_article_hidden_and_malformed_reply_targets_fail_without_writes(self):
        reader, _ = self.reader()
        parent = self.comment(reader)
        for target in ('invalid', '9' * 50, '9999999999999999999', str(parent)):
            path = '/post/1' if target == str(parent) else f'/post/{self.post_id}'
            self.assertEqual(self.submit(reader, path, {'body': 'Forged reply', 'reply_to': target}).status_code, 404)
        with self.app.app_context():
            db.session.get(Comment, parent).disabled = True
            db.session.commit()
        self.assertEqual(self.submit(reader, f'/post/{self.post_id}', {'body': 'Forged reply', 'reply_to': parent}).status_code, 404)
        with self.app.app_context():
            self.assertEqual(Comment.query.filter_by(body='Forged reply').count(), 0)

    def test_notification_actions_require_csrf_and_same_recipient(self):
        reader, _ = self.reader()
        self.comment(reader)
        with self.app.app_context():
            nid = ReplyNotification.query.one().id
        self.assertEqual(self.client.post(f'/notifications/{nid}/read').status_code, 400)
        self.assertEqual(self.submit(reader, f'/notifications/{nid}/read', {}).status_code, 404)
        response = self.submit(self.client, f'/notifications/{nid}/read', {})
        self.assertEqual(response.status_code, 302)
        self.assertIn('#comment-', response.location)
        with self.app.app_context():
            self.assertIsNotNone(ReplyNotification.query.one().read_at)

    def test_read_all_is_post_only_and_does_not_touch_others(self):
        reader, _ = self.reader()
        parent = self.comment(reader)
        self.comment(self.client, 'Answer', parent)
        self.assertEqual(self.client.get('/notifications/read-all').status_code, 405)
        self.assertEqual(self.client.post('/notifications/read-all').status_code, 400)
        self.assertEqual(self.submit(self.client, '/notifications/read-all', {}).status_code, 302)
        with self.app.app_context():
            mine = ReplyNotification.query.filter_by(recipient_id=self.owner_id).one()
            other = ReplyNotification.query.filter(ReplyNotification.recipient_id != self.owner_id).one()
            self.assertIsNotNone(mine.read_at)
            self.assertIsNone(other.read_at)

    def test_notification_unread_filter_paginates_only_visible_owned_rows_and_keeps_filter(self):
        _, reader_id = self.reader()
        with self.app.app_context():
            stamp = datetime(2026, 10, 31)
            comments = [Comment(body=f'Visible reminder {index}', post_id=self.post_id, author_id=reader_id)
                        for index in range(31)]
            db.session.add_all(comments)
            db.session.flush()
            reminders = [ReplyNotification(recipient_id=self.owner_id, comment=comment,
                read_at=stamp if index % 5 == 0 else None, created_at=stamp)
                for index, comment in enumerate(comments)]
            hidden_comment = Comment(body='Hidden reminder sentinel', disabled=True,
                                     post_id=self.post_id, author_id=reader_id)
            hidden_post = Post(body='Hidden article reminder sentinel', hidden=True, author_id=self.owner_id)
            hidden_post_comment = Comment(body='Reminder on hidden article', post=hidden_post, author_id=reader_id)
            foreign = Comment(body='Another recipient sentinel', post_id=self.post_id, author_id=self.owner_id)
            db.session.add_all(reminders + [
                ReplyNotification(recipient_id=self.owner_id, comment=hidden_comment, created_at=stamp),
                ReplyNotification(recipient_id=self.owner_id, comment=hidden_post_comment, created_at=stamp),
                ReplyNotification(recipient_id=reader_id, comment=foreign, created_at=stamp)])
            db.session.commit()
            expected = [item.id for item in reminders if item.read_at is None][::-1]
        response, context = self.rendered_get(self.client, '/notifications?filter=unread&page=2')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(context['notification_filter'], 'unread')
        self.assertEqual(context['pagination'].total, 24)
        self.assertEqual([item.id for item in context['notifications']], expected[20:])
        self.assertEqual(context['unread_reply_count'], 24)
        page = html.unescape(response.get_data(as_text=True))
        self.assertIn('filter=unread', page)
        self.assertIn('name="filter" value="unread"', page)
        self.assertIn('name="page" value="2"', page)
        self.assertNotIn('Hidden reminder sentinel', page)
        self.assertNotIn('Hidden article reminder sentinel', page)
        self.assertNotIn('Another recipient sentinel', page)
        _, all_context = self.rendered_get(self.client, '/notifications?filter=invalid')
        self.assertEqual(all_context['notification_filter'], 'all')
        self.assertEqual(all_context['pagination'].total, 31)

    def test_notification_title_reply_and_parent_excerpt_are_plain_text_and_hidden_parent_is_omitted(self):
        _, reader_id = self.reader()
        with self.app.app_context():
            db.session.get(Post, self.post_id).body = '# Original **article** title\n\nBody'
            parent = Comment(body='Original **question** &lt;img src=x onerror=alert(1)&gt;',
                             post_id=self.post_id, author_id=self.owner_id)
            reply = Comment(body='A **helpful** response &lt;svg onload=alert(2)&gt;',
                            post_id=self.post_id, author_id=reader_id, parent=parent)
            notification = ReplyNotification(recipient_id=self.owner_id, comment=reply)
            db.session.add(notification)
            db.session.commit()
            parent_id = parent.id
        response, context = self.rendered_get(self.client, '/notifications')
        item = context['notification_items'][0]
        self.assertEqual(item['post_title'], 'Original article title')
        self.assertIn('Original question', item['parent_excerpt'])
        self.assertIn('A helpful response', item['reply_excerpt'])
        page = response.get_data(as_text=True)
        self.assertNotIn('<img src=x onerror=alert(1)>', page)
        self.assertNotIn('<svg onload=alert(2)>', page)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt;', page)
        with self.app.app_context():
            db.session.get(Comment, parent_id).disabled = True
            db.session.commit()
        response, context = self.rendered_get(self.client, '/notifications')
        self.assertIsNone(context['notification_items'][0]['parent_excerpt'])
        self.assertNotIn('Original question', response.get_data(as_text=True))
        self.assertIn('原评论当前不可见', response.get_data(as_text=True))

    def test_mark_read_stays_in_filter_and_clamps_an_emptied_last_page(self):
        _, reader_id = self.reader()
        with self.app.app_context():
            rows = [ReplyNotification(recipient_id=self.owner_id,
                comment=Comment(body=f'Page reminder {index}', post_id=self.post_id, author_id=reader_id))
                for index in range(21)]
            db.session.add_all(rows)
            db.session.commit()
            first_id = rows[0].id
        response = self.submit(self.client, f'/notifications/{first_id}/read', {
            'filter': 'unread', 'page': '2', 'action': 'stay'})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, '/notifications?filter=unread&page=1')
        response, context = self.rendered_get(self.client, response.location)
        self.assertEqual(context['pagination'].total, 20)
        self.assertNotIn(first_id, [item.id for item in context['notifications']])
        response = self.submit(self.client, f'/notifications/{first_id}/read', {
            'filter': 'all', 'page': '2', 'action': 'stay'})
        self.assertEqual(response.location, '/notifications?filter=all&page=2')
        response = self.submit(self.client, f'/notifications/{first_id}/read', {
            'filter': 'https://attacker.invalid', 'page': '9' * 100, 'action': 'stay'})
        self.assertEqual(response.location, '/notifications?filter=all&page=1')

    def test_mark_unread_is_owned_csrf_post_and_read_state_is_reversible(self):
        reader, _ = self.reader()
        cid = self.comment(reader)
        with self.app.app_context():
            nid = ReplyNotification.query.one().id
        self.submit(self.client, f'/notifications/{nid}/read', {'action': 'stay'})
        self.assertEqual(self.client.post(f'/notifications/{nid}/read', data={'action': 'unread'}).status_code, 400)
        self.assertEqual(self.submit(reader, f'/notifications/{nid}/read', {'action': 'unread'}).status_code, 404)
        with self.app.app_context():
            self.assertIsNotNone(db.session.get(ReplyNotification, nid).read_at)
        response = self.submit(self.client, f'/notifications/{nid}/read', {
            'action': 'unread', 'filter': 'unread', 'page': '99'})
        self.assertEqual(response.location, '/notifications?filter=unread&page=1')
        response, context = self.rendered_get(self.client, response.location)
        self.assertEqual([item.id for item in context['notifications']], [nid])
        with self.app.app_context():
            self.assertIsNone(db.session.get(ReplyNotification, nid).read_at)
        response = self.submit(self.client, f'/notifications/{nid}/read', {'action': 'view'})
        self.assertIn(f'#comment-{cid}', response.location)

    def test_read_all_keeps_filter_and_only_changes_visible_notifications_of_recipient(self):
        reader, reader_id = self.reader()
        self.comment(reader)
        with self.app.app_context():
            hidden = ReplyNotification(recipient_id=self.owner_id,
                comment=Comment(body='Hidden notification untouched', disabled=True,
                                post_id=self.post_id, author_id=reader_id))
            foreign = ReplyNotification(recipient_id=reader_id,
                comment=Comment(body='Other recipient untouched', post_id=self.post_id, author_id=self.owner_id))
            db.session.add_all([hidden, foreign])
            db.session.commit()
            hidden_id, foreign_id = hidden.id, foreign.id
        response = self.submit(self.client, '/notifications/read-all', {'filter': 'unread', 'page': '2'})
        self.assertEqual(response.location, '/notifications?filter=unread&page=1')
        response, context = self.rendered_get(self.client, response.location)
        self.assertEqual(context['pagination'].total, 0)
        self.assertIn('暂时没有未读提醒', response.get_data(as_text=True))
        with self.app.app_context():
            self.assertIsNone(db.session.get(ReplyNotification, hidden_id).read_at)
            self.assertIsNone(db.session.get(ReplyNotification, foreign_id).read_at)

    def test_hidden_content_disappears_from_private_notifications_and_unread_count(self):
        reader, _ = self.reader()
        cid = self.comment(reader, 'Private when hidden')
        with self.app.app_context():
            db.session.get(Comment, cid).disabled = True
            db.session.commit()
        page = self.client.get('/notifications').get_data(as_text=True)
        self.assertNotIn('Private when hidden', page)
        self.assertIn('0 条未读', page_text(page))
        self.assertEqual(self.client.get(f'/comments/{cid}').status_code, 404)

    def test_own_comment_edit_preserves_relation_time_and_notification_state(self):
        reader, reader_id = self.reader()
        cid = self.comment(reader, 'Needs correction')
        with self.app.app_context():
            original = db.session.get(Comment, cid).timestamp
        self.assertEqual(self.client.get(f'/comments/{cid}/edit').status_code, 403)
        self.assertEqual(reader.post(f'/comments/{cid}/edit', data={'body': 'Unprotected'}).status_code, 400)
        response = self.submit(reader, f'/comments/{cid}/edit', {'body': 'Corrected **text**', 'reply_to': '999'})
        self.assertEqual(response.status_code, 302)
        with self.app.app_context():
            comment = db.session.get(Comment, cid)
            self.assertEqual((comment.author_id, comment.post_id, comment.parent_id, comment.timestamp),
                             (reader_id, self.post_id, None, original))
            self.assertEqual(comment.body, 'Corrected **text**')
            self.assertIsNotNone(comment.edited_at)
            self.assertEqual(ReplyNotification.query.count(), 1)
            self.assertIsNone(ReplyNotification.query.one().read_at)
        self.assertIn('已编辑', self.client.get(f'/post/{self.post_id}').get_data(as_text=True))

    def test_comment_edit_limits_blank_and_hidden_guards(self):
        cid = self.comment(self.client)
        path = f'/comments/{cid}/edit'
        self.assertEqual(self.submit(self.client, path, {'body': 'x' * 2001}).status_code, 413)
        self.assertEqual(self.submit(self.client, path, {'body': ''}).status_code, 200)
        with self.app.app_context():
            self.assertEqual(db.session.get(Comment, cid).body, 'A public reply')
            db.session.get(Post, self.post_id).hidden = True
            db.session.commit()
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_comment_anchor_uses_stable_order_and_correct_page(self):
        self.app.config['FLASKY_COMMENTS_PER_PAGE'] = 2
        with self.app.app_context():
            stamp = datetime(2026, 10, 31)
            comments = [Comment(body=f'Equal time {i}', post_id=self.post_id,
                                author_id=self.owner_id, timestamp=stamp) for i in range(5)]
            db.session.add_all(comments)
            db.session.commit()
            target = comments[-1].id
        response = self.client.get(f'/comments/{target}')
        self.assertIn(f'page=3#comment-{target}', response.location)

    def test_extreme_page_numbers_cannot_overflow_search_notifications_or_comments(self):
        page = '9' * 100
        for path in ('/search?q=needle&page=' + page, '/notifications?page=' + page,
                     f'/post/{self.post_id}?page=' + page):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_legacy_null_comment_timestamps_have_consistent_anchor_pages(self):
        self.app.config['FLASKY_COMMENTS_PER_PAGE'] = 1
        with self.app.app_context():
            old = Comment(body='Legacy undated comment', post_id=self.post_id, author_id=self.owner_id)
            newer = Comment(body='Dated comment', post_id=self.post_id, author_id=self.owner_id)
            db.session.add_all([old, newer])
            db.session.commit()
            old_id, newer_id = old.id, newer.id
            db.session.execute(sa.text('UPDATE comments SET timestamp=NULL WHERE id=:id'), {'id': old_id})
            db.session.commit()
        self.assertIn(f'page=1#comment-{old_id}', self.client.get(f'/comments/{old_id}').location)
        self.assertIn(f'page=2#comment-{newer_id}', self.client.get(f'/comments/{newer_id}').location)
        self.assertIn('Legacy undated comment', self.client.get(f'/post/{self.post_id}?page=1').get_data(as_text=True))

    def test_notification_and_reply_survive_new_app_instance(self):
        reader, _ = self.reader()
        cid = self.comment(reader)
        recreated = create_app('public-demo')
        recreated.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        try:
            with recreated.test_client() as client:
                self.assertEqual(client.get('/healthz').status_code, 200)
            with recreated.app_context():
                self.assertIsNotNone(db.session.get(Comment, cid))
                self.assertEqual(ReplyNotification.query.count(), 1)
        finally:
            with recreated.app_context():
                db.session.remove()
                db.engine.dispose()

    def test_success_receipt_is_token_only_and_failed_post_has_no_receipt(self):
        token = 'a' * 32
        response = self.submit(self.client, '/', {'body': 'Receipt article', '_writing_draft_token': token})
        self.assertEqual(response.status_code, 302)
        with self.client.session_transaction() as session:
            self.assertEqual(session['writing_receipt'], {'owner': str(self.owner_id), 'path': '/', 'token': token})
            self.assertNotIn('Receipt article', repr(dict(session)))
            session.pop('writing_receipt')
        self.submit(self.client, '/', {'body': '', '_writing_draft_token': token})
        with self.client.session_transaction() as session:
            self.assertNotIn('writing_receipt', session)

    def test_json_comment_success_returns_verified_fragment_destination_and_target_receipt(self):
        reader, reader_id = self.reader()
        parent_id = self.comment(self.client, 'The question to answer')
        self.app.config['FLASKY_COMMENTS_PER_PAGE'] = 1
        token = 'd' * 32
        response = reader.post(f'/post/{self.post_id}?page=999', data={
            'body': 'A **new answer** <script>alert(1)</script>', 'reply_to': '000' + str(parent_id),
            '_writing_draft_token': token, 'csrf_token': self.token(reader)},
            headers={'Accept': 'application/json'})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.is_json)
        payload = response.get_json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['parent_id'], parent_id)
        self.assertEqual(payload['count'], 2)
        self.assertEqual(payload['destination'], f'/post/{self.post_id}?page=2#comment-{payload["id"]}')
        self.assertEqual(payload['writing_receipt'], {
            'owner': str(reader_id), 'path': f'/post/{self.post_id}', 'token': token,
            'scope': f'/post/{self.post_id}#reply:{parent_id}'})
        parser = TextParser(payload['comment_html'])
        roots = [attrs for tag, attrs in parser.elements if tag == 'li' and 'data-thread-comment' in attrs]
        self.assertEqual(len(roots), 1)
        self.assertEqual(roots[0]['id'], f'comment-{payload["id"]}')
        self.assertEqual(roots[0]['data-comment-id'], str(payload['id']))
        self.assertEqual(roots[0]['data-parent-id'], str(parent_id))
        self.assertNotIn('script', [tag for tag, _ in parser.elements])
        self.assertTrue(any(tag == 'strong' for tag, _ in parser.elements))
        self.assertNotIn('<html', payload['comment_html'])
        with reader.session_transaction() as session:
            self.assertNotIn('writing_receipt', session)
        with self.app.app_context():
            notification = ReplyNotification.query.filter_by(comment_id=payload['id']).one()
            self.assertEqual(notification.recipient_id, self.owner_id)

    def test_json_top_level_reply_uses_new_scope_and_does_not_reuse_an_older_receipt(self):
        reader, reader_id = self.reader()
        token = 'e' * 32
        response = reader.post(f'/post/{self.post_id}', data={
            'body': 'Top level comment', '_writing_draft_token': token, 'csrf_token': self.token(reader)},
            headers={'Accept': 'application/json, text/html;q=0.5'})
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertIsNone(payload['parent_id'])
        self.assertEqual(payload['writing_receipt']['scope'], f'/post/{self.post_id}#reply:new')
        csrf = self.token(reader)
        with reader.session_transaction() as session:
            session['writing_receipt'] = {'owner': str(reader_id), 'path': '/', 'token': token}
        response = reader.post(f'/post/{self.post_id}', data={
            'body': 'No draft token comment', 'csrf_token': csrf},
            headers={'Accept': 'application/json'})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.get_json()['writing_receipt'])

    def test_json_comment_form_errors_and_csrf_never_create_content_or_receipts(self):
        reader, _ = self.reader()
        for values, error_field in (({'body': '', 'csrf_token': self.token(reader)}, 'body'),
                                    ({'body': 'Unprotected comment'}, 'csrf_token')):
            response = reader.post(f'/post/{self.post_id}', data={
                **values, '_writing_draft_token': 'f' * 32}, headers={'Accept': 'application/json'})
            self.assertEqual(response.status_code, 400)
            self.assertFalse(response.get_json()['ok'])
            self.assertTrue(response.get_json()['errors'][error_field])
        with self.app.app_context():
            self.assertEqual(Comment.query.filter_by(post_id=self.post_id).count(), 0)
            self.assertEqual(ReplyNotification.query.count(), 0)
        with reader.session_transaction() as session:
            self.assertNotIn('writing_receipt', session)

    def test_json_comment_permission_and_reply_target_guards_are_preserved(self):
        anonymous = self.app.test_client()
        response = anonymous.post(f'/post/{self.post_id}', data={'body': 'Anonymous write'},
                                  headers={'Accept': 'application/json'})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(response.get_json()['ok'])
        reader, _ = self.reader()
        csrf = self.token(reader)
        with patch('app.models.User.can', return_value=False):
            response = reader.post(f'/post/{self.post_id}', data={'body': 'Unauthorized write', 'csrf_token': csrf},
                                   headers={'Accept': 'application/json'})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(response.get_json()['ok'])
        parent_id = self.comment(self.client)
        with self.app.app_context():
            db.session.get(Comment, parent_id).disabled = True
            db.session.commit()
        for parent in ('malformed', '9' * 50, str(parent_id)):
            response = reader.post(f'/post/{self.post_id}', data={
                'body': 'Invalid target write', 'reply_to': parent, 'csrf_token': self.token(reader)},
                headers={'Accept': 'application/json'})
            self.assertEqual(response.status_code, 404)
            self.assertFalse(response.get_json()['ok'])
        with self.app.app_context():
            self.assertEqual(Comment.query.filter_by(post_id=self.post_id).count(), 1)
            self.assertEqual(ReplyNotification.query.count(), 0)

    def test_html_comment_fallback_and_ajax_header_do_not_change_csrf_requirements(self):
        reader, _ = self.reader()
        response = reader.post(f'/post/{self.post_id}', data={'body': 'Header is not authorization'},
                               headers={'X-Requested-With': 'XMLHttpRequest'})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.is_json)
        response = reader.post(f'/post/{self.post_id}', data={
            'body': 'Normal HTML fallback', 'csrf_token': self.token(reader)},
            headers={'Accept': 'text/html'})
        self.assertEqual(response.status_code, 302)
        self.assertIn('/comments/', response.location)


class DiscussionMigrationTests(unittest.TestCase):
    def legacy_store(self, database):
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript('CREATE TABLE users (id INTEGER PRIMARY KEY); '
                'CREATE TABLE roles (id INTEGER PRIMARY KEY); '
                'CREATE TABLE follows (id INTEGER PRIMARY KEY); '
                'CREATE TABLE posts (id INTEGER PRIMARY KEY); '
                'CREATE TABLE comments (id INTEGER PRIMARY KEY, body TEXT, post_id INTEGER, author_id INTEGER); '
                "INSERT INTO comments VALUES (7, 'original', 2, 3);")

    def test_legacy_upgrade_is_backed_up_additive_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'legacy.sqlite'
            self.legacy_store(database)
            migrate_discussion_schema(database)
            migrate_discussion_schema(database)
            backups = list(Path(directory).glob('before-discussions-*.sqlite'))
            self.assertEqual(len(backups), 1)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute('SELECT id,body,post_id,author_id,parent_id,edited_at FROM comments').fetchall(),
                                 [(7, 'original', 2, 3, None, None)])
                self.assertEqual(connection.execute('PRAGMA foreign_key_list(comments)').fetchone()[2], 'comments')
                self.assertEqual(connection.execute('PRAGMA quick_check').fetchone()[0], 'ok')
            with closing(sqlite3.connect(backups[0])) as connection:
                self.assertEqual(connection.execute('SELECT * FROM comments').fetchall(), [(7, 'original', 2, 3)])

    def test_failed_public_migration_rolls_back_ddl_and_keeps_original_backup(self):
        real_connect = sqlite3.connect
        class FailingConnection(sqlite3.Connection):
            def execute(self, sql, *args, **kwargs):
                if sql.startswith('CREATE TABLE reply_notifications'):
                    raise sqlite3.OperationalError('injected schema failure')
                return super().execute(sql, *args, **kwargs)
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'legacy.sqlite'
            self.legacy_store(database)
            def failing_connect(*args, **kwargs):
                return real_connect(*args, **dict(kwargs, factory=FailingConnection))
            with patch('app.discussion_schema.sqlite3.connect', side_effect=failing_connect):
                with self.assertRaisesRegex(sqlite3.OperationalError, 'injected schema failure'):
                    migrate_discussion_schema(database)
            with closing(real_connect(database)) as connection:
                self.assertEqual([r[1] for r in connection.execute('PRAGMA table_info(comments)')],
                                 ['id', 'body', 'post_id', 'author_id'])
                self.assertEqual(connection.execute('SELECT * FROM comments').fetchall(), [(7, 'original', 2, 3)])
            self.assertEqual(len(list(Path(directory).glob('before-discussions-*.sqlite'))), 1)

    def test_alembic_upgrade_keeps_existing_comments_and_can_adopt_prepared_store(self):
        source = Path(__file__).resolve().parents[1] / 'migrations/versions/20261031_discussion_replies.py'
        spec = importlib.util.spec_from_file_location('discussion_migration', source)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with tempfile.TemporaryDirectory() as directory:
            for prepared in (False, True):
                database = Path(directory) / f'legacy-{prepared}.sqlite'
                self.legacy_store(database)
                if prepared:
                    migrate_discussion_schema(database)
                engine = sa.create_engine(sa.URL.create('sqlite', database=str(database)))
                try:
                    with engine.begin() as connection:
                        with Operations.context(MigrationContext.configure(connection)):
                            migration.upgrade()
                            migration.upgrade()
                        self.assertEqual(connection.exec_driver_sql('SELECT id,body,post_id,author_id,parent_id,edited_at FROM comments').all(),
                                         [(7, 'original', 2, 3, None, None)])
                        self.assertIn('comments', [fk['referred_table'] for fk in sa.inspect(connection).get_foreign_keys('comments')])
                        self.assertIn('reply_notifications', sa.inspect(connection).get_table_names())
                finally:
                    engine.dispose()
