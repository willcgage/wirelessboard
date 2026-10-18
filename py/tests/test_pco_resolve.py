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
        assert sorted(c['name'] for c in conflicts[0]['claimants']) == ['Brooke', 'Fatai']
        # ⛔ Nobody wins a contested slot any more. Last-one-wins put a name on
        # the board that was right half the time and looked exactly as
        # authoritative as one that was right.
        assert conflicts[0]['winner'] is None
        assert conflicts[0]['skipped'] is True

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


class TestContestedSlotsAreSkipped:
    """⛔ A slot two people claim is left exactly as it was.

    Last-one-wins wrote a name that was right about half the time and looked
    exactly as authoritative as one that was right. On a board whose whole job
    is who has which microphone, "these two both claim HH-4, so it has been
    left alone" is something an operator fixes in ten seconds; a confident
    wrong name is something nobody knows to question.
    """

    def contested(self, slots):
        resolved, _ = pco.resolve_assignments([
            person('Fatai', position='Vocal 1'),
            person('Brooke', position='Mic 1'),
        ], DEFAULT_OPTIONS)
        return resolved, pco.find_conflicts(resolved)

    def test_nothing_is_written_to_a_contested_slot(self, slots):
        slots[0]['extended_name'] = 'Last week'
        resolved, conflicts = self.contested(slots)

        pco._apply_assignments(resolved, DEFAULT_OPTIONS, pco.conflicted_slots(conflicts))

        assert slots[0]['extended_name'] == 'Last week'

    def test_uncontested_slots_are_still_written(self, slots):
        # The skip is surgical: one bad slot must not stop the other eleven.
        resolved, conflicts = self.contested(slots)

        pco._apply_assignments(resolved, DEFAULT_OPTIONS, pco.conflicted_slots(conflicts))

        # Slot 9 is the IEM half of "Vocal 1" and nobody else claims it.
        assert slots[2]['extended_name'] == 'Fatai'

    def test_a_contested_slot_is_not_counted_as_an_update(self, slots):
        resolved, conflicts = self.contested(slots)

        updated = pco._apply_assignments(resolved, DEFAULT_OPTIONS, pco.conflicted_slots(conflicts))

        assert updated == 1

    def test_no_conflicts_means_nothing_is_skipped(self, slots):
        resolved, _ = pco.resolve_assignments(
            [person('Fatai', position='Vocal 1')], DEFAULT_OPTIONS)

        assert pco.conflicted_slots(pco.find_conflicts(resolved)) == set()

    def test_the_skip_set_is_just_the_slot_numbers(self, slots):
        _resolved, conflicts = self.contested(slots)

        assert pco.conflicted_slots(conflicts) == {1}

    def test_seed_extended_id_does_not_touch_a_contested_slot_either(self, slots):
        # ⚠️ Left exactly as it was means the slot ID too. Writing one would
        # change what a *later* sync matches on, off the back of a plan the
        # board could not read.
        slots[0].pop('extended_id', None)
        resolved, conflicts = self.contested(slots)
        options = dict(DEFAULT_OPTIONS, seed_extended_id=True)

        pco._apply_assignments(resolved, options, pco.conflicted_slots(conflicts))

        assert 'extended_id' not in slots[0]

    def test_a_contested_slot_is_not_cleared_either(self, slots):
        # It *was* matched, just contested, so `clear_unmatched` never sees it.
        # Both a guessed name and a blank would be the board inventing an answer.
        slots[0]['extended_name'] = 'Last week'
        resolved, _conflicts = self.contested(slots)

        assert 1 not in [s['slot'] for s in pco.slots_to_clear(resolved)]


