"""Photos chosen for a person by hand (#145).

⭐ This is the whole flow for a board with Planning Center switched off: name
the person on a slot, give them a file, done. Filename matching stays as the
fallback, so a folder of correctly named photos keeps working with nothing to
migrate.

⛔ Keyed on the **person**, not the slot. The photo has to follow them when a
sync moves them to another channel — the behaviour filename matching already
had — and it is what lets two people called Dave have different photos, which a
filename key cannot express at all.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


@pytest.fixture
def tree(monkeypatch):
    saved = []
    monkeypatch.setattr(config, 'config_tree', {})
    monkeypatch.setattr(config, 'save_current_config', lambda: saved.append(1))
    config.config_tree.clear()
    return saved


class TestStoringAChoice:
    def test_a_person_can_be_given_a_file(self, tree):
        result = config.set_media_assignment('Jane Smith', 'Jane-2026.jpg')

        assert result == {'jane smith': 'Jane-2026.jpg'}

    def test_the_key_matches_what_the_browser_looks_up(self, tree):
        # ⛔ Trim and lower-case, exactly like `backgroundKey`. Any difference
        # between the two means a choice that saves and never resolves, which
        # looks precisely like the photo not existing.
        config.set_media_assignment('  Jane Smith  ', 'Jane-2026.jpg')

        assert 'jane smith' in config.get_media_assignments()

    def test_choosing_again_replaces(self, tree):
        config.set_media_assignment('Jane Smith', 'old.jpg')
        config.set_media_assignment('Jane Smith', 'new.jpg')

        assert config.get_media_assignments() == {'jane smith': 'new.jpg'}

    def test_an_empty_file_takes_the_choice_away(self, tree):
        config.set_media_assignment('Jane Smith', 'Jane-2026.jpg')
        config.set_media_assignment('Jane Smith', '')

        assert config.get_media_assignments() == {}

    def test_clearing_someone_who_has_no_choice_is_not_an_error(self, tree):
        assert config.set_media_assignment('Nobody', '') == {}

    def test_two_people_can_share_a_file(self, tree):
        # The case a filename key cannot express: two people called Dave.
        config.set_media_assignment('Dave Jones', 'dave.jpg')
        config.set_media_assignment('Dave Smith', 'dave.jpg')

        assert len(config.get_media_assignments()) == 2

    def test_a_choice_with_no_person_is_refused(self, tree):
        # A photo is assigned to a person; there is nothing to key on.
        with pytest.raises(ValueError):
            config.set_media_assignment('', 'Jane.jpg')
        with pytest.raises(ValueError):
            config.set_media_assignment(None, 'Jane.jpg')

    def test_each_choice_is_saved(self, tree):
        config.set_media_assignment('Jane Smith', 'Jane.jpg')

        assert len(tree) == 1

    def test_a_file_that_does_not_exist_is_still_stored(self, tree):
        # ⚠️ Whether the file is there is the browser's question at render time
        # -- a missing one falls back to the filename match rather than to a
        # blank card. Refusing here would make an operator fix an unrelated
        # problem before they could record a choice.
        assert config.set_media_assignment('Jane Smith', 'not-on-disk.jpg')


class TestReadingThem:
    def test_a_board_that_has_never_chosen_one_has_none(self, tree):
        assert config.get_media_assignments() == {}

    def test_rubbish_in_the_stored_block_is_dropped_rather_than_served(self, tree):
        config.config_tree['media'] = {'assignments': {
            'jane smith': 'Jane.jpg',
            '': 'orphan.jpg',
            'bob': '',
            'carol': 42,
        }}

        assert config.get_media_assignments() == {'jane smith': 'Jane.jpg'}

    def test_a_malformed_media_block_does_not_break_the_board(self, tree):
        config.config_tree['media'] = 'photos please'

        assert config.get_media_assignments() == {}

    def test_what_comes_back_is_a_copy(self, tree):
        config.set_media_assignment('Jane Smith', 'Jane.jpg')
        config.get_media_assignments()['jane smith'] = 'tampered'

        assert config.get_media_assignments() == {'jane smith': 'Jane.jpg'}


class TestItDoesNotInventConfig:
    def test_reading_does_not_write(self, tree):
        # ⛔ `read_json_config` already fills the tree from four ensure_*
        # helpers, and any write-back there persists invented settings -- two
        # separate paths have done it before. Reading assignments must not add
        # a fifth.
        config.get_media_assignments()

        assert tree == []

    def test_the_block_only_appears_once_a_choice_is_made(self, tree):
        config.get_media_assignments()
        assert 'media' not in config.config_tree or not config.config_tree['media']['assignments']

        config.set_media_assignment('Jane Smith', 'Jane.jpg')

        assert config.config_tree['media']['assignments']
