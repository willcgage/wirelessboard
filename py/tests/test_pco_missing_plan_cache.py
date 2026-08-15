"""A plan that has rolled off the schedule should stop costing round trips.

Every lookup against a dead plan paid for two requests -- the service-scoped
URL and then the global fallback -- and the PCO panel polls, so a board left
running past a plan's date re-paid that indefinitely. With the calls on the
IOLoop that was the ~20s freeze reported in #73; off the IOLoop it is merely
waste, but it is waste with an operator staring at a spinner.

Only a 404 is cached. A timeout or a connection error may well be transient,
and refusing to retry those would turn a blip into an outage.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


PLAN_PEOPLE = {'data': [], 'included': []}


@pytest.fixture(autouse=True)
def clean_cache():
    pco._MISSING_PLANS.clear()
    pco._LAST_HTTP_ERROR = None
    yield
    pco._MISSING_PLANS.clear()
    pco._LAST_HTTP_ERROR = None


@pytest.fixture
def creds(monkeypatch):
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'},
        'mapping': {},
    })


class Counter:
    """Stands in for the network, counting what it was asked for."""

    def __init__(self, status):
        self.calls = 0
        self.status = status

    def __call__(self, *_args, **_kwargs):
        self.calls += 1
        pco._LAST_HTTP_ERROR = self.status
        return None


def test_a_404_is_remembered_so_the_second_lookup_costs_nothing(monkeypatch, creds):
    fail = Counter(404)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    first = pco.list_people_for_plan('89808074')
    assert first['ok'] is False
    assert first['error'] == pco.PLAN_GONE_ERROR
    assert fail.calls == 1

    second = pco.list_people_for_plan('89808074')
    assert second['error'] == pco.PLAN_GONE_ERROR
    assert fail.calls == 1, 'a plan already known to be gone was requested again'


def test_the_teams_lookup_shares_the_same_memory(monkeypatch, creds):
    # Both panels ask about the same plan; one of them learning it is gone
    # should spare the other.
    fail = Counter(404)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    pco.list_people_for_plan('89808074')
    assert fail.calls == 1

    teams = pco.list_teams_for_plan('89808074')
    assert teams['ok'] is False
    assert teams['error'] == pco.PLAN_GONE_ERROR
    assert fail.calls == 1


def test_a_timeout_is_not_cached(monkeypatch, creds):
    # _http_get reports None for a connection error, leaving no status. Caching
    # that would turn a blip into an outage lasting the whole TTL.
    fail = Counter(None)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    first = pco.list_people_for_plan('89808074')
    assert first['ok'] is False
    assert first['error'] != pco.PLAN_GONE_ERROR

    pco.list_people_for_plan('89808074')
    assert fail.calls == 2, 'a transient failure should be retried'


def test_a_500_is_not_cached(monkeypatch, creds):
    fail = Counter(500)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    pco.list_people_for_plan('89808074')
    pco.list_people_for_plan('89808074')
    assert fail.calls == 2


def test_the_memory_expires(monkeypatch, creds):
    fail = Counter(404)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    pco.list_people_for_plan('89808074')
    assert fail.calls == 1

    # A plan can reappear -- an id corrected upstream, a plan un-deleted -- so
    # the answer has to be allowed to go stale.
    now = [0.0]
    monkeypatch.setattr(pco.time, 'monotonic', lambda: now[0])
    pco._MISSING_PLANS['89808074'] = 10.0
    now[0] = 11.0

    pco.list_people_for_plan('89808074')
    assert fail.calls == 2


def test_while_cached_the_plan_is_not_re_requested_even_if_it_would_now_work(monkeypatch, creds):
    """The deliberate cost of the cache, pinned so it is a decision not a surprise.

    The guard returns before any request, so a plan that comes back to life
    inside the TTL is still reported gone. That is the accepted trade: the
    alternative is paying two round trips to find out, every poll, for as long
    as the plan stays dead -- which is the fault being fixed.
    """
    live = Counter(None)

    def would_succeed(*_args, **_kwargs):
        live.calls += 1
        pco._LAST_HTTP_ERROR = None
        return PLAN_PEOPLE

    monkeypatch.setattr(pco, '_get_plan_people_any', would_succeed)
    pco._remember_missing_plan('89808074')

    result = pco.list_people_for_plan('89808074')
    assert result['ok'] is False
    assert live.calls == 0, 'the cache should short-circuit before the network'


def test_a_success_after_expiry_clears_the_memory(monkeypatch, creds):
    # Once the entry lapses the plan is retried, and a lookup that works must
    # leave nothing behind -- otherwise a recovered plan would be re-marked
    # gone every time the entry aged out.
    monkeypatch.setattr(pco, '_get_plan_people_any', lambda *_a, **_k: PLAN_PEOPLE)
    pco._MISSING_PLANS['89808074'] = pco.time.monotonic() - 1  # already lapsed

    result = pco.list_people_for_plan('89808074')
    assert result['ok'] is True
    assert pco._plan_is_known_missing('89808074') is False


def test_one_dead_plan_does_not_block_another(monkeypatch, creds):
    seen = []

    def selective(plan_id, *_args, **_kwargs):
        seen.append(plan_id)
        if plan_id == 'dead':
            pco._LAST_HTTP_ERROR = 404
            return None
        pco._LAST_HTTP_ERROR = None
        return PLAN_PEOPLE

    monkeypatch.setattr(pco, '_get_plan_people_any', selective)

    assert pco.list_people_for_plan('dead')['ok'] is False
    assert pco.list_people_for_plan('alive')['ok'] is True
    assert pco._plan_is_known_missing('dead') is True
    assert pco._plan_is_known_missing('alive') is False
