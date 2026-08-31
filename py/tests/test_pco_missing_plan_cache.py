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


@pytest.fixture
def plan_is_gone(monkeypatch):
    """The plan resource itself answers 404 -- the plan really has been deleted.

    Needed by every test whose sweep ends in a 404. The sweep's trailing
    status is no longer enough to condemn a plan; `_plan_is_really_gone` asks
    Planning Center about the plan itself, and without this stub these tests
    would reach the real network.
    """
    monkeypatch.setattr(pco, '_plan_is_really_gone', lambda *_a, **_k: True)


@pytest.fixture
def plan_is_alive(monkeypatch):
    """The plan resource answers -- it exists, its roster just could not be read."""
    monkeypatch.setattr(pco, '_plan_is_really_gone', lambda *_a, **_k: False)


def test_a_404_is_remembered_so_the_second_lookup_costs_nothing(monkeypatch, creds, plan_is_gone):
    fail = Counter(404)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    first = pco.list_people_for_plan('89808074')
    assert first['ok'] is False
    assert first['error'] == pco.PLAN_GONE_ERROR
    assert fail.calls == 1

    second = pco.list_people_for_plan('89808074')
    assert second['error'] == pco.PLAN_GONE_ERROR
    assert fail.calls == 1, 'a plan already known to be gone was requested again'


def test_the_teams_lookup_shares_the_same_memory(monkeypatch, creds, plan_is_gone):
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


def test_the_memory_expires(monkeypatch, creds, plan_is_gone):
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


def test_a_live_plan_with_an_empty_roster_is_not_recorded_as_gone(monkeypatch, creds, plan_is_alive):
    """The misclassification behind the report, and the reason the entry existed.

    `_get_plan_people_any` sweeps the generic path, the plan's own service type,
    then every service type over three endpoints each, then generic
    team_members. Whatever `_LAST_HTTP_ERROR` holds at the end is the status of
    whichever probe ran last -- so a plan nobody is scheduled on yet finishes
    the sweep looking exactly like a deleted one.

    Condemning it on that evidence put a live plan in a five-minute cache, and
    until #90 the operator was then answered from it.
    """
    fail = Counter(404)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    result = pco.list_people_for_plan('89808074')

    assert result['ok'] is False
    assert result['error'] == pco.PLAN_PEOPLE_UNREADABLE_ERROR
    assert result['error'] != pco.PLAN_GONE_ERROR
    assert pco._plan_is_known_missing('89808074') is False, (
        'a plan Planning Center still has must never be cached as gone')

    # And because nothing was cached, the next look actually looks.
    pco.list_people_for_plan('89808074')
    assert fail.calls == 2


def test_the_teams_lookup_makes_the_same_distinction(monkeypatch, creds, plan_is_alive):
    fail = Counter(404)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    teams = pco.list_teams_for_plan('89808074')

    assert teams['error'] == pco.PLAN_PEOPLE_UNREADABLE_ERROR
    assert pco._plan_is_known_missing('89808074') is False


def test_the_plan_itself_is_what_decides(monkeypatch, creds):
    """`_plan_is_really_gone` asks about the plan, and reads only that answer."""
    asked = []

    def fake_get(url, _headers, params=None):
        asked.append(url)
        pco._LAST_HTTP_ERROR = 404
        return None

    monkeypatch.setattr(pco, '_http_get', fake_get)
    assert pco._plan_is_really_gone('89808074', {}) is True
    assert asked == ['{}/plans/89808074'.format(pco.BASE_URL)], (
        'the plan resource is the only thing worth asking')

    def found(url, _headers, params=None):
        asked.append(url)
        pco._LAST_HTTP_ERROR = None
        return {'data': {'id': '89808074'}}

    monkeypatch.setattr(pco, '_http_get', found)
    assert pco._plan_is_really_gone('89808074', {}) is False


