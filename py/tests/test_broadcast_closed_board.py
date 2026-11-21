"""A board going away mid-broadcast is not an ERROR in the log.

⛔⛔ Measured on the venue board: 815 "Task exception was never retrieved"
tracebacks in three days, each one a `WebSocketClosedError` from a frame sent
to a board that had just closed. `write_message` returns a future; nothing read
it, so asyncio reported each failure when the future was collected.
"""

import asyncio
import gc

import pytest
import tornado.websocket as websocket

import tornado_server


class FakeConnection:
    def __init__(self, closing=False):
        self._closing = closing

    def is_closing(self):
        return self._closing


class FakeClient:
    def __init__(self, sent=None, closing=False, raises=None):
        self.ws_connection = FakeConnection(closing)
        self._sent = sent
        self._raises = raises
        self.calls = 0

    def write_message(self, data):
        self.calls += 1
        if self._raises is not None:
            raise self._raises
        return self._sent


@pytest.fixture
def clients(monkeypatch):
    monkeypatch.setattr(tornado_server.SocketHandler, 'clients', set())
    return tornado_server.SocketHandler.clients


def _unretrieved_after(fail_with, clients, consume):
    """Broadcast to one board whose send then fails; return what asyncio said."""
    loop = asyncio.new_event_loop()
    reported = []
    loop.set_exception_handler(lambda _loop, context: reported.append(context))
    try:
        sent = loop.create_future()
        clients.add(FakeClient(sent=sent))
        if consume:
            tornado_server.SocketHandler.broadcast('{}')
        sent.set_exception(fail_with)
        loop.run_until_complete(asyncio.sleep(0))
        clients.clear()
        del sent
        gc.collect()
    finally:
        loop.close()
    return reported


def test_the_unread_future_is_what_the_log_was_full_of(clients):
    # ⚠️ The control: proves this harness CAN see the fault, so the test below
    # passing means the fault is gone rather than invisible.
    assert _unretrieved_after(websocket.WebSocketClosedError(), clients, consume=False)


def test_a_board_closing_mid_send_is_consumed_quietly(clients):
    assert _unretrieved_after(websocket.WebSocketClosedError(), clients, consume=True) == []


def test_a_real_send_failure_is_still_said(clients, caplog):
    assert _unretrieved_after(RuntimeError('boom'), clients, consume=True) == []
    assert 'WebSocket send failed: boom' in caplog.text


def test_a_board_already_closing_is_not_written_to(clients):
    closing = FakeClient(closing=True)
    clients.add(closing)
    tornado_server.SocketHandler.broadcast('{}')
    assert closing.calls == 0


def test_a_close_raised_at_the_call_is_not_a_warning(clients, caplog):
    clients.add(FakeClient(raises=websocket.WebSocketClosedError()))
    tornado_server.SocketHandler.broadcast('{}')
    assert 'broadcast failed' not in caplog.text
