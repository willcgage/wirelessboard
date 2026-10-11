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
