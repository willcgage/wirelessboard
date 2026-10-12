"""When each item was meant to happen (#121).

The last of Planning Center's three timer modes. The other two are arithmetic
on numbers the board already has; this one needs the running order, and the
arithmetic is where it can quietly go wrong -- an off-by-one-item schedule
produces a timer that is confidently wrong rather than visibly broken.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco_running_order as ro  # noqa: E402


NOON = 1_700_000_000  # an arbitrary epoch; only the offsets matter


def item(item_id, title, length):
    return {'id': item_id, 'title': title, 'length': length}


ORDER = [
    item('1', 'Countdown', 300),
    item('2', 'Welcome', 180),
    item('3', 'Worship', 1200),
    item('4', 'Sermon', 1800),
]


class TestTheSchedule:
    def test_each_item_starts_where_the_last_one_ended(self):
        schedule = ro.build_schedule(ORDER, NOON)

        assert [e['starts_at'] for e in schedule] == [
            NOON, NOON + 300, NOON + 480, NOON + 1680,
        ]
        assert [e['ends_at'] for e in schedule] == [
            NOON + 300, NOON + 480, NOON + 1680, NOON + 3480,
        ]

    def test_it_keeps_the_order_it_was_given(self):
        # ⛔ Planning Center returns the running order in order. Sorting it here
        # by anything would invent a service nobody planned.
        schedule = ro.build_schedule(list(reversed(ORDER)), NOON)

        assert [e['title'] for e in schedule] == ['Sermon', 'Worship', 'Welcome', 'Countdown']

    def test_a_header_with_no_length_sits_at_the_same_moment_as_the_next_item(self):
        # ⚠️ Missing length is zero, not unknown. Treating it as unknown would
        # make everything below a header untimeable, which is most of a plan.
        schedule = ro.build_schedule(
            [item('1', 'Pre-service', None), item('2', 'Welcome', 180)], NOON)

        assert schedule[0]['starts_at'] == schedule[0]['ends_at'] == NOON
        assert schedule[1]['starts_at'] == NOON

    def test_a_negative_or_unparseable_length_is_zero_rather_than_a_rewind(self):
        schedule = ro.build_schedule(
            [item('1', 'Odd', -60), item('2', 'Next', 'soon'), item('3', 'Real', 60)], NOON)

        assert [e['length'] for e in schedule] == [0, 0, 60]
        assert schedule[-1]['ends_at'] == NOON + 60

    def test_without_a_start_time_there_is_no_schedule_at_all(self):
        # ⛔ Every value here is the start plus an offset. Anchoring to zero
        # would not give approximate answers, it would give a timer counting
        # down to 1970.
        assert ro.build_schedule(ORDER, None) == []

    def test_junk_in_the_list_is_skipped_rather_than_fatal(self):
        schedule = ro.build_schedule([item('1', 'Real', 60), None, 'nonsense'], NOON)

        assert len(schedule) == 1


class TestFindingAnItem:
    def test_the_scheduled_end_of_the_third_item(self):
        schedule = ro.build_schedule(ORDER, NOON)

        assert ro.scheduled_end_for(schedule, '3') == NOON + 1680
        assert ro.scheduled_start_for(schedule, '3') == NOON + 480

    def test_an_item_the_schedule_has_never_heard_of_is_none(self):
        # ⚠️ Not a guess. A song added mid-service is exactly this case, and a
        # timer falling back to another mode would show a plausible number
        # meaning something else.
        schedule = ro.build_schedule(ORDER, NOON)

        assert ro.scheduled_end_for(schedule, '99') is None
        assert ro.scheduled_end_for(schedule, None) is None
        assert ro.scheduled_end_for([], '1') is None

    def test_ids_compare_as_strings_because_the_api_mixes_both(self):
        schedule = ro.build_schedule([item(7, 'Seven', 60)], NOON)

        assert ro.scheduled_end_for(schedule, '7') == NOON + 60
        assert ro.scheduled_end_for(schedule, 7) == NOON + 60


class TestRunningLate:
    def test_drift_is_positive_when_the_service_is_behind(self):
        schedule = ro.build_schedule(ORDER, NOON)

        # Worship was meant to start at NOON+480 and actually started 4 minutes late.
        assert ro.drift_seconds(schedule, '3', NOON + 480 + 240) == 240

    def test_and_negative_when_it_is_ahead(self):
        schedule = ro.build_schedule(ORDER, NOON)

        assert ro.drift_seconds(schedule, '3', NOON + 480 - 60) == -60

    def test_unknown_when_either_half_is_missing(self):
        schedule = ro.build_schedule(ORDER, NOON)

        assert ro.drift_seconds(schedule, '3', None) is None
        assert ro.drift_seconds(schedule, '99', NOON) is None


class TestKnowingWhenToRefetch:
    def test_an_item_outside_the_cached_order_means_it_is_stale(self):
        # ⛔ Somebody adding a song mid-service is normal. Without this the
        # cached order answers about a service that no longer exists for the
        # rest of the morning.
        schedule = ro.build_schedule(ORDER, NOON)

        assert ro.is_stale(schedule, '99')
        assert not ro.is_stale(schedule, '2')

    def test_no_schedule_at_all_is_stale(self):
        assert ro.is_stale([], '1')
        assert ro.is_stale(None, '1')


class TestTheWholeService:
    def test_total_length_is_the_sum_of_the_items(self):
        assert ro.total_length(ro.build_schedule(ORDER, NOON)) == 3480
        assert ro.total_length([]) == 0
        assert ro.total_length(None) == 0
