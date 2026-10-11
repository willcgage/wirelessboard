"""The calendar of plans, and noticing when the active one changes (#140).

Two read-only capabilities that the automatic half will be built on:

⭐ **The schedule** is the only way to check a rule set *before* a service
rather than after. "What will the board do on Sunday" is otherwise unanswerable
without actually syncing, which writes.

⚠️ **Change detection** answers about the plan the board **last synced**, not
the plan nearest today. Those differ exactly when somebody syncs early, and the
honest question is "is what is on screen still right".
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


PROFILES = [
    {'id': 'weekend', 'name': 'Weekend', 'folder_id': '100'},
    {'id': 'youth', 'name': 'Youth', 'service_type_id': '34'},
]

PLANS = [
    {'id': '1', 'short_dates': 'Oct 12', 'service_type_id': '12', 'service_type_name': 'Sunday AM'},
    {'id': '2', 'short_dates': 'Oct 15', 'service_type_id': '34', 'service_type_name': 'Youth'},
    {'id': '3', 'short_dates': 'Oct 19', 'service_type_id': '99', 'service_type_name': 'Other'},
]


@pytest.fixture(autouse=True)
def clean():
    pco.forget_folder_chains()
    pco.forget_last_sync()
    yield
    pco.forget_folder_chains()
    pco.forget_last_sync()


@pytest.fixture
def listed(monkeypatch):
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'},
        'services': {},
        'mapping': {},
        'profiles': PROFILES,
    })
    monkeypatch.setattr(pco, 'list_plans', lambda: {'ok': True, 'plans': PLANS})
    monkeypatch.setattr(pco, 'folder_chain', lambda stid, headers: ('100',) if str(stid) == '12' else ())


class TestSchedule:
    def test_every_upcoming_plan_says_which_rules_it_will_get(self, listed):
        result = pco.plan_schedule()

        assert result['ok'] is True
        assert [(p['plan_id'], p['profile']['id']) for p in result['plans']] == [
            ('1', 'weekend'),   # matched through its folder
            ('2', 'youth'),     # matched on its service type
            ('3', None),        # nothing matches; the board settings apply
        ]

    def test_it_says_how_each_one_matched(self, listed):
        # ⭐ The operator has to be able to tell a folder match from a service
        # type match, or a surprising row is unexplainable.
        reasons = [p['profile']['reason'] for p in pco.plan_schedule()['plans']]

        assert reasons == ['folder', 'service_type', 'base']

    def test_a_plan_with_no_profile_still_describes_itself(self, listed):
        last = pco.plan_schedule()['plans'][-1]

        assert last['profile']['description'] == 'Using the board settings.'

    def test_the_limit_is_honoured(self, listed):
        assert len(pco.plan_schedule(limit=2)['plans']) == 2

    def test_a_limit_of_zero_returns_nothing_rather_than_everything(self, listed):
        # A slice with a zero limit is an easy way to accidentally return the
        # whole list, which is the opposite of what was asked.
        assert pco.plan_schedule(limit=0)['plans'] == []

    def test_it_carries_the_plan_label_and_date(self, listed):
        first = pco.plan_schedule()['plans'][0]

        assert first['label'] == 'Oct 12'
        assert first['service_type_name'] == 'Sunday AM'

    def test_binding_conflicts_are_reported_alongside(self, listed, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'profiles': [{'id': 'a', 'name': 'A', 'folder_id': '100'},
                         {'id': 'b', 'name': 'B', 'folder_id': '100'}],
        })

        assert pco.plan_schedule()['profile_conflicts'][0]['winner'] == 'A'

    def test_a_failed_plan_list_is_passed_through(self, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {}})
        monkeypatch.setattr(pco, 'list_plans', lambda: {'ok': False, 'error': 'nope'})

        assert pco.plan_schedule() == {'ok': False, 'error': 'nope'}

    def test_a_disabled_integration_says_so(self, monkeypatch):
        def refuse():
            raise pco.PcoConfigError('PCO integration is disabled (pco.enabled=false)')

        monkeypatch.setattr(pco, 'get_pco_config', refuse)

        assert pco.plan_schedule()['ok'] is False

    def test_it_writes_nothing(self, listed, monkeypatch):
        import config
        writes = []
        monkeypatch.setattr(config, 'save_current_config', lambda: writes.append(1))

        pco.plan_schedule()

        assert writes == []

    def test_the_folder_walk_is_skipped_for_service_type_matches(self, listed, monkeypatch):
        # ⚠️ Plan 2 matches on its service type, so nothing a folder could say
        # would change the answer. The same gate the sync path uses.
        walked = []
        monkeypatch.setattr(pco, 'folder_chain', lambda stid, h: walked.append(str(stid)) or ())

        pco.plan_schedule()

        assert '34' not in walked

    def test_no_folder_bindings_means_no_walk_at_all(self, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
            'profiles': [{'id': 'a', 'service_type_id': '12'}]})
        monkeypatch.setattr(pco, 'list_plans', lambda: {'ok': True, 'plans': PLANS})

        def explode(*_a, **_k):
            raise AssertionError('should not have walked the folder tree')

        monkeypatch.setattr(pco, 'folder_chain', explode)

        assert pco.plan_schedule()['ok'] is True


class TestSyncMemory:
    def test_nothing_is_remembered_before_the_first_sync(self):
        assert pco.last_sync() == {}

    def test_a_sync_is_remembered(self):
        pco.record_sync('77', '2026-10-11T12:00:00Z', 'youth')

        remembered = pco.last_sync()

        assert remembered['plan_id'] == '77'
        assert remembered['updated_at'] == '2026-10-11T12:00:00Z'
        assert remembered['profile_id'] == 'youth'

    def test_only_the_most_recent_sync_is_kept(self):
        pco.record_sync('77', 'a', 'youth')
        pco.record_sync('78', 'b', 'weekend')

        assert pco.last_sync()['plan_id'] == '78'

    def test_a_sync_with_no_plan_is_not_recorded(self):
        pco.record_sync(None, 'a', 'b')

        assert pco.last_sync() == {}

    def test_what_comes_back_is_a_copy(self):
        # Callers serialise it into an API response; handing out the live dict
        # would let one of them edit what the next check compares against.
        pco.record_sync('77', 'a', 'b')
        pco.last_sync()['plan_id'] = 'tampered'

        assert pco.last_sync()['plan_id'] == '77'


class TestChangeDetection:
    @pytest.fixture
    def creds(self, monkeypatch):
        monkeypatch.setattr(pco, 'get_pco_config', lambda: {
            'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {}})

    def test_nothing_synced_yet_is_not_a_change(self, creds):
        result = pco.check_active_plan()

        assert result['ok'] is True
        assert result['known'] is False
        assert result['changed'] is False

    def test_an_unchanged_plan_reports_no_change(self, creds, monkeypatch):
        pco.record_sync('77', 'stamp-1', 'youth')
        monkeypatch.setattr(pco, 'plan_updated_at', lambda *a, **k: 'stamp-1')

        assert pco.check_active_plan()['changed'] is False

    def test_a_changed_plan_is_reported(self, creds, monkeypatch):
        pco.record_sync('77', 'stamp-1', 'youth')
        monkeypatch.setattr(pco, 'plan_updated_at', lambda *a, **k: 'stamp-2')

        result = pco.check_active_plan()

        assert result['changed'] is True
        assert result['plan_id'] == '77'
        assert result['previous_updated_at'] == 'stamp-1'
        assert result['updated_at'] == 'stamp-2'

    def test_it_asks_about_the_plan_that_was_synced_not_the_nearest_one(self, creds, monkeypatch):
        # ⚠️ They differ exactly when somebody syncs early, and the honest
        # question is "is what is on screen still right".
        pco.record_sync('77', 'stamp-1', None)
        asked = []
        monkeypatch.setattr(pco, 'plan_updated_at',
                            lambda plan_id, headers: asked.append(plan_id) or 'stamp-1')

        pco.check_active_plan()

        assert asked == ['77']

    def test_a_failed_check_is_not_an_all_clear(self, creds, monkeypatch):
        # ⛔ A dead network reporting "unchanged" is the worst answer available:
        # the board looks confident and is not checking anything.
        pco.record_sync('77', 'stamp-1', None)
        monkeypatch.setattr(pco, 'plan_updated_at', lambda *a, **k: None)

        result = pco.check_active_plan()

        assert result['ok'] is False
        assert result['error']
        # The key point: it must not claim "unchanged". A caller reading
        # `changed` without checking `ok` would otherwise be told all is well.
        assert 'changed' not in result

    def test_a_sync_with_no_stamp_never_reports_a_change(self, creds, monkeypatch):
        # Watching was off when this was synced, so there is nothing to compare
        # against. Reporting "changed" on the first check would be a guess.
        pco.record_sync('77', None, None)
        monkeypatch.setattr(pco, 'plan_updated_at', lambda *a, **k: 'stamp-9')

        assert pco.check_active_plan()['changed'] is False

    def test_it_never_syncs(self, creds, monkeypatch):
        # ⛔ Reports only. Whether a change is applied automatically or waits
        # for an admin is decided above this.
        pco.record_sync('77', 'stamp-1', None)
        monkeypatch.setattr(pco, 'plan_updated_at', lambda *a, **k: 'stamp-2')

        def explode(*_a, **_k):
            raise AssertionError('check_active_plan must not sync')

        monkeypatch.setattr(pco, 'sync_from_pco', explode)
        monkeypatch.setattr(pco, '_apply_assignments', explode)

        assert pco.check_active_plan()['changed'] is True


class TestWatchIsOptIn:
    def test_off_by_default(self):
        assert pco._watching_active_plan({}) is False
        assert pco._watching_active_plan({'watch_active_plan': False}) is False

    def test_a_truthy_string_does_not_turn_it_on(self):
        assert pco._watching_active_plan({'watch_active_plan': 'false'}) is False

    def test_on_when_asked(self):
        assert pco._watching_active_plan({'watch_active_plan': True}) is True

    def test_a_sync_pays_nothing_for_it_when_off(self, monkeypatch):
        # ⚠️ It is one more request on the path an operator is waiting on. The
        # same rule the folder walk follows.
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (34, '77', None))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: {'data': [], 'included': []})
        monkeypatch.setattr(pco, '_configured_slots', lambda: [])

        def explode(*_a, **_k):
            raise AssertionError('should not have asked for updated_at')

        monkeypatch.setattr(pco, 'plan_updated_at', explode)

        result = pco.resolve_sync({'auth': {'token': 't', 'secret': 's'},
                                   'services': {}, 'mapping': {}})

        assert result['plan_updated_at'] is None

    def test_a_watching_sync_captures_the_stamp(self, monkeypatch):
        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (34, '77', None))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: {'data': [], 'included': []})
        monkeypatch.setattr(pco, '_configured_slots', lambda: [])
        monkeypatch.setattr(pco, 'plan_updated_at', lambda *a, **k: 'stamp-1')

        result = pco.resolve_sync({'auth': {'token': 't', 'secret': 's'}, 'services': {},
                                   'mapping': {}, 'watch_active_plan': True})

        assert result['plan_updated_at'] == 'stamp-1'


class TestOnlyRealSyncsAreRemembered:
    @pytest.fixture
    def resolution(self):
        return {
            'ok': True, 'plan_id': '77', 'plan_updated_at': 'stamp-1',
            'options': {'strategy': 'position_or_note'},
            'category': '', 'resolved': [], 'unmatched': [],
            'conflicts': [], 'people': [], 'profile': {'id': 'youth'},
            'profile_conflicts': [],
        }

    def test_a_real_sync_is_remembered(self, resolution, monkeypatch):
        import config
        monkeypatch.setattr(config, 'save_current_config', lambda: None)

        pco.finish_sync(resolution, dry_run=False)

        assert pco.last_sync()['plan_id'] == '77'

    def test_a_preview_is_not(self, resolution):
        # ⛔ A preview that recorded here would make the next check report "no
        # change" about a plan nobody ever applied.
        pco.finish_sync(resolution, dry_run=True)

        assert pco.last_sync() == {}
