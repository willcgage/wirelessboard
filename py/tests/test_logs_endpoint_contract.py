"""Every JSON endpoint has to answer with a body.

/api/logs stopped doing that. Removing the Google Drive backgrounds took the
body of `LogsHandler.get` with it -- the Drive landing handler had been defined
*nested inside* that method, so deleting the class deleted everything after it
and left:

    class LogsHandler(web.RequestHandler):
        def get(self):
            self.set_header('Content-Type', 'application/json')

which is valid Python. It compiled, every unit test passed, and the endpoint
answered 200 with `Content-Type: application/json` and zero bytes -- so the log
viewer failed in the browser with "Unexpected end of JSON input" and nothing in
the suite had an opinion. Found by a venue test, on hardware, by eye.

Two guards, because the two failures are different:

- the contract test below requests the endpoint and parses the answer, which is
  what the browser does and the only thing that catches an empty body;
- the shape test walks the module's AST for any handler method that announces a
  content type and then returns without writing, which catches the same
  deletion in a handler nobody has written a contract test for yet.
"""

import ast
import io
import json
import os
import sys
from unittest import mock

import tornado.web as web
from tornado.testing import AsyncHTTPTestCase

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tornado_server  # noqa: E402


SERVER_SOURCE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'tornado_server.py',
)


class LogsEndpointContract(AsyncHTTPTestCase):
    """What the log viewer in the browser actually does."""

    def get_app(self):
        return web.Application([
            (r'/api/logs/settings', tornado_server.LogSettingsHandler),
            (r'/api/logs/purge', tornado_server.LogsPurgeHandler),
            (r'/api/logs', tornado_server.LogsHandler),
        ])

    def setUp(self):
        super().setUp()
        patches = [
            mock.patch.object(tornado_server.config, 'log_file', return_value='/tmp/nope.log'),
            mock.patch.object(
                tornado_server.config, 'get_logging_settings',
                return_value={'level': 'INFO', 'backups': 5},
            ),
            mock.patch.object(
                tornado_server, 'read_log_entries',
                return_value={'entries': [], 'next_cursor': None, 'has_more': False},
            ),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_logs_returns_a_json_body(self):
        response = self.fetch('/api/logs')
        self.assertEqual(response.code, 200)
        self.assertTrue(response.body, 'an empty body is what broke the log viewer')
        payload = json.loads(response.body)
        self.assertTrue(payload['ok'])
        for key in ('entries', 'cursor', 'has_more', 'sources', 'levels', 'logging', 'direction'):
            self.assertIn(key, payload, 'the viewer reads %s off every answer' % key)

    def test_logs_rejects_a_bad_limit_with_a_json_body(self):
        response = self.fetch('/api/logs?limit=banana')
        self.assertEqual(response.code, 400)
        self.assertFalse(json.loads(response.body)['ok'])

    def test_log_settings_returns_a_json_body(self):
        payload = json.loads(self.fetch('/api/logs/settings').body)
        self.assertTrue(payload['ok'])
        self.assertIn('logging', payload)


def _handler_methods():
    """Every request method on every handler class in tornado_server."""
    with io.open(SERVER_SOURCE, encoding='utf-8') as handle:
        tree = ast.parse(handle.read())

    # ⛔ `head` is deliberately absent: a HEAD response carries headers and no
    # body by definition, so `JsonHandler.head` -- which sets the content type,
    # sets 200 and stops -- is correct and would otherwise read as truncated.
    verbs = {'get', 'post', 'put', 'delete', 'patch'}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        if not any('RequestHandler' in ast.unparse(base) for base in node.bases):
            continue
        for item in node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name in verbs:
                yield node.name, item


def _announces_a_content_type(method):
    for node in ast.walk(method):
        if not isinstance(node, ast.Call):
            continue
        target = ast.unparse(node.func)
        if not target.endswith('set_header'):
            continue
        if node.args and isinstance(node.args[0], ast.Constant):
            if str(node.args[0].value).lower() == 'content-type':
                return True
    return False


def _answers(method):
    """Does the method ever produce a body, or hand off to something that does?"""
    for node in ast.walk(method):
        if isinstance(node, ast.Call):
            target = ast.unparse(node.func)
            tail = target.rsplit('.', 1)[-1]
            if tail in {'write', 'render', 'redirect', 'finish', 'write_error', 'send_error'}:
                return True
        # `raise web.HTTPError(...)` is a complete answer too.
        if isinstance(node, ast.Raise):
            return True
    return False


def test_no_handler_announces_a_content_type_without_answering():
    """A method that sets Content-Type and never writes is a truncated handler.

    This is the exact shape the Google Drive removal left behind: the header
    survived because it was the first line, and everything that produced the
    body was below the deleted class.
    """
    silent = [
        '%s.%s' % (cls, method.name)
        for cls, method in _handler_methods()
        if _announces_a_content_type(method) and not _answers(method)
    ]
    assert silent == [], (
        'these handlers declare a content type and return without a body, '
        'which the browser reads as malformed: %s' % ', '.join(silent)
    )


def test_the_shape_guard_can_fail():
    """⛔ Plant the fault and watch the guard catch it.

    A guard written against a deletion is worthless if it only ever runs
    against correct code -- so check it against the broken handler directly,
    pasted as it actually shipped.
    """
    broken = ast.parse(
        'class LogsHandler(web.RequestHandler):\n'
        '    def get(self):\n'
        "        self.set_header('Content-Type', 'application/json')\n"
    )
    method = broken.body[0].body[0]
    assert _announces_a_content_type(method), 'the guard must see the header'
    assert not _answers(method), 'the guard must notice there is no body'

    whole = ast.parse(
        'class Fine(web.RequestHandler):\n'
        '    def get(self):\n'
        "        self.set_header('Content-Type', 'application/json')\n"
        "        self.write(json.dumps({'ok': True}))\n"
    )
    assert _answers(whole.body[0].body[0]), 'and must not flag a handler that writes'
