"""What the interface needs in order to explain "no devices found".

That outcome looked identical in three different situations: a scan had run and
come back empty, there was nothing configured to scan at all, or the board had
only just started and had not looked yet. The interface could say nothing useful
because the server never told it which -- so it said nothing, and an operator
whose receivers were missing had no next step except a third-party tool (#51,
split out of #21).

Reporting the networks actually swept also answers the question underneath the
complaint: an operator can see the scan covered 192.168.1.0/24 while their
receivers are on 10.100.50.x.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import discover  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_status(monkeypatch):
    """Each test starts from the never-scanned state."""
    monkeypatch.setattr(discover, 'scan_status', {
        'has_scanned': False,
        'last_scan_at': None,
        'networks': [],
        'found': 0,
        'platform': sys.platform,
    }, raising=False)
    monkeypatch.setattr(discover, 'discovered', [], raising=False)
    yield


def test_before_any_scan_the_status_says_so():
    """A board that has only just started must not be reported as "found nothing"."""
    status = discover.get_scan_status()

    assert status['has_scanned'] is False
    assert status['networks'] == []


def test_a_completed_scan_reports_the_networks_it_swept(monkeypatch):
    swept = []
    monkeypatch.setattr(discover, '_probe_network', lambda net, timeout: swept.append(str(net)))
    monkeypatch.setattr(discover, '_candidate_subnets',
                        lambda settings: [discover.ipaddress.ip_network('192.168.1.0/24')])

    discover._run_active_scan({'timeout_ms': 750})

    status = discover.get_scan_status()
    assert status['has_scanned'] is True
    assert status['networks'] == ['192.168.1.0/24']
    assert status['last_scan_at'] is not None
    assert swept == ['192.168.1.0/24']


def test_nothing_to_scan_is_recorded_as_its_own_state(monkeypatch):
    """Distinct from "scanned and found nothing", and the one an operator can fix.

    Skipping the record here would leave has_scanned False forever, so the
    interface would go on saying "still looking" about a board that is not
    looking anywhere.
    """
    monkeypatch.setattr(discover, '_candidate_subnets', lambda settings: [])

    discover._run_active_scan({'timeout_ms': 750})

    status = discover.get_scan_status()
    assert status['has_scanned'] is True
    assert status['networks'] == []


def test_a_scan_cut_short_by_shutdown_is_not_reported_as_complete(monkeypatch):
    """It never swept what it claims; reporting coverage it did not have would lie."""
    def die(net, timeout):
        raise RuntimeError('shutting down')

    monkeypatch.setattr(discover, '_probe_network', die)
    monkeypatch.setattr(discover, '_candidate_subnets',
                        lambda settings: [discover.ipaddress.ip_network('10.0.0.0/24')])

    discover._run_active_scan({'timeout_ms': 750})

    assert discover.get_scan_status()['has_scanned'] is False


def test_the_found_count_comes_from_what_discovery_holds(monkeypatch):
    monkeypatch.setattr(discover, 'discovered', [{'ip': '10.0.0.5'}, {'ip': '10.0.0.6'}],
                        raising=False)
    monkeypatch.setattr(discover, '_probe_network', lambda net, timeout: None)
    monkeypatch.setattr(discover, '_candidate_subnets',
                        lambda settings: [discover.ipaddress.ip_network('10.0.0.0/24')])

    discover._run_active_scan({'timeout_ms': 750})

    assert discover.get_scan_status()['found'] == 2


def test_the_platform_reported_is_the_boards_not_the_browsers():
    """The permission that can silently block discovery belongs to the machine
    running the service, which is not necessarily the one looking at the page."""
    assert discover.get_scan_status()['platform'] == sys.platform


def test_the_status_is_a_copy_callers_cannot_corrupt():
    status = discover.get_scan_status()
    status['networks'].append('tampered')

    assert discover.get_scan_status()['networks'] == []
