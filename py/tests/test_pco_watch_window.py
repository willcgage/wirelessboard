"""When the board stops watching a plan (#140).

⭐ A board left running all week would otherwise poll Planning Center every two
minutes about a plan nobody is looking at any more -- an account's rate limit
spent on nothing.

Watching stops when the service is over: either Planning Center Live has ended
it, or the scheduled end has passed by a configurable grace period.

⛔ The bias throughout is to **keep watching when unsure**. Over-polling costs a
few requests; stopping early means the board quietly stops noticing changes in
the middle of the service it exists for.
"""

import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


HEADERS = {'Authorization': 'Basic x'}


def ago(minutes):
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes)).isoformat()


def ahead(minutes):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=minutes)).isoformat()


@pytest.fixture(autouse=True)
def clean():
    pco.forget_plan_ends()
    pco.forget_plan_watch()
    pco.forget_last_sync()
    yield
    pco.forget_plan_ends()
    pco.forget_plan_watch()
    pco.forget_last_sync()


def plan_times(monkeypatch, *entries):
    monkeypatch.setattr(pco, '_http_get', lambda *a, **k: {
        'data': [{'attributes': attrs} for attrs in entries]})


class TestWhenToStop:
    def test_a_service_still_to_come_keeps_watching(self, monkeypatch):
        plan_times(monkeypatch, {'ends_at': ahead(120)})

        assert pco.watch_has_finished({}, '77', HEADERS) is None

    def test_a_service_inside_the_grace_period_keeps_watching(self, monkeypatch):
        # Services run over. That is the whole reason grace is a setting.
        plan_times(monkeypatch, {'ends_at': ago(20)})

        assert pco.watch_has_finished({'watch_grace_minutes': 60}, '77', HEADERS) is None

    def test_past_the_grace_period_stops(self, monkeypatch):
        plan_times(monkeypatch, {'ends_at': ago(90)})

        reason = pco.watch_has_finished({'watch_grace_minutes': 60}, '77', HEADERS)

        assert reason is not None
        assert '60 minutes' in reason

    def test_live_ending_the_service_stops_it_even_before_the_scheduled_end(self, monkeypatch):
        # A service that finished early. Only set when somebody ran Planning
        # Center Live, which is the minority of services here -- so the
        # scheduled end is the path that has to work, and this is the bonus.
        plan_times(monkeypatch, {'ends_at': ahead(120), 'live_ends_at': ago(5)})

        reason = pco.watch_has_finished({}, '77', HEADERS)

        assert reason is not None
        assert 'Live' in reason

    def test_the_latest_of_several_service_times_wins(self, monkeypatch):
        # ⚠️ A 9am and an 11am service are one plan. The board watches it until
        # the last one is over, not the first.
        plan_times(monkeypatch, {'ends_at': ago(120)}, {'ends_at': ahead(60)})

        assert pco.watch_has_finished({'watch_grace_minutes': 0}, '77', HEADERS) is None

    def test_zero_grace_stops_at_the_scheduled_end(self, monkeypatch):
        plan_times(monkeypatch, {'ends_at': ago(1)})

        assert pco.watch_has_finished({'watch_grace_minutes': 0}, '77', HEADERS) is not None


class TestItKeepsWatchingWhenUnsure:
    def test_a_plan_with_no_times_keeps_watching(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: {'data': []})

        assert pco.watch_has_finished({}, '77', HEADERS) is None

    def test_a_failed_lookup_keeps_watching(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: None)

        assert pco.watch_has_finished({}, '77', HEADERS) is None

    def test_an_unparseable_timestamp_keeps_watching(self, monkeypatch):
        plan_times(monkeypatch, {'ends_at': 'sometime on Sunday'})

        assert pco.watch_has_finished({}, '77', HEADERS) is None

    def test_no_plan_id_is_not_an_end(self):
        assert pco.plan_end('', HEADERS) == (None, False)


