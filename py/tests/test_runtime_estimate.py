"""Estimating how long a pack has left (#109).

Bars answer "roughly how full". The question during a service is "will this pack
last", and two of the four receiver families coming cannot answer it.

⛔ **An estimate presented as a measurement is worse than no estimate**, so
every answer carries where it came from — and the board must be able to say
nothing at all, which is the honest answer more often than it is comfortable.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import runtime_estimate as rt  # noqa: E402


MINUTE = 60.0


class TestBucketBottom:
    def test_a_bar_is_read_as_the_bottom_of_its_range(self):
        # ⛔ Three bars of five means somewhere in 40-59%. Taking 40% makes the
        # board under-promise; taking 59% tells somebody a nearly flat pack is
        # fine. Only one of those sends a person on stage with a dying mic.
        assert rt.level_fraction(3) == pytest.approx(0.4)
        assert rt.level_fraction(5) == pytest.approx(0.8)
        assert rt.level_fraction(1) == pytest.approx(0.0)

    def test_an_unknown_level_has_no_fraction(self):
        assert rt.level_fraction(255) is None
        assert rt.level_fraction(0) is None
        assert rt.level_fraction(None) is None
        assert rt.level_fraction('full') is None


class TestSayingNothing:
    def test_a_fresh_transmitter_offers_no_estimate(self):
        # ⛔ Nothing has changed yet, so there is no drain rate -- only a guess
        # dressed as a number. The board shows bars until then.
        est = rt.RuntimeEstimator()
        est.record(5, now=0)

        assert est.minutes_remaining(now=10 * MINUTE) is None

    def test_a_level_repeated_forever_still_offers_nothing(self):
        est = rt.RuntimeEstimator()
        for n in range(20):
            est.record(5, now=n * MINUTE)

        assert est.minutes_remaining(now=20 * MINUTE) is None

    def test_an_unknown_reading_is_not_a_sample(self):
        # A receiver that drops out for a minute has not had its battery
        # changed, and 255 is not a level.
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(255, now=MINUTE)

        assert est.minutes_remaining(now=2 * MINUTE) is None

    def test_a_pack_that_is_not_draining_has_no_time_to_empty(self):
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(5, now=30 * MINUTE)

        assert est.minutes_remaining(now=30 * MINUTE) is None


class TestEstimating:
    def test_one_bar_lost_projects_the_rest(self):
        # 5 bars (0.8) to 4 bars (0.6) in 30 minutes: 0.2 per 30 min, so 0.6
        # left is another 90 minutes.
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=30 * MINUTE)

        assert est.minutes_remaining(now=30 * MINUTE) == 90

    def test_time_already_spent_at_the_current_level_counts(self):
        # ⚠️ A pack that reached its last bar twenty minutes ago has twenty
        # minutes less left than one that reached it just now.
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=30 * MINUTE)

        assert est.minutes_remaining(now=50 * MINUTE) == 70

    def test_a_pack_past_empty_reports_zero_rather_than_a_negative(self):
        est = rt.RuntimeEstimator()
        est.record(2, now=0)
        est.record(1, now=10 * MINUTE)

        assert est.minutes_remaining(now=10 * MINUTE) == 0

    def test_the_fit_uses_the_window_not_the_last_two_points(self):
        # ⚠️ A single sample straddling a bucket edge should not swing the
        # number. Three even steps give the same rate as the outer pair.
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=10 * MINUTE)
        est.record(3, now=20 * MINUTE)

        # 0.4 lost in 20 minutes; 0.4 left is another 20.
        assert est.minutes_remaining(now=20 * MINUTE) == 20


class TestBatterySwap:
    def test_a_level_that_rises_starts_again(self):
        # ⛔ Keeping the old drain rate would make a fresh battery read as
        # terminal: a rate measured on a dying pack, applied to a full one.
        est = rt.RuntimeEstimator()
        est.record(2, now=0)
        est.record(1, now=10 * MINUTE)
        assert est.minutes_remaining(now=10 * MINUTE) is not None

        est.record(5, now=11 * MINUTE)

        assert est.minutes_remaining(now=11 * MINUTE) is None

    def test_and_then_measures_the_new_pack(self):
        est = rt.RuntimeEstimator()
        est.record(1, now=0)
        est.record(5, now=MINUTE)
        est.record(4, now=31 * MINUTE)

        assert est.minutes_remaining(now=31 * MINUTE) == 90

    def test_a_swap_mid_service_does_not_inherit_the_old_rate(self):
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=5 * MINUTE)      # draining fast
        est.record(5, now=6 * MINUTE)      # new pack

        assert est.minutes_remaining(now=6 * MINUTE) is None


class TestTheWindow:
    def test_old_samples_fall_out(self):
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=10 * MINUTE)
        est.record(3, now=(rt.WINDOW_SECONDS / 60 + 20) * MINUTE)

        # The first sample is well outside the window and must not drag the
        # rate towards an hour-old average.
        assert len(est.samples) == 2

    def test_the_last_two_are_always_kept(self):
        # ⚠️ Keeping samples and projecting from them are different questions.
        # The pair survives however old it is, so a reading that arrives later
        # has something to be fitted against -- but a *stale* last reading does
        # not get projected forward, which is the rule in the class below.
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=MINUTE)
        est.record(4, now=10 * rt.WINDOW_SECONDS)

        assert len(est.samples) >= 2

    def test_a_kept_pair_is_fitted_against_once_a_reading_arrives(self):
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=30 * MINUTE)
        # Quiet for a long time, then a bar drops.
        est.record(3, now=10 * rt.WINDOW_SECONDS)

        assert est.minutes_remaining(now=10 * rt.WINDOW_SECONDS) is not None


class TestWhatThePublishedValueSays:
    def test_a_reported_runtime_always_wins(self):
        # ⚠️ The receiver knows things the estimator cannot: the chemistry, the
        # transmit power, what the pack did before this board saw it.
        assert rt.describe('2:30', 90) == {'runtime': '2:30', 'runtime_source': 'reported'}

    def test_an_estimate_is_marked_as_one(self):
        # ⛔ An estimate presented as a measurement is worse than no estimate.
        assert rt.describe('', 90) == {'runtime': '1:30', 'runtime_source': 'estimated'}

    def test_nothing_to_say_says_nothing(self):
        assert rt.describe('', None) == {'runtime': '', 'runtime_source': 'none'}

    def test_the_two_sources_are_distinguishable(self):
        reported = rt.describe('1:30', None)
        estimated = rt.describe('', 90)

        assert reported['runtime'] == estimated['runtime']
        assert reported['runtime_source'] != estimated['runtime_source']


class TestFormatting:
    def test_it_matches_what_a_reported_runtime_looks_like(self):
        assert rt.format_runtime(90) == '1:30'
        assert rt.format_runtime(5) == '0:05'
        assert rt.format_runtime(0) == '0:00'

    def test_nothing_formats_to_nothing_rather_than_zero(self):
        assert rt.format_runtime(None) == ''
        assert rt.format_runtime(-1) == ''


class TestItStopsGuessingWhenItStopsHearing:
    def test_a_transmitter_that_went_quiet_offers_no_estimate(self):
        # ⛔ Projecting forward from an hour-old reading reaches zero, and the
        # board would then state as an estimate that a pack is flat -- about a
        # channel it has heard nothing from. Found by calling ch_json with
        # stale sample times and getting a confident "0:00".
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=30 * MINUTE)

        assert est.minutes_remaining(now=30 * MINUTE + rt.WINDOW_SECONDS + 1) is None

    def test_a_recent_reading_still_estimates(self):
        est = rt.RuntimeEstimator()
        est.record(5, now=0)
        est.record(4, now=30 * MINUTE)

        assert est.minutes_remaining(now=35 * MINUTE) == 85
