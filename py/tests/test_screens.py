"""The screens an installation has described (#170).

⭐ A list rather than one block, because a minimum column width is a fact about
**one screen in one place**. The television above the charging dock has dock
positions to line up with; the laptop at front of house has nothing underneath
it. A single global number would hand every board in the building the first
room's size, which is the question that sent this back to the drawing board.

⛔ A save here must never reconfigure the board. Recording a tape measure is not
a reason to drop every receiver socket for two seconds (#116).
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


WALL = {'id': 'wall', 'name': 'Auditorium wall', 'diagonal_inches': 55, 'min_column_inches': 4.5}
FOH = {'id': 'foh', 'name': 'FOH laptop', 'diagonal_inches': 15}


@pytest.fixture
def tree(monkeypatch):
    stored = {'slots': [], 'screens': []}
    monkeypatch.setattr(config, 'config_tree', stored)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    return stored


class TestWhatIsKept:
    def test_a_described_screen_survives_intact(self):
        assert config.normalize_screens([WALL]) == [{
            'id': 'wall', 'name': 'Auditorium wall',
            'diagonal_inches': 55.0, 'min_column_inches': 4.5,
        }]

    def test_numbers_arriving_as_text_from_a_form_are_still_numbers(self):
        screens = config.normalize_screens([
            {'id': 'wall', 'diagonal_inches': '55', 'min_column_inches': '4.5'},
        ])

        assert screens[0]['diagonal_inches'] == 55.0
        assert screens[0]['min_column_inches'] == 4.5

    def test_a_screen_with_nothing_under_it_keeps_no_minimum(self):
        # The laptop at front of house is a real screen with a real size and no
        # dock below it. Describing it must not invent a rule for it.
        assert config.normalize_screens([FOH])[0]['min_column_inches'] is None

    def test_a_missing_name_falls_back_to_the_id(self):
        assert config.normalize_screens([{'id': 'wall', 'diagonal_inches': 55}])[0]['name'] == 'wall'


class TestWhatIsRefused:
    def test_an_entry_without_an_id_cannot_be_chosen_so_is_dropped(self):
        assert config.normalize_screens([{'name': 'nameless', 'diagonal_inches': 55}]) == []

    def test_an_entry_without_a_size_is_dropped(self):
        # ⛔ It could be picked from the list and would then silently impose
        # nothing, which is worse than not offering it.
        assert config.normalize_screens([{'id': 'wall', 'name': 'Wall'}]) == []

    def test_the_first_definition_of_an_id_wins(self):
        screens = config.normalize_screens([WALL, {'id': 'wall', 'diagonal_inches': 99}])

        assert len(screens) == 1
        assert screens[0]['diagonal_inches'] == 55.0

    def test_nonsense_sizes_are_refused_rather_than_propagated(self):
        for bad in (0, -55, 'big', None, True, [], {}):
            assert config.normalize_screens([{'id': 'x', 'diagonal_inches': bad}]) == [], bad

    def test_a_bad_column_width_leaves_the_screen_usable_without_a_minimum(self):
        # ⚠️ The size is what makes an entry valid; the column width is optional.
        # A typo in the optional half must not delete the screen.
        screens = config.normalize_screens([
            {'id': 'wall', 'diagonal_inches': 55, 'min_column_inches': 'wide'},
        ])

        assert len(screens) == 1
        assert screens[0]['min_column_inches'] is None

    def test_junk_in_the_list_is_skipped_rather_than_fatal(self):
        assert config.normalize_screens([WALL, None, 'nonsense', 7]) == config.normalize_screens([WALL])

    def test_anything_that_is_not_a_list_is_no_screens(self):
        for bad in (None, {}, 'wall', 7):
            assert config.normalize_screens(bad) == []


class TestStoring:
    def test_saving_replaces_the_list(self, tree):
        config.update_screens([WALL, FOH])
        assert [s['id'] for s in config.get_screens()] == ['wall', 'foh']

        config.update_screens([FOH])
        assert [s['id'] for s in config.get_screens()] == ['foh']

    def test_saving_normalizes_on_the_way_in(self, tree):
        config.update_screens([{'id': 'wall', 'diagonal_inches': '55'}, {'name': 'dropped'}])

        assert len(config.get_screens()) == 1

    def test_a_save_does_not_rebuild_the_receivers(self, tree, monkeypatch):
        # Describing a screen changes how a board lays itself out and nothing
        # about the hardware. Tearing every socket down for it would cost two
        # seconds of blank wall for a measurement.
        def explode(*_a, **_k):
            raise AssertionError('a screen save must not reconfigure the board')

        monkeypatch.setattr(config, 'reconfig', explode)
        monkeypatch.setattr(config, 'rebuild_from_disk', explode)

        config.update_screens([WALL])

        assert config.get_screens()[0]['id'] == 'wall'

    def test_reading_never_hands_out_the_live_list(self, tree):
        # ⛔ `config_tree` is the file's in-memory image. A caller mutating what
        # it got back would be editing the configuration without saving it.
        config.update_screens([WALL])
        got = config.get_screens()
        got[0]['diagonal_inches'] = 1

        assert config.get_screens()[0]['diagonal_inches'] == 55.0

    def test_a_tree_with_junk_in_it_is_cleaned_on_read(self, tree):
        tree['screens'] = [WALL, {'id': 'broken'}]

        assert [s['id'] for s in config.get_screens()] == ['wall']
