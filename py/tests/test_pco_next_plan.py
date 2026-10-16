"""Which plan "next upcoming" means (#120).

The weekly job was the one thing nobody could skip: open the panel, find this
Sunday in a list, pick it. `_get_next_plan_id` and `_get_next_plan_global` have
existed all along and nothing in the interface offered them.

⛔ The reason this is its own resolver rather than "the first row of the plans
list" is that the two can disagree. The list is scoped to the chosen service
type; `_select_plan`, which a sync uses, falls back to scanning every service
type when none is chosen. A board that offers "next upcoming" and then syncs a
different plan is worse than one that never offered it.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


@pytest.fixture
def creds(monkeypatch):
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'},
        'services': {'service_type_id': 7},
        'mapping': {},
    })


@pytest.fixture
def no_service_type(monkeypatch):
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'},
        'services': {},
        'mapping': {},
    })


def plan_detail(**attrs):
    return {'data': {'id': '77', 'attributes': attrs}}


class TestPlanLabel:
    def test_dates_alone_when_there_is_no_title(self):
        # Most plans carry no title at all.
        assert pco._plan_label({'short_dates': 'Aug 2'}) == 'Aug 2'

    def test_short_dates_win_over_long(self):
        assert pco._plan_label({'short_dates': 'Aug 2', 'dates': 'August 2, 2026'}) == 'Aug 2'

    def test_title_is_joined_when_there_is_one(self):
        assert pco._plan_label({'short_dates': 'Aug 2', 'title': 'Baptism'}) == 'Aug 2 — Baptism'

    def test_an_empty_plan_labels_as_empty_not_as_a_dash(self):
        assert pco._plan_label({}) == ''
        assert pco._plan_label({'title': '   '}) == ''


class TestNextPlan:
    def test_it_reports_the_plan_select_plan_picks(self, creds, monkeypatch):
        # ⭐ The contract: the same answer a sync would reach. Pinned by going
        # through _select_plan rather than by re-deriving it here.
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (7, '77', None))
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: plan_detail(short_dates='Oct 12'))

        result = pco.next_plan()

        assert result['ok'] is True
        assert result['plan_id'] == '77'
        assert result['service_type_id'] == 7

    def test_the_label_names_the_date(self, creds, monkeypatch):
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (7, '77', None))
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: plan_detail(
            short_dates='Oct 12', title='Baptism'))

        assert pco.next_plan()['label'] == 'Oct 12 — Baptism'

    def test_a_plan_whose_detail_call_fails_is_still_the_right_plan(self, creds, monkeypatch):
        # ⚠️ The label is a convenience; the id is the answer. Failing the whole
        # lookup because a title could not be fetched would send the operator
        # back to picking plans by hand over nothing.
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (7, '77', None))
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: None)

        result = pco.next_plan()

        assert result['ok'] is True
        assert result['plan_id'] == '77'
        assert result['label'] == ''

    def test_no_upcoming_plan_is_reported_not_guessed(self, creds, monkeypatch):
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (7, None, None))

        result = pco.next_plan()

        assert result['ok'] is False
        assert 'upcoming' in result['error']

    def test_a_resolution_error_comes_back_verbatim(self, creds, monkeypatch):
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (None, None, 'Unable to resolve Service Type'))

        assert pco.next_plan() == {'ok': False, 'error': 'Unable to resolve Service Type'}

    def test_a_disabled_integration_says_so_rather_than_erroring(self, monkeypatch):
        def refuse():
            raise pco.PcoConfigError('PCO integration is disabled (pco.enabled=false)')

        monkeypatch.setattr(pco, 'get_pco_config', refuse)

        result = pco.next_plan()

        assert result['ok'] is False
        assert 'disabled' in result['error']

    def test_it_never_returns_the_token(self, creds, monkeypatch):
        # This answer goes to every client that can reach the board.
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (7, '77', None))
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: plan_detail(short_dates='Oct 12'))

        import json
        blob = json.dumps(pco.next_plan())

        assert 'secret' not in blob
        assert 'Authorization' not in blob
        assert 'auth' not in blob


class TestItAgreesWithASync:
    """⛔ The one property that matters: offering one plan and syncing another."""

    def test_both_paths_go_through_select_plan(self, creds, monkeypatch):
        seen = []

        def spy(services, headers, plan_id_override=None):
            seen.append(plan_id_override)
            return (7, '77', None)

        monkeypatch.setattr(pco, '_select_plan', spy)
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: plan_detail(short_dates='Oct 12'))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: ({'data': [], 'included': []}, None))

        pco.next_plan()
        pco.resolve_sync(pco.get_pco_config())

        # Neither passes an override, so both land on the same "next" branch.
        assert seen == [None, None]

    def test_the_global_scan_is_used_when_no_service_type_is_chosen(self, no_service_type, monkeypatch):
        # The case that makes a client-side "first row of the list" wrong: with
        # no service type, the sync scans every service type instead.
        monkeypatch.setattr(pco, '_get_next_plan_global', lambda headers: (3, '99'))
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: plan_detail(short_dates='Oct 12'))

        result = pco.next_plan()

        assert result['plan_id'] == '99'
        assert result['service_type_id'] == 3
