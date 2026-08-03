"""Tests for the team list that drives the team chooser.

The chooser exists because the filter used to be typed by hand, and a team is
one "&"-versus-"and" away from a substring filter that silently matches
nothing. So this list has to report every team on the plan -- including the
ones the operator has not picked -- and mark which are currently selected.
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


def team(team_id, name):
    return {'type': 'Team', 'id': team_id, 'attributes': {'name': name}}


def person(person_id, name):
    return {'type': 'Person', 'id': person_id, 'attributes': {'name': name}}


PLAN_PEOPLE = {
    'data': [
        pp('1', '10', 'Vocal 2'),
        pp('1', '11', 'Vocal 3'),
        # Same person, two positions on one team across service times.
        pp('2', '20', 'Electric Guitar 1'),
        pp('2', '20', 'Keys 1 - Piano'),
        pp('3', '30', 'Host Moment'),
    ],
    'included': [
        team('1', 'Vocal Team'), team('2', 'Band'), team('3', 'Speakers & Hosts'),
        person('10', 'Alice'), person('11', 'Bree'),
        person('20', 'Cody'), person('30', 'Dana'),
    ],
}


@pytest.fixture
def plan(monkeypatch):
    def fake_config():
        return {
            'auth': {'token': 't', 'secret': 's'},
            'mapping': {'team_name_filter': []},
            'services': {},
        }
    monkeypatch.setattr(pco, 'get_pco_config', fake_config)
    monkeypatch.setattr(pco, '_get_plan_people_any', lambda *_a, **_k: PLAN_PEOPLE)
    return fake_config


def teams_by_name(result):
    return {t['name']: t for t in result['teams']}


class TestListTeamsForPlan:
    def test_reports_every_team_on_the_plan(self, plan):
        result = pco.list_teams_for_plan('99')
        assert result['ok'] is True
        assert [t['name'] for t in result['teams']] == [
            'Band', 'Speakers & Hosts', 'Vocal Team']

    def test_counts_distinct_people_not_rows(self, plan):
        """Cody holds two positions on Band; that is one person, not two."""
        assert teams_by_name(pco.list_teams_for_plan('99'))['Band']['people'] == 1

    def test_lists_the_positions_each_team_covers(self, plan):
        band = teams_by_name(pco.list_teams_for_plan('99'))['Band']
        assert band['positions'] == ['Electric Guitar 1', 'Keys 1 - Piano']

    def test_nothing_is_selected_without_a_filter(self, plan):
        result = pco.list_teams_for_plan('99')
        assert result['filter_active'] is False
        assert all(t['selected'] is False for t in result['teams'])

    def test_marks_the_saved_filter_as_selected(self, monkeypatch, plan):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'},
            'mapping': {'team_name_filter': ['Vocal', 'Band']},
            'services': {},
        })
        result = pco.list_teams_for_plan('99')
        picked = {t['name'] for t in result['teams'] if t['selected']}
        assert picked == {'Vocal Team', 'Band'}
        assert result['filter_active'] is True

    def test_unselected_teams_are_still_listed(self, monkeypatch, plan):
        """The whole point: a filtered-out team must remain re-addable."""
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'},
            'mapping': {'team_name_filter': ['Vocal Team']},
            'services': {},
        })
        result = pco.list_teams_for_plan('99')
        assert 'Speakers & Hosts' in {t['name'] for t in result['teams']}

    def test_ampersand_team_matches_its_own_name(self, monkeypatch, plan):
        """"Speakers and Hosts" is a different string and must not match."""
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'},
            'mapping': {'team_name_filter': ['Speakers and Hosts']},
            'services': {},
        })
        assert all(t['selected'] is False for t in pco.list_teams_for_plan('99')['teams'])

    def test_unfetchable_plan_reports_an_error(self, monkeypatch, plan):
        monkeypatch.setattr(pco, '_get_plan_people_any', lambda *_a, **_k: None)
        result = pco.list_teams_for_plan('99')
        assert result['ok'] is False
        assert 'Unable to fetch' in result['error']
