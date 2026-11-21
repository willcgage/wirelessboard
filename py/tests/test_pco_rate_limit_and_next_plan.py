"""Three Planning Center assumptions that did not hold (2026-11-21 review).

1. An automatic sync acts on the plan the watcher was watching -- it did not;
   `auto_sync_decision` now names that plan and the profile that put it there.
2. "Next plan" means an upcoming plan -- the last fallback had no filter, and
   Planning Center lists plans oldest first.
3. A 429 is handled -- it was just another failed GET, and the roster sweep
   kept asking.
"""

import os
import sys
from unittest import mock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


class FakeResponse:
    def __init__(self, status, body=None, headers=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.headers = headers or {}
        self.text = ''

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def clean_rate_limit():
    pco.forget_rate_limit()
    yield
    pco.forget_rate_limit()


# --- 1. the automatic sync's plan and rules ------------------------------------

class TestAutoSyncDecisionNamesThePlan:
    def test_it_carries_the_watched_plan_and_the_last_profile(self, monkeypatch):
        monkeypatch.setattr(pco, 'plan_watch_status',
                            lambda: {'plan_id': '91062751', 'updated_at': 'v2', 'changed': True})
        monkeypatch.setattr(pco, 'last_sync',
                            lambda: {'plan_id': '91062751', 'profile_id': 'christmas'})
        monkeypatch.setattr(pco, 'auto_sync_mapping', lambda: {'auto_sync': True})
        monkeypatch.setattr(pco.pco_auto_sync, 'should_auto_sync',
                            lambda *a, **k: (True, 'changed'))

        decision = pco.auto_sync_decision()

        assert decision['plan_id'] == '91062751'
        assert decision['profile_id'] == 'christmas'

    def test_the_base_mapping_is_no_profile_not_an_empty_one(self, monkeypatch):
        # '' would reach select_profile as a hand-picked id that does not exist.
        monkeypatch.setattr(pco, 'plan_watch_status', lambda: {'plan_id': '1', 'updated_at': 'v'})
        monkeypatch.setattr(pco, 'last_sync', lambda: {'plan_id': '1', 'profile_id': ''})
        monkeypatch.setattr(pco, 'auto_sync_mapping', lambda: {})
        monkeypatch.setattr(pco.pco_auto_sync, 'should_auto_sync', lambda *a, **k: (True, ''))

        assert pco.auto_sync_decision()['profile_id'] is None


# --- 2. "next" never means the oldest plan -------------------------------------

class TestNextPlanNeverDropsTheFutureFilter:
    def test_every_request_asks_for_future_plans(self, monkeypatch):
        asked = []

        def fake_get(url, headers, params=None, **kwargs):
            asked.append(dict(params or {}))
            return {'data': []}

        monkeypatch.setattr(pco, '_http_get', fake_get)

        assert pco._get_next_plan_id(7, {}) is None
        assert asked, 'it asked nothing'
        assert all(p.get('filter') == 'future' for p in asked), asked

    def test_planted_unfiltered_fallback_would_be_caught(self, monkeypatch):
        # ⛔ Plant the violation: if any request lacks the filter, the plan it
        # returns must not be the answer. An oldest-first list served only to an
        # unfiltered request proves the guard above can fail.
        def fake_get(url, headers, params=None, **kwargs):
            if (params or {}).get('filter') != 'future':
                return {'data': [{'id': 'OLDEST'}]}
            return {'data': []}

        monkeypatch.setattr(pco, '_http_get', fake_get)

        assert pco._get_next_plan_id(7, {}) != 'OLDEST'


# --- 3. the rate limit ---------------------------------------------------------

class TestRateLimit:
    def test_a_429_stops_further_requests_until_the_wait_is_over(self):
        calls = []

        def get(url, **kwargs):
            calls.append(url)
            return FakeResponse(429, headers={'Retry-After': '17'})

        with mock.patch.object(pco.requests, 'get', get):
            assert pco._http_get('https://x/a', {}) is None
            assert pco._http_get('https://x/b', {}) is None
            assert pco._http_get('https://x/c', {}, probe=True) is None

        assert calls == ['https://x/a'], 'it kept asking after being told to wait'
        assert pco._LAST_HTTP_ERROR == 429
        assert 1 <= pco.rate_limit_remaining() <= 17

    def test_it_asks_again_once_the_wait_is_over(self):
        responses = [FakeResponse(429, headers={'Retry-After': '5'}),
                     FakeResponse(200, body={'data': 'ok'})]
        with mock.patch.object(pco.requests, 'get', lambda url, **k: responses.pop(0)):
            assert pco._http_get('https://x/a', {}) is None
            pco.forget_rate_limit()  # the wait has passed
            assert pco._http_get('https://x/a', {}) == {'data': 'ok'}

    def test_a_missing_or_silly_retry_after_is_bounded(self):
        assert pco._retry_after_seconds(FakeResponse(429)) == pco._RATE_LIMIT_DEFAULT_SECONDS
        assert pco._retry_after_seconds(FakeResponse(429, headers={'Retry-After': 'soon'})) \
            == pco._RATE_LIMIT_DEFAULT_SECONDS
        assert pco._retry_after_seconds(FakeResponse(429, headers={'Retry-After': '99999'})) \
            == pco._RATE_LIMIT_MAX_SECONDS
        assert pco._retry_after_seconds(FakeResponse(429, headers={'Retry-After': '0'})) == 1

    def test_the_operator_is_told_to_wait_not_that_nobody_is_scheduled(self, monkeypatch):
        with mock.patch.object(pco.requests, 'get',
                               lambda url, **k: FakeResponse(429, headers={'Retry-After': '20'})):
            pco._http_get('https://x/a', {})

        failure = pco.PlanPeopleFailure('service_types/7/plans/1/plan_people', 404)
        # The scoped read said 404, then the sweep hit the limit: still a wait.
        monkeypatch.setattr(pco, '_plan_is_really_gone', lambda *a: pytest.fail('asked PCO again'))
        message = pco._plan_people_error(failure, '1', {})

        assert 'slow down' in message
        assert message != pco.PLAN_PEOPLE_UNREADABLE_ERROR
        assert 'slow down' in pco._fetch_error('Unable to fetch plans')

    def test_an_ordinary_404_is_still_an_ordinary_404(self, monkeypatch):
        pco._LAST_HTTP_ERROR = 404
        monkeypatch.setattr(pco, '_plan_is_really_gone', lambda *a: False)
        failure = pco.PlanPeopleFailure('service_types/7/plans/1/plan_people', 404)

        assert pco._plan_people_error(failure, '1', {}) == pco.PLAN_PEOPLE_UNREADABLE_ERROR
