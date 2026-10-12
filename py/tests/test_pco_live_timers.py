"""Planning Center's three timing modes, on this board (#121).

⭐ These are **Live's own** modes, by Live's own names. A board that invented a
fourth would be teaching operators something they could not use anywhere else,
and the people reading this strip are often the same people watching Live on a
laptop three feet away.

⛔ The rule that matters most: a mode whose inputs are missing reports that it
**cannot tell**, and never silently falls back to a different mode. The number
would look right and mean something else, which on a service clock is worse
than no number.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco_live  # noqa: E402


class TestChoosingAMode:
    def test_planning_centers_default_is_the_default(self):
        assert pco_live.timer_mode(None) == 'full_item_length'
        assert pco_live.timer_mode('') == 'full_item_length'

    def test_a_configured_mode_is_used(self):
        assert pco_live.timer_mode('end_service_on_time') == 'end_service_on_time'

    def test_case_and_whitespace_do_not_matter(self):
        assert pco_live.timer_mode('  End_Item_On_Time ') == 'end_item_on_time'

    def test_an_unknown_mode_falls_back_rather_than_failing(self):
        # A bad value in config.json must not take the strip out.
        assert pco_live.timer_mode('stopwatch') == 'full_item_length'

    def test_every_mode_has_a_label(self):
        for mode in pco_live.TIMER_MODES:
            assert pco_live.TIMER_LABELS[mode]


class TestFullItemLength:
    """The item's scheduled length, regardless of where the service actually is."""

    def test_it_counts_down(self):
        timer = pco_live.item_timer('full_item_length', elapsed=100, length=300)

        assert timer == {'seconds': 200, 'over': False, 'mode': 'full_item_length', 'known': True}

    def test_running_over_turns_it_round_and_counts_up(self):
        # ⭐ Exactly what Live does: the timer goes red and counts up. An
        # operator who knows Live reads this without being taught.
        timer = pco_live.item_timer('full_item_length', elapsed=400, length=300)

        assert timer['over'] is True
        assert timer['seconds'] == 100

    def test_exactly_on_time_is_not_over(self):
        assert pco_live.item_timer('full_item_length', elapsed=300, length=300)['over'] is False

    def test_an_item_with_no_length_cannot_be_timed(self):
        assert pco_live.item_timer('full_item_length', elapsed=10, length=None)['known'] is False
        assert pco_live.item_timer('full_item_length', elapsed=10, length=0)['known'] is False

    def test_an_item_that_has_not_started_cannot_be_timed(self):
        assert pco_live.item_timer('full_item_length', elapsed=None, length=300)['known'] is False


class TestEndServiceOnTime:
    """Counts to when the service is meant to end, not when the item is."""

    def test_it_counts_to_the_service_end(self):
        timer = pco_live.item_timer(
            'end_service_on_time', elapsed=10, length=300,
            service_end=2000, now=1400.0)

        assert timer['seconds'] == 600
        assert timer['over'] is False

    def test_a_service_running_late_counts_up(self):
        timer = pco_live.item_timer(
            'end_service_on_time', elapsed=10, length=300,
            service_end=1000, now=1180.0)

        assert timer['over'] is True
        assert timer['seconds'] == 180

    def test_it_ignores_the_item_length_entirely(self):
        # ⚠️ The distinguishing property. If this quietly used `length` it
        # would be Full Item Length wearing another name.
        a = pco_live.item_timer('end_service_on_time', elapsed=10, length=300,
                                service_end=2000, now=1400.0)
        b = pco_live.item_timer('end_service_on_time', elapsed=10, length=9999,
                                service_end=2000, now=1400.0)

        assert a == b

    def test_without_a_service_end_it_says_it_cannot_tell(self):
        # ⛔ Never falls back to the item length. That number would look right
        # and mean something else.
        timer = pco_live.item_timer('end_service_on_time', elapsed=10, length=300, now=1400.0)

        assert timer['known'] is False
        assert timer['seconds'] is None
        assert timer['mode'] == 'end_service_on_time'


class TestEndItemOnTime:
    """Counts to when this item was scheduled to end."""

    def test_it_counts_to_the_items_scheduled_end(self):
        timer = pco_live.item_timer(
            'end_item_on_time', elapsed=10, length=300,
            scheduled_end=1500, now=1400.0)

        assert timer['seconds'] == 100
        assert timer['over'] is False

    def test_an_item_past_its_scheduled_end_counts_up(self):
        timer = pco_live.item_timer(
            'end_item_on_time', elapsed=10, length=300,
            scheduled_end=1300, now=1400.0)

        assert timer['over'] is True
        assert timer['seconds'] == 100

    def test_without_a_schedule_it_says_it_cannot_tell(self):
        # ⚠️ This is the mode the board cannot yet compute -- it needs the
        # whole running order. Saying so is the honest behaviour until then.
        assert pco_live.item_timer(
            'end_item_on_time', elapsed=10, length=300, now=1400.0)['known'] is False

    def test_it_differs_from_full_item_length(self):
        # Same item, both modes, different answers -- which is the entire
        # reason Planning Center offers both.
        full = pco_live.item_timer('full_item_length', elapsed=100, length=300)
        ended = pco_live.item_timer('end_item_on_time', elapsed=100, length=300,
                                    scheduled_end=1500, now=1400.0)

        assert full['seconds'] != ended['seconds']


class TestTheClock:
    def test_minutes_and_seconds_under_an_hour(self):
        assert pco_live.format_clock(63) == '1:03'
        assert pco_live.format_clock(5) == '0:05'

    def test_no_leading_zero_on_the_minutes(self):
        # ⚠️ "5:03" is a duration; "05:03" reads as a clock time, and this sits
        # next to one.
        assert pco_live.format_clock(303) == '5:03'

    def test_hours_appear_only_when_there_are_some(self):
        assert pco_live.format_clock(3723) == '1:02:03'
        assert pco_live.format_clock(3599) == '59:59'

    def test_nothing_to_show_is_not_a_zero(self):
        # ⛔ "0:00" means the item is exactly out of time. "--:--" means we do
        # not know. Showing the first for the second is a lie on a clock.
        assert pco_live.format_clock(None) == '--:--'
        assert pco_live.format_clock(0) == '0:00'

    def test_a_negative_never_reaches_the_display(self):
        # `item_timer` hands over an absolute value with an `over` flag, so a
        # negative here would be a bug upstream -- it must not render as "-1:-3".
        assert pco_live.format_clock(-63) == '0:00'


@pytest.mark.parametrize('mode', pco_live.TIMER_MODES)
def test_every_mode_reports_its_own_name_back(mode):
    # Whatever happens, the strip can say which mode produced the number --
    # three timers that look alike are only readable if labelled.
    assert pco_live.item_timer(mode, elapsed=None, length=None)['mode'] == mode
