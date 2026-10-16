"""The slot's position, stored at last (#238).

Planning Center writes both halves of a plan row -- "Bob Roberts - Vocal 1" --
and until now the board kept only the person. The position was read on every
sync to decide *which* slot somebody belonged to and then thrown away.

⛔ The decision this encodes: **Planning Center overwrites the position at each
sync, and hand-editing is allowed in between.**
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import pco  # noqa: E402


@pytest.fixture
def stored(monkeypatch):
    tree = {'slots': [{
        'slot': 1,
        'type': 'ulxd',
        'ip': '10.0.0.1',
        'channel': 1,
        'extended_id': 'HH-1',
        'extended_name': 'Alice',
        'extended_position': 'Vocal 1',
        'chan_name_raw': 'SLOT 1',
    }]}
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    return tree['slots'][0]


class TestAConfigurationSave:
    """`config_mix`, which the receivers editor's save goes through."""

    def test_a_save_that_omits_the_position_keeps_it(self, stored):
        """⛔ The one that matters.

        The receivers editor sends whole slots and knows nothing about a
        position. Without this, saving a receiver would silently wipe the
        position off every slot on the board -- the same fault the comment
        above `extended_id` in `config_mix` already warns about.
        """
        out = config.config_mix([{'slot': 1, 'type': 'ulxd'}])[0]

        assert out['extended_position'] == 'Vocal 1'

    def test_it_can_be_changed(self, stored):
        out = config.config_mix([{'slot': 1, 'extended_position': 'Guitar 3'}])[0]

        assert out['extended_position'] == 'Guitar 3'

    def test_clearing_it_removes_it_rather_than_storing_empty(self, stored):
        out = config.config_mix([{'slot': 1, 'extended_position': ''}])[0]

        assert 'extended_position' not in out


class TestUpdateSlot:
    """The partial shape: absent means "not editing this"."""

    def test_an_absent_key_leaves_it_alone(self, stored):
        config.update_slot({'slot': 1, 'extended_name': 'Bob'})

        assert stored['extended_position'] == 'Vocal 1'
        assert stored['extended_name'] == 'Bob'

    def test_it_can_be_typed_by_hand(self, stored):
        config.update_slot({'slot': 1, 'extended_position': 'Speaker'})

        assert stored['extended_position'] == 'Speaker'

    def test_an_empty_value_clears_it(self, stored):
        config.update_slot({'slot': 1, 'extended_position': ''})

        assert 'extended_position' not in stored

    def test_clearing_the_person_does_not_clear_the_position(self, stored):
        """⛔ A slot keeps its role when the person leaves it.

        The same rule `extended_id` already follows: the position is what the
        next sync matches on, and often something the operator set deliberately.
        """
        config.update_slot({'slot': 1, 'extended_name': ''})

        assert 'extended_name' not in stored
        assert stored['extended_position'] == 'Vocal 1'


class TestASync:
    """`_apply_assignments`, which is where a sync writes."""

    def resolved_for(self, slot, name='Bob Roberts', position='Vocal 2'):
        """⚠️ The LIVE slot dict, never a stand-in.

        `_apply_assignments` writes through it, so a hand-built `{'slot': 1}`
        makes a sync that changed a name look like one that changed nothing.
        """
        return [{
            'name': name,
            'label': 'HH-1',
            'position': position,
            '_matches': [{'slot': slot}],
        }]

    def test_a_sync_writes_the_position(self, stored):
        changed = pco._apply_assignments(self.resolved_for(stored), {})

        assert stored['extended_position'] == 'Vocal 2'
        assert stored['extended_name'] == 'Bob Roberts'
        assert changed == 1

    def test_a_sync_overwrites_a_hand_typed_position(self, stored):
        """⭐ The decision, stated as a test.

        Settled 2026-10-15: Planning Center overwrites at each sync, and
        hand-editing is what fills the gaps in between.
        """
        stored['extended_position'] = 'something typed'

        pco._apply_assignments(self.resolved_for(stored), {})

        assert stored['extended_position'] == 'Vocal 2'

    def test_a_plan_that_names_no_position_leaves_the_stored_one_alone(self, stored):
        """⛔ An absent answer is not an answer of "nobody".

        Clearing here would mean one plan with a blank position silently
        stripping the roles off a board that had been set up by hand.
        """
        pco._apply_assignments(self.resolved_for(stored, position=''), {})

        assert stored['extended_position'] == 'Vocal 1'
        assert stored['extended_name'] == 'Bob Roberts'

    def test_writing_only_the_position_still_counts_as_a_change(self, stored):
        """A sync that corrects a role has changed the board."""
        stored['extended_name'] = 'Bob Roberts'

        changed = pco._apply_assignments(self.resolved_for(stored), {})

        assert changed == 1
        assert stored['extended_position'] == 'Vocal 2'

    def test_a_contested_slot_is_not_given_a_position_either(self, stored):
        """⛔ Skipped slots are left exactly as they are -- both halves."""
        pco._apply_assignments(self.resolved_for(stored), {}, skip_slots={1})

        assert stored['extended_position'] == 'Vocal 1'
        assert stored['extended_name'] == 'Alice'

    def test_the_device_name_is_still_never_overwritten(self, stored):
        """The guarantee the position must not have broken."""
        pco._apply_assignments(self.resolved_for(stored), {})

        assert stored['chan_name_raw'] == 'SLOT 1'
