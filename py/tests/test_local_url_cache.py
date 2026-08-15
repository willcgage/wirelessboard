"""localURL must never resolve the host on a request.

/data.json is polled every five seconds by every open board, and the handler is
synchronous, so a blocking resolver call inside it is held against the IOLoop
and every other request queues behind it. On a network where the host's own
name does not resolve, that lookup spends the full resolver timeout: observed
on site as a floor of just over 5000ms on every /data.json, with the backlog
climbing past 100 seconds.

That was first addressed with a 60s cache, which turned "every request pays"
into "one request a minute pays". A venue running 1.11.0 then reported the
remainder: a 5 second freeze of the entire board, once a minute, for as long as
it was left running (#74). The resolution now happens on a worker thread at
startup and on a timer, and localURL only reads the answer -- so these tests
are about it never blocking at all, rather than about how often it blocks.
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
    monkeypatch.setattr(tornado_server, '_LOCAL_URL', None, raising=False)
    monkeypatch.setattr(tornado_server, '_LOCAL_URL_SLOW_WARNED', False, raising=False)
    return resolver


def test_localurl_never_resolves(resolver):
    """The whole point. Reading the address must cost nothing."""
    for _ in range(10):
        tornado_server.localURL()

    assert resolver.calls == [], 'localURL resolved the host on a request path'


def test_a_slow_resolver_does_not_delay_a_request(resolver):
    # Five seconds is what the venue saw. If this ever blocks again it will be
    # obvious here rather than in a log file six weeks later.
    resolver.delay = 5.0

    started = time.monotonic()
    for _ in range(5):
        tornado_server.localURL()
    elapsed = time.monotonic() - started

    assert elapsed < 0.1, f'localURL waited {elapsed:.2f}s on the resolver'


def test_the_background_refresh_supplies_the_address(resolver):
    assert tornado_server.localURL() == 'https://github.com/willcgage/wirelessboard'

    tornado_server.refresh_local_url().result()

    assert resolver.calls == ['board.local']
    assert tornado_server.localURL() == 'http://10.100.50.10:8058'


def test_a_failing_lookup_leaves_the_fallback_and_does_not_raise(resolver):
    resolver.fail = True

    tornado_server.refresh_local_url().result()

    assert tornado_server.localURL() == 'https://github.com/willcgage/wirelessboard'


def test_the_address_is_refreshed_rather_than_pinned(resolver, monkeypatch):
    """The host's IP can change under DHCP, so a startup-only answer goes stale."""
    tornado_server.refresh_local_url().result()
    assert tornado_server.localURL() == 'http://10.100.50.10:8058'

    monkeypatch.setattr(socket, 'gethostbyname', lambda _name: '10.100.50.99')
    tornado_server.refresh_local_url().result()

    assert tornado_server.localURL() == 'http://10.100.50.99:8058'


def test_a_refresh_in_flight_does_not_block_a_reader(resolver):
    resolver.delay = 1.0
    future = tornado_server.refresh_local_url()

    started = time.monotonic()
    url = tornado_server.localURL()
    elapsed = time.monotonic() - started

    assert elapsed < 0.1
    assert url == 'https://github.com/willcgage/wirelessboard'
    future.result()
    assert tornado_server.localURL() == 'http://10.100.50.10:8058'


def test_configured_local_url_skips_resolution(resolver, monkeypatch):
    monkeypatch.setattr(
        tornado_server.config, 'config_tree',
        {'port': 8058, 'local_url': 'http://board.example:8058'}, raising=False)

    assert tornado_server.localURL() == 'http://board.example:8058'
    assert resolver.calls == []


def test_the_slow_warning_is_said_once_not_every_refresh(resolver, caplog):
    """Once is a diagnosis; every five minutes is noise in the log."""
    resolver.delay = 1.2

    with caplog.at_level('WARNING', logger='micboard.web'):
        tornado_server.refresh_local_url().result()
        tornado_server.refresh_local_url().result()
        tornado_server.refresh_local_url().result()

    warnings = [r for r in caplog.records if 'Resolving this host took' in r.getMessage()]
    assert len(warnings) == 1