class TestMultiPosition:
    """One person holding several positions (#260).

    ⛔ The mirror of a contested slot and invisible to `find_conflicts`, which
    is keyed by slot. Measured on the venue's own plan: Christian Nuckels held
    Welcome **and** Vocal 1, so the board wrote his name on both and whoever was
    on the Welcome slot was overwritten without a word.
    """

    @pytest.fixture
    def board(self, monkeypatch):
        tree = {
            'slots': [
                {'slot': 1, 'type': 'qlxd', 'extended_id': 'Vocal 1'},
                {'slot': 7, 'type': 'qlxd', 'extended_id': 'Welcome',
                 'extended_name': 'Casie Hamilton'},
                {'slot': 11, 'type': 'ulxd', 'extended_id': 'Acoustic Guitar'},
                {'slot': 9, 'type': 'p10t', 'extended_id': 'Vocal 1'},
            ]
        }
        monkeypatch.setattr(config, 'config_tree', tree)
        monkeypatch.setattr(config, 'save_current_config', lambda: None)
        return tree['slots']

    def resolve(self, people):
        return pco.resolve_assignments(people, {
            'strategy': 'position', 'number_fallback': False, 'seed_extended_id': False,
        })

    def test_one_person_two_positions_is_reported(self, board):
        resolved, _ = self.resolve([
            person('Christian Nuckels', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ])
        found = pco.find_multi_position(resolved, kinds={})

        assert len(found) == 1
        assert found[0]['name'] == 'Christian Nuckels'
        assert sorted(found[0]['slots']) == [1, 7, 9]
        assert sorted(p['position'] for p in found[0]['positions']) == ['Vocal 1', 'Welcome']

    def test_the_intended_fan_out_is_not_reported(self, board):
        # ⭐ The distinction the whole fix rests on. "Vocal 1" matches a
        # handheld AND its IEM -- one resolved entry with two matches, which is
        # what the mapping is built to do. Reporting it would break the feature
        # the project argues for in `pco_mapping`'s own docstring.
        resolved, _ = self.resolve([person('Fatai', position='Vocal 1')])

        assert len(resolved) == 1
        assert len(resolved[0]['slots']) == 2
        assert pco.find_multi_position(resolved, kinds={}) == []

    def test_one_person_one_position_is_not_reported(self, board):
        resolved, _ = self.resolve([person('Chris Wall', position='Welcome')])
        assert pco.find_multi_position(resolved, kinds={}) == []

    def test_find_conflicts_cannot_see_it(self, board):
        # ⛔ Stated as a test because it is the reason this went unnoticed:
        # the existing guard is keyed by slot and this is the other axis.
        resolved, _ = self.resolve([
            person('Christian Nuckels', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ])
        assert pco.find_conflicts(resolved) == []
        assert pco.find_multi_position(resolved, kinds={}) != []

    def test_the_slots_are_left_alone_so_nobody_is_evicted(self, board):
        # ⛔⛔ The sharp half. Casie Hamilton is on the Welcome slot; Christian
        # holds Welcome and Vocal 1. Writing him to both takes her off a slot
        # and gives her nothing, because neither of her own positions matches.
        resolved, _ = self.resolve([
            person('Christian Nuckels', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ])
        skip = pco.multi_position_slots(pco.find_multi_position(resolved, kinds={}))
        pco._apply_assignments(resolved, {'seed_extended_id': False}, skip)

        by_slot = {s['slot']: s for s in board}
        assert by_slot[7].get('extended_name') == 'Casie Hamilton'
        assert not (by_slot[1].get('extended_name') or '')

    def test_without_the_skip_she_is_evicted(self, board):
        # The guard proves itself: the same resolution, applied with no skip
        # set, is exactly the reported fault.
        resolved, _ = self.resolve([
            person('Christian Nuckels', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ])
        pco._apply_assignments(resolved, {'seed_extended_id': False}, set())

        by_slot = {s['slot']: s for s in board}
        assert by_slot[7].get('extended_name') == 'Christian Nuckels'
        assert by_slot[1].get('extended_name') == 'Christian Nuckels'

    def test_a_multi_position_slot_is_never_also_cleared(self, board):
        # `slots_to_clear` excludes anything matched, and a skipped slot is
        # still matched -- so a held slot must not be swept up by
        # `clear_unmatched`, which would evict by the other route.
        resolved, _ = self.resolve([
            person('Christian Nuckels', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ])
        stale = [s.get('slot') for s in pco.slots_to_clear(resolved)]
        assert 7 not in stale

    def test_names_are_matched_without_case_or_padding(self, board):
        resolved, _ = self.resolve([
            person(' christian nuckels ', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ])
        assert len(pco.find_multi_position(resolved, kinds={})) == 1


class TestTwoRadiosIsNormalWhenTheEquipmentDiffers:
    """⭐⭐ The maintainer's rule, 2026-10-18 (#260):

        "A person can hold two, but typically that would be with a Handheld
         (HH) and a Bodypack (BP)."

    So the question is not *whether* somebody may hold two radios -- they may --
    but whether the pair is the ordinary shape. Both of these are live on the
    venue board: Brandon Risinger carries HH-2 and BP-11, which is normal;
    one person on two handhelds is not.
    """

    @pytest.fixture
    def board(self, monkeypatch):
        tree = {
            'slots': [
                {'slot': 1, 'type': 'qlxd', 'extended_id': 'Vocal 1'},
                {'slot': 2, 'type': 'qlxd', 'extended_id': 'Vocal 2'},
                {'slot': 7, 'type': 'qlxd', 'extended_id': 'Welcome'},
                {'slot': 11, 'type': 'ulxd', 'extended_id': 'Acoustic Guitar'},
            ]
        }
        monkeypatch.setattr(config, 'config_tree', tree)
        monkeypatch.setattr(config, 'save_current_config', lambda: None)
        return tree['slots']

    # The venue's own labelling, read off the receivers.
    KINDS = {1: 'handheld', 2: 'handheld', 7: 'handheld', 11: 'bodypack'}

    def resolve(self, people):
        return pco.resolve_assignments(people, {
            'strategy': 'position', 'number_fallback': False, 'seed_extended_id': False,
        })

    def test_handheld_and_bodypack_is_normal_and_both_are_written(self, board):
        # Brandon Risinger, exactly as the board carries him today.
        resolved, _ = self.resolve([
            person('Brandon Risinger', position='Vocal 2'),
            person('Brandon Risinger', position='Acoustic Guitar'),
        ])
        found = pco.find_multi_position(resolved, kinds=self.KINDS)

        assert len(found) == 1
        assert found[0]['typical'] is True
        assert found[0]['skipped'] is False
        # Nothing is held back, so the sync writes him to both.
        assert pco.multi_position_slots(found) == set()

        pco._apply_assignments(resolved, {'seed_extended_id': False},
                               pco.multi_position_slots(found))
        by_slot = {s['slot']: s for s in board}
        assert by_slot[2].get('extended_name') == 'Brandon Risinger'
        assert by_slot[11].get('extended_name') == 'Brandon Risinger'

    def test_two_handhelds_is_unusual_and_left_alone(self, board):
        resolved, _ = self.resolve([
            person('Christian Nuckels', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ])
        found = pco.find_multi_position(resolved, kinds=self.KINDS)

        assert found[0]['typical'] is False
        assert found[0]['skipped'] is True
        assert pco.multi_position_slots(found) == {1, 7}

    def test_equipment_that_cannot_be_identified_is_not_assumed_typical(self, board):
        # ⛔ "Cannot tell" is not "normal". A receiver with no recognisable
        # label yields no kind, and writing both on the strength of a guess is
        # the behaviour this whole issue is about.
        resolved, _ = self.resolve([
            person('Brandon Risinger', position='Vocal 2'),
            person('Brandon Risinger', position='Acoustic Guitar'),
        ])
        found = pco.find_multi_position(resolved, kinds={2: 'handheld'})

        assert found[0]['typical'] is False
        assert pco.multi_position_slots(found) == {2, 11}

    def test_the_kind_is_read_from_the_receiver_label(self):
        assert pco.device_kind_for_slot('HH-1') == 'handheld'
        assert pco.device_kind_for_slot('BP-11') == 'bodypack'
        assert pco.device_kind_for_slot('IEM 1') == 'iem'
        # ⚠️ A convention, not a protocol fact. An unrecognised label is
        # "cannot tell", never a guess.
        assert pco.device_kind_for_slot('Slot 3') is None
        assert pco.device_kind_for_slot('') is None


class TestAnImpossiblePairKeepsTheRadioTheyHave:
    """⭐⭐ The maintainer's refinement (#260, 2026-10-18):

        "Christian can't have two Handhelds, so, he wouldn't technically be
         in two slots."

    Two handhelds is not merely unusual, it is impossible — so one of those
    positions is not a radio at all. When exactly one candidate slot already
    carries the person, that is the radio they have: keep it, leave the rest
    alone. On none or several there is nothing to reason from, and every slot
    is left alone — the earlier behaviour, kept as the fallback.
    """

    KINDS = {1: 'handheld', 7: 'handheld', 11: 'bodypack'}

    def board(self, monkeypatch, occupants):
        tree = {'slots': [
            {'slot': 1, 'type': 'qlxd', 'extended_id': 'Vocal 1',
             'extended_name': occupants.get(1, '')},
            {'slot': 7, 'type': 'qlxd', 'extended_id': 'Welcome',
             'extended_name': occupants.get(7, '')},
        ]}
        monkeypatch.setattr(config, 'config_tree', tree)
        monkeypatch.setattr(config, 'save_current_config', lambda: None)
        return tree['slots']

    def resolve(self):
        return pco.resolve_assignments([
            person('Christian Nuckels', position='Welcome'),
            person('Christian Nuckels', position='Vocal 1'),
        ], {'strategy': 'position', 'number_fallback': False, 'seed_extended_id': False})[0]

    def test_the_slot_he_is_already_on_is_kept(self, monkeypatch):
        slots = self.board(monkeypatch, {1: 'Christian Nuckels'})
        found = pco.find_multi_position(self.resolve(), kinds=self.KINDS)

        assert found[0]['anchor_slot'] == 1
        assert found[0]['held'] == [7]
        # ⭐ The board stops claiming he is on two channels, and the slot he is
        # not on is never written.
        assert pco.multi_position_slots(found) == {7}

        pco._apply_assignments(self.resolve(), {'seed_extended_id': False},
                               pco.multi_position_slots(found))
        by_slot = {s['slot']: s for s in slots}
        assert by_slot[1].get('extended_name') == 'Christian Nuckels'
        assert not (by_slot[7].get('extended_name') or '')

    def test_on_neither_slot_every_slot_is_left_alone(self, monkeypatch):
        # ⚠️ Fallback A. Nothing says which radio he has, so nothing is written
        # rather than one being picked.
        self.board(monkeypatch, {7: 'Casie Hamilton'})
        found = pco.find_multi_position(self.resolve(), kinds=self.KINDS)

        assert found[0]['anchor_slot'] is None
        assert sorted(found[0]['held']) == [1, 7]

    def test_on_both_slots_every_slot_is_left_alone(self, monkeypatch):
        # Already on two handhelds, which should not have happened. There is
        # no single radio to keep, so nothing is decided for the operator.
        self.board(monkeypatch, {1: 'Christian Nuckels', 7: 'Christian Nuckels'})
        found = pco.find_multi_position(self.resolve(), kinds=self.KINDS)

        assert found[0]['anchor_slot'] is None
        assert sorted(found[0]['held']) == [1, 7]

    def test_a_normal_pair_holds_nothing_and_needs_no_anchor(self, monkeypatch):
        self.board(monkeypatch, {1: 'Christian Nuckels'})
        found = pco.find_multi_position(
            self.resolve(), kinds={1: 'handheld', 7: 'bodypack'})

        assert found[0]['typical'] is True
        assert found[0]['held'] == []
        assert found[0]['anchor_slot'] is None
        assert pco.multi_position_slots(found) == set()

    def test_the_match_ignores_case_and_padding(self, monkeypatch):
        self.board(monkeypatch, {1: '  christian nuckels '})
        found = pco.find_multi_position(self.resolve(), kinds=self.KINDS)
        assert found[0]['anchor_slot'] == 1
