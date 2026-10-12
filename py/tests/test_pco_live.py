"""Where the service has got to (#121).

⛔ **Live is often not running.** The maintainer runs it for some events and not
others, and plenty of churches never do. The whole point of these tests is that
"not running" stays a first-class answer and never degrades into a stale
position shown as though it were current.

⭐ There is no "is it running" flag in the API — the `can_*` fields on the Live
resource are permissions, not session state. The test is whether there is a
current item time carrying a `live_start_at`.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco_live  # noqa: E402


CURRENT = {'title': 'Worship', 'length': 900, 'started_at': 1000.0}


class TestWhichState:
    def test_disabled_is_off_whatever_else_is_true(self):
        # ⚠️ Order matters: a disabled strip must not report errors about a
        # plan nobody asked it to follow.
        assert pco_live.live_state(
            enabled=False, plan_id='77', current=CURRENT, error='boom') == 'off'

    def test_nothing_synced_is_not_an_error(self):
        assert pco_live.live_state(enabled=True, plan_id=None, current=None) == 'no_plan'

    def test_a_plan_with_no_live_session_is_not_running(self):
        assert pco_live.live_state(enabled=True, plan_id='77', current=None) == 'not_running'

    def test_a_current_item_with_no_start_is_still_not_running(self):
        # The edge can exist without a session ever having been started.
        assert pco_live.live_state(
            enabled=True, plan_id='77', current={'title': 'Worship'}) == 'not_running'

    def test_a_started_item_is_running(self):
        assert pco_live.live_state(
            enabled=True, plan_id='77', current=CURRENT,
            asked_at=1000.0, now=1010.0) == 'running'

    def test_updates_that_stop_go_stale_rather_than_freezing(self):
        # ⛔ A frozen position shown as current is the one unacceptable
        # outcome. Silence is information.
        assert pco_live.live_state(
            enabled=True, plan_id='77', current=CURRENT,
            asked_at=1000.0, now=1000.0 + pco_live.STALE_AFTER_SECONDS + 1) == 'stale'

    def test_one_missed_poll_is_not_stale(self):
        # ⚠️ A strip flickering between "running" and "stale" is worse than one
        # that lags, so the threshold is generous.
        assert pco_live.live_state(
            enabled=True, plan_id='77', current=CURRENT,
            asked_at=1000.0, now=1040.0) == 'running'

    def test_an_error_beats_a_position_we_can_no_longer_confirm(self):
        assert pco_live.live_state(
            enabled=True, plan_id='77', current=CURRENT, error='timeout') == 'error'

    def test_every_state_is_one_we_declared(self):
        for case in [
            dict(enabled=False, plan_id=None, current=None),
            dict(enabled=True, plan_id=None, current=None),
            dict(enabled=True, plan_id='77', current=None),
            dict(enabled=True, plan_id='77', current=CURRENT, asked_at=1.0, now=2.0),
            dict(enabled=True, plan_id='77', current=CURRENT, asked_at=1.0, now=99999.0),
            dict(enabled=True, plan_id='77', current=None, error='x'),
        ]:
            assert pco_live.live_state(**case) in pco_live.STATES


class TestWhatItSays:
    def test_not_running_says_exactly_that(self):
        assert pco_live.state_label('not_running') == 'Live not running'

    def test_unreachable_is_not_reported_as_not_running(self):
        # ⛔ Different facts. Showing the second as the first teaches an
        # operator that the strip is decorative.
        assert pco_live.state_label('error') != pco_live.state_label('not_running')
        assert 'reach' in pco_live.state_label('error')

    def test_nothing_synced_says_so(self):
        assert pco_live.state_label('no_plan') == 'No plan synced'

    def test_stale_carries_an_age(self):
        # Without it "no recent update" could be ten seconds or an hour.
        assert pco_live.state_label('stale', age_seconds=300) == 'No update for 5 minutes'
        assert pco_live.state_label('stale', age_seconds=60) == 'No update for 1 minute'

    def test_stale_without_a_usable_age_still_says_something(self):
        assert pco_live.state_label('stale') == 'No recent update'
        assert pco_live.state_label('stale', age_seconds=30) == 'No recent update'

    def test_running_needs_no_label_because_the_item_is_the_message(self):
        assert pco_live.state_label('running') == ''
        assert pco_live.state_label('off') == ''


class TestElapsedAndOverrun:
    def test_elapsed_counts_from_the_live_start(self):
        assert pco_live.elapsed_seconds(1000.0, 1125.0) == 125

    def test_an_item_that_has_not_started_has_no_elapsed(self):
        assert pco_live.elapsed_seconds(None, 1000.0) is None

    def test_a_clock_skew_does_not_produce_negative_time(self):
        assert pco_live.elapsed_seconds(2000.0, 1000.0) == 0

    def test_running_over_is_only_reported_when_it_is_true(self):
        # ⚠️ "Three minutes left" and "three minutes over" are different
        # statements. A single signed number makes the strip shout at every
        # item for most of its duration.
        assert pco_live.running_over(100, 900) is None
        assert pco_live.running_over(1000, 900) == 100

    def test_an_item_with_no_planned_length_cannot_run_over(self):
        assert pco_live.running_over(5000, None) is None
        assert pco_live.running_over(5000, 0) is None

    def test_no_elapsed_means_no_overrun(self):
        assert pco_live.running_over(None, 900) is None


class TestReadingTheApiPayload:
    def test_an_item_is_found_in_the_included_block(self):
        included = [
            {'type': 'Item', 'id': '5', 'attributes': {'title': 'Welcome'}},
            {'type': 'Item', 'id': '6', 'attributes': {'title': 'Worship'}},
        ]

        assert pco_live.item_from(included, '6')['title'] == 'Worship'

    def test_a_missing_item_is_empty_rather_than_an_error(self):
        assert pco_live.item_from([], '6') == {}
        assert pco_live.item_from(None, '6') == {}
        assert pco_live.item_from([{'type': 'Item', 'id': '5'}], None) == {}

    def test_other_included_types_are_not_mistaken_for_items(self):
        included = [{'type': 'PlanTime', 'id': '6', 'attributes': {'title': 'Wrong'}}]

        assert pco_live.item_from(included, '6') == {}

    def test_an_item_is_described_from_both_halves_of_the_payload(self):
        # The title lives on Item; the timing lives on ItemTime. The strip
        # needs both and they arrive in different places.
        described = pco_live.describe_item(
            {'title': 'Worship', 'item_type': 'song'},
            {'length': 900, 'live_start_at': '2026-10-11T15:00:00Z'},
        )

        assert described == {
            'title': 'Worship',
            'type': 'song',
            'length': 900,
            'started_at': '2026-10-11T15:00:00Z',
        }

    def test_a_bare_item_describes_cleanly(self):
        assert pco_live.describe_item({}, {}) == {
            'title': '', 'type': '', 'length': None, 'started_at': None,
        }

    def test_a_non_numeric_length_is_dropped_rather_than_crashing(self):
        assert pco_live.describe_item({}, {'length': 'about ten minutes'})['length'] is None
