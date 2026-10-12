"""Saving a group edits what the payload carries, and nothing else.

The three fields of a group are edited from different places. The board's
drag-and-drop editor (`E`) rearranges `slots` and sends a title along with it;
a list that renames a group sends a title and has no business knowing the
membership. Before #114 every save wrote all three unconditionally, so the
second kind of caller had to send back a membership it never showed the
operator -- and getting that wrong emptied the group.

⛔ Absent means "not editing this". Emptying a group is still possible, by
sending `slots: []`, which is present and says so.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


@pytest.fixture
def stored(monkeypatch):
    tree = {
        'groups': [{
            'group': 1,
            'title': 'Worship',
            'slots': [2, 3, 4, 7],
            'hide_charts': False,
        }],
        'slots': [],
    }
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    monkeypatch.setattr(config, 'group_update_list', [])
    return tree['groups'][0]


class TestPartialUpdates:
    def test_a_rename_keeps_the_membership(self, stored):
        """The one that matters: renaming must not empty a group."""
        config.update_group({'group': 1, 'title': 'Worship Team'})

        assert stored['title'] == 'Worship Team'
        assert stored['slots'] == [2, 3, 4, 7]
        assert stored['hide_charts'] is False

    def test_rearranging_slots_keeps_the_title(self, stored):
        config.update_group({'group': 1, 'slots': [7, 2]})

        assert stored['slots'] == [7, 2]
        assert stored['title'] == 'Worship'

    def test_a_chart_toggle_touches_nothing_else(self, stored):
        config.update_group({'group': 1, 'hide_charts': True})

        assert stored['hide_charts'] is True
        assert stored['slots'] == [2, 3, 4, 7]
        assert stored['title'] == 'Worship'

    def test_emptying_a_group_is_still_possible_when_asked_for(self, stored):
        config.update_group({'group': 1, 'slots': []})

        assert stored['slots'] == []

    def test_a_payload_with_only_a_number_changes_nothing(self, stored):
        before = dict(stored)
        config.update_group({'group': 1})

        assert stored == before


class TestNewGroups:
    def test_a_group_that_does_not_exist_yet_is_created(self, stored):
        config.update_group({'group': 4, 'title': 'Kids', 'slots': [11]})

        created = config.get_group_by_number(4)
        assert created['title'] == 'Kids'
        assert created['slots'] == [11]

    def test_a_new_group_carries_only_what_it_was_given(self, stored):
        # No invented defaults: a field nobody set stays absent, and the
        # readers already cope -- `groupTableBuilder` defaults hide_charts when
        # it is null rather than requiring it.
        config.update_group({'group': 5, 'title': 'Drama'})

        created = config.get_group_by_number(5)
        assert created == {'group': 5, 'title': 'Drama'}


def test_the_update_is_still_announced_to_clients(stored):
    # The websocket push reads this list; a group edit that does not appear
    # there leaves every other board showing the old grouping until it reloads.
    config.update_group({'group': 1, 'title': 'Band'})

    assert config.group_update_list[-1]['title'] == 'Band'


@pytest.fixture
def two_groups(monkeypatch):
    """Two groups, because ordering needs something to reorder."""
    tree = {
        'groups': [
            {'group': 1, 'title': 'Worship', 'slots': [1, 2]},
            {'group': 2, 'title': 'Teaching', 'slots': [3, 4]},
        ],
        'slots': [],
    }
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    monkeypatch.setattr(config, 'group_update_list', [])
    return tree['groups']

class TestRotationFields:
    """The two fields the wall's rotation reads (#113, #114).

    ⛔ A bad value here does not produce a wrong-looking list — it produces a
    wall that holds one group for an hour, or skips a group nobody meant to
    skip. So they are normalised on the way in rather than trusted.
    """

    def test_a_group_can_be_taken_out_of_the_rotation(self, two_groups):
        config.update_group({'group': 1, 'rotate': False})

        assert config.get_group_by_number(1)['rotate'] is False

    def test_and_put_back(self, two_groups):
        config.update_group({'group': 1, 'rotate': False})
        config.update_group({'group': 1, 'rotate': True})

        assert config.get_group_by_number(1)['rotate'] is True

    def test_a_truthy_string_does_not_turn_rotation_on(self, two_groups):
        # It arrives as JSON, where a stray "false" would otherwise read as yes.
        config.update_group({'group': 1, 'rotate': 'false'})

        assert config.get_group_by_number(1)['rotate'] is False

    def test_a_dwell_is_stored_in_seconds(self, two_groups):
        config.update_group({'group': 1, 'dwell': 45})

        assert config.get_group_by_number(1)['dwell'] == 45

    def test_an_absurd_dwell_is_bounded_rather_than_refused(self, two_groups):
        # ⚠️ The same bounds the browser applies. If the two disagree, the board
        # and the editor disagree about what was saved.
        config.update_group({'group': 1, 'dwell': 1})
        assert config.get_group_by_number(1)['dwell'] == config.MIN_GROUP_DWELL

        config.update_group({'group': 1, 'dwell': 99999})
        assert config.get_group_by_number(1)['dwell'] == config.MAX_GROUP_DWELL

    def test_clearing_the_dwell_falls_back_to_the_board_default(self, two_groups):
        config.update_group({'group': 1, 'dwell': 45})
        config.update_group({'group': 1, 'dwell': ''})

        assert 'dwell' not in config.get_group_by_number(1)

    def test_nonsense_is_treated_as_no_dwell_rather_than_stored(self, two_groups):
        config.update_group({'group': 1, 'dwell': 'a while'})

        assert 'dwell' not in config.get_group_by_number(1)

    def test_a_save_that_omits_them_leaves_them_alone(self, two_groups):
        # ⛔ The same bargain as title and slots: absent means "not editing
        # this", never "clear it". A rename must not stop a group rotating.
        config.update_group({'group': 1, 'rotate': False, 'dwell': 45})
        config.update_group({'group': 1, 'title': 'Renamed'})

        group = config.get_group_by_number(1)
        assert group['rotate'] is False
        assert group['dwell'] == 45
        assert group['title'] == 'Renamed'


class TestOrdering:
    """⭐ List order *is* rotation order, so this is not cosmetic."""

    def test_groups_can_be_reordered(self, two_groups):
        config.reorder_groups([2, 1])

        assert [g['group'] for g in config.config_tree['groups']] == [2, 1]

    def test_a_group_the_caller_did_not_mention_survives(self, two_groups):
        # ⚠️ A stale editor that has not seen a group just added must not be
        # able to delete it by leaving it out.
        config.reorder_groups([2])

        assert sorted(g['group'] for g in config.config_tree['groups']) == [1, 2]

    def test_an_unknown_group_number_is_ignored(self, two_groups):
        config.reorder_groups([99, 2, 1])

        assert [g['group'] for g in config.config_tree['groups']] == [2, 1]

    def test_rubbish_in_the_order_does_not_lose_groups(self, two_groups):
        config.reorder_groups(['two', None, 1])

        assert sorted(g['group'] for g in config.config_tree['groups']) == [1, 2]

    def test_an_empty_order_changes_nothing(self, two_groups):
        before = [g['group'] for g in config.config_tree['groups']]
        config.reorder_groups([])

        assert [g['group'] for g in config.config_tree['groups']] == before
