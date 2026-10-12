"""Reading the live position out of Planning Center (#121).

⛔ Every failure here is reported as a *state*, never raised. A strip that
disappears when the network hiccups is one nobody trusts to mean anything when
it is absent — and the whole point of this strip is that its silence is
information.
"""

import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


# The item in `item_time` below starts here. Derived rather than written out,
# because a hand-typed epoch is a silent off-by-an-hour waiting to happen.
STARTED_AT = '2026-10-11T15:00:00Z'
STARTED_EPOCH = dt.datetime.fromisoformat('2026-10-11T15:00:00+00:00').timestamp()


def item_time(item_id='5', title='Worship', started=STARTED_AT, length=900):
    return {
        'data': {
            'id': '1',
            'attributes': {'live_start_at': started, 'length': length},
            'relationships': {'item': {'data': {'type': 'Item', 'id': item_id}}},
        },
        'included': [{'type': 'Item', 'id': item_id,
                      'attributes': {'title': title, 'item_type': 'song'}}],
    }


@pytest.fixture(autouse=True)
def clean():
    pco.forget_last_sync()
    pco._LAST_HTTP_ERROR = None
    yield
    pco.forget_last_sync()
    pco._LAST_HTTP_ERROR = None


@pytest.fixture
def live_on(monkeypatch):
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
        'live_strip': True,
    })


class TestItIsOffUnlessAskedFor:
    def test_off_by_default(self, monkeypatch):
        # ⛔ Live is not running for most services here. A strip nobody asked
        # for, spending API calls to say "Live not running", is worse than no
        # strip at all.
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {}})

        def explode(*_a, **_k):
            raise AssertionError('a disabled strip must cost no API calls')

        monkeypatch.setattr(pco, '_http_get', explode)

        assert pco.live_status() == {'state': 'off'}

    def test_a_disabled_integration_is_simply_off(self, monkeypatch):
        def refuse():
            raise pco.PcoConfigError('PCO integration is disabled (pco.enabled=false)')

        monkeypatch.setattr(pco, 'get_pco_config', refuse)

        assert pco.live_status() == {'state': 'off'}

    def test_a_truthy_string_does_not_turn_it_on(self, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'live_strip': 'false'})

        assert pco.live_status()['state'] == 'off'


class TestNothingToFollow:
    def test_nothing_synced_is_not_an_error(self, live_on, monkeypatch):
        def explode(*_a, **_k):
            raise AssertionError('nothing to ask about')

        monkeypatch.setattr(pco, '_http_get', explode)

        result = pco.live_status()

        assert result['state'] == 'no_plan'
        assert result['label'] == 'No plan synced'


class TestLiveNotRunning:
    def test_an_empty_edge_means_live_was_never_started(self, live_on, monkeypatch):
        # ⭐ The only honest test available: the API has no "is it running"
        # flag, and the `can_*` fields are permissions.
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: {'data': None})

        result = pco.live_status()

        assert result['state'] == 'not_running'
        assert result['label'] == 'Live not running'

    def test_it_does_not_ask_for_the_next_item_when_nothing_is_running(self, live_on, monkeypatch):
        # ⚠️ Otherwise a plan nobody has started Live on pays for two requests
        # a tick, forever.
        pco.record_sync('77', 'stamp', None)
        asked = []
        monkeypatch.setattr(pco, '_http_get',
                            lambda url, *a, **k: asked.append(url) or {'data': None})

        pco.live_status()

        assert not any('next_item_time' in u for u in asked)

    def test_an_item_time_with_no_live_start_is_still_not_running(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time(started=None))

        assert pco.live_status()['state'] == 'not_running'


class TestLiveRunning:
    def test_the_current_item_is_reported(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            item_time(title='Next thing') if 'next_item_time' in url else item_time()))

        result = pco.live_status()

        assert result['state'] == 'running'
        assert result['current']['title'] == 'Worship'
        assert result['current']['length'] == 900
        assert result['next']['title'] == 'Next thing'

    def test_elapsed_is_measured_from_the_live_start(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time())
        # 15:10Z, ten minutes after the item started.
        monkeypatch.setattr(pco.time, 'time', lambda: STARTED_EPOCH + 600)

        assert pco.live_status()['elapsed'] == 600

    def test_running_over_is_reported_only_once_it_is_true(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time(length=300))
        monkeypatch.setattr(pco.time, 'time', lambda: STARTED_EPOCH + 600)  # ten minutes in

        assert pco.live_status()['over_by'] == 300

    def test_an_item_inside_its_length_is_not_over(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time(length=1800))
        monkeypatch.setattr(pco.time, 'time', lambda: STARTED_EPOCH + 600)

        assert pco.live_status()['over_by'] is None

    def test_it_follows_the_plan_that_was_synced(self, live_on, monkeypatch):
        # ⚠️ Not the next upcoming one. The strip is about what is on screen.
        pco.record_sync('77', 'stamp', None)
        asked = []
        monkeypatch.setattr(pco, '_http_get',
                            lambda url, *a, **k: asked.append(url) or item_time())

        pco.live_status()

        assert all('/plans/77/' in u for u in asked)


