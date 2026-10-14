"""The save path itself, which nothing called until the venue did (#203, #212).

⛔ Why this file exists. `update_screens_and_docks` carried
`normalize_docks(dock)` — a name that does not exist — from the #212 rename all
the way into 2.0.0-beta.5. Every save of a screen or a dock raised
`NameError: name 'dock' is not defined` and answered 500, so the Dock section
could not be used at all.

⚠️ Nothing caught it because the tests stopped either side of this function:
`normalize_docks` and `normalize_screens` were covered thoroughly, and the save
that joins them was covered by a hand-run curl check — taken **before** the
rename and never again after it. A mechanical rename needs the same end-to-end
check as the change it renames.

So these call the save, not the pieces.
"""
import pytest

import config


@pytest.fixture
def stored(monkeypatch):
    tree = {'slots': [], 'groups': [], 'screens': [], 'docks': []}
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    return tree


WALL = {'id': 'wall', 'name': 'Auditorium wall', 'diagonal_inches': 55}
DOCK = {
    'id': 'green-room', 'name': 'Green Room', 'kind': 'dock',
    'position_inches': 3.9, 'positions': 11,
}


class TestTheSaveRuns:
    def test_a_screen_and_a_dock_save_together(self, stored):
        """The venue's own configuration: a 55in wall over an 11-position dock."""
        saved = config.update_screens_and_docks(
            [dict(WALL, dock_id='green-room')], [DOCK])

        assert [s['id'] for s in saved['screens']] == ['wall']
        assert [d['id'] for d in saved['docks']] == ['green-room']
        assert saved['screens'][0]['dock_id'] == 'green-room'
        assert saved['docks'][0]['position_inches'] == 3.9
        assert saved['docks'][0]['positions'] == 11

    def test_both_lists_reach_the_stored_tree(self, stored):
        config.update_screens_and_docks([WALL], [DOCK])
        assert [d['id'] for d in stored['docks']] == ['green-room']
        assert [s['id'] for s in stored['screens']] == ['wall']

    def test_saving_nothing_is_allowed(self, stored):
        """A board clearing its screens is a normal thing to do."""
        config.update_screens_and_docks([WALL], [DOCK])
        saved = config.update_screens_and_docks([], [])
        assert saved == {'screens': [], 'docks': []}

    def test_junk_is_dropped_rather_than_raising(self, stored):
        saved = config.update_screens_and_docks(
            [WALL, {'no': 'id'}, 'not a dict'],
            [DOCK, {'id': 'no-width'}, None])
        assert [s['id'] for s in saved['screens']] == ['wall']
        assert [d['id'] for d in saved['docks']] == ['green-room']

    def test_a_dock_a_screen_names_survives_the_round_trip(self, stored):
        """⛔ The link is the part that decides the column count (#201).

        A save that stored the dock but lost the reference would silently drop
        that board's column floor.
        """
        config.update_screens_and_docks([dict(WALL, dock_id='green-room')], [DOCK])
        screen = config.get_screens()[0]
        docks = config.get_docks()
        assert screen['dock_id'] == 'green-room'
        assert any(d['id'] == screen['dock_id'] for d in docks), \
            'the screen must still point at a dock that exists'


class TestTheHandlerContract:
    def test_the_function_takes_screens_then_docks(self, stored):
        """⚠️ Positional, and the handler calls it positionally.

        The NameError was invisible to every caller because the signature was
        right and only the body was wrong; this pins the shape the handler
        depends on so a future rename cannot quietly swap them.
        """
        saved = config.update_screens_and_docks([WALL], [DOCK])
        assert saved['screens'][0]['name'] == 'Auditorium wall'
        assert saved['docks'][0]['name'] == 'Green Room'
