"""A failed roster read must name the request that failed, not the last one tried.

The venue's worked example answered "Unable to fetch plan people (Planning
Center returned 400)". Nobody could act on that, because the 400 did not
necessarily belong to the plan being previewed.

`_get_plan_people_any` sweeps the generic path, the plan's own service type,
then *every* service type over three endpoints each, then generic team_members.
On an account with twenty-odd service types that is some sixty-five requests,
and `_LAST_HTTP_ERROR` -- one module global, overwritten by every one of them --
ends up holding whichever probe ran last. That probe was aimed at a service
type nobody asked about.

`py/pco.py` already documents this trap for 404s, in `_plan_is_really_gone`.
These tests extend the same reasoning to every status, and to the surface where
it actually bit: the worked example.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_globals():
    pco._LAST_HTTP_ERROR = None
    pco._MISSING_PLANS.clear()
    yield
    pco._LAST_HTTP_ERROR = None
    pco._MISSING_PLANS.clear()


class TestTheFailureThatIsReported:
    """Which of the many attempts gets to explain itself."""

    def test_the_scoped_request_is_what_is_reported(self, monkeypatch):
        """⛔ The venue's exact case: a service type is set and that request fails.

        The sweep then runs and ends on some unrelated probe. The status the
        operator sees has to be the scoped request's, not the sweep's.
        """
        def scoped_fails(stid, plan_id, headers):
            pco._LAST_HTTP_ERROR = 400
            return None

        def sweep_ends_elsewhere(plan_id, headers):
            # Sixty-odd requests later, against a service type nobody asked
            # about, on a plan id that does not exist there.
            pco._LAST_HTTP_ERROR = 404
            return None

        monkeypatch.setattr(pco, '_get_plan_people_with_service', scoped_fails)
        monkeypatch.setattr(pco, '_get_plan_people_any', sweep_ends_elsewhere)

        payload, failure = pco._fetch_plan_people(42, '99', {})

        assert payload is None
        assert failure.status == 400, 'the sweep\'s trailing 404 must not win'
        assert 'service_types/42/plans/99/plan_people' == failure.where

    def test_a_successful_scoped_request_reports_no_failure(self, monkeypatch):
        monkeypatch.setattr(
            pco, '_get_plan_people_with_service',
            lambda *_a, **_k: {'data': [], 'included': []})

        payload, failure = pco._fetch_plan_people(42, '99', {})

        assert payload == {'data': [], 'included': []}
        assert failure is None

    def test_the_sweep_rescuing_it_is_not_a_failure(self, monkeypatch):
        """The scoped path failing is routine when the plan lives elsewhere."""
        monkeypatch.setattr(pco, '_get_plan_people_with_service', lambda *_a, **_k: None)
        monkeypatch.setattr(
            pco, '_get_plan_people_any',
            lambda *_a, **_k: {'data': [{'id': '1'}], 'included': []})

        payload, failure = pco._fetch_plan_people(42, '99', {})

        assert payload['data'] == [{'id': '1'}]
        assert failure is None, 'it was found -- there is nothing to report'

    def test_without_a_service_type_the_blame_is_not_pinned_on_one_endpoint(self, monkeypatch):
        """⚠️ Here the trailing status really is all there is.

        The generic path IS the sweep's first step, so there is no separate
        request to read. The honest answer is to say the sweep failed rather
        than name an endpoint that may not be the one that produced the status.
        """
        def sweep(plan_id, headers):
            pco._LAST_HTTP_ERROR = 500
            return None

        monkeypatch.setattr(pco, '_get_plan_people_any', sweep)

        payload, failure = pco._fetch_plan_people(None, '99', {})

        assert payload is None
        assert failure.status == 500
        assert 'sweep' in failure.where
        assert 'service_types/' not in failure.where


class TestWhatTheOperatorIsTold:
    """`_plan_people_error` turns a failure into something actionable."""

    def test_a_status_names_the_request_and_points_at_logs(self):
        failure = pco.PlanPeopleFailure('service_types/42/plans/99/plan_people', 400)

        message = pco._plan_people_error(failure, '99', {})

        assert '400' in message
        assert 'service_types/42/plans/99/plan_people' in message
        assert 'Logs' in message, 'the full exchange is already logged -- say so'

    def test_rejected_credentials_are_explained_not_numbered(self):
        failure = pco.PlanPeopleFailure('plans/99/plan_people', 401)

        message = pco._plan_people_error(failure, '99', {})

        assert 'keyring' in message, 'a 401 here is overwhelmingly a token that never came across'

    def test_no_status_at_all_says_so(self):
        """A timeout leaves `_LAST_HTTP_ERROR` as None and is not a 'returned None'."""
        failure = pco.PlanPeopleFailure('plans/99/plan_people', None)

        message = pco._plan_people_error(failure, '99', {})

        assert 'None' not in message
        assert 'timed out' in message or 'could not be reached' in message

    def test_a_404_still_asks_the_plan_before_condemning_it(self, monkeypatch):
        """⛔ #73/#90: an empty roster ends the sweep exactly like a deleted plan."""
        monkeypatch.setattr(pco, '_plan_is_really_gone', lambda *_a, **_k: False)
        failure = pco.PlanPeopleFailure('plans/99/plan_people', 404)

        message = pco._plan_people_error(failure, '99', {})

        assert message == pco.PLAN_PEOPLE_UNREADABLE_ERROR
        assert pco._plan_is_known_missing('99') is False

    def test_a_404_on_a_plan_that_really_is_gone_says_that(self, monkeypatch):
        monkeypatch.setattr(pco, '_plan_is_really_gone', lambda *_a, **_k: True)
        failure = pco.PlanPeopleFailure('plans/99/plan_people', 404)

        message = pco._plan_people_error(failure, '99', {})

        assert message == pco.PLAN_GONE_ERROR
        assert pco._plan_is_known_missing('99') is True


def test_every_roster_read_explains_itself_the_same_way():
    """⛔ The worked example used to be the odd one out.

    The people list and the sync both asked whether a 404 meant the plan was
    gone; the preview -- the one surface whose entire job is to explain what a
    sync would do -- reported a bare status and stopped. Three call sites, three
    behaviours, and the thinnest one was on the surface built for explaining.
    """
    import inspect
    source = inspect.getsource(pco)

    assert source.count('_plan_people_error(') >= 5, (
        'every caller routes its failure through the one explainer')
    # Nothing reads the trailing global to describe a roster read any more.
    assert '_fetch_error("Unable to fetch plan people")' not in source
    assert "_fetch_error('Unable to fetch plan people')" not in source
