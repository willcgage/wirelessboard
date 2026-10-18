"""Apply does what Preview showed (#120).

The preview is only worth reading if it is a promise. These exercise the one
property that makes it one: the same resolution, previewed and then applied,
produces the **same diff** -- and the board afterwards matches what the diff
said it would be.

⛔ The hazard is a diff built after the write. `finish_sync` reads
`extended_name` off the live slot dicts, so a diff assembled at the end of a
real sync would report every "from" as the value just written: it would agree
with itself, every row would read `Fatai -> Fatai`, and the preview an operator
trusted would be the only one telling the truth.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import pco  # noqa: E402
import sync_diff  # noqa: E402


@pytest.fixture
def slots(monkeypatch):
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


def live(number):
    by_number = {s.get('slot'): s for s in config.config_tree.get('slots', [])}
    return by_number[number]


def resolution(assignments, clear_unmatched=False, conflicts=None, multi_position=None):
    """`assignments` is {person: [slot numbers]}."""
    options = dict(pco._mapping_options({'clear_unmatched': clear_unmatched}))
    return {
        'ok': True,
        'options': options,
        'category': '',
        'resolved': [{
            'name': name,
            'team': 'Band',
            'position': f'{name} position',
            'matched_via': 'position',
            '_matches': [{'slot': live(n)} for n in numbers],
        } for name, numbers in assignments.items()],
        'unmatched': [],
        'conflicts': conflicts or [],
        'multi_position': multi_position or [],
        'people': [],
        'plan_id': '42',
    }


class TestThePromise:
    def test_the_preview_and_the_sync_describe_the_same_changes(self, slots):
        preview = pco.finish_sync(
            resolution({'Amy': [3], 'Fatai': [2]}, clear_unmatched=True),
            dry_run=True,
        )
        # Nothing was written, so the same resolution still applies.
        applied = pco.finish_sync(
            resolution({'Amy': [3], 'Fatai': [2]}, clear_unmatched=True),
            dry_run=False,
        )

        assert preview['changes'] == applied['changes']
        assert preview['changes_counts'] == applied['changes_counts']

    def test_and_the_board_afterwards_is_what_the_diff_said(self, slots):
        preview = pco.finish_sync(
            resolution({'Amy': [3], 'Fatai': [2]}, clear_unmatched=True),
            dry_run=True,
        )
        pco.finish_sync(
            resolution({'Amy': [3], 'Fatai': [2]}, clear_unmatched=True),
            dry_run=False,
        )

        for row in preview['changes']:
            after = (live(row['slot']).get('extended_name') or '')
            assert after == row['to'], f"slot {row['slot']} ended up as {after!r}"

    def test_a_real_sync_does_not_report_every_row_as_unchanged(self, slots):
        # ⛔ The regression this file exists for. A diff built after the write
        # reads the new names as the old ones, so everything looks unchanged.
        applied = pco.finish_sync(resolution({'Amy': [2]}), dry_run=False)
        row = next(r for r in applied['changes'] if r['slot'] == 2)

        assert row['from'] == 'Dave'
        assert row['to'] == 'Amy'
        assert row['action'] == 'change'


class TestWhatTheDiffSays:
    def test_it_covers_assignments_changes_clears_and_the_already_right(self, slots):
        result = pco.finish_sync(
            resolution({'Amy': [3], 'Fatai': [1]}, clear_unmatched=True),
            dry_run=True,
        )
        by_slot = {row['slot']: row for row in result['changes']}

        assert by_slot[3]['action'] == 'assign'
        assert by_slot[1]['action'] == 'unchanged', 'Fatai is already on slot 1'
        assert by_slot[2]['action'] == 'clear'
        assert by_slot[4]['action'] == 'clear'
        assert result['changes_counts']['clear'] == 2

    def test_a_contested_slot_is_shown_as_skipped_with_both_names(self, slots):
        conflicts = [{'slot': 2, 'claimants': [{'name': 'Amy'}, {'name': 'Zoe'}]}]
        result = pco.finish_sync(
            resolution({'Amy': [2]}, conflicts=conflicts),
            dry_run=True,
        )
        row = next(r for r in result['changes'] if r['slot'] == 2)

        assert row['action'] == 'skipped'
        assert row['claimants'] == ['Amy', 'Zoe']
        assert row['from'] == row['to'] == 'Dave', 'nobody is written to a contested slot'

    def test_a_contested_slot_really_is_left_alone(self, slots):
        conflicts = [{'slot': 2, 'claimants': [{'name': 'Amy'}, {'name': 'Zoe'}]}]
        pco.finish_sync(resolution({'Amy': [2]}, conflicts=conflicts), dry_run=False)

        assert live(2)['extended_name'] == 'Dave'

    def test_a_board_already_correct_reports_a_noop(self, slots):
        result = pco.finish_sync(
            resolution({'Fatai': [1], 'Dave': [2]}),
            dry_run=True,
        )

        assert sync_diff.is_noop(result['changes'])
        assert len(result['changes']) == 2, 'the rows are still there to be shown'


class TestAMultiPositionSlotIsAPromiseToo:
    """The same contract for the other kind of skip (#260).

    ⛔ Detection was well covered and the wiring was not: nothing called
    `build_changes` with `multi_position`, so the row shape Python emits and
    the sentence the browser writes from it were only ever tested apart. These
    close that seam — the row is produced by a real `finish_sync`, which is
    what the preview and the sync both go through.
    """

    def held(self, name='Amy', slots_held=(2,), anchor=None, positions=('Welcome', 'Vocal 1')):
        return [{
            'name': name,
            'positions': [{'position': p, 'label': p, 'slots': list(slots_held)} for p in positions],
            'slots': list(slots_held),
            'kinds': ['handheld'] * len(slots_held),
            'typical': False,
            'anchor_slot': anchor,
            'held': list(slots_held),
            'skipped': True,
        }]

    def test_the_row_says_it_was_skipped_and_why(self, slots):
        result = pco.finish_sync(
            resolution({'Amy': [2]}, multi_position=self.held()),
            dry_run=True,
        )
        row = next(r for r in result['changes'] if r['slot'] == 2)

        assert row['action'] == 'skipped'
        # ⛔ The reason, not just the fact. "claimed by two people" would be a
        # lie here and would send an operator looking for a second person.
        assert row['skip_reason'] == 'multi-position'
        assert row['held_by']['name'] == 'Amy'
        assert row['held_by']['positions'] == ['Welcome', 'Vocal 1']
        assert row['claimants'] == [], 'nobody is contesting it'
        assert row['from'] == row['to'] == 'Dave', 'nobody is written to a held slot'

    def test_it_really_is_left_alone_by_a_real_sync(self, slots):
        pco.finish_sync(
            resolution({'Amy': [2]}, multi_position=self.held()),
            dry_run=False,
        )

        assert live(2)['extended_name'] == 'Dave'

    def test_the_preview_and_the_sync_agree_about_it(self, slots):
        # The property the whole file exists for, applied to this skip.
        preview = pco.finish_sync(
            resolution({'Amy': [2]}, multi_position=self.held()), dry_run=True)
        applied = pco.finish_sync(
            resolution({'Amy': [2]}, multi_position=self.held()), dry_run=False)

        assert preview['changes'] == applied['changes']

    def test_the_slot_the_person_is_kept_on_is_written_not_skipped(self, slots):
        # ⚠️ The anchor is not a skip and must not be explained as one. Amy is
        # kept on slot 1 and held off slot 2.
        result = pco.finish_sync(
            resolution({'Amy': [1, 2]},
                       multi_position=self.held(slots_held=(2,), anchor=1)),
            dry_run=True,
        )
        kept = next(r for r in result['changes'] if r['slot'] == 1)
        dropped = next(r for r in result['changes'] if r['slot'] == 2)

        assert kept['action'] == 'change', 'the slot she keeps is written'
        assert kept['to'] == 'Amy'
        assert kept['skip_reason'] == ''
        assert kept['held_by'] == {}
        assert dropped['action'] == 'skipped'

    def test_a_normal_pair_holds_nothing_and_both_rows_are_written(self, slots):
        # A typical pair reports `held: []`, so neither slot is skipped.
        typical = [{
            'name': 'Amy', 'positions': [], 'slots': [1, 2],
            'kinds': ['handheld', 'bodypack'], 'typical': True,
            'anchor_slot': None, 'held': [], 'skipped': False,
        }]
        result = pco.finish_sync(
            resolution({'Amy': [1, 2]}, multi_position=typical), dry_run=True)

        assert [r['action'] for r in result['changes'] if r['slot'] in (1, 2)] == ['change', 'change']

    def test_the_response_names_them_not_just_the_diff_rows(self, slots):
        # ⛔⛔ The gap this closes. The diff rows carried the reason, but
        # `skipped` is what the summary and the worked example read — so a slot
        # was marked skipped with no reason given anywhere an operator looks.
        result = pco.finish_sync(
            resolution({'Amy': [2]}, multi_position=self.held()),
            dry_run=True,
        )

        assert 'held' in result, 'the response must name the held slots'
        assert result['held'] == [{
            'slot': 2, 'name': 'Amy',
            'positions': ['Welcome', 'Vocal 1'],
            'kept_on': None,
        }]

    def test_held_is_not_folded_into_skipped(self, slots):
        # ⛔ `skipped` means contested, and both readers phrase it as "claimed
        # by N people". A multi-position entry in there would put back the
        # exact sentence #260 removed.
        result = pco.finish_sync(
            resolution({'Amy': [2]}, multi_position=self.held()),
            dry_run=True,
        )

        assert result['skipped'] == [], 'nobody is contesting anything here'

    def test_the_slot_kept_is_reported_so_the_operator_can_check_it(self, slots):
        result = pco.finish_sync(
            resolution({'Amy': [1, 2]},
                       multi_position=self.held(slots_held=(2,), anchor=1)),
            dry_run=True,
        )

        assert result['held'][0]['kept_on'] == 1

    def test_a_typical_pair_reports_nothing_held(self, slots):
        typical = [{
            'name': 'Amy', 'positions': [], 'slots': [1, 2],
            'kinds': ['handheld', 'bodypack'], 'typical': True,
            'anchor_slot': None, 'held': [], 'skipped': False,
        }]
        result = pco.finish_sync(
            resolution({'Amy': [1, 2]}, multi_position=typical), dry_run=True)

        assert result['held'] == []

    def test_an_allowed_pair_leaves_no_held_by_on_its_rows(self, slots):
        # ⛔ Found on a real board: a handheld-and-instrument pair reports
        # `held: []`, and `[] or slots` fell through to every slot — so rows
        # that were written carried a `held_by` saying somebody was holding
        # them. The data said the opposite of the action beside it.
        typical = [{
            'name': 'Amy', 'positions': [{'position': 'Vocal 2', 'label': 'Vocal 2', 'slots': [1, 2]}],
            'slots': [1, 2], 'kinds': ['handheld', 'instrument'], 'typical': True,
            'anchor_slot': None, 'held': [], 'skipped': False,
        }]
        result = pco.finish_sync(
            resolution({'Amy': [1, 2]}, multi_position=typical), dry_run=True)

        for row in result['changes']:
            assert row['held_by'] == {}, f"slot {row['slot']} is not held by anybody"
            assert row['skip_reason'] == ''
