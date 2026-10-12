"""End item on time, the last of Planning Center's three modes (#121).

The other two were arithmetic on numbers the Live edges already carry. This one
needs the whole running order and the service's scheduled start, which is why
it was left until last — and why everything it costs has to stay behind the one
branch that needs it.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


# 15:00 UTC, which is where the fixtures below put the service start.
START_AT = '2026-10-11T15:00:00Z'
START_EPOCH = 1_791_738_000


def _epoch(text):
    return int(pco._parse_iso(text).timestamp())


ITEMS = {
    'data': [
        {'id': '1', 'attributes': {'title': 'Countdown', 'length': 300}},
        {'id': '2', 'attributes': {'title': 'Welcome', 'length': 180}},
        {'id': '3', 'attributes': {'title': 'Worship', 'length': 1200}},
        {'id': '4', 'attributes': {'title': 'Sermon', 'length': 1800}},
    ]
}

TIMES = {'data': [{'id': 't1', 'attributes': {'starts_at': START_AT,
                                              'ends_at': '2026-10-11T16:30:00Z'}}]}


def item_time(item_id='3', started=START_AT, length=1200):
    return {
        'data': {
            'id': 'it1',
            'attributes': {'live_start_at': started, 'length': length},
            'relationships': {'item': {'data': {'type': 'Item', 'id': item_id}}},
        },
        'included': [{'type': 'Item', 'id': item_id,
                      'attributes': {'title': 'Worship', 'item_type': 'song'}}],
    }


@pytest.fixture(autouse=True)
def clean():
    pco.forget_last_sync()
    pco.forget_running_order()
    pco._LAST_HTTP_ERROR = None
    yield
    pco.forget_last_sync()
    pco.forget_running_order()
    pco._LAST_HTTP_ERROR = None


@pytest.fixture
def board(monkeypatch):
    """A board on End item on time, with a plan Live is running."""
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
        'live_strip': True, 'live_timer_mode': 'end_item_on_time'})
    pco.record_sync('77', 'stamp', None)

    def router(url, *_a, **_k):
        if '/items' in url:
            return ITEMS
        if '/plan_times' in url:
            return TIMES
        return item_time()

    monkeypatch.setattr(pco, '_http_get', router)
    return monkeypatch


class TestItComputes:
    def test_the_timer_counts_down_to_this_item_s_scheduled_end(self, board):
        # Worship is the third item: 300 + 180 in before it, 1200 long, so it
        # was meant to end 1680s after the service start. Ten minutes in.
        board.setattr(pco.time, 'time', lambda: _epoch(START_AT) + 480 + 600)

        result = pco.live_status()

        assert result['timer']['mode'] == 'end_item_on_time'
        assert result['timer']['known'] is True
        assert result['timer']['over'] is False
        # 1680 - 1080 = 600 seconds left.
        assert result['clock'] == '10:00'

    def test_an_item_running_late_counts_up(self, board):
        # ⭐ Planning Center's own behaviour, copied deliberately: once an item
        # is past its scheduled end the timer turns over and counts up. An
        # operator who knows Live reads this without being taught.
        board.setattr(pco.time, 'time', lambda: _epoch(START_AT) + 1680 + 90)

        result = pco.live_status()

        assert result['timer']['over'] is True
        assert result['clock'] == '1:30'

    def test_it_is_measured_from_the_schedule_not_from_when_the_item_started(self, board):
        # ⛔ The whole point of the mode. Full item length would say 20:00 at
        # the moment Worship starts however late it is; this says how long is
        # left before it should be finishing.
        board.setattr(pco.time, 'time', lambda: _epoch(START_AT) + 480 + 300)

        assert pco.live_status()['clock'] == '15:00'


class TestWhatItCosts:
    def test_the_other_modes_never_fetch_the_running_order(self, monkeypatch):
        # ⚠️ A request per plan on every tick of every board is exactly the
        # mistake the watcher made before #140 gated it.
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'live_strip': True, 'live_timer_mode': 'full_item_length'})
        pco.record_sync('77', 'stamp', None)

        asked = []

        def router(url, *_a, **_k):
            asked.append(url)
            return item_time()

        monkeypatch.setattr(pco, '_http_get', router)
        pco.live_status()

        assert not any('/items' in url for url in asked)
        assert not any('/plan_times' in url for url in asked)

    def test_the_running_order_is_fetched_once_and_then_cached(self, board):
        board.setattr(pco.time, 'time', lambda: _epoch(START_AT) + 600)
        asked = []
        original = pco._http_get

        def counting(url, *a, **k):
            asked.append(url)
            return original(url, *a, **k)

        board.setattr(pco, '_http_get', counting)

        pco.live_status()
        pco.live_status()
        pco.live_status()

        assert len([u for u in asked if '/items' in u]) == 1
        assert len([u for u in asked if '/plan_times' in u]) == 1


class TestWhenItCannotTell:
    def test_a_plan_with_no_scheduled_times_says_so(self, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'live_strip': True, 'live_timer_mode': 'end_item_on_time'})
        pco.record_sync('77', 'stamp', None)
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            ITEMS if '/items' in url else ({'data': []} if '/plan_times' in url else item_time())))

        result = pco.live_status()

        assert result['timer']['known'] is False
        assert result['clock'] == '--:--'

    def test_an_item_added_mid_service_refetches_once_then_gives_up(self, monkeypatch):
        # ⛔ Somebody adding a song mid-service is normal, so a stale order gets
        # one refetch. An item that is genuinely gone must not refetch on every
        # tick for the rest of the morning.
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'live_strip': True, 'live_timer_mode': 'end_item_on_time'})
        pco.record_sync('77', 'stamp', None)
        fetches = []

        def router(url, *_a, **_k):
            if '/items' in url:
                fetches.append(url)
                return ITEMS
            if '/plan_times' in url:
                return TIMES
            return item_time(item_id='99')

        monkeypatch.setattr(pco, '_http_get', router)
        monkeypatch.setattr(pco.time, 'time', lambda: _epoch(START_AT) + 600)

        first = pco.live_status()
        pco.live_status()
        pco.live_status()

        assert first['timer']['known'] is False
        assert len(fetches) == 2, 'one normal fetch and exactly one forced refetch'

    def test_a_failed_items_fetch_keeps_the_order_it_had(self, board):
        # A blip must not read as "this plan has no running order", which would
        # silently turn the timer off mid-service.
        board.setattr(pco.time, 'time', lambda: _epoch(START_AT) + 480 + 600)
        assert pco.live_status()['timer']['known'] is True

        board.setattr(pco, '_http_get', lambda url, *a, **k: (
            None if '/items' in url else (TIMES if '/plan_times' in url else item_time())))
        pco._RUNNING_ORDER.clear()  # force it past the cache

        assert pco.live_status()['timer']['known'] is False, 'nothing cached yet, so it says so'


class TestSeveralServiceTimes:
    def test_the_second_service_is_timed_from_its_own_start(self, monkeypatch):
        # ⛔ A 9am and an 11am are one plan. Anchoring to the earliest start
        # would report the whole second service as two hours late.
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'live_strip': True, 'live_timer_mode': 'end_item_on_time'})
        pco.record_sync('77', 'stamp', None)
        two = {'data': [
            {'id': 't1', 'attributes': {'starts_at': START_AT, 'ends_at': '2026-10-11T16:00:00Z'}},
            {'id': 't2', 'attributes': {'starts_at': '2026-10-11T17:00:00Z',
                                        'ends_at': '2026-10-11T18:00:00Z'}},
        ]}
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            ITEMS if '/items' in url else (two if '/plan_times' in url else item_time())))
        # Ten minutes into Worship during the *second* service.
        second_start = _epoch('2026-10-11T17:00:00Z')
        monkeypatch.setattr(pco.time, 'time', lambda: second_start + 480 + 600)

        assert pco.live_status()['clock'] == '10:00'
