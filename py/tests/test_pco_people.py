"""Tests for the assignment list the operator picks from.

One person can be scheduled to several teams on the same plan. Collapsing them
to a single row kept whichever team came back first and discarded the rest, so
a vocalist also rostered under Band vanished from the Vocal Team roster --
along with the vocal position that actually needed a microphone. The sync path
never had this problem (`_dedupe_people` keys on position too), so the table
the operator assigned from disagreed with what a sync would do.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


def pp(team_id, person_id, position):
    return {
        'attributes': {'team_position_name': position},
        'relationships': {
            'team': {'data': {'type': 'Team', 'id': team_id}},
            'person': {'data': {'type': 'Person', 'id': person_id}},
        },
    }


TEAMS = [
    {'type': 'Team', 'id': '1', 'attributes': {'name': 'Vocal Team'}},
    {'type': 'Team', 'id': '2', 'attributes': {'name': 'Band'}},
    {'type': 'Team', 'id': '3', 'attributes': {'name': 'Speakers & Hosts'}},
]
PEOPLE = [
    {'type': 'Person', 'id': '10', 'attributes': {'name': 'Christian Nuckels'}},
    {'type': 'Person', 'id': '11', 'attributes': {'name': 'Emorie Nuckels'}},
]

# Christian is on all three teams, exactly as he is on a real Sunday plan.
PLAN_PEOPLE = {
    'data': [
        pp('2', '10', 'Experience Director'),
        pp('3', '10', 'Welcome'),
        pp('1', '10', 'Vocal 1'),
        pp('1', '11', 'Vocal 5'),
        # Same person, team and position twice: two service times, one row.
        pp('1', '11', 'Vocal 5'),
    ],
    'included': TEAMS + PEOPLE,
}


@pytest.fixture
def plan(monkeypatch):
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'},
        'mapping': {'team_name_filter': []},
        'services': {},
    })
    monkeypatch.setattr(pco, '_get_plan_people_any', lambda *_a, **_k: PLAN_PEOPLE)


def rows(result):
    return [(p['name'], p['team'], p['position']) for p in result['people']]


class TestListPeopleForPlan:
    def test_a_person_on_several_teams_keeps_every_assignment(self, plan):
        result = pco.list_people_for_plan('99')
        christian = [r for r in rows(result) if r[0] == 'Christian Nuckels']

        assert sorted(christian) == [
            ('Christian Nuckels', 'Band', 'Experience Director'),
            ('Christian Nuckels', 'Speakers & Hosts', 'Welcome'),
            ('Christian Nuckels', 'Vocal Team', 'Vocal 1'),
        ]

    def test_the_vocal_position_is_not_lost(self, plan):
        """The regression that started this: Vocal 1 went missing entirely."""
        vocal = sorted(p['position'] for p in pco.list_people_for_plan('99')['people']
                       if p['team'] == 'Vocal Team')

        assert vocal == ['Vocal 1', 'Vocal 5']

    def test_repeated_service_times_still_collapse(self, plan):
        """Emorie is scheduled twice to one position; that is one assignment."""
        emorie = [r for r in rows(pco.list_people_for_plan('99')) if r[0] == 'Emorie Nuckels']

        assert emorie == [('Emorie Nuckels', 'Vocal Team', 'Vocal 5')]

    def test_filtering_to_a_team_keeps_that_teams_assignment(self, monkeypatch, plan):
        """Filtering to Vocal Team used to drop Christian, whose row said Band."""
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'},
            'mapping': {'team_name_filter': ['Vocal Team']},
            'services': {},
        })
        result = pco.list_people_for_plan('99')

        assert sorted(rows(result)) == [
            ('Christian Nuckels', 'Vocal Team', 'Vocal 1'),
            ('Emorie Nuckels', 'Vocal Team', 'Vocal 5'),
        ]

    def test_rows_are_grouped_by_team_then_name(self, plan):
        teams = [p['team'] for p in pco.list_people_for_plan('99')['people']]

        assert teams == sorted(teams)

    def test_agrees_with_what_a_sync_would_see(self, plan):
        """The table and the sync must not disagree about who is scheduled."""
        ui = {(p['name'], p['team'], p['position'])
              for p in pco.list_people_for_plan('99')['people']}
        sync = {(p['name'], p['team'], p['position'])
                for p in pco._dedupe_people(_flattened())}

        assert ui == sync


def _flattened():
    return pco._flatten_plan_people(PLAN_PEOPLE, 'Mic / IEM Assignments', [])