def test_a_transient_failure_costs_no_extra_request(monkeypatch, creds):
    """Only a 404 earns the second look; a timeout or a 500 is evidence of nothing."""
    probe = Counter(None)
    monkeypatch.setattr(pco, '_plan_is_really_gone', probe)

    for status in (None, 500):
        pco._MISSING_PLANS.clear()
        monkeypatch.setattr(pco, '_get_plan_people_any', Counter(status))
        pco.list_people_for_plan('89808074')

    assert probe.calls == 0, 'the plan was asked about on a failure that proves nothing'


def test_a_poll_inside_the_ttl_is_answered_from_memory(monkeypatch, creds):
    """The deliberate cost of the cache, pinned so it is a decision not a surprise.

    For an unforced lookup the guard returns before any request, so a plan that
    comes back to life inside the TTL is still reported gone. That is the
    accepted trade for polling: the alternative is paying two round trips to
    find out, every poll, for as long as the plan stays dead -- the #73 fault.
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
    assert live.calls == 0, 'an unforced lookup should short-circuit before the network'


def test_an_operator_request_is_never_answered_from_memory(monkeypatch, creds):
    """The bug reported from a board on 2026-08-30.

    Pick a plan, press Load People, get "that plan no longer exists" -- and keep
    getting it, without a request leaving the machine, because the entry is
    consulted before the network and lasts five minutes. Nothing the operator
    could press cleared it; restarting did, which is why it was reported as
    "Wirelessboard has to be restarted for a new plan's people to load".

    The cache was built to spare *polls*, never to answer a person.
    """
    live = Counter(None)

    def would_succeed(*_args, **_kwargs):
        live.calls += 1
        pco._LAST_HTTP_ERROR = None
        return PLAN_PEOPLE

    monkeypatch.setattr(pco, '_get_plan_people_any', would_succeed)
    pco._remember_missing_plan('89808074')

    result = pco.list_people_for_plan('89808074', force=True)

    assert live.calls == 1, 'the operator asked; the network should have been used'
    assert result['ok'] is True
    assert pco._plan_is_known_missing('89808074') is False, (
        'a forced lookup must also clear the entry, or the next poll still lies')


def test_a_forced_teams_lookup_clears_it_too(monkeypatch, creds):
    # The team chooser reloads whenever the plan changes, so it is an operator
    # action by the same argument -- and it shares the one memory.
    monkeypatch.setattr(pco, '_get_plan_people_any', lambda *_a, **_k: PLAN_PEOPLE)
    pco._remember_missing_plan('89808074')

    teams = pco.list_teams_for_plan('89808074', force=True)

    assert teams['ok'] is True
    assert pco._plan_is_known_missing('89808074') is False


def test_forcing_still_records_a_plan_that_really_is_gone(monkeypatch, creds, plan_is_gone):
    # Bypassing the memory must not stop it being written: a genuinely dead plan
    # found the hard way should still spare the next poll.
    fail = Counter(404)
    monkeypatch.setattr(pco, '_get_plan_people_any', fail)

    result = pco.list_people_for_plan('89808074', force=True)

    assert result['error'] == pco.PLAN_GONE_ERROR
    assert pco._plan_is_known_missing('89808074') is True


def test_a_success_after_expiry_clears_the_memory(monkeypatch, creds):
    # Once the entry lapses the plan is retried, and a lookup that works must
    # leave nothing behind -- otherwise a recovered plan would be re-marked
    # gone every time the entry aged out.
    monkeypatch.setattr(pco, '_get_plan_people_any', lambda *_a, **_k: PLAN_PEOPLE)
    pco._MISSING_PLANS['89808074'] = pco.time.monotonic() - 1  # already lapsed

    result = pco.list_people_for_plan('89808074')
    assert result['ok'] is True
    assert pco._plan_is_known_missing('89808074') is False


def test_one_dead_plan_does_not_block_another(monkeypatch, creds, plan_is_gone):
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
