"""How many boards are watching this server (#116).

The per-device / everyone split already existed and nothing said so. A save
from a phone reloads every connected board and drops the receiver sockets for
a couple of seconds -- during a service, which is when saves happen. Before an
operator can be told that, the server has to be able to say how many boards
would be affected.

⚠️ Boards, not people. Two tabs on one laptop are two clients and the server
cannot tell them apart, so everything an operator reads says "boards".
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tornado_server  # noqa: E402


class FakeClient:
    """Stands in for a websocket connection: the handler only ever counts them."""


@pytest.fixture
def no_clients(monkeypatch):
    monkeypatch.setattr(tornado_server.SocketHandler, 'clients', set())
    return tornado_server.SocketHandler


def test_an_empty_board_has_no_viewers(no_clients):
    assert no_clients.viewer_count() == 0


def test_every_connected_board_is_counted(no_clients):
    for _ in range(3):
        no_clients.clients.add(FakeClient())

    assert no_clients.viewer_count() == 3


def test_a_board_that_goes_away_stops_being_counted(no_clients):
    client = FakeClient()
    no_clients.clients.add(client)
    assert no_clients.viewer_count() == 1

    no_clients.clients.remove(client)
    assert no_clients.viewer_count() == 0


def test_the_count_is_a_plain_number_the_payload_can_carry(no_clients):
    no_clients.clients.add(FakeClient())
    count = no_clients.viewer_count()

    # It is serialised into data.json, so it has to survive JSON unchanged --
    # a set's length is an int, but this pins it against someone returning the
    # set itself and finding out from a 500 in the field.
    import json
    assert json.loads(json.dumps({'viewers': count}))['viewers'] == 1
