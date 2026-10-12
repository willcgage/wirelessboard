"""Syncing a plan with nobody watching (#140).

⛔ These are the conditions under which this board edits itself. A sync writes
`config.json` and can take people off the board, so every test here is about a
refusal: the interesting cases are all the ones where it declines.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco_auto_sync as auto  # noqa: E402


ON = {'auto_sync': True}
CHANGED = {'changed': True, 'plan_id': '42', 'updated_at': 'v2', 'checked_at': 100}


class TestTheSwitch:
    def test_off_unless_explicitly_on(self):
        assert not auto.auto_sync_enabled(None)
        assert not auto.auto_sync_enabled({})
        assert auto.auto_sync_enabled({'auto_sync': True})

    def test_a_string_false_is_not_yes(self):
        # ⛔ It reaches here from config.json, where "false" is a truthy string
        # and would start rewriting a board nobody asked it to.
        assert not auto.auto_sync_enabled({'auto_sync': 'false'})
        assert not auto.auto_sync_enabled({'auto_sync': 'no'})
        assert not auto.auto_sync_enabled({'auto_sync': 0})
        assert auto.auto_sync_enabled({'auto_sync': 'true'})
        assert auto.auto_sync_enabled({'auto_sync': 'yes'})

    def test_it_is_a_mapping_key_so_a_profile_can_override_the_board(self):
        # The maintainer asked for this per profile: Youth automatic, the main
        # service manual. Inheritance gives both.
        import pco_profiles

        assert auto.AUTO_SYNC_KEY in pco_profiles.MAPPING_KEYS


class TestWhenItRefuses:
    def test_with_the_switch_off(self):
        go, why = auto.should_auto_sync(CHANGED, {})

        assert not go
        assert 'off' in why

    def test_when_nothing_changed(self):
        go, why = auto.should_auto_sync({'changed': False, 'plan_id': '42'}, ON)

        assert not go
        assert 'nothing has changed' in why

    def test_when_the_last_check_failed(self):
        # A dead network is not a reason to write to the board, and
        # `check_active_plan` deliberately returns no `changed` key when it
        # could not ask -- so a caller trusting `changed` alone learns nothing.
        status = dict(CHANGED, error='Unable to check the plan')
        go, why = auto.should_auto_sync(status, ON)

        assert not go
        assert 'failed' in why

    def test_when_the_service_is_over(self):
        # Whatever changed, changing the board now helps nobody -- and it may
        # be somebody setting up next week.
        go, why = auto.should_auto_sync(dict(CHANGED, finished='plan ended'), ON)

        assert not go
        assert 'over' in why

    def test_when_one_is_already_running(self):
        # ⚠️ The watcher wakes every 30s and a sync is several seconds of HTTP.
        # Two overlapping ones would both write config.json.
        go, why = auto.should_auto_sync(CHANGED, ON, running=True)

        assert not go
        assert 'already running' in why

    def test_before_the_first_check(self):
        assert not auto.should_auto_sync({}, ON)[0]
        assert not auto.should_auto_sync(None, ON)[0]


class TestItDoesNotRetryForever:
    def test_a_version_already_tried_is_not_tried_again(self):
        # ⛔ Retrying every two minutes would spend the account's rate limit on
        # a plan that is not going to succeed, and hide the failure behind its
        # own repetition (#73, #90).
        tried = {('42', 'v2')}
        go, why = auto.should_auto_sync(CHANGED, ON, attempted=tried)

        assert not go
        assert 'already tried' in why

    def test_but_a_further_edit_is_a_new_chance(self):
        # ⭐ Keyed on the plan *and* its version. Keyed on the plan alone, one
        # failure would block it for the rest of the service.
        tried = {('42', 'v2')}
        go, _ = auto.should_auto_sync(dict(CHANGED, updated_at='v3'), ON, attempted=tried)

        assert go

    def test_a_change_it_cannot_identify_is_refused(self):
        go, why = auto.should_auto_sync({'changed': True, 'plan_id': '42'}, ON)

        assert not go
        assert 'identified' in why
        assert auto.attempt_key({'changed': True}) is None


class TestWhenItGoes:
    def test_a_changed_plan_on_an_automatic_profile(self):
        go, why = auto.should_auto_sync(CHANGED, ON)

        assert go
        assert 'automatically' in why


class TestWhatItSaysAfterwards:
    def test_it_names_the_removals_in_the_same_breath(self):
        # ⭐ The half an operator who was absent cannot undo by syncing again.
        text = auto.describe_outcome({'ok': True, 'updates': 3, 'cleared': 2})

        assert '3 slots updated' in text
        assert '2 slots cleared' in text

    def test_a_sync_that_changed_nothing_says_so_plainly(self):
        text = auto.describe_outcome({'ok': True, 'updates': 0, 'cleared': 0})

        assert 'nothing on the board needed changing' in text

    def test_contested_slots_are_never_folded_into_the_count(self):
        # They were not handled. They are the one thing here still needing a
        # person, so they are said separately (#141).
        result = {'ok': True, 'updates': 1, 'cleared': 0, 'skipped': [{'slot': 4}]}
        text = auto.describe_outcome(result)

        assert '1 slot updated' in text
        assert '1 slot left alone' in text
        assert 'still need checking' in text

    def test_a_failure_says_what_went_wrong(self):
        assert 'boom' in auto.describe_outcome({'ok': False, 'error': 'boom'})
        assert 'failed' in auto.describe_outcome({'ok': False})
        assert 'failed' in auto.describe_outcome(None)

    def test_singular_and_plural_both_read(self):
        one = auto.describe_outcome({'ok': True, 'updates': 1, 'cleared': 1})

        assert '1 slot updated' in one
        assert '1 slot cleared' in one


class TestWhetherSomebodyHasToLook:
    def test_a_clean_automatic_sync_needs_nobody(self):
        assert not auto.needs_attention({'ok': True, 'updates': 2, 'cleared': 0})

    def test_a_contested_slot_does(self):
        assert auto.needs_attention({'ok': True, 'skipped': [{'slot': 4}]})

    def test_a_failure_does(self):
        assert auto.needs_attention({'ok': False, 'error': 'boom'})
        assert auto.needs_attention(None)

    def test_clearing_people_does_not(self):
        # Reported loudly, but not flagged: the admin turned that option on,
        # and a prompt that always appears is one nobody reads.
        assert not auto.needs_attention({'ok': True, 'updates': 0, 'cleared': 3})
