"""#217: a healthy sync must not write a run of WARNINGs into the log.

The venue's Application Logs showed, back to back:

    PCO GET .../service_types/162905/plans/91062751/plan_people failed: 404 ...
    PCO GET .../plans/91062751/plan_people failed: 404 ...

Those were not failures. They are the first two probes of a sweep that is
*designed* to try several paths -- the generic one, the plan's own service
type, then every service type over three endpoints each. `_http_get` is the
single chokepoint they all go through, and it logged every non-200 at WARNING.

⛔ So a sync that worked perfectly wrote a dozen alarming lines into the log an
operator reads when something is wrong, and the three outcomes that actually
matter were indistinguishable:

    1. the sweep found the people on a later probe  -- nothing is wrong;
    2. nobody is scheduled on the plan              -- nothing is wrong;
    3. the token cannot see the service type        -- the operator must act.

⭐ These tests stub `requests.get` rather than `_http_get`, so the real logging
decision is the thing under test rather than something mocked away.
"""

import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402

LOGGER = 'micboard.pco'
ROSTER = {'data': [{'id': '1'}, {'id': '2'}], 'included': []}


class FakeResponse:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload if payload is not None else {}
        self.text = '{"errors":[{"status":"%s"}]}' % status

    def json(self):
        return self._payload


def route(table, default=404):
    """Answer by URL suffix; everything else misses.

    ⛔ `endswith`, not `in`. Substring matching looked obvious and was wrong:
    the generic `/v2/plans/99/plan_people` is a substring of the *scoped*
    `/v2/service_types/42/plans/99/plan_people`, so the first probe answered
    200 and three tests silently stopped testing a sweep at all.

    ⚠️ `requests.get` is called with `params=` separately, so the URL here
    never carries a query string -- `/service_types` is the listing and
    `/service_types/33/...` is a scoped path.
    """
    seen = []

    def get(url, headers=None, params=None, timeout=None):
        seen.append(url)
        for suffix, response in table:
            if url.endswith(suffix):
                return response
        return FakeResponse(default)

    get.seen = seen
    return get


@pytest.fixture(autouse=True)
def _clean():
    pco._LAST_HTTP_ERROR = None
    pco._MISSING_PLANS.clear()
    pco._begin_roster_read()
    yield
    pco._MISSING_PLANS.clear()
    pco._begin_roster_read()


def warnings_in(caplog):
    return [r for r in caplog.records if r.levelno >= logging.WARNING]


def infos_in(caplog):
    return [r for r in caplog.records if r.levelno == logging.INFO]


class TestASweepThatWorks:
    """Outcome 1: found on a later probe. Nothing is wrong."""

    def test_a_rescued_roster_logs_no_warning_at_all(self, monkeypatch, caplog):
        """⛔ The headline of #217."""
        monkeypatch.setattr(pco.requests, 'get', route([
            ('/v2/plans/99/plan_people', FakeResponse(200, ROSTER)),
        ]))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            payload, failure = pco._fetch_plan_people(42, '99', {})

        assert payload == ROSTER
        assert failure is None
        assert warnings_in(caplog) == [], (
            'a sweep finding the roster on a later path is the sweep working')

    def test_it_says_what_happened_exactly_once(self, monkeypatch, caplog):
        monkeypatch.setattr(pco.requests, 'get', route([
            ('/v2/plans/99/plan_people', FakeResponse(200, ROSTER)),
        ]))

        with caplog.at_level(logging.INFO, logger=LOGGER):
            pco._fetch_plan_people(42, '99', {})

        summaries = infos_in(caplog)
        assert len(summaries) == 1, 'one roster read, one line'
        message = summaries[0].getMessage()
        assert '99' in message and '2 scheduled' in message
        assert 'came back empty' in message, 'and it accounts for the earlier paths'

    def test_the_misses_are_still_there_at_debug(self, monkeypatch, caplog):
        """⚠️ Quieter, not gone. This is the evidence #245 points operators at."""
        monkeypatch.setattr(pco.requests, 'get', route([
            ('/v2/plans/99/plan_people', FakeResponse(200, ROSTER)),
        ]))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            pco._fetch_plan_people(42, '99', {})

        debug = [r for r in caplog.records if r.levelno == logging.DEBUG]
        assert debug, 'the scoped probe that missed must still be recorded'
        assert any('service_types/42' in r.getMessage() for r in debug)

    def test_a_first_try_hit_is_quiet_and_says_nothing_about_other_paths(
            self, monkeypatch, caplog):
        monkeypatch.setattr(pco.requests, 'get', route([
            ('/service_types/42/plans/99/plan_people', FakeResponse(200, ROSTER)),
        ]))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            payload, _ = pco._fetch_plan_people(42, '99', {})

        assert payload == ROSTER
        assert warnings_in(caplog) == []
        assert len(infos_in(caplog)) == 1
        assert 'came back empty' not in infos_in(caplog)[0].getMessage()

    def test_a_multi_service_type_account_is_swept_without_warnings(
            self, monkeypatch, caplog):
        """The venue's shape: the plan lives under some other service type.

        ⚠️ This is the expensive path -- three endpoints per service type --
        and every one of its misses used to be a WARNING.
        """
        monkeypatch.setattr(pco.requests, 'get', route([
            ('/service_types', FakeResponse(200, {'data': [
                {'id': '11'}, {'id': '22'}, {'id': '33'},
            ]})),
            ('/service_types/33/plans/99/plan_people', FakeResponse(200, ROSTER)),

        ]))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            payload, failure = pco._fetch_plan_people(None, '99', {})

        assert payload == ROSTER, 'the sweep reached the third service type'
        assert failure is None
        assert warnings_in(caplog) == [], (
            'a dozen expected misses is the sweep, not a dozen faults')


