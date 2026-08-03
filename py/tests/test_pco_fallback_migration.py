"""The one-time correction that turns position_number_fallback off.

Changing the default could not reach existing installations: the PCO panel
wrote this key on every save with its checkbox defaulting to checked, so the
value is explicitly `true` in the file and a new default is never consulted.
Left alone it matches positions on the trailing number, which misassigns as
soon as more than one team is scheduled.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


def tree(fallback=True, migrations=None):
    t = {
        'port': 8058,
        'slots': [],
        'pco': {'enabled': True, 'mapping': {'position_number_fallback': fallback}},
    }
    if migrations is not None:
        t[config.APPLIED_MIGRATIONS_KEY] = migrations
    return t


@pytest.fixture
def install(monkeypatch):
    def use(t):
        monkeypatch.setattr(config, 'config_tree', t)
        return t
    return use


class TestMigratePcoNumberFallback:
    def test_turns_an_unchosen_true_off(self, install):
        t = install(tree(fallback=True))

        assert config.migrate_pco_number_fallback() is True
        assert t['pco']['mapping']['position_number_fallback'] is False

    def test_records_that_it_ran(self, install):
        t = install(tree(fallback=True))
        config.migrate_pco_number_fallback()

        assert t[config.APPLIED_MIGRATIONS_KEY][config.PCO_FALLBACK_MIGRATION] is True

    def test_a_deliberate_reenable_survives(self, install):
        """Single-team plans legitimately want this on. Do not keep undoing it."""
        t = install(tree(fallback=True))
        config.migrate_pco_number_fallback()

        # The operator turns it back on and the app restarts.
        t['pco']['mapping']['position_number_fallback'] = True
        assert config.migrate_pco_number_fallback() is False
        assert t['pco']['mapping']['position_number_fallback'] is True

    def test_leaves_an_explicit_false_alone(self, install):
        t = install(tree(fallback=False))
        config.migrate_pco_number_fallback()

        assert t['pco']['mapping']['position_number_fallback'] is False

    def test_does_not_add_the_key_when_it_was_never_set(self, install):
        t = install({'port': 8058, 'pco': {'mapping': {'strategy': 'position'}}})
        config.migrate_pco_number_fallback()

        assert 'position_number_fallback' not in t['pco']['mapping']

    def test_config_without_pco_is_still_marked(self, install):
        """Otherwise adding PCO later would get retroactively overridden."""
        t = install({'port': 8058, 'slots': []})

        assert config.migrate_pco_number_fallback() is True
        assert config.migration_applied(config.PCO_FALLBACK_MIGRATION) is True

    def test_second_run_reports_no_change(self, install):
        install(tree(fallback=True))
        config.migrate_pco_number_fallback()

        assert config.migrate_pco_number_fallback() is False


class TestTheMarkerSurvivesTheInterface:
    def test_a_pco_save_does_not_wipe_the_marker(self, install, monkeypatch):
        """update_pco_config replaces whole sub-objects from the payload.

        A marker inside pco.mapping would be gone after one save, and the
        migration would run again and undo a deliberate re-enable. This is why
        it lives at the top level.
        """
        t = install(tree(fallback=True))
        monkeypatch.setattr(config, 'save_current_config', lambda: None)
        config.migrate_pco_number_fallback()

        # Exactly what the panel posts: a fresh mapping object, no marker in it.
        config.update_pco_config({
            'enabled': True,
            'mapping': {'strategy': 'position', 'position_number_fallback': True},
        })

        assert config.migration_applied(config.PCO_FALLBACK_MIGRATION) is True
        assert config.migrate_pco_number_fallback() is False
        assert t['pco']['mapping']['position_number_fallback'] is True
