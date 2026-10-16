"""Assignment rules that differ by the kind of plan being synced.

A Sunday morning service and a Wednesday youth night use different teams, often
a different note category, and a different set of channels. Until profiles,
Planning Center settings were one mapping block, so whichever shape was
configured last was the shape every plan got.

Two properties carry most of the weight and are pinned hardest below:

⭐ **Profiles inherit from the board's mapping rather than replacing it**, so a
profile that only wants a different team filter says only that.

⛔ **A named profile that does not exist is an error, never a quiet fallback.**
Syncing with different rules than the ones asked for is how the wrong person
ends up on a microphone, and it looks exactly like the board working.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco_profiles  # noqa: E402


BASE = {
    'mapping': {
        'strategy': 'position_or_note',
        'note_category': 'Mic / IEM Assignments',
        'note_source': 'person',
        'team_name_filter': ['Vocal', 'Band'],
        'position_number_fallback': False,
        'seed_extended_id': False,
        'clear_unmatched': False,
    },
    'profiles': [
        {
            'id': 'sunday-am',
            'name': 'Sunday AM',
            'service_type_id': '12',
            'mapping': {'team_name_filter': ['Vocal', 'Band', 'Host']},
        },
        {
            'id': 'youth',
            'name': 'Wednesday Youth',
            'service_type_id': 34,
            'mapping': {'team_name_filter': ['Youth Band'], 'clear_unmatched': True},
        },
        {
            # Unbound on purpose: it shares Sunday AM's service type, so no
            # automatic rule can tell it apart. Only a person can say which
            # night it is -- which is the whole reason hand-picking exists.
            'id': 'christmas-eve',
            'name': 'Christmas Eve',
            'mapping': {'note_category': 'Christmas Mics'},
        },
    ],
}


class TestEffectiveMapping:
    def test_a_profile_inherits_every_rule_it_does_not_set(self):
        # ⭐ The property that keeps profiles cheap to add. Without it each one
        # restates all seven knobs, and a knob added later silently differs
        # between profiles -- two of which decide whether a sync takes people
        # *off* the board.
        profile = pco_profiles.profile_by_id(BASE, 'sunday-am')
        mapping = pco_profiles.effective_mapping(BASE, profile)

        assert mapping['strategy'] == 'position_or_note'
        assert mapping['note_category'] == 'Mic / IEM Assignments'
        assert mapping['clear_unmatched'] is False

    def test_what_it_does_set_wins(self):
        profile = pco_profiles.profile_by_id(BASE, 'sunday-am')

        assert pco_profiles.effective_mapping(BASE, profile)['team_name_filter'] == [
            'Vocal', 'Band', 'Host']

    def test_no_profile_is_the_board_settings_unchanged(self):
        assert pco_profiles.effective_mapping(BASE, None) == BASE['mapping']

    def test_the_base_mapping_is_never_mutated(self):
        # It is the live config dict. A profile that edited it in place would
        # leak into the next sync, and into every other profile.
        profile = pco_profiles.profile_by_id(BASE, 'youth')
        pco_profiles.effective_mapping(BASE, profile)

        assert BASE['mapping']['team_name_filter'] == ['Vocal', 'Band']
        assert BASE['mapping']['clear_unmatched'] is False

    def test_an_explicit_null_is_not_an_override(self):
        # ⚠️ What a half-filled form sends. Treating it as an override would
        # blank a rule the board was set up with.
        cfg = {'mapping': {'note_category': 'Mics'}, 'profiles': [
            {'id': 'p', 'mapping': {'note_category': None}}]}

        assert pco_profiles.effective_mapping(cfg, cfg['profiles'][0])['note_category'] == 'Mics'

    def test_a_key_outside_the_known_set_is_ignored(self):
        # A typo in config.json must not become a rule nobody can find.
        cfg = {'mapping': {'strategy': 'position'}, 'profiles': [
            {'id': 'p', 'mapping': {'stratgy': 'note', 'enabled': False}}]}

        mapping = pco_profiles.effective_mapping(cfg, cfg['profiles'][0])

        assert mapping == {'strategy': 'position'}

    def test_a_profile_with_no_mapping_block_is_harmless(self):
        cfg = {'mapping': {'strategy': 'position'}, 'profiles': [{'id': 'p', 'name': 'Bare'}]}

        assert pco_profiles.effective_mapping(cfg, cfg['profiles'][0]) == {'strategy': 'position'}

    def test_a_board_with_no_mapping_at_all_still_resolves(self):
        assert pco_profiles.effective_mapping({}, None) == {}


class TestSelection:
    def test_a_bound_profile_is_picked_from_the_service_type(self):
        profile, reason, error = pco_profiles.select_profile(BASE, service_type_id='34')

        assert error is None
        assert profile['id'] == 'youth'
        assert reason == 'service_type'

    def test_the_binding_survives_int_and_string_ids(self):
        # ⚠️ Service type ids arrive as ints from config.json and strings from
        # the API. Comparing them raw silently matches nothing, and the board
        # quietly uses the wrong rules.
        assert pco_profiles.select_profile(BASE, service_type_id=34)[0]['id'] == 'youth'
        assert pco_profiles.select_profile(BASE, service_type_id='12')[0]['id'] == 'sunday-am'

    def test_an_unbound_profile_is_never_matched_automatically(self):
        # Christmas Eve shares Sunday AM's service type on purpose.
        profile, _reason, _error = pco_profiles.select_profile(BASE, service_type_id='12')

        assert profile['id'] == 'sunday-am'

    def test_but_it_can_be_chosen_by_hand(self):
        profile, reason, error = pco_profiles.select_profile(
            BASE, service_type_id='12', profile_override='christmas-eve')

        assert error is None
        assert profile['id'] == 'christmas-eve'
        assert reason == 'chosen'

    def test_a_hand_pick_beats_a_binding(self):
        profile, _reason, _error = pco_profiles.select_profile(
            BASE, service_type_id='34', profile_override='sunday-am')

        assert profile['id'] == 'sunday-am'

    def test_an_unknown_profile_is_an_error_not_a_fallback(self):
        # ⛔ The important one. Falling back would sync with rules nobody asked
        # for and look exactly like success.
        profile, _reason, error = pco_profiles.select_profile(
            BASE, service_type_id='12', profile_override='no-such-thing')

        assert profile is None
        assert 'no-such-thing' in error

    def test_an_unmatched_service_type_uses_the_board_settings(self):
        profile, reason, error = pco_profiles.select_profile(BASE, service_type_id='999')

        assert (profile, reason, error) == (None, 'base', None)

    def test_no_service_type_at_all_uses_the_board_settings(self):
        assert pco_profiles.select_profile(BASE)[0] is None

    def test_a_board_with_no_profiles_behaves_exactly_as_before(self):
        # ⭐ No migration, nothing to turn on: every existing configuration
        # lands here and gets its mapping block, unchanged.
        cfg = {'mapping': {'strategy': 'position'}}

        profile, reason, error = pco_profiles.select_profile(cfg, service_type_id='12')

        assert (profile, reason, error) == (None, 'base', None)
        assert pco_profiles.effective_mapping(cfg, profile) == {'strategy': 'position'}


class TestDefaultProfile:
    def test_the_default_applies_when_nothing_else_matches(self):
        cfg = dict(BASE, default_profile='christmas-eve')

        profile, reason, _error = pco_profiles.select_profile(cfg, service_type_id='999')

        assert profile['id'] == 'christmas-eve'
        assert reason == 'default'

    def test_a_binding_beats_the_default(self):
        cfg = dict(BASE, default_profile='christmas-eve')

        assert pco_profiles.select_profile(cfg, service_type_id='34')[0]['id'] == 'youth'

    def test_a_default_pointing_at_a_deleted_profile_does_not_stop_a_sync(self):
        # ⚠️ Unlike an override, nobody asked for it this time. Refusing to
        # sync over a stale setting would be worse than using the board's own
        # rules -- but it is reported, so the staleness is visible.
        cfg = dict(BASE, default_profile='deleted')

        profile, reason, error = pco_profiles.select_profile(cfg, service_type_id='999')

        assert (profile, error) == (None, None)
        assert reason == 'default_missing'


class TestMalformedConfig:
    def test_profiles_that_are_not_a_list_are_ignored(self):
        assert pco_profiles.profiles_of({'profiles': {'id': 'x'}}) == []
        assert pco_profiles.profiles_of({'profiles': 'sunday'}) == []
        assert pco_profiles.profiles_of({}) == []

    def test_entries_without_an_id_are_dropped(self):
        cfg = {'profiles': [{'name': 'No id'}, {'id': '', 'name': 'Blank'}, {'id': 'ok'}]}

        assert [p['id'] for p in pco_profiles.profiles_of(cfg)] == ['ok']

    def test_a_non_dict_entry_does_not_crash_selection(self):
        cfg = {'profiles': ['sunday', None, 42, {'id': 'ok', 'service_type_id': '12'}]}

        assert pco_profiles.select_profile(cfg, service_type_id='12')[0]['id'] == 'ok'


class TestBindingConflicts:
    def test_one_profile_per_service_type_is_no_conflict(self):
        assert pco_profiles.binding_conflicts(BASE) == []

    def test_two_profiles_claiming_one_service_type_are_reported(self):
        # ⚠️ Reported, not refused: a half-finished configuration should not
        # stop a service. But an operator who believes "Youth" is in force
        # while "Sunday AM" actually is needs to be told.
        cfg = {'profiles': [
            {'id': 'a', 'name': 'Sunday AM', 'service_type_id': '12'},
            {'id': 'b', 'name': 'Sunday AM (old)', 'service_type_id': '12'},
        ]}

        conflicts = pco_profiles.binding_conflicts(cfg)

        assert len(conflicts) == 1
        assert conflicts[0]['winner'] == 'Sunday AM'
        assert conflicts[0]['profiles'] == ['Sunday AM', 'Sunday AM (old)']

    def test_the_reported_winner_is_the_one_actually_used(self):
        cfg = {'profiles': [
            {'id': 'a', 'name': 'First', 'service_type_id': '12'},
            {'id': 'b', 'name': 'Second', 'service_type_id': '12'},
        ]}

        winner = pco_profiles.binding_conflicts(cfg)[0]['winner']
        selected = pco_profiles.select_profile(cfg, service_type_id='12')[0]

        assert selected['name'] == winner

    def test_unbound_profiles_never_conflict(self):
        cfg = {'profiles': [{'id': 'a', 'name': 'A'}, {'id': 'b', 'name': 'B'}]}

        assert pco_profiles.binding_conflicts(cfg) == []


class TestDescription:
    @pytest.mark.parametrize('reason,expected', [
        ('chosen', 'Using the "Wednesday Youth" profile.'),
        ('service_type', 'Using the "Wednesday Youth" profile, matched on this plan\'s service type.'),
        ('default', 'Using the "Wednesday Youth" profile, the default.'),
    ])
    def test_it_says_which_rules_are_in_force_and_why(self, reason, expected):
        # The operator has to be able to tell a hand-pick from an automatic
        # match; otherwise "why did it use those teams" is unanswerable.
        profile = pco_profiles.profile_by_id(BASE, 'youth')

        assert pco_profiles.describe_selection(profile, reason) == expected

    def test_no_profile_says_so_plainly(self):
        assert pco_profiles.describe_selection(None, 'base') == 'Using the board settings.'

    def test_a_stale_default_is_called_out(self):
        assert 'missing' in pco_profiles.describe_selection(None, 'default_missing')

    def test_a_profile_with_no_name_falls_back_to_its_id(self):
        assert 'sunday-am' in pco_profiles.describe_selection({'id': 'sunday-am'}, 'chosen')


class TestItReachesTheSync:
    """⭐ The unit tests above prove the choice; these prove it is obeyed.

    A profile that resolves correctly and is then ignored by `resolve_sync` is
    the worst outcome available -- the board reports the right rules and syncs
    with the wrong ones.
    """

    @pytest.fixture
    def plan(self, monkeypatch):
        import pco

        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (34, '77', None))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: ({'data': [], 'included': []}, None))
        monkeypatch.setattr(pco, '_configured_slots', lambda: [])
        return pco

    def cfg(self):
        import copy
        return dict(copy.deepcopy(BASE), auth={'token': 't', 'secret': 's'}, services={})

    def test_the_bound_profile_s_rules_are_the_ones_used(self, plan):
        result = plan.resolve_sync(self.cfg())

        # The youth profile turns clear_unmatched on; the board's own mapping
        # has it off. If the profile were ignored this would be False, and a
        # sync would silently stop taking last week's people off the board.
        assert result['options']['clear_unmatched'] is True
        assert result['profile']['id'] == 'youth'
        assert result['profile']['reason'] == 'service_type'

    def test_inherited_rules_come_from_the_board(self, plan):
        result = plan.resolve_sync(self.cfg())

        # The youth profile says nothing about these.
        assert result['options']['strategy'] == 'position_or_note'
        assert result['category'] == 'Mic / IEM Assignments'

    def test_a_hand_picked_profile_overrides_the_binding(self, plan):
        result = plan.resolve_sync(self.cfg(), profile_override='christmas-eve')

        assert result['profile']['id'] == 'christmas-eve'
        assert result['category'] == 'Christmas Mics'
        # Christmas Eve says nothing about clearing, so it inherits "off" --
        # not the youth profile's "on", which is no longer in play at all.
        assert result['options']['clear_unmatched'] is False

    def test_an_unknown_profile_stops_the_sync(self, plan):
        result = plan.resolve_sync(self.cfg(), profile_override='nope')

        assert result['ok'] is False
        assert 'nope' in result['error']

    def test_a_board_with_no_profiles_is_untouched(self, plan):
        cfg = {'auth': {'token': 't', 'secret': 's'}, 'services': {},
               'mapping': {'strategy': 'position', 'clear_unmatched': True}}

        result = plan.resolve_sync(cfg)

        assert result['options']['strategy'] == 'position'
        assert result['options']['clear_unmatched'] is True
        assert result['profile']['id'] is None
        assert result['profile']['description'] == 'Using the board settings.'

    def test_the_report_is_always_present(self, plan):
        # ⚠️ "Using the board settings." is a real answer. An absent field
        # would leave the operator to infer which rules ran, which is exactly
        # what profiles make non-obvious.
        result = plan.resolve_sync(self.cfg())

        assert set(result['profile']) == {'id', 'name', 'reason', 'bound_to', 'description'}

    def test_an_explicit_plan_costs_one_lookup_to_find_its_service_type(self, monkeypatch):
        # ⚠️ `_select_plan` returns no service type for an explicitly chosen
        # plan, so a bound profile cannot be matched without asking. Only on
        # this path, and only when profiles exist at all.
        import pco

        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (None, '77', None))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: ({'data': [], 'included': []}, None))
        monkeypatch.setattr(pco, '_configured_slots', lambda: [])
        looked_up = []

        def service_type_of(plan_id, _headers):
            looked_up.append(plan_id)
            return 34

        monkeypatch.setattr(pco, '_get_plan_service_type_id', service_type_of)

        result = pco.resolve_sync(self.cfg(), plan_id_override='77')

        assert looked_up == ['77']
        assert result['profile']['id'] == 'youth'

    def test_no_profiles_means_no_extra_lookup(self, monkeypatch):
        # The common case must not pay for a feature it is not using.
        import pco

        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (None, '77', None))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: ({'data': [], 'included': []}, None))
        monkeypatch.setattr(pco, '_configured_slots', lambda: [])

        def explode(*_a, **_k):
            raise AssertionError('should not have looked up the service type')

        monkeypatch.setattr(pco, '_get_plan_service_type_id', explode)

        pco.resolve_sync({'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {}},
                         plan_id_override='77')

    def test_a_hand_picked_profile_also_skips_the_lookup(self, monkeypatch):
        # Nothing needs matching when the operator has already said which.
        import pco

        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (None, '77', None))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: ({'data': [], 'included': []}, None))
        monkeypatch.setattr(pco, '_configured_slots', lambda: [])

        def explode(*_a, **_k):
            raise AssertionError('should not have looked up the service type')

        monkeypatch.setattr(pco, '_get_plan_service_type_id', explode)

        result = pco.resolve_sync(self.cfg(), plan_id_override='77', profile_override='youth')

        assert result['profile']['id'] == 'youth'

    def test_a_profile_with_a_bogus_strategy_is_refused_by_name(self, plan):
        # ⛔ `get_pco_config` validates the board's mapping; a profile's
        # overrides never pass through it. An unsupported strategy produces no
        # labels, so every person comes back unmatched -- indistinguishable
        # from a plan with nobody on it, which is the worst way to fail.
        cfg = self.cfg()
        cfg['profiles'][1]['mapping']['strategy'] = 'whatever'

        result = plan.resolve_sync(cfg)

        assert result['ok'] is False
        assert 'whatever' in result['error']
        assert 'Wednesday Youth' in result['error']

    def test_a_profile_with_a_bogus_note_source_is_refused_too(self, plan):
        cfg = self.cfg()
        cfg['profiles'][1]['mapping']['note_source'] = 'telepathy'

        result = plan.resolve_sync(cfg)

        assert result['ok'] is False
        assert 'telepathy' in result['error']

    def test_a_bogus_rule_in_an_unused_profile_does_not_stop_a_sync(self, plan):
        # ⚠️ Only the profile actually in force is checked. A typo in a profile
        # nobody selected must not take the board out on a Sunday morning.
        cfg = self.cfg()
        cfg['profiles'][2]['mapping']['strategy'] = 'whatever'

        assert plan.resolve_sync(cfg)['ok'] is True


class TestFolderBinding:
    """⭐ Churches organise Services into folders, and the maintainer's board
    covers Sunday Morning, Sunday Night, Wednesday Youth and special services.

    A folder binding is one rule covering every service type filed under it --
    including ones created later, which a service-type binding cannot do.

    ⛔ Templates are deliberately absent. Planning Center copies a template into
    a plan rather than linking it, so a plan carries no reference back and
    nothing the board can read says which template it came from. Hand-picking
    is the answer there, not a binding that cannot exist.
    """

    CFG = {
        'mapping': {'strategy': 'position_or_note', 'team_name_filter': ['Everyone']},
        'profiles': [
            {'id': 'weekend', 'name': 'Weekend', 'folder_id': '100',
             'mapping': {'team_name_filter': ['Vocal', 'Band']}},
            {'id': 'youth', 'name': 'Youth', 'folder_id': '200',
             'mapping': {'team_name_filter': ['Youth Band'], 'clear_unmatched': True}},
            {'id': 'sunday-night', 'name': 'Sunday Night', 'service_type_id': '55',
             'mapping': {'team_name_filter': ['Evening Band']}},
        ],
    }

    def test_a_folder_binding_matches_a_service_type_inside_it(self):
        profile, reason, error = pco_profiles.select_profile(
            self.CFG, service_type_id='12', folder_ids=('100',))

        assert error is None
        assert profile['id'] == 'weekend'
        assert reason == 'folder'

    def test_a_service_type_binding_beats_a_folder_one(self):
        # The more specific statement wins, as everywhere else here.
        profile, reason, _error = pco_profiles.select_profile(
            self.CFG, service_type_id='55', folder_ids=('100',))

        assert profile['id'] == 'sunday-night'
        assert reason == 'service_type'

    def test_the_nearest_folder_wins(self):
        # ⭐ What makes nesting useful: "Youth" inside "Weekend" beats
        # "Weekend", so one general rule covers a whole tree while a single
        # branch overrides it. Same precedence as a stylesheet.
        profile, _reason, _error = pco_profiles.select_profile(
            self.CFG, service_type_id='77', folder_ids=('200', '100'))

        assert profile['id'] == 'youth'

    def test_an_ancestor_folder_still_matches_when_nothing_nearer_does(self):
        profile, _reason, _error = pco_profiles.select_profile(
            self.CFG, service_type_id='77', folder_ids=('999', '100'))

        assert profile['id'] == 'weekend'

    def test_a_service_type_in_no_matching_folder_uses_the_board_settings(self):
        profile, reason, _error = pco_profiles.select_profile(
            self.CFG, service_type_id='77', folder_ids=('900', '901'))

        assert (profile, reason) == (None, 'base')

    def test_a_hand_pick_still_beats_a_folder(self):
        profile, reason, _error = pco_profiles.select_profile(
            self.CFG, service_type_id='12', folder_ids=('100',), profile_override='youth')

        assert (profile['id'], reason) == ('youth', 'chosen')

    def test_folder_ids_survive_ints(self):
        assert pco_profiles.select_profile(
            {'profiles': [{'id': 'p', 'folder_id': 100}]},
            service_type_id='12', folder_ids=('100',))[0]['id'] == 'p'

    def test_binds_anywhere_is_false_without_folder_bindings(self):
        # ⚠️ The gate on the folder walk, which costs one request per level.
        assert pco_profiles.binds_anywhere({'profiles': [
            {'id': 'a', 'service_type_id': '12'}, {'id': 'b'}]}) is False

    def test_binds_anywhere_is_true_with_one(self):
        assert pco_profiles.binds_anywhere(self.CFG) is True

    def test_two_profiles_claiming_one_folder_are_reported(self):
        cfg = {'profiles': [
            {'id': 'a', 'name': 'Weekend', 'folder_id': '100'},
            {'id': 'b', 'name': 'Weekend (old)', 'folder_id': '100'},
        ]}

        clash = pco_profiles.binding_conflicts(cfg)[0]

        assert clash['kind'] == 'folder'
        assert clash['folder_id'] == '100'
        assert clash['winner'] == 'Weekend'

    def test_the_description_says_it_matched_on_a_folder(self):
        # The operator has to be able to tell "this matched because of the
        # folder" from "this matched because of the service type", or a
        # surprising profile choice is unexplainable.
        profile = pco_profiles.profile_by_id(self.CFG, 'youth')

        assert 'folder' in pco_profiles.describe_selection(profile, 'folder')


class TestFolderWalkIsNotPaidForTwice:
    """⚠️ The walk is one request per level on the path an operator waits on."""

    @pytest.fixture
    def sync(self, monkeypatch):
        import pco

        monkeypatch.setattr(pco, '_select_plan', lambda *a, **k: (34, '77', None))
        monkeypatch.setattr(pco, '_fetch_plan_people', lambda *a, **k: ({'data': [], 'included': []}, None))
        monkeypatch.setattr(pco, '_configured_slots', lambda: [])
        walked = []
        monkeypatch.setattr(pco, 'folder_chain',
                            lambda stid, headers: walked.append(stid) or ('100',))
        pco._walked = walked
        return pco

    def auth(self, profiles):
        return {'auth': {'token': 't', 'secret': 's'}, 'services': {}, 'mapping': {},
                'profiles': profiles}

    def test_no_folder_bindings_means_no_walk(self, sync):
        sync.resolve_sync(self.auth([{'id': 'a', 'service_type_id': '99'}]))

        assert sync._walked == []

    def test_a_matching_service_type_binding_short_circuits_the_walk(self, sync):
        # Nothing a folder could say would change the answer, so nothing is asked.
        result = sync.resolve_sync(self.auth([
            {'id': 'exact', 'service_type_id': '34'},
            {'id': 'broad', 'folder_id': '100'},
        ]))

        assert sync._walked == []
        assert result['profile']['id'] == 'exact'

    def test_a_hand_pick_short_circuits_it_too(self, sync):
        sync.resolve_sync(self.auth([{'id': 'a', 'folder_id': '100'}]),
                          profile_override='a')

        assert sync._walked == []

    def test_it_walks_when_a_folder_binding_could_actually_win(self, sync):
        result = sync.resolve_sync(self.auth([{'id': 'weekend', 'folder_id': '100'}]))

        assert sync._walked == [34]
        assert result['profile']['id'] == 'weekend'
        assert result['profile']['reason'] == 'folder'

    def test_the_report_says_how_the_profile_is_attached(self, sync):
        result = sync.resolve_sync(self.auth([{'id': 'weekend', 'folder_id': '100'}]))

        assert result['profile']['bound_to'] == 'folder'
