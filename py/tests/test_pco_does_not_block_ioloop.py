"""A slow Planning Center call must not stop the rest of the board.

The PCO handlers were plain synchronous methods calling requests with a 10s
timeout. Tornado runs one thread, so each one held the IOLoop for its whole
round trip -- no other request, no websocket frame, no device poll. A plan that
had rolled off the schedule was the worst case, because the lookup tries the
service-scoped URL and then falls back to the global one, so an unresponsive
API cost two timeouts back to back. That is the freeze reported in #73.

These tests pin the property that matters and would otherwise only be visible
at a venue: while a PCO call is in flight, other requests are still served.
"""

import json
import os
import sys
import threading
import time
from unittest import mock

import tornado.web as web
from tornado.testing import AsyncHTTPTestCase, gen_test

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tornado_server  # noqa: E402


class Probe(web.RequestHandler):
    """Something cheap to ask for while PCO is busy."""

    def get(self):
        self.write('{"alive": true}')


class PcoDoesNotBlockTheLoop(AsyncHTTPTestCase):
    def get_app(self):
        return web.Application([
            (r'/api/pco/people', tornado_server.PcoPeopleHandler),
            (r'/api/pco/services', tornado_server.PcoServicesHandler),
            (r'/probe', Probe),
        ])

    @gen_test
    async def test_a_slow_lookup_does_not_delay_another_request(self):
        """Both requests are launched, then raced. The probe must finish first.

        ⛔ Do not rewrite this to wait for the PCO call to start before sending
        the probe. Any such wait runs *on the IOLoop*, which is precisely what a
        blocking handler is holding -- so the wait cannot proceed until the call
        has already finished, the probe is then sent into an idle loop, and the
        test passes against the very code it is meant to catch. That mistake was
        made here first; the fix is to send both and compare.
        """
        PCO_SECONDS = 1.0

        def slow_people(*_args, **_kwargs):
            time.sleep(PCO_SECONDS)
            return {"ok": True, "people": []}

        with mock.patch.object(tornado_server.pco, 'list_people_for_plan', slow_people):
            began = time.monotonic()
            slow = self.http_client.fetch(self.get_url('/api/pco/people?plan=89808074'))
            probe = self.http_client.fetch(self.get_url('/probe'))

            probe_response = await probe
            probe_elapsed = time.monotonic() - began

            slow_response = await slow
            slow_elapsed = time.monotonic() - began

        assert probe_response.code == 200
        assert json.loads(slow_response.body)['ok'] is True

        # The PCO call really did take its time...
        assert slow_elapsed >= PCO_SECONDS * 0.8, (
            f'the slow handler only took {slow_elapsed:.2f}s; the test proves nothing'
        )
        # ...and the board answered anyway. On the old synchronous handler the
        # probe could not be served until the sleep was over, so this was ~1s.
        assert probe_elapsed < PCO_SECONDS / 2, (
            f'the probe waited {probe_elapsed:.2f}s behind a {slow_elapsed:.2f}s PCO call'
        )

    @gen_test
    async def test_two_pco_calls_stay_serialized(self):
        """One worker on purpose -- pco.py's error reporting depends on it.

        pco.py records the status of the most recent failed request in a module
        global so a caller that only receives None can still say why it failed.
        That is only sound while the calls do not interleave, so the executor
        has a single worker and this pins it.
        """
        overlapped = []
        active = []
        lock = threading.Lock()

        def watcher(*_args, **_kwargs):
            with lock:
                active.append(1)
                if len(active) > 1:
                    overlapped.append(1)
            time.sleep(0.2)
            with lock:
                active.pop()
            return {"ok": True}

        with mock.patch.object(tornado_server.pco, 'list_service_types', watcher):
            both = [
                self.http_client.fetch(self.get_url('/api/pco/services')),
                self.http_client.fetch(self.get_url('/api/pco/services')),
            ]
            for f in both:
                await f

        assert not overlapped, 'PCO calls ran concurrently; _LAST_HTTP_ERROR is no longer sound'

    def test_the_executor_has_exactly_one_worker(self):
        # The invariant above, stated where someone changing the pool will see
        # it before the tests get a chance to fail.
        assert tornado_server._PCO_EXECUTOR._max_workers == 1

    def test_the_sync_handler_is_still_synchronous(self):
        """Deliberate: sync_from_pco writes config.json.

        Holding the IOLoop is what currently stops that racing the other
        handlers that write the file. If this ever becomes async, the config
        write path needs to be thread-safe first.
        """
        import inspect

        assert not inspect.iscoroutinefunction(tornado_server.PcoSyncHandler.post)
        for handler in (
            tornado_server.PcoPeopleHandler,
            tornado_server.PcoTeamsHandler,
            tornado_server.PcoPlansHandler,
            tornado_server.PcoServicesHandler,
            tornado_server.PcoNotesHandler,
            tornado_server.PcoPreviewHandler,
        ):
            assert inspect.iscoroutinefunction(handler.get), f'{handler.__name__}.get blocks the IOLoop'
