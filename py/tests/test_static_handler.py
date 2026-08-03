"""Which static handler serves /static, and why it matters in a checkout.

Tornado caches each static file's content hash in a class-level dict for the
life of the process and never invalidates it. In a deployed app that is right;
in a source checkout the bundle changes on every `npm run build`, so a server
started beforehand keeps answering 304 against the hash it captured at startup
and the browser goes on running the old bundle -- through a hard reload and in
a new tab, because the validator still matches.
"""

import os
import sys

import pytest
import tornado.web as web

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tornado_server  # noqa: E402


class TestStaticFileHandlerChoice:
    def test_a_source_checkout_rehashes(self, monkeypatch):
        monkeypatch.delattr(sys, 'frozen', raising=False)

        assert tornado_server.static_file_handler() is tornado_server.SourceCheckoutStaticHandler

    def test_a_frozen_build_keeps_tornados_cache(self, monkeypatch):
        """A packaged bundle cannot change while it runs; re-hashing is waste."""
        monkeypatch.setattr(sys, 'frozen', True, raising=False)

        assert tornado_server.static_file_handler() is web.StaticFileHandler

    def test_the_checkout_handler_is_a_static_file_handler(self):
        assert issubclass(tornado_server.SourceCheckoutStaticHandler, web.StaticFileHandler)


class TestSourceCheckoutEtag:
    """compute_etag must read the file, not Tornado's process-wide hash cache."""

    def _handler(self, abs_path):
        h = tornado_server.SourceCheckoutStaticHandler.__new__(
            tornado_server.SourceCheckoutStaticHandler)
        h.absolute_path = abs_path
        return h

    def test_the_etag_follows_the_file(self, tmp_path, monkeypatch):
        target = tmp_path / 'app.js'
        target.write_text('first build')
        handler = self._handler(str(target))

        first = handler.compute_etag()

        # Poison the cache the way a long-running server would have it, then
        # rebuild the file underneath.
        web.StaticFileHandler._static_hashes[str(target)] = 'stale-hash'
        target.write_text('second build, different bytes')
        second = handler.compute_etag()

        assert first and second
        assert first != second
        assert 'stale-hash' not in (second or '')

    def test_an_unreadable_file_yields_no_etag(self, tmp_path):
        handler = self._handler(str(tmp_path / 'does-not-exist.js'))

        assert handler.compute_etag() is None

    def test_no_path_yields_no_etag(self):
        assert self._handler(None).compute_etag() is None
