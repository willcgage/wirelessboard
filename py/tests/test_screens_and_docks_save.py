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
    'id': 'green-room', 'name': 'Green Room', 'kind': 'charging',
    'position_inches': 3.9, 'positions': 11,
}


class TestTheSaveRuns:
    def test_a_screen_and_a_dock_save_together(self, stored):
        """The venue's own configuration: a 55in wall over an 11-position dock."""
        saved = config.update_screens_and_docks(
            [dict(WALL, dock_id='green-room')], [DOCK])

        assert [s['id'] for s in saved['screens']] == ['wall']
        assert [d['id'] for d in saved['docks']] == ['green-room']
        assert saved['screens'][0]['dock_ids'] == ['green-room']
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
        assert screen['dock_ids'] == ['green-room']
        assert any(d['id'] in screen['dock_ids'] for d in docks), \
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


class TestTheKindsThisReplaced:
    """⛔ Everything underneath a screen is a dock (settled 2026-10-15).

    The `dock` / `pad` split is gone. These values are in real `config.json`
    files, and this is the normaliser that rewrites them on every save -- so a
    board that described its docks before the change has to come through with
    the same meaning.

    ⛔ Why this class exists at all: #212 renamed a function in here and shipped
    a `NameError`, so **every** Screens/Dock save 500'd in beta.5. It had been
    checked by hand before the rename and never after.
    """

    def test_a_stored_dock_was_a_charging_dock(self):
        [only] = config.normalize_docks([dict(DOCK, kind='dock')])
        assert only['kind'] == 'charging'

    def test_a_stored_pad_charged_nothing_and_still_does(self):
        # ⛔ Not interchangeable with the above. Mapping both one way would tell
        # an operator their dock charges when it does not, or the reverse, and
        # the kind is the only record of it -- nothing branches on it.
        [only] = config.normalize_docks([dict(DOCK, kind='pad')])
        assert only['kind'] == 'noncharging'

    def test_the_current_kinds_pass_through(self):
        for kind in config.DOCK_KINDS:
            [only] = config.normalize_docks([dict(DOCK, kind=kind)])
            assert only['kind'] == kind

    def test_junk_keeps_the_measurement_and_defaults_the_way_it_used_to(self):
        for junk in ('trolley', '', None, 7, {}, True):
            [only] = config.normalize_docks([dict(DOCK, kind=junk)])
            assert only['kind'] == 'charging'
            assert only['position_inches'] == 3.9, 'the width is what matters'

    def test_a_save_carries_the_old_kinds_forward(self, stored):
        """The whole point: the migration happens where boards actually save."""
        saved = config.update_screens_and_docks(
            [dict(WALL, dock_id='green-room')],
            [dict(DOCK, kind='pad')])

        assert saved['docks'][0]['kind'] == 'noncharging'
        # And the screen still finds its floor, which is the reason any of
        # this is stored.
        assert saved['screens'][0]['dock_ids'] == ['green-room']
        assert saved['docks'][0]['position_inches'] == 3.9

    def test_the_two_sides_agree_on_the_kinds(self):
        """⛔ py/config.py and js/docks.mjs must list the same kinds.

        The browser normalises the payload before it is sent and this
        normalises what gets stored. If they disagree, one of them silently
        rewrites the other's value on every save.
        """
        import pathlib
        import re

        source = pathlib.Path(__file__).resolve().parents[2] / 'js' / 'docks.mjs'
        text = source.read_text(encoding='utf-8')
        found = re.search(r"export const DOCK_KINDS = \[([^\]]*)\]", text)
        assert found, 'DOCK_KINDS not found in js/docks.mjs'
        js_kinds = tuple(re.findall(r"'([^']+)'", found.group(1)))
        assert js_kinds == config.DOCK_KINDS

        legacy = re.search(r"const LEGACY_DOCK_KINDS = \{([^}]*)\}", text)
        assert legacy, 'LEGACY_DOCK_KINDS not found in js/docks.mjs'
        js_legacy = dict(re.findall(r"(\w+): '([^']+)'", legacy.group(1)))
        assert js_legacy == config.LEGACY_DOCK_KINDS



class TestSeveralDocksUnderOneScreen:
    """A3: the venue has eleven SBC200s under the Green Room screen.

    ⛔ A screen named exactly one dock, and the field test reported that as the
    plain limit it is:

        "I can only choose 1 dock under a screen right now; however, I have 11
         under the Green Room Screen I am testing and using in production now."

    Eleven units in a row is the ordinary case, not an exotic one.
    """

    def test_a_screen_can_name_several(self, stored):
        second = dict(DOCK, id='side-table', name='Side table')
        saved = config.update_screens_and_docks(
            [dict(WALL, dock_ids=['green-room', 'side-table'])], [DOCK, second])

        assert saved['screens'][0]['dock_ids'] == ['green-room', 'side-table']

    def test_the_order_is_the_operators(self, stored):
        # Left to right on the table. A count would not care; anything that
        # later links a position to a slot would.
        second = dict(DOCK, id='side-table')
        saved = config.update_screens_and_docks(
            [dict(WALL, dock_ids=['side-table', 'green-room'])], [DOCK, second])

        assert saved['screens'][0]['dock_ids'] == ['side-table', 'green-room']

    def test_one_dock_cannot_be_under_one_screen_twice(self, stored):
        # ⚠️ Summing a repeat would hand the board more columns than the room
        # has places.
        saved = config.update_screens_and_docks(
            [dict(WALL, dock_ids=['green-room', 'green-room'])], [DOCK])

        assert saved['screens'][0]['dock_ids'] == ['green-room']

    def test_the_single_dock_shapes_are_still_read(self, stored):
        # ⛔ Read, never written. A board described under an earlier shape keeps
        # its floor; dropping the link would silently widen its columns past
        # the dock they were measured against.
        saved = config.update_screens_and_docks([dict(WALL, dock_id='green-room')], [DOCK])
        assert saved['screens'][0]['dock_ids'] == ['green-room']

        saved = config.update_screens_and_docks([dict(WALL, furniture_id='green-room')], [DOCK])
        assert saved['screens'][0]['dock_ids'] == ['green-room']

    def test_furniture_id_is_the_old_name_not_a_second_dock(self, stored):
        # ⛔ `furniture_id` was renamed to `dock_id`. A board carrying both
        # would otherwise be handed two docks where it has one, and a column
        # count twice what it should be.
        saved = config.update_screens_and_docks(
            [dict(WALL, dock_id='green-room', furniture_id='side-table')],
            [DOCK, dict(DOCK, id='side-table')])

        assert saved['screens'][0]['dock_ids'] == ['green-room']

    def test_the_singular_key_is_not_written_back(self, stored):
        # One record of the link, so the two cannot drift apart.
        saved = config.update_screens_and_docks([dict(WALL, dock_id='green-room')], [DOCK])
        assert 'dock_id' not in saved['screens'][0]
        assert 'furniture_id' not in saved['screens'][0]
