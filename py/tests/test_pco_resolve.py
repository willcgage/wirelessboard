"""Tests for PCO assignment resolution and the slot writes it drives."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import pco  # noqa: E402


DEFAULT_OPTIONS = {
    'strategy': 'position_or_note',
    'number_fallback': True,
    'seed_extended_id': False,
}


@pytest.fixture
def slots(monkeypatch):
    """Install a small slot list into the module-level config tree."""
    tree = {
        'slots': [
            {'slot': 1, 'type': 'ulxd', 'extended_id': 'Mic 1'},
            {'slot': 2, 'type': 'ulxd', 'extended_id': 'Mic 2'},
            {'slot': 9, 'type': 'p10t', 'extended_id': 'IEM 1'},
        ]
    }
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    return tree['slots']


def person(name, position='', note='', bracket_id='', team='Vocal'):
    return {
        'name': name,
        'team': team,
        'position': position,
        'note': note,
        'bracket_id': bracket_id,
    }


class TestResolveAssignments:
    def test_position_resolves_to_mic_and_iem(self, slots):
        resolved, unmatched = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], DEFAULT_OPTIONS)

        assert unmatched == []
        assert len(resolved) == 1
        entry = resolved[0]
        assert entry['matched_via'] == 'position'
        assert sorted(s['slot'] for s in entry['slots']) == [1, 9]
        assert {s['kind'] for s in entry['slots']} == {'mic', 'iem'}

    def test_unmatched_position_is_reported_with_what_was_tried(self, slots):
        resolved, unmatched = pco.resolve_assignments(
            [person('Nobody', position='Vocal 7')], DEFAULT_OPTIONS)

        assert resolved == []
        assert unmatched[0]['position'] == 'Vocal 7'
        assert unmatched[0]['tried'] == ['Vocal 7']

    def test_note_is_used_when_position_finds_nothing(self, slots):
        resolved, _ = pco.resolve_assignments(
            [person('Brooke', position='Vocal 7', note='Mic 2')], DEFAULT_OPTIONS)

        assert resolved[0]['matched_via'] == 'note'
        assert [s['slot'] for s in resolved[0]['slots']] == [2]

    def test_legacy_strategy_prefers_the_note(self, slots):
        options = dict(DEFAULT_OPTIONS, strategy='note_or_brackets')
        resolved, _ = pco.resolve_assignments(
            [person('Joel', position='Vocal 1', note='Mic 2')], options)

        assert resolved[0]['matched_via'] == 'note'
        assert [s['slot'] for s in resolved[0]['slots']] == [2]

    def test_position_only_strategy_ignores_notes(self, slots):
        options = dict(DEFAULT_OPTIONS, strategy='position')
        resolved, unmatched = pco.resolve_assignments(
            [person('Joel', position='Vocal 7', note='Mic 2')], options)

        assert resolved == []
        assert unmatched[0]['tried'] == ['Vocal 7']

    def test_number_fallback_disabled_leaves_position_unmatched(self, slots):
        options = dict(DEFAULT_OPTIONS, number_fallback=False)
        resolved, unmatched = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], options)

        assert resolved == []
        assert len(unmatched) == 1

    def test_no_slots_configured(self, monkeypatch):
        monkeypatch.setattr(config, 'config_tree', {'slots': []})
        resolved, unmatched = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], DEFAULT_OPTIONS)
        assert resolved == []
        assert len(unmatched) == 1


class TestApplyAssignments:
    def test_writes_extended_name_to_every_matched_slot(self, slots):
        resolved, _ = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], DEFAULT_OPTIONS)
        updated = pco._apply_assignments(resolved, DEFAULT_OPTIONS)

        assert updated == 2
        assert slots[0]['extended_name'] == 'Fatai'   # Mic 1
        assert slots[2]['extended_name'] == 'Fatai'   # IEM 1
        assert 'extended_name' not in slots[1]        # Mic 2 untouched

    def test_is_idempotent(self, slots):
        resolved, _ = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], DEFAULT_OPTIONS)
        assert pco._apply_assignments(resolved, DEFAULT_OPTIONS) == 2
        assert pco._apply_assignments(resolved, DEFAULT_OPTIONS) == 0

    def test_never_overwrites_device_names(self, slots):
        slots[0]['chan_name'] = 'HANDHELD A'
        slots[0]['chan_name_raw'] = 'HANDHELD A'
        resolved, _ = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], DEFAULT_OPTIONS)
        pco._apply_assignments(resolved, DEFAULT_OPTIONS)

        assert slots[0]['chan_name'] == 'HANDHELD A'
        assert slots[0]['chan_name_raw'] == 'HANDHELD A'

    def test_extended_id_is_left_alone_by_default(self, slots):
        slots.append({'slot': 3, 'type': 'ulxd', 'chan_name': 'Vocal 3'})
        resolved, _ = pco.resolve_assignments(
            [person('Taya', position='Vocal 3')], DEFAULT_OPTIONS)
        pco._apply_assignments(resolved, DEFAULT_OPTIONS)

        assert 'extended_id' not in slots[-1]
        assert slots[-1]['extended_name'] == 'Taya'

    def test_seed_extended_id_fills_only_empty_ids(self, slots):
        slots.append({'slot': 3, 'type': 'ulxd', 'chan_name': 'Vocal 3'})
        options = dict(DEFAULT_OPTIONS, seed_extended_id=True)
        resolved, _ = pco.resolve_assignments(
            [person('Taya', position='Vocal 3'), person('Fatai', position='Vocal 1')], options)
        pco._apply_assignments(resolved, options)

        assert slots[-1]['extended_id'] == 'Vocal 3'   # was empty, now seeded
        assert slots[0]['extended_id'] == 'Mic 1'      # operator's label preserved


class TestFlattenPlanPeople:
    def build_payload(self, position, team='Vocal', person_id='7'):
        return {
            'data': [{
                'id': '1',
                'attributes': {'team_position_name': position, 'name': 'Fallback Name'},
                'relationships': {
                    'person': {'data': {'type': 'Person', 'id': person_id}},
                    'team': {'data': {'type': 'Team', 'id': '3'}},
                },
            }],
            'included': [
                {'type': 'Person', 'id': person_id,
                 'attributes': {'first_name': 'Fatai', 'last_name': 'V'}},
                {'type': 'Team', 'id': '3', 'attributes': {'name': team}},
            ],
        }

    def test_reads_team_position_name(self):
        people = pco._flatten_plan_people(self.build_payload('Vocal 1'), 'Mic / IEM Assignments', [])
        assert people[0]['position'] == 'Vocal 1'
        assert people[0]['team'] == 'Vocal'
        assert people[0]['name'] == 'Fatai V'

    def test_team_filter_is_substring_and_case_insensitive(self):
        payload = self.build_payload('Vocal 1', team='Vocal Team A')
        assert pco._flatten_plan_people(payload, 'cat', ['vocal'])
        assert pco._flatten_plan_people(payload, 'cat', ['band']) == []
        assert pco._flatten_plan_people(payload, 'cat', []), 'empty filter keeps everyone'

    def test_falls_back_to_plan_person_name(self):
        payload = self.build_payload('Vocal 1')
        payload['included'] = [t for t in payload['included'] if t['type'] != 'Person']
        assert pco._flatten_plan_people(payload, 'cat', [])[0]['name'] == 'Fallback Name'

    def test_bracket_id_extracted_from_name(self):
        payload = self.build_payload('')
        payload['included'][0]['attributes'] = {'first_name': 'Fatai', 'last_name': '[H01]'}
        assert pco._flatten_plan_people(payload, 'cat', [])[0]['bracket_id'] == 'H01'


class TestDedupePeople:
    def test_repeated_service_times_collapse(self):
        rows = [person('Fatai', position='Vocal 1')] * 3
        assert len(pco._dedupe_people(rows)) == 1

    def test_distinct_positions_are_kept(self):
        rows = [person('Fatai', position='Vocal 1'), person('Fatai', position='Vocal 2')]
        assert len(pco._dedupe_people(rows)) == 2


class TestTeamFilterHelper:
    @pytest.mark.parametrize('team,filters,expected', [
        ('Vocal', [], True),
        ('Vocal', ['vocal'], True),
        ('Vocal Team', ['vocal'], True),
        ('Band', ['vocal'], False),
        (None, ['vocal'], False),
        (None, [], True),
    ])
    def test_matching(self, team, filters, expected):
        assert pco._team_matches_filters(team, filters) is expected


class TestFindConflicts:
    def test_two_people_on_one_slot_is_reported(self, slots):
        resolved, _ = pco.resolve_assignments([
            person('Fatai', position='Vocal 1'),
            person('Brooke', position='Mic 1'),
        ], DEFAULT_OPTIONS)
        conflicts = pco.find_conflicts(resolved)

        assert [c['slot'] for c in conflicts] == [1]
        assert conflicts[0]['winner'] == 'Brooke'
        assert sorted(c['name'] for c in conflicts[0]['claimants']) == ['Brooke', 'Fatai']

    def test_same_person_on_several_slots_is_not_a_conflict(self, slots):
        resolved, _ = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], DEFAULT_OPTIONS)
        assert pco.find_conflicts(resolved) == []

    def test_distinct_people_on_distinct_slots_is_not_a_conflict(self, slots):
        resolved, _ = pco.resolve_assignments([
            person('Fatai', position='Vocal 1'),
            person('Brooke', position='Vocal 2'),
        ], DEFAULT_OPTIONS)
        assert pco.find_conflicts(resolved) == []


# Slots labelled by the position they serve, which is what strict matching asks
# for: a mic and an IEM channel each carrying the position's own name.
@pytest.fixture
def position_labelled_slots(monkeypatch):
    tree = {
        'slots': [
            {'slot': 1, 'type': 'ulxd', 'extended_id': 'Vocal 1'},
            {'slot': 2, 'type': 'p10t', 'extended_id': 'Vocal 1'},
            {'slot': 3, 'type': 'ulxd', 'extended_id': 'Guitar 1'},
            {'slot': 4, 'type': 'p10t', 'extended_id': 'Guitar 1'},
            {'slot': 5, 'type': 'ulxd', 'extended_id': 'Host 1'},
        ]
    }
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    return tree['slots']


STRICT_OPTIONS = dict(DEFAULT_OPTIONS, number_fallback=False)


class TestSeveralTeamsScheduled:
    """A slot serves a position, not a team.

    Position labels are unique within a team, not across a plan. The trailing
    number fallback keys on the number alone, so with Vocal Team, Band and
    Speakers and Hosts all scheduled, "Vocal 1", "Guitar 1" and "Host 1" every
    one of them reduce to 1 and claim the same "Mic 1" slot.
    """

    def test_number_fallback_collides_across_teams(self, slots):
        # Why the fallback cannot be the default once more than one team is
        # scheduled: three distinct positions, one slot.
        resolved, _ = pco.resolve_assignments([
            person('Alice', position='Vocal 1', team='Vocal Team'),
            person('Bob', position='Guitar 1', team='Band'),
            person('Cara', position='Host 1', team='Speakers and Hosts'),
        ], dict(DEFAULT_OPTIONS, number_fallback=True))

        conflicts = pco.find_conflicts(resolved)
        assert [c['slot'] for c in conflicts] == [1, 9]
        assert sorted(c['name'] for c in conflicts[0]['claimants']) == [
            'Alice', 'Bob', 'Cara']

    def test_strict_matching_keeps_teams_apart(self, position_labelled_slots):
        resolved, unmatched = pco.resolve_assignments([
            person('Alice', position='Vocal 1', team='Vocal Team'),
            person('Bob', position='Guitar 1', team='Band'),
            person('Cara', position='Host 1', team='Speakers and Hosts'),
        ], STRICT_OPTIONS)

        assert unmatched == []
        assert pco.find_conflicts(resolved) == []
        by_name = {e['name']: sorted(s['slot'] for s in e['slots']) for e in resolved}
        assert by_name == {'Alice': [1, 2], 'Bob': [3, 4], 'Cara': [5]}

    def test_strict_matching_still_fills_mic_and_iem(self, position_labelled_slots):
        """Pairing survives: label both channels with the position name."""
        resolved, _ = pco.resolve_assignments(
            [person('Alice', position='Vocal 1', team='Vocal Team')], STRICT_OPTIONS)

        assert {s['kind'] for s in resolved[0]['slots']} == {'mic', 'iem'}

    def test_position_with_no_matching_slot_goes_to_manual(self, position_labelled_slots):
        """Anything strict matching cannot place is left for hand assignment."""
        resolved, unmatched = pco.resolve_assignments(
            [person('Dan', position='Bass 2', team='Band')], STRICT_OPTIONS)

        assert resolved == []
        assert unmatched[0]['name'] == 'Dan'
        assert unmatched[0]['team'] == 'Band'


class TestMappingOptionDefaults:
    def test_number_fallback_is_off_unless_asked_for(self):
        assert pco._mapping_options({})['number_fallback'] is False

    def test_number_fallback_can_still_be_enabled(self):
        opts = pco._mapping_options({'position_number_fallback': True})
        assert opts['number_fallback'] is True


class TestSeededSlotsMatchLaterPlans:
    """Assign by hand once, record the position, match automatically after.

    Strict matching sends anything it cannot place to manual assignment, which
    would be every week forever if nothing were learned from it. Writing the
    *position* onto the slot -- not the person, who changes week to week -- is
    what closes that loop.
    """

    @pytest.fixture
    def seeded_slots(self, monkeypatch):
        # The state left behind after one hand assignment with "remember
        # each person's position on the slot" ticked.
        tree = {
            'slots': [
                {'slot': 1, 'type': 'ulxd', 'extended_id': 'Electric Guitar 1',
                 'extended_name': 'Joe Spring'},
                {'slot': 2, 'type': 'p10t', 'extended_id': 'Electric Guitar 1',
                 'extended_name': 'Joe Spring'},
                {'slot': 3, 'type': 'ulxd'},
            ]
        }
        monkeypatch.setattr(config, 'config_tree', tree)
        monkeypatch.setattr(config, 'save_current_config', lambda: None)
        return tree['slots']

    def test_next_weeks_different_person_still_matches(self, seeded_slots):
        """The whole point: the slot answers to the position, not the person."""
        resolved, unmatched = pco.resolve_assignments(
            [person('Someone Else', position='Electric Guitar 1', team='Band')],
            STRICT_OPTIONS)

        assert unmatched == []
        entry = resolved[0]
        assert entry['matched_via'] == 'position'
        assert sorted(s['slot'] for s in entry['slots']) == [1, 2]
        assert {s['kind'] for s in entry['slots']} == {'mic', 'iem'}

    def test_the_slot_takes_the_new_persons_name(self, seeded_slots):
        resolved, _ = pco.resolve_assignments(
            [person('Someone Else', position='Electric Guitar 1', team='Band')],
            STRICT_OPTIONS)
        pco._apply_assignments(resolved, STRICT_OPTIONS)

        assert seeded_slots[0]['extended_name'] == 'Someone Else'
        # ...without disturbing the position that made the match possible.
        assert seeded_slots[0]['extended_id'] == 'Electric Guitar 1'

    def test_an_unseeded_slot_is_still_left_for_manual(self, seeded_slots):
        resolved, unmatched = pco.resolve_assignments(
            [person('Nobody', position='Drums', team='Band')], STRICT_OPTIONS)

        assert resolved == []
        assert unmatched[0]['position'] == 'Drums'
