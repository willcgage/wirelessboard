"""Tests for the Planning Center position -> Wirelessboard slot mapping rules."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco_mapping  # noqa: E402


def slot(number, slot_type=None, extended_id=None, chan_name=None):
    built = {'slot': number}
    if slot_type:
        built['type'] = slot_type
    if extended_id:
        built['extended_id'] = extended_id
    if chan_name:
        built['chan_name'] = chan_name
    return built


class TestNormalizeLabel:
    @pytest.mark.parametrize('raw,expected', [
        ('Vocal 1', 'vocal 1'),
        ('  vocal-1 ', 'vocal 1'),
        ('VOCAL_1', 'vocal 1'),
        ('Mic / IEM 3', 'mic iem 3'),
        ('H01', 'h01'),
        ('', ''),
        (None, ''),
        (7, '7'),
    ])
    def test_normalizes(self, raw, expected):
        assert pco_mapping.normalize_label(raw) == expected


class TestSplitLabel:
    @pytest.mark.parametrize('raw,expected', [
        ('Vocal 1', ('vocal', 1)),
        ('Vocal 01', ('vocal', 1)),
        ('Mic1', ('mic', 1)),
        ('BP 11', ('bp', 11)),
        ('Lead Vocal 2', ('lead vocal', 2)),
        ('IEM', ('iem', None)),
        ('4', ('', 4)),
        ('', ('', None)),
        # Only the final numeric token is the number; earlier ones stay in the prefix.
        ('Vocal 1 2', ('vocal 1', 2)),
        ('Mic 100', ('mic', 100)),
        ('Vocal 011', ('vocal', 11)),
        ('Mic 0', ('mic', 0)),
        ('0', ('', 0)),
        ('iem-01-b', ('iem 01 b', None)),
    ])
    def test_splits(self, raw, expected):
        assert pco_mapping.split_label(raw) == expected

    def test_separate_numeric_tokens_are_not_glued(self):
        """"Vocal 1 2" must not be read as the number 12."""
        assert pco_mapping.split_label('Vocal 1 2')[1] == 2

    def test_does_not_cross_match_a_glued_number(self):
        slots = [
            {'slot': 12, 'type': 'ulxd', 'extended_id': 'Mic 12'},
            {'slot': 2, 'type': 'ulxd', 'extended_id': 'Mic 2'},
        ]
        matches = pco_mapping.match_slots('Vocal 1 2', slots)
        assert [m['slot']['slot'] for m in matches] == [2]

    def test_leading_zeros_compare_equal(self):
        assert pco_mapping.split_label('Mic 01')[1] == pco_mapping.split_label('Mic 1')[1]


class TestDeviceKind:
    @pytest.mark.parametrize('prefix,expected', [
        ('mic', 'mic'),
        ('handheld', 'mic'),
        ('bp', 'mic'),
        ('iem', 'iem'),
        ('in ear', 'iem'),         # trailing word decides, so "in ear" reads as an IEM
        ('inear', 'iem'),
        ('vocal mic', 'mic'),      # a device word later in the prefix still counts
        ('vocal', None),
        ('band', None),
        ('', None),
    ])
    def test_prefix_lookup(self, prefix, expected):
        assert pco_mapping.device_kind_for_prefix(prefix) == expected

    def test_slot_kind_from_type(self):
        assert pco_mapping.slot_kind(slot(1, 'ulxd')) == 'mic'
        assert pco_mapping.slot_kind(slot(1, 'p10t')) == 'iem'
        assert pco_mapping.slot_kind(slot(1, 'offline')) is None
        assert pco_mapping.slot_kind(slot(1)) is None


class TestMatchSlots:
    def test_exact_extended_id_wins(self):
        slots = [
            slot(1, 'ulxd', extended_id='Vocal 1'),
            slot(2, 'ulxd', chan_name='Vocal 1'),
        ]
        matches = pco_mapping.match_slots('Vocal 1', slots)
        assert [m['slot']['slot'] for m in matches] == [1]
        assert matches[0]['via'] == 'extended_id'

    def test_falls_back_to_device_name(self):
        slots = [slot(2, 'ulxd', chan_name='Vocal 1')]
        matches = pco_mapping.match_slots('vocal-1', slots)
        assert [m['slot']['slot'] for m in matches] == [2]
        assert matches[0]['via'] == 'chan_name'

    def test_one_position_fills_mic_and_iem(self):
        """The headline behaviour: "Vocal 1" covers both Mic 1 and IEM 1."""
        slots = [
            slot(1, 'ulxd', extended_id='Mic 1'),
            slot(9, 'p10t', extended_id='IEM 1'),
            slot(2, 'ulxd', extended_id='Mic 2'),
            slot(10, 'p10t', extended_id='IEM 2'),
        ]
        matches = pco_mapping.match_slots('Vocal 1', slots)
        assert sorted(m['slot']['slot'] for m in matches) == [1, 9]

    def test_number_fallback_respects_slot_type(self):
        """A slot labelled "IEM 1" but wired as a receiver is not an IEM match."""
        slots = [slot(1, 'ulxd', extended_id='IEM 1')]
        assert pco_mapping.match_slots('Vocal 1', slots) == []

    def test_number_fallback_can_be_disabled(self):
        slots = [slot(1, 'ulxd', extended_id='Mic 1')]
        assert pco_mapping.match_slots('Vocal 1', slots, allow_number_fallback=False) == []
        assert pco_mapping.match_slots('Vocal 1', slots, allow_number_fallback=True)

    def test_unrelated_prefix_with_same_number_does_not_match(self):
        """"Band 1" must not soak up the person scheduled to "Vocal 1"."""
        slots = [slot(5, 'ulxd', extended_id='Band 1')]
        assert pco_mapping.match_slots('Vocal 1', slots) == []

    def test_same_prefix_matches_on_number_despite_formatting(self):
        slots = [slot(3, 'ulxd', extended_id='vocal-01')]
        matches = pco_mapping.match_slots('Vocal 1', slots)
        assert [m['slot']['slot'] for m in matches] == [3]

    def test_label_without_number_does_not_use_fallback(self):
        slots = [slot(1, 'ulxd', extended_id='Mic 1')]
        assert pco_mapping.match_slots('Vocals', slots) == []

    def test_blank_label_matches_nothing(self):
        slots = [slot(1, 'ulxd', extended_id='Mic 1')]
        assert pco_mapping.match_slots('', slots) == []
        assert pco_mapping.match_slots(None, slots) == []

    def test_untyped_slot_still_matches_device_word(self):
        slots = [slot(1, extended_id='Mic 1')]
        assert [m['slot']['slot'] for m in pco_mapping.match_slots('Vocal 1', slots)] == [1]

    def test_ignores_non_dict_entries(self):
        assert pco_mapping.match_slots('Vocal 1', [None, 'nope', 3]) == []


class TestPlanPersonLabels:
    PERSON = {
        'name': 'Fatai',
        'position': 'Vocal 1',
        'note': 'H01',
        'bracket_id': 'BP11',
    }

    def test_position_first_by_default(self):
        labels = pco_mapping.plan_person_labels(self.PERSON)
        assert labels[0] == ('position', 'Vocal 1')
        assert [source for source, _ in labels] == ['position', 'note', 'bracket']

    def test_position_only_strategy(self):
        labels = pco_mapping.plan_person_labels(self.PERSON, 'position')
        assert labels == [('position', 'Vocal 1')]

    def test_legacy_strategy_prefers_notes(self):
        labels = pco_mapping.plan_person_labels(self.PERSON, 'note_or_brackets')
        assert [source for source, _ in labels] == ['note', 'bracket', 'position']

    def test_blank_sources_are_dropped(self):
        labels = pco_mapping.plan_person_labels({'position': '', 'note': ' H01 ', 'bracket_id': ''})
        assert labels == [('note', 'H01')]

    def test_no_sources_yields_nothing(self):
        assert pco_mapping.plan_person_labels({'name': 'Nobody'}) == []


class TestSlotDescribe:
    def test_prefers_extended_id(self):
        assert pco_mapping.slot_describe(
            slot(4, 'p10t', extended_id='IEM 1', chan_name='Ears')) == 'slot 4 p10t "IEM 1"'

    def test_falls_back_to_channel_name(self):
        assert pco_mapping.slot_describe(slot(4, 'ulxd', chan_name='Vocal 1')) == 'slot 4 ulxd "Vocal 1"'

    def test_bare_slot(self):
        assert pco_mapping.slot_describe({'slot': 7}) == 'slot 7'