class TestFailuresAreStatesNotExceptions:
    def test_an_unreachable_api_is_an_error_state(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: None)

        result = pco.live_status()

        assert result['state'] == 'error'
        assert result['label'] == 'Cannot reach Planning Center'

    def test_an_error_is_never_reported_as_not_running(self, live_on, monkeypatch):
        # ⛔ The two are different facts, and a board showing the second as the
        # first teaches its operator the strip is decorative.
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: None)

        assert pco.live_status()['label'] != 'Live not running'

    def test_a_failed_next_item_lookup_does_not_lose_the_current_one(self, live_on, monkeypatch):
        # The position is the point; what comes after it is a nicety.
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            None if 'next_item_time' in url else item_time()))

        result = pco.live_status()

        assert result['state'] == 'running'
        assert result['current']['title'] == 'Worship'
        assert result['next'] is None

    def test_an_unparseable_start_time_does_not_crash_the_strip(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time(started='half past'))

        result = pco.live_status()

        assert result['state'] == 'running'
        assert result['elapsed'] is None

    def test_it_never_writes(self, live_on, monkeypatch):
        import config
        writes = []
        monkeypatch.setattr(config, 'save_current_config', lambda: writes.append(1))
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time())

        pco.live_status()

        assert writes == []


class TestTheTimerReachesTheStrip:
    def test_the_default_mode_counts_the_item_down(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time(length=900))
        monkeypatch.setattr(pco.time, 'time', lambda: STARTED_EPOCH + 600)

        result = pco.live_status()

        assert result['timer'] == {
            'seconds': 300, 'over': False, 'mode': 'full_item_length', 'known': True}
        assert result['clock'] == '5:00'

    def test_an_overrunning_item_counts_up(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time(length=300))
        monkeypatch.setattr(pco.time, 'time', lambda: STARTED_EPOCH + 600)

        result = pco.live_status()

        assert result['timer']['over'] is True
        assert result['clock'] == '5:00'

    def test_end_service_on_time_asks_for_the_service_end(self, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'live_strip': True, 'live_timer_mode': 'end_service_on_time'})
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time())
        monkeypatch.setattr(pco, 'plan_end', lambda *a, **k: ('2026-10-11T16:00:00+00:00', False))
        monkeypatch.setattr(pco.time, 'time', lambda: STARTED_EPOCH + 600)

        result = pco.live_status()

        # An hour of service, ten minutes in.
        assert result['timer']['mode'] == 'end_service_on_time'
        assert result['clock'] == '50:00'

    def test_the_other_modes_never_ask_for_the_service_end(self, live_on, monkeypatch):
        # ⚠️ Full item length does not need it, and paying for it every tick
        # would be the same mistake the watcher made before #140 was gated.
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time())

        def explode(*_a, **_k):
            raise AssertionError('full item length must not look up the service end')

        monkeypatch.setattr(pco, 'plan_end', explode)

        assert pco.live_status()['timer']['mode'] == 'full_item_length'

    def test_a_mode_that_cannot_be_computed_says_so(self, monkeypatch):
        # ⛔ End item on time needs the running order and the service start.
        # When either is unavailable -- here the plan has no scheduled times --
        # it must report "cannot tell" rather than quietly showing the item
        # length, which is a different mode wearing this one's label.
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'live_strip': True, 'live_timer_mode': 'end_item_on_time'})
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time(length=900))
        monkeypatch.setattr(pco.time, 'time', lambda: STARTED_EPOCH + 600)

        result = pco.live_status()

        assert result['timer']['known'] is False
        assert result['clock'] == '--:--'

    def test_the_mode_is_named_for_the_strip_to_show(self, live_on, monkeypatch):
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: item_time())

        assert pco.live_status()['timer_label'] == 'Full item length'