class TestNobodyScheduledYet:
    """Outcome 2: the plan is real and empty. Also not a failure."""

    def test_an_unstaffed_plan_is_not_a_warning(self, monkeypatch, caplog):
        # Everything 404s except the plan itself, which is how
        # `_plan_is_really_gone` tells an empty plan from a deleted one.
        monkeypatch.setattr(pco.requests, 'get', route([
            ('/v2/plans/99/plan_people', FakeResponse(404)),
            ('/v2/plans/99', FakeResponse(200, {'data': {'id': '99'}})),
        ]))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            payload, failure = pco._fetch_plan_people(None, '99', {})
            message = pco._plan_people_error(failure, '99', {})

        assert payload is None
        assert message == pco.PLAN_PEOPLE_UNREADABLE_ERROR
        assert warnings_in(caplog) == [], (
            'a plan nobody is scheduled on yet is the ordinary case before a service')
        assert any('nobody readable' in r.getMessage() for r in infos_in(caplog))


class TestWhenTheOperatorMustAct:
    """Outcome 3, and its neighbours. These do warn."""

    def test_rejected_credentials_warn_once(self, monkeypatch, caplog):
        monkeypatch.setattr(pco.requests, 'get', route([], default=401))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            _, failure = pco._fetch_plan_people(42, '99', {})
            pco._plan_people_error(failure, '99', {})

        warned = warnings_in(caplog)
        assert len(warned) == 1, 'one roster read, one warning'
        assert '401' in warned[0].getMessage()

    def test_a_deleted_plan_warns(self, monkeypatch, caplog):
        monkeypatch.setattr(pco.requests, 'get', route([], default=404))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            _, failure = pco._fetch_plan_people(None, '99', {})
            message = pco._plan_people_error(failure, '99', {})

        assert message == pco.PLAN_GONE_ERROR
        warned = warnings_in(caplog)
        assert len(warned) == 1
        assert 'no longer has this plan' in warned[0].getMessage()

    def test_an_unexpected_status_warns_and_names_the_request(self, monkeypatch, caplog):
        """The venue's 400, which started all of this."""
        monkeypatch.setattr(pco.requests, 'get', route([], default=400))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            _, failure = pco._fetch_plan_people(42, '99', {})
            pco._plan_people_error(failure, '99', {})

        warned = warnings_in(caplog)
        assert len(warned) == 1
        text = warned[0].getMessage()
        assert '400' in text
        assert 'service_types/42/plans/99/plan_people' in text
        assert 'DEBUG and try again' in text, (
            'the probes are already past -- turning DEBUG on helps the next attempt')


class TestNothingElseWentQuiet:
    """⛔ The obvious way to "fix" #217 is to stop warning. Check I did not."""

    def test_an_ordinary_request_still_warns(self, monkeypatch, caplog):
        monkeypatch.setattr(pco.requests, 'get', route([], default=500))

        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            pco._http_get('https://example.invalid/whatever', {})

        assert len(warnings_in(caplog)) == 1, (
            'only the roster sweep was reclassified, not every request')

    def test_the_journal_does_not_leak_between_roster_reads(self, monkeypatch, caplog):
        """⚠️ Module state, so the count must start again each time."""
        monkeypatch.setattr(pco.requests, 'get', route([
            ('/v2/plans/99/plan_people', FakeResponse(200, ROSTER)),
        ]))

        pco._fetch_plan_people(42, '99', {})
        first = pco._probe_count()

        with caplog.at_level(logging.INFO, logger=LOGGER):
            pco._fetch_plan_people(42, '99', {})

        assert pco._probe_count() == first, (
            'the second read must not inherit the first read\'s attempts')
        assert len(infos_in(caplog)) == 1

    def test_the_journal_is_capped(self, monkeypatch):
        pco._begin_roster_read()
        for i in range(pco._PROBE_JOURNAL_CAP + 50):
            pco._note_probe('u%d' % i, 404)
        assert pco._probe_count() == pco._PROBE_JOURNAL_CAP
