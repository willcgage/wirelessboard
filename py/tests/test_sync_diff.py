"""The preview as a diff of the board (#120).

⛔ The question this answers is "what will happen to my board", not "what does
the plan say". Every test here is about a slot, and about the half the old
preview never showed: who is on it now.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sync_diff  # noqa: E402


def slot(number, name='', describe=''):
    return {'slot': number, 'extended_name': name, 'describe': describe}


def entry(name, slots, **kwargs):
    return {
        'name': name,
        'team': kwargs.get('team', ''),
        'position': kwargs.get('position', ''),
        'matched_via': kwargs.get('matched_via', 'position'),
        '_matches': [{'slot': s} for s in slots],
    }


class TestWhatChanges:
    def test_an_empty_slot_is_an_assignment(self):
        rows = sync_diff.build_changes([entry('Fatai', [slot(3)])])

        assert rows == [{
            'slot': 3, 'from': '', 'to': 'Fatai', 'action': 'assign',
            'position': '', 'team': '', 'matched_via': 'position',
            'describe': '', 'claimants': [],
            # An assignment is never a skip, so it carries neither reason (#260).
            'skip_reason': '', 'held_by': {},
        }]

    def test_a_different_person_is_a_change_and_names_both(self):
        # ⭐ The whole point. The old preview said "Fatai -> slot 3" and never
        # mentioned that Dave was on it.
        rows = sync_diff.build_changes([entry('Fatai', [slot(3, 'Dave')])])

        assert rows[0]['from'] == 'Dave'
        assert rows[0]['to'] == 'Fatai'
        assert rows[0]['action'] == 'change'

    def test_the_same_person_is_not_a_change(self):
        rows = sync_diff.build_changes([entry('Dave', [slot(3, 'Dave')])])

        assert rows[0]['action'] == 'unchanged'
        assert sync_diff.changed(rows) == []

    def test_whitespace_does_not_invent_a_change(self):
        rows = sync_diff.build_changes([entry('Dave ', [slot(3, ' Dave')])])

        assert rows[0]['action'] == 'unchanged'

    def test_a_cleared_slot_says_who_is_being_taken_off(self):
        rows = sync_diff.build_changes([], stale=[slot(5, 'Bob')])

        assert rows[0] == {
            'slot': 5, 'from': 'Bob', 'to': '', 'action': 'clear',
            'position': '', 'team': '', 'matched_via': '',
            'describe': '', 'claimants': [],
            # A clear is never a skip, so it carries neither reason (#260).
            'skip_reason': '', 'held_by': {},
        }


class TestContestedSlots:
    def test_a_skipped_slot_keeps_what_it_has(self):
        # ⛔ Reporting the person the sync *would* have written implies it is
        # going to. A contested slot is the one nobody should trust.
        conflicts = [{'slot': 4, 'claimants': [{'name': 'Dave'}, {'name': 'Fatai'}]}]
        rows = sync_diff.build_changes(
            [entry('Fatai', [slot(4, 'Carol')])],
            conflicts=conflicts,
            skip_slots={4},
        )

        assert rows[0]['action'] == 'skipped'
        assert rows[0]['from'] == 'Carol'
        assert rows[0]['to'] == 'Carol', 'a skipped slot is not about to change'
        assert rows[0]['claimants'] == ['Dave', 'Fatai']

    def test_a_skipped_slot_sorts_first(self):
        # It is the only row that wants somebody to do something before the
        # service starts, so it must not be below twelve quiet ones.
        rows = sync_diff.build_changes(
            [entry('Fatai', [slot(9, 'Carol')]), entry('Amy', [slot(1)])],
            stale=[slot(2, 'Bob')],
            conflicts=[{'slot': 9, 'claimants': [{'name': 'Fatai'}]}],
            skip_slots={9},
        )

        assert [row['action'] for row in rows] == ['skipped', 'assign', 'clear']


class TestReadingOrder:
    def test_rows_are_grouped_by_what_happens_then_by_slot(self):
        rows = sync_diff.build_changes(
            [
                entry('Amy', [slot(7)]),
                entry('Zoe', [slot(2)]),
                entry('Dave', [slot(5, 'Dave')]),
                entry('Fatai', [slot(3, 'Carol')]),
            ],
        )

        assert [(r['action'], r['slot']) for r in rows] == [
            ('change', 3), ('assign', 2), ('assign', 7), ('unchanged', 5),
        ]

    def test_a_slot_number_that_is_not_a_number_still_sorts(self):
        rows = sync_diff.build_changes([entry('Amy', [slot('x'), slot(2)])])

        assert [r['slot'] for r in rows] == [2, 'x']


class TestOneEntryManySlots:
    def test_a_person_on_two_slots_produces_two_rows(self):
        # A singer with a handheld and an IEM is one assignment and two things
        # happening to the board.
        rows = sync_diff.build_changes([entry('Amy', [slot(1), slot(8, 'Amy')])])

        assert [(r['slot'], r['action']) for r in rows] == [(1, 'assign'), (8, 'unchanged')]


class TestSummarising:
    def test_counts_name_every_action_even_at_zero(self):
        rows = sync_diff.build_changes([entry('Amy', [slot(1)])])
        tally = sync_diff.counts(rows)

        assert tally['assign'] == 1
        assert tally['clear'] == 0, 'a caller should not have to branch on absence'
        assert set(tally) == set(sync_diff.ACTIONS)

    def test_a_board_that_is_already_right_says_so(self):
        # ⭐ "0 updates" beside a table of twelve rows reads like a failure.
        rows = sync_diff.build_changes([entry('Dave', [slot(3, 'Dave')])])

        assert sync_diff.is_noop(rows)
        assert len(rows) == 1, 'and the unchanged rows are still there to be shown'

    def test_nothing_at_all_is_also_a_noop(self):
        assert sync_diff.is_noop(sync_diff.build_changes([]))
        assert sync_diff.build_changes(None) == []


class TestItNeverContradictsItself:
    def test_a_matched_slot_is_never_also_cleared(self):
        # `clear_unmatched` cannot reach a matched slot, but a row claiming
        # both would be the worst kind of wrong, so it is refused here too.
        shared = slot(6, 'Bob')
        rows = sync_diff.build_changes([entry('Amy', [shared])], stale=[shared])

        assert len(rows) == 1
        assert rows[0]['action'] == 'change'
