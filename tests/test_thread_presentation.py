"""Real reply routes retain a short, safe reference and a native path to the full text."""
from html.parser import HTMLParser
import re
import unittest
from urllib.parse import urlsplit

from app.models import PostAppearance

if __package__:
    from . import test_discussions as discussions
else:
    import test_discussions as discussions


class Element:
    def __init__(self, tag, attrs=()):
        self.tag = tag
        self.attrs = {name: value if value is not None else ''
                      for name, value in attrs}
        self.children = []

    def elements(self):
        for child in self.children:
            if isinstance(child, Element):
                yield child
                yield from child.elements()

    @property
    def text(self):
        return ''.join(child.text if isinstance(child, Element) else child
                       for child in self.children)

    def one(self, tag=None, **attrs):
        matches = [child for child in self.elements()
                   if (tag is None or child.tag == tag)
                   and all(child.attrs.get(name) == value for name, value in attrs.items())]
        if len(matches) != 1:
            raise AssertionError(f'Expected one {tag} {attrs}, found {len(matches)}')
        return matches[0]


class Markup(HTMLParser):
    void_tags = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Element('document')
        self.stack = [self.root]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.void_tags:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


class ThreadPresentationTests(unittest.TestCase):
    setUp = discussions.DiscussionTests.setUp
    tearDown = discussions.DiscussionTests.tearDown
    token = discussions.DiscussionTests.token
    start = discussions.DiscussionTests.start
    submit = discussions.DiscussionTests.submit
    comment = discussions.DiscussionTests.comment

    def page(self, path):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200)
        return Markup(response.get_data(as_text=True)).root

    def reference(self, root, reply_id):
        reply = root.one('li', id=f'comment-{reply_id}')
        toggle = reply.one('a', **{'data-thread-context': ''})
        panel = reply.one('div', id=toggle.attrs['aria-controls'])
        return toggle, panel

    def assert_compact_reference(self, root, reply_id, parent_id, complete):
        toggle, panel = self.reference(root, reply_id)
        summary = panel.one('blockquote').text.strip()
        self.assertLessEqual(len(summary), 180)
        self.assertTrue(summary.endswith('…'))
        self.assertTrue(complete.startswith(summary[:-1]))
        self.assertNotEqual(summary, complete)
        self.assertEqual(toggle.attrs['href'], f'/comments/{parent_id}')
        self.assertEqual(toggle.attrs['aria-expanded'], 'false')
        self.assertIn('hidden', panel.attrs)
        for element in panel.elements():
            self.assertNotIn('data-thread-locate', element.attrs)
            self.assertNotIn('data-thread-context-close', element.attrs)
            self.assertNotIn('thread-context-hint', element.attrs.get('class', '').split())
            self.assertNotIn(element.tag, {'a', 'button'})
        return toggle, panel

    def test_long_reply_reference_is_brief_and_native_link_opens_the_full_parent(self):
        complete = '这是原评论里需要保留的完整句子。' * 24 + '仅在原文末尾可见的标记'
        parent_id = self.comment(self.client, complete)
        reply_id = self.comment(self.client, '针对上面的想法继续交流。', parent_id)
        root = self.page(f'/post/{self.post_id}')
        toggle, panel = self.assert_compact_reference(root, reply_id, parent_id, complete)
        self.assertIn('data-thread-long', root.one('li', id=f'comment-{parent_id}').attrs)
        self.assertNotIn('data-thread-long', root.one('li', id=f'comment-{reply_id}').attrs)
        self.assertNotIn('仅在原文末尾可见的标记', panel.text)

        destination = self.client.get(toggle.attrs['href'])
        self.assertEqual(destination.status_code, 302)
        url = urlsplit(destination.location)
        self.assertEqual(url.path, f'/post/{self.post_id}')
        self.assertEqual(url.fragment, f'comment-{parent_id}')
        full = self.client.get(toggle.attrs['href'], follow_redirects=True)
        self.assertEqual(full.status_code, 200)
        original = Markup(full.get_data(as_text=True)).root.one('li', id=f'comment-{parent_id}')
        self.assertIn(complete, original.text)

    def test_reference_displays_quoted_html_as_text_without_creating_active_markup(self):
        literal = '<img src=x onerror=alert(1)>'
        parent_id = self.comment(self.client, f'代码示例：`{literal}` 与 `<script>alert(2)</script>`。')
        reply_id = self.comment(self.client, '这段代码应该如何处理？', parent_id)
        root = self.page(f'/post/{self.post_id}')
        _, panel = self.reference(root, reply_id)
        self.assertIn(literal, panel.text)
        self.assertIn('<script>alert(2)</script>', panel.text)
        self.assertFalse(any(element.tag in {'script', 'img'} for element in panel.elements()))
        self.assertFalse(any(name.startswith('on') for element in panel.elements()
                             for name in element.attrs))

    def test_new_reply_fragment_keeps_its_glass_color_and_brief_reference_across_refresh_and_pagination(self):
        complete = '原句在异步发送后也只保留简短摘要。' * 20
        parent_id = self.comment(self.client, complete)
        with self.app.app_context():
            discussions.db.session.add(PostAppearance(post_id=self.post_id,
                                                     theme_color='#6a8fc8', card_material='glass'))
            discussions.db.session.commit()
        response = self.client.post(f'/post/{self.post_id}', data={
            'body': '新回复', 'reply_to': str(parent_id),
            'csrf_token': self.token(self.client, f'/post/{self.post_id}'),
        }, headers={'Accept': 'application/json'})
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertTrue(payload['ok'])
        fragment = Markup(payload['comment_html']).root
        self.assert_compact_reference(fragment, payload['id'], parent_id, complete)
        reply = fragment.one('li', id=f"comment-{payload['id']}")
        style = reply.attrs['style']
        hue = re.search(r'(?:^|;)--thread-glass-hue:(\d+);', style)
        self.assertIsNotNone(hue)
        self.assertTrue(0 <= int(hue[1]) < 360)
        self.assertEqual(reply.attrs['data-theme-color'], '#6a8fc8')
        self.assertIn('data-post-theme-card', reply.attrs)
        self.assertRegex(style, r'--appearance-hue:[\d.]+;--appearance-saturation:[\d.]+%;')
        for class_name in ('thread-message', 'thread-reference', 'thread-editor-slot'):
            self.assertEqual(sum(class_name in child.attrs.get('class', '').split()
                                 for child in reply.children if isinstance(child, Element)), 1)

        for _ in range(2):
            root = self.page(f'/post/{self.post_id}')
            rendered = root.one('li', id=f"comment-{payload['id']}")
            self.assertEqual(rendered.attrs['style'], style)
            parent_style = root.one('li', id=f'comment-{parent_id}').attrs['style']
            parent_hue = re.search(r'(?:^|;)--thread-glass-hue:(\d+);', parent_style)
            self.assertIsNotNone(parent_hue)
            self.assertNotEqual(parent_hue[1], hue[1])
            self.assert_compact_reference(root, payload['id'], parent_id, complete)
        self.app.config['FLASKY_COMMENTS_PER_PAGE'] = 1
        paginated = self.page(f'/post/{self.post_id}?page=2')
        self.assertEqual(paginated.one('li', id=f"comment-{payload['id']}").attrs['style'], style)
        self.assert_compact_reference(paginated, payload['id'], parent_id, complete)

    def test_discussion_heading_and_send_action_keep_only_the_essential_copy(self):
        parent_id = self.comment(self.client, '这是可以回复的原评论。')
        for query in ('', f'?reply_to={parent_id}'):
            with self.subTest(directed=bool(query)):
                root = self.page(f'/post/{self.post_id}{query}')
                ordinary = root.one('li', id=f'comment-{parent_id}')
                self.assertRegex(ordinary.attrs['style'], r'^--thread-glass-hue:\d+;')
                self.assertIn('data-theme-color', ordinary.attrs)
                heading = root.one('h2', id='comments')
                self.assertEqual(heading.text.strip(), '聊聊这篇文章')
                discussion = root.one('section', **{'data-thread': ''})
                self.assertEqual(discussion.attrs['data-thread-layout'], 'scatter')
                switch = discussion.one('div', **{'data-thread-layout-switch': ''})
                self.assertIn('hidden', switch.attrs)
                self.assertEqual(switch.attrs['aria-label'], '评论排版')
                for layout, pressed in (('scatter', 'true'), ('list', 'false')):
                    control = switch.one('button', **{'data-thread-layout-value': layout})
                    self.assertEqual(control.attrs['type'], 'button')
                    self.assertEqual(control.attrs['aria-pressed'], pressed)
                heading_headers = [node for node in root.elements() if node.tag == 'header'
                                   and any(child is heading for child in node.elements())]
                self.assertEqual(len(heading_headers), 1)
                self.assertFalse(any(child.tag == 'p' for child in heading_headers[0].elements()))
                composer = root.one('div', **{'data-thread-composer': ''})
                controls = [node for node in composer.elements() if node.attrs.get('type') == 'submit']
                self.assertEqual(len(controls), 1)
                label = controls[0].attrs.get('value', controls[0].text).strip()
                self.assertEqual(label, '发送')
                self.assertNotIn('再次点击', re.sub(r'\s+', '', composer.text))


if __name__ == '__main__':
    unittest.main()