class TestLookupCost:
    def test_a_successful_lookup_is_cached(self, monkeypatch):
        calls = []
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: calls.append(1) or {
            'data': [{'attributes': {'ends_at': ahead(60)}}]})

        pco.plan_end('77', HEADERS)
        pco.plan_end('77', HEADERS)

        assert len(calls) == 1

    def test_a_failed_lookup_is_not_cached(self, monkeypatch):
        # ⛔ Caching "we do not know when this ends" would stop the watcher
        # reconsidering after a blip, and the consequence of that is a board
        # that silently stops watching during a service.
        calls = []
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: calls.append(1) or None)

        pco.plan_end('77', HEADERS)
        pco.plan_end('77', HEADERS)

        assert len(calls) == 2

    def test_different_plans_are_cached_apart(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: {
            'data': [{'attributes': {'ends_at': ahead(60) if '/77/' in url else ago(600)}}]})

        assert pco.watch_has_finished({'watch_grace_minutes': 0}, '77', HEADERS) is None
        assert pco.watch_has_finished({'watch_grace_minutes': 0}, '78', HEADERS) is not None


class TestGracePeriod:
    def test_an_hour_by_default(self):
        assert pco.watch_grace_minutes({}) == 60
        assert pco.watch_grace_minutes(None) == 60

    def test_a_configured_grace_is_used(self):
        assert pco.watch_grace_minutes({'watch_grace_minutes': 30}) == 30

    def test_zero_is_allowed(self):
        assert pco.watch_grace_minutes({'watch_grace_minutes': 0}) == 0

    def test_it_is_clamped_rather_than_refused(self):
        assert pco.watch_grace_minutes({'watch_grace_minutes': -5}) == 0
        assert pco.watch_grace_minutes({'watch_grace_minutes': 99999}) == 1440

    def test_nonsense_falls_back_to_the_default(self):
        assert pco.watch_grace_minutes({'watch_grace_minutes': 'a while'}) == 60


class TestTheWatcherHonoursIt:
    @pytest.fixture
    def watching(self, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'watch_active_plan': True})

    def test_a_finished_service_is_not_checked_again(self, watching, monkeypatch):
        pco.record_sync('77', 'stamp-1', None)
        monkeypatch.setattr(pco, 'watch_has_finished', lambda *a, **k: 'the service has ended')

        def explode():
            raise AssertionError('should not have checked a finished plan')

        monkeypatch.setattr(pco, 'check_active_plan', explode)

        assert pco.run_plan_watch()['finished'] == 'the service has ended'

    def test_a_standing_warning_survives_the_service_ending(self, watching, monkeypatch):
        # ⚠️ If the plan changed during the service that is still true
        # afterwards. Dropping the notice the moment the service ends removes
        # it exactly when somebody comes back to ask why the board looked wrong.
        monkeypatch.setattr(pco, 'watch_has_finished', lambda *a, **k: None)
        pco.record_sync('77', 'stamp-1', None)
        monkeypatch.setattr(pco, 'check_active_plan', lambda: {
            'ok': True, 'known': True, 'changed': True, 'plan_id': '77'})
        pco.run_plan_watch()

        monkeypatch.setattr(pco, 'watch_has_finished', lambda *a, **k: 'the service has ended')
        pco._PLAN_WATCH['checked_at'] = 0
        status = pco.run_plan_watch()

        assert status['changed'] is True
        assert status['finished']

    def test_a_new_sync_starts_watching_again(self, watching, monkeypatch):
        # ⛔ Without this, watching would end permanently at the first service
        # after a restart.
        monkeypatch.setattr(pco, 'watch_has_finished', lambda *a, **k: 'the service has ended')
        pco.record_sync('77', 'stamp-1', None)
        pco.run_plan_watch()
        assert pco.plan_watch_status()['finished']

        pco.record_sync('78', 'stamp-2', None)

        assert pco.plan_watch_status() == {}

    def test_nothing_synced_yet_is_not_treated_as_finished(self, watching, monkeypatch):
        # There is no plan to ask about, so the end-time lookup must not run.
        def explode(*_a, **_k):
            raise AssertionError('should not have looked up plan times')

        monkeypatch.setattr(pco, 'watch_has_finished', explode)
        monkeypatch.setattr(pco, 'check_active_plan', lambda: {
            'ok': True, 'known': False, 'changed': False})

        assert pco.run_plan_watch() == {}
