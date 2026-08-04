"""localURL must not resolve the host on every request.

/data.json is polled every five seconds by every open board, and the handler is
synchronous, so a blocking resolver call inside it is held against the IOLoop
and every other request queues behind it. On a network where the host's own
name does not resolve, that lookup spends the full resolver timeout: observed
on site as a floor of just over 5000ms on every /data.json, with the backlog
climbing past 100 seconds.
"""

import os
import socket
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tornado_server  # noqa: E402


@pytest.fixture
def resolver(monkeypatch):
    """Count resolver calls and let a test make them slow or failing."""
    calls = []

    def fake_gethostname():
        return 'board.local'

    def fake_gethostbyname(name):
        calls.append(name)
        if resolver.delay:
            time.sleep(resolver.delay)
        if resolver.fail:
            raise OSError('name resolution timed out')
        return '10.100.50.10'

    resolver.delay = 0
    resolver.fail = False
    resolver.calls = calls

    monkeypatch.setattr(socket, 'gethostname', fake_gethostname)
    monkeypatch.setattr(socket, 'gethostbyname', fake_gethostbyname)
    monkeypatch.setattr(tornado_server.config, 'config_tree', {'port': 8058}, raising=False)
    monkeypatch.setattr(tornado_server, '_LOCAL_URL_CACHE', None, raising=False)
    return resolver


def test_repeated_calls_resolve_once(resolver):
    urls = [tornado_server.localURL() for _ in range(10)]

    assert len(resolver.calls) == 1
    assert urls == ['http://10.100.50.10:8058'] * 10


def test_a_failing_lookup_is_cached_too(resolver):
    # The expensive case is the one that times out, so it is the one that most
    # needs to not repeat -- caching only successes would leave the fault intact.
    resolver.fail = True

    for _ in range(10):
        tornado_server.localURL()

    assert len(resolver.calls) == 1


def test_a_slow_lookup_is_paid_once_not_per_request(resolver):
    resolver.delay = 0.2

    started = time.monotonic()
    for _ in range(5):
        tornado_server.localURL()
    elapsed = time.monotonic() - started

    # Five requests used to cost five timeouts; now they cost one.
    assert elapsed < 0.2 * 3
    assert len(resolver.calls) == 1


def test_the_address_is_still_refreshed(resolver):
    """Caching must not pin the address forever -- the host's IP can change."""
    tornado_server.localURL()
    cached_url, _deadline = tornado_server._LOCAL_URL_CACHE
    tornado_server._LOCAL_URL_CACHE = (cached_url, time.monotonic() - 1)

    tornado_server.localURL()

    assert len(resolver.calls) == 2


def test_configured_local_url_skips_resolution(resolver, monkeypatch):
    monkeypatch.setattr(
        tornado_server.config, 'config_tree',
        {'port': 8058, 'local_url': 'http://board.example:8058'}, raising=False)

    assert tornado_server.localURL() == 'http://board.example:8058'
    assert resolver.calls == []
