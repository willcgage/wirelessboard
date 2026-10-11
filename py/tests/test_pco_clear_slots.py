"""Taking people off slots (#135).

Until this, a sync only ever wrote. `_apply_assignments` sets `extended_name`
on the slots it matched and touches nothing else, so a slot that matched last
week and matches nobody this week keeps last week's name -- on a board whose
whole job is who has which microphone, which means it confidently names the
wrong person and somebody hands them HH-4.

⛔ The sharp edge is the other direction: clearing too much. A spare handheld
lent to a visiting speaker is a slot Planning Center has never heard of, and an
over-eager sync takes that assignment away. Hence the option is off by default,
and hence `clearable` is reported on a preview as well as a sync -- the operator
has to be able to see what would go before agreeing to it.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import pco  # noqa: E402


@pytest.fixture
def slots(monkeypatch):
    """Four slots: two with people on them, one empty, one unlabelled."""
    tree = {
        'slots': [
            {'slot': 1, 'type': 'ulxd', 'extended_id': 'Mic 1', 'extended_name': 'Fatai'},
            {'slot': 2, 'type': 'ulxd', 'extended_id': 'Mic 2', 'extended_name': 'Dave'},
            {'slot': 3, 'type': 'ulxd', 'extended_id': 'Mic 3'},
            {'slot': 4, 'type': 'ulxd', 'extended_name': 'Visiting speaker'},
        ]
    }
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    return tree['slots']


def resolved_for(*slot_numbers):
    """A minimal resolution that claims the given slots.

    ⚠️ `_matches[].slot` has to be the *live* config dict, not a stand-in.
    `_apply_assignments` writes through it, so a copy here would let a sync that
    changes a name look like a sync that changed nothing.
    """
    by_number = {s.get('slot'): s for s in config.config_tree.get('slots', [])}
    return [{
        'name': 'Somebody',
        '_matches': [{'slot': by_number[n]} for n in slot_numbers],
    }]


class TestSlotsToClear:
    def test_a_slot_the_plan_does_not_fill_is_stale(self, slots):
        stale = pco.slots_to_clear(resolved_for(1))

        assert [s['slot'] for s in stale] == [2, 4]

    def test_an_empty_slot_is_not_counted(self, slots):
        # Slot 3 has no name. It is already clear, and counting it would make
        # "4 slots will be cleared" a number the operator cannot reconcile with
        # anything on screen.
        stale = pco.slots_to_clear(resolved_for())

        assert 3 not in [s['slot'] for s in stale]
        assert [s['slot'] for s in stale] == [1, 2, 4]

    def test_a_whitespace_only_name_counts_as_empty(self, slots):
        slots[2]['extended_name'] = '   '

        assert 3 not in [s['slot'] for s in pco.slots_to_clear(resolved_for())]

    def test_nothing_is_stale_when_the_plan_fills_everything(self, slots):
        assert pco.slots_to_clear(resolved_for(1, 2, 4)) == []

    def test_the_live_slot_dicts_come_back_not_copies(self, slots):
        # The caller pops `extended_name` off what this returns, so identity
        # matters: a copy would clear nothing and report success.
        stale = pco.slots_to_clear(resolved_for(2, 4))

        assert stale[0] is slots[0]


class TestClearUnmatched:
    def test_the_person_comes_off(self, slots):
        count = pco._clear_unmatched(pco.slots_to_clear(resolved_for(1)))

        assert count == 2
        assert 'extended_name' not in slots[1]
        assert 'extended_name' not in slots[3]

    def test_the_matched_slot_keeps_its_person(self, slots):
        pco._clear_unmatched(pco.slots_to_clear(resolved_for(1)))

        assert slots[0]['extended_name'] == 'Fatai'

    def test_the_slot_id_survives(self, slots):
        # ⚠️ `extended_id` is what the *next* sync matches on, and it is often
        # something the operator set deliberately. A slot keeps its role when
        # the person leaves it -- otherwise clearing once breaks matching for
        # every week after.
        pco._clear_unmatched(pco.slots_to_clear(resolved_for(1)))

        assert slots[1]['extended_id'] == 'Mic 2'

    def test_clearing_nothing_is_not_an_error(self, slots):
        assert pco._clear_unmatched([]) == 0

    def test_it_does_not_save(self, slots, monkeypatch):
        # The caller saves once, after both the writes and the clears. A save in
        # here would be a second full write of config.json per sync -- and this
        # file has been destroyed by a save once already.
        saves = []
        monkeypatch.setattr(config, 'save_current_config', lambda: saves.append(1))

        pco._clear_unmatched(pco.slots_to_clear(resolved_for(1)))

        assert saves == []


class TestMappingOption:
    def test_off_by_default(self):
        assert pco._mapping_options({})['clear_unmatched'] is False

    def test_on_when_asked(self):
        assert pco._mapping_options({'clear_unmatched': True})['clear_unmatched'] is True

    def test_a_truthy_string_does_not_turn_it_on(self):
        # It reaches here from JSON, where a stray "false" would otherwise read
        # as yes and start taking people off the board.
        assert pco._mapping_options({'clear_unmatched': 'false'})['clear_unmatched'] is False


class TestFinishSyncReporting:
    """What `finish_sync` tells the operator about what it removed."""

    def resolution(self, slots_claimed, clear_unmatched):
        options = dict(pco._mapping_options({'clear_unmatched': clear_unmatched}))
        return {
            'ok': True,
            'options': options,
            'category': '',
            'resolved': resolved_for(*slots_claimed),
            'unmatched': [],
            'conflicts': [],
            'people': [],
            'plan_id': '42',
        }

    def test_a_preview_says_what_would_go_and_changes_nothing(self, slots):
        result = pco.finish_sync(self.resolution([1], True), dry_run=True)

        assert result['cleared'] == 0
        assert [c['slot'] for c in result['clearable']] == [2, 4]
        assert slots[1]['extended_name'] == 'Dave'

    def test_the_preview_names_the_people(self, slots):
        # ⛔ The names have to be snapshotted before the clear. Reading them off
        # the live slot dicts afterwards reports "cleared 2 slots: None, None",
        # which tells the operator nothing about what they just lost.
        result = pco.finish_sync(self.resolution([1], True), dry_run=True)

        assert [c['name'] for c in result['clearable']] == ['Dave', 'Visiting speaker']

    def test_a_real_sync_still_names_them_after_clearing(self, slots):
        result = pco.finish_sync(self.resolution([1], True), dry_run=False)

        assert result['cleared'] == 2
        assert [c['name'] for c in result['clearable']] == ['Dave', 'Visiting speaker']
        assert 'extended_name' not in slots[1]

    def test_the_option_off_leaves_last_week_alone(self, slots):
        result = pco.finish_sync(self.resolution([1], False), dry_run=False)

        assert result['cleared'] == 0
        assert result['clearable'] == []
        assert slots[1]['extended_name'] == 'Dave'

    def test_a_real_sync_saves_once_when_it_clears(self, slots, monkeypatch):
        saves = []
        monkeypatch.setattr(config, 'save_current_config', lambda: saves.append(1))

        pco.finish_sync(self.resolution([1], True), dry_run=False)

        # ⭐ One write, though this sync both wrote a name onto slot 1 and took
        # people off slots 2 and 4. `_apply_assignments` used to save on its own
        # and the clear saved again -- two full rewrites of the one file in this
        # project a bad save has already destroyed once.
        assert len(saves) == 1

    def test_applying_on_its_own_still_saves_once(self, slots, monkeypatch):
        saves = []
        monkeypatch.setattr(config, 'save_current_config', lambda: saves.append(1))

        pco.finish_sync(self.resolution([1], False), dry_run=False)

        assert len(saves) == 1

    def test_a_sync_that_changes_nothing_does_not_touch_the_file(self, slots, monkeypatch):
        saves = []
        monkeypatch.setattr(config, 'save_current_config', lambda: saves.append(1))
        slots[0]['extended_name'] = 'Somebody'  # already what the plan says

        pco.finish_sync(self.resolution([1], False), dry_run=False)

        assert saves == []

    def test_a_preview_never_saves(self, slots, monkeypatch):
        saves = []
        monkeypatch.setattr(config, 'save_current_config', lambda: saves.append(1))

        pco.finish_sync(self.resolution([1], True), dry_run=True)

        assert saves == []

    def test_a_failed_save_does_not_lose_the_sync(self, slots, monkeypatch):
        def boom():
            raise OSError('read-only filesystem')

        monkeypatch.setattr(config, 'save_current_config', boom)

        result = pco.finish_sync(self.resolution([1], True), dry_run=False)

        assert result['ok'] is True
        assert result['cleared'] == 2
