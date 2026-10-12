"""An automatic sync obeys the same thread discipline as a manual one (#140).

⛔ This is the test that makes automatic sync safe to have at all. The watcher
runs on a worker, and the obvious implementation -- "it already has a thread,
do the sync there" -- would put a second thread in front of `config.json`,
the one file whose corruption once left a server that could not start.

So the sequencing has to be the three phases `PcoSyncHandler` uses: load and
apply on the IOLoop, only the HTTP in between on a worker. Reading the code
cannot prove that; recording which thread each phase actually ran on can.
"""

import os
import sys
import threading
from unittest import mock

from tornado.testing import AsyncTestCase, gen_test

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tornado_server  # noqa: E402


class AutoSyncStaysOffTheLoopOnlyWhereItMay(AsyncTestCase):
    def setUp(self):
        super().setUp()
        self.threads = {}
        self.loop_thread = threading.get_ident()

    def _record(self, name, value):
        def fake(*args, **kwargs):
            self.threads[name] = threading.get_ident()
            return value
        return fake

    @gen_test
    async def test_the_writes_run_on_the_loop_and_the_http_does_not(self):
        decision = {'go': True, 'reason': 'changed', 'key': ('42', 'v2')}
        resolution = {'ok': True, 'resolved': []}
        result = {'ok': True, 'updates': 2, 'cleared': 0, 'skipped': []}

        with mock.patch.object(tornado_server.pco, 'auto_sync_decision',
                               self._record('decide', decision)), \
             mock.patch.object(tornado_server.pco, 'begin_sync',
                               self._record('begin', {'ok': True, 'config': {}})), \
             mock.patch.object(tornado_server.pco, 'resolve_sync',
                               self._record('resolve', resolution)), \
             mock.patch.object(tornado_server.pco, 'finish_sync',
                               self._record('finish', result)), \
             mock.patch.object(tornado_server.pco, 'note_auto_sync_attempt'), \
             mock.patch.object(tornado_server.pco, 'record_auto_sync',
                               self._record('record', {})):
            await tornado_server._auto_sync_if_due()

        # ⛔ Both phases that can touch config.json.
        assert self.threads['begin'] == self.loop_thread, 'begin_sync left the IOLoop'
        assert self.threads['finish'] == self.loop_thread, 'finish_sync left the IOLoop'
        assert self.threads['record'] == self.loop_thread

        # ⛔ And the one that is several seconds of HTTP.
        assert self.threads['resolve'] != self.loop_thread, 'resolve_sync ran on the IOLoop'
        assert self.threads['decide'] != self.loop_thread, 'the decision asks PCO; it ran on the loop'

    @gen_test
    async def test_nothing_is_written_when_the_decision_says_no(self):
        calls = []
        with mock.patch.object(tornado_server.pco, 'auto_sync_decision',
                               lambda running=False: {'go': False, 'reason': 'off'}), \
             mock.patch.object(tornado_server.pco, 'begin_sync',
                               lambda: calls.append('begin')), \
             mock.patch.object(tornado_server.pco, 'finish_sync',
                               lambda *a, **k: calls.append('finish')):
            await tornado_server._auto_sync_if_due()

        assert calls == []

    @gen_test
    async def test_the_attempt_is_marked_before_the_sync_not_after(self):
        # ⛔ A sync that throws halfway would otherwise never be marked, and
        # the watcher would start it again on the next tick, forever.
        order = []

        def boom(*args, **kwargs):
            order.append('resolve')
            raise RuntimeError('network gone')

        with mock.patch.object(tornado_server.pco, 'auto_sync_decision',
                               lambda running=False: {'go': True, 'key': ('42', 'v2')}), \
             mock.patch.object(tornado_server.pco, 'note_auto_sync_attempt',
                               lambda key: order.append('marked')), \
             mock.patch.object(tornado_server.pco, 'begin_sync',
                               lambda: {'ok': True, 'config': {}}), \
             mock.patch.object(tornado_server.pco, 'resolve_sync', boom):
            try:
                await tornado_server._auto_sync_if_due()
            except RuntimeError:
                pass

        assert order[0] == 'marked', 'the attempt must be recorded before it can fail'

    @gen_test
    async def test_a_failed_sync_does_not_leave_the_door_shut(self):
        # ⚠️ The running flag is held across an await. A sync that throws has
        # to clear it, or automatic sync is dead until the server restarts.
        with mock.patch.object(tornado_server.pco, 'auto_sync_decision',
                               lambda running=False: {'go': True, 'key': ('42', 'v2')}), \
             mock.patch.object(tornado_server.pco, 'note_auto_sync_attempt'), \
             mock.patch.object(tornado_server.pco, 'begin_sync',
                               mock.Mock(side_effect=RuntimeError('boom'))):
            try:
                await tornado_server._auto_sync_if_due()
            except RuntimeError:
                pass

        assert tornado_server._AUTO_SYNC_RUNNING is False

    @gen_test
    async def test_a_watcher_tick_survives_a_failing_automatic_sync(self):
        # The board keeps being told the plan changed, which is the behaviour
        # without this feature -- a strictly better failure than the tick dying.
        with mock.patch.object(tornado_server.pco, 'run_plan_watch', lambda: {}), \
             mock.patch.object(tornado_server, '_auto_sync_if_due',
                               mock.Mock(side_effect=RuntimeError('boom'))):
            await tornado_server._plan_watch_tick()
