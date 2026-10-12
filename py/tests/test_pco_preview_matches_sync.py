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


def resolution(assignments, clear_unmatched=False, conflicts=None):
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
