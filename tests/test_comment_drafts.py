"""Comment draft scopes and committed receipts agree across real CSRF routes."""
import re
import unittest

if __package__:
    from . import test_discussions as discussions
else:
    import test_discussions as discussions
from flask import session
from flask_login import login_user
from app import db
from app.models import Comment, User
from app.writing_receipts import record_writing_receipt


class CommentDraftTests(unittest.TestCase):
    # Use the same disposable public-demo fixture as the discussion routes.
    setUp = discussions.DiscussionTests.setUp
    tearDown = discussions.DiscussionTests.tearDown
    token = discussions.DiscussionTests.token
    start = discussions.DiscussionTests.start
    submit = discussions.DiscussionTests.submit
    comment = discussions.DiscussionTests.comment

    def test_scopes_ignore_pagination_and_separate_reply_targets(self):
        parent = self.comment(self.client)
        root_scope = f'data-writing-scope="/post/{self.post_id}#reply:new"'
        reply_scope = f'data-writing-scope="/post/{self.post_id}#reply:{parent}"'
        for page in (1, 2, 99):
            with self.subTest(page=page):
                ordinary = self.client.get(f'/post/{self.post_id}?page={page}').get_data(as_text=True)
                reply = self.client.get(f'/post/{self.post_id}?page={page}&reply_to=00{parent}').get_data(as_text=True)
                self.assertIn(root_scope, ordinary)
                self.assertIn(reply_scope, reply)
                self.assertNotIn(reply_scope, ordinary)
        self.assertIn(f'data-writing-owner="{self.owner_id}"', ordinary)

    def test_comments_and_corrections_load_only_the_light_draft_controller(self):
        cid = self.comment(self.client)
        for path in (f'/post/{self.post_id}', f'/comments/{cid}/edit'):
            with self.subTest(path=path):
                page = self.client.get(path).get_data(as_text=True)
                self.assertRegex(page, r'/static/(?:writing-drafts\.js|bundles/drafts\.)')
                self.assertNotIn('easymde', page.lower())
                self.assertNotIn('purify.min.js', page)
                self.assertNotRegex(page, r'/static/(?:writing\.js|bundles/writing\.)')
        self.assertIn(f'data-writing-scope="/comments/{cid}/edit"', page)
        anonymous = self.app.test_client().get(f'/post/{self.post_id}').get_data(as_text=True)
        self.assertNotIn('data-writing-owner', anonymous)

    def test_article_drafts_retain_the_original_scope_and_editor_order(self):
        page = self.client.get('/write').get_data(as_text=True)
        self.assertIn('data-writing-scope="/"', page)
        draft = re.search(r'/static/(?:writing-drafts\.js|bundles/drafts\.)', page)
        editor = re.search(r'/static/(?:writing\.js|bundles/writing\.)', page)
        self.assertIsNotNone(draft)
        self.assertIsNotNone(editor)
        self.assertLess(draft.start(), page.index('easymde.min.js'))
        self.assertLess(draft.start(), editor.start())

    def test_success_receipt_uses_the_validated_reply_target_and_is_consumed_once(self):
        parent = self.comment(self.client)
        token = 'b' * 32
        for target in ('', f'00{parent}'):
            with self.subTest(target=target):
                response = self.submit(self.client, f'/post/{self.post_id}?page=99', {
                    'body': 'Reply draft receipt', 'reply_to': target,
                    '_writing_draft_token': token, '_writing_scope': '/forged-target',
                })
                self.assertEqual(response.status_code, 302)
                expected_scope = f'/post/{self.post_id}#reply:{parent if target else "new"}'
                with self.client.session_transaction() as session:
                    self.assertEqual(session['writing_receipt'], {
                        'owner': str(self.owner_id), 'path': f'/post/{self.post_id}',
                        'token': token, 'scope': expected_scope,
                    })
                    self.assertNotIn('Reply draft receipt', repr(dict(session)))
                result = self.client.get(response.location, follow_redirects=True).get_data(as_text=True)
                self.assertIn(f'data-writing-receipt-scope="{expected_scope}"', result)
                self.assertIn(f'data-writing-receipt-token="{token}"', result)
                with self.client.session_transaction() as session:
                    self.assertNotIn('writing_receipt', session)
                self.assertNotIn('data-writing-receipt-token', self.client.get(f'/post/{self.post_id}').get_data(as_text=True))

    def test_failed_comment_and_correction_never_acknowledge_or_change_saved_text(self):
        cid = self.comment(self.client, body='Original comment')
        for path in (f'/post/{self.post_id}', f'/comments/{cid}/edit'):
            with self.subTest(path=path):
                response = self.submit(self.client, path, {'body': '   ', '_writing_draft_token': 'c' * 32})
                self.assertEqual(response.status_code, 200)
                self.assertIn('data-writing-method="POST"', response.get_data(as_text=True))
                with self.client.session_transaction() as session:
                    self.assertNotIn('writing_receipt', session)
                self.assertEqual(self.client.post(path, data={'body': 'Unprotected', '_writing_draft_token': 'c' * 32}).status_code, 400)
                with self.client.session_transaction() as session:
                    self.assertNotIn('writing_receipt', session)
        with self.app.app_context():
            self.assertEqual(db.session.get(Comment, cid).body, 'Original comment')

    def test_correction_receipt_is_bound_to_the_edited_comment(self):
        cid = self.comment(self.client)
        token = 'd' * 32
        path = f'/comments/{cid}/edit'
        response = self.submit(self.client, path, {'body': 'Saved correction',
            'reply_to': '999', '_writing_draft_token': token})
        self.assertEqual(response.status_code, 302)
        result = self.client.get(response.location).get_data(as_text=True)
        self.assertIn(f'data-writing-receipt-scope="{path}"', result)
        self.assertIn('Saved correction', result)
        self.assertNotRegex(result, r'/static/(?:writing\.js|bundles/writing\.)')

    def test_json_receipt_returns_only_this_submit_without_leaving_a_session_receipt(self):
        token = 'e' * 32
        with self.app.test_request_context(f'/post/{self.post_id}', method='POST',
                data={'body': 'Ajax comment', '_writing_draft_token': token}):
            login_user(db.session.get(User, self.owner_id))
            result = record_writing_receipt(store=False)
            self.assertEqual(result, {'owner': str(self.owner_id), 'path': f'/post/{self.post_id}',
                'token': token, 'scope': f'/post/{self.post_id}#reply:new'})
            self.assertNotIn('writing_receipt', session)
        with self.app.test_request_context(f'/post/{self.post_id}', method='POST',
                data={'body': 'Invalid token', '_writing_draft_token': 'invalid'}):
            self.assertIsNone(record_writing_receipt(store=False))
            self.assertNotIn('writing_receipt', session)
