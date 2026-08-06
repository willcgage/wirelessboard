"""An admin must have a way back from a config.json the board cannot use.

Starting on a damaged config is what makes the interface reachable, but it is
not a fix -- the file on disk is still broken and nothing writes to it. Before
this the only remedy was editing JSON by hand on the machine, which is exactly
what the operator could not do when the interface was the thing that had gone.

Two ways out, both leaving the damaged file on disk: restore the last config
that loaded cleanly, or reset to the same defaults a fresh install starts from.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


GOOD = {
    'slots': [{'slot': 1, 'type': 'offline', 'ip': '10.0.0.1'}],
    'groups': [],
    'port': 8058,
}


@pytest.fixture
def board(tmp_path, monkeypatch):
    """A config directory, with the device rebuild stubbed out."""
    path = tmp_path / 'config.json'
    path.write_text(json.dumps(GOOD))

    monkeypatch.setattr(config, 'config_file', lambda: str(path))
    monkeypatch.setattr(config, 'config_tree', dict(GOOD), raising=False)
    monkeypatch.setattr(config, 'config_load_degraded', False, raising=False)
    # Reloading dials real receivers and sleeps; the recovery contract under
    # test is which bytes land in the file, not the socket work after it.
    monkeypatch.setattr(config, 'rebuild_from_disk', lambda: None)
    return path


def test_a_clean_load_captures_a_backup(tmp_path, monkeypatch):
    path = tmp_path / 'config.json'
    path.write_text(json.dumps(GOOD))
    monkeypatch.setattr(config, 'config_file', lambda: str(path))
    monkeypatch.setattr(config, 'get_gif_dir', lambda: str(tmp_path))
    monkeypatch.setattr(config, 'get_version_number', lambda: '1.6.1')

    config.read_json_config(str(path))

    assert json.loads((tmp_path / 'config.json.bak').read_text())['slots']


def test_a_degraded_load_does_not_overwrite_the_backup(tmp_path, monkeypatch):
    """The one thing that would make the backup useless when it is needed.

    A board that comes up on a damaged config must not replace the last good
    copy with the damaged one -- that is precisely the restart during which the
    backup has to survive.
    """
    path = tmp_path / 'config.json'
    path.write_text(json.dumps(GOOD))
    monkeypatch.setattr(config, 'config_file', lambda: str(path))
    monkeypatch.setattr(config, 'get_gif_dir', lambda: str(tmp_path))
    monkeypatch.setattr(config, 'get_version_number', lambda: '1.6.1')

    config.read_json_config(str(path))          # good load -> backup taken
    path.write_text('{}')                        # the race's output
    config.read_json_config(str(path))           # degraded load

    restored = json.loads((tmp_path / 'config.json.bak').read_text())
    assert restored['slots'][0]['slot'] == 1


def test_restore_puts_the_last_good_config_back(board, tmp_path):
    (tmp_path / 'config.json.bak').write_text(json.dumps(GOOD))
    board.write_text('{}')

    config.recover('restore')

    assert json.loads(board.read_text())['slots'][0]['slot'] == 1


def test_reset_to_defaults_produces_a_loadable_config(board):
    board.write_text('{}')

    config.recover('defaults')

    written = json.loads(board.read_text())
    assert isinstance(written.get('slots'), list)


def test_recovery_keeps_the_file_it_replaced(board, tmp_path):
    """The damaged file is often a one character fix for someone reading it."""
    board.write_text('{"slots": "not-a-list"}')

    config.recover('defaults')

    kept = tmp_path / 'config.json.rejected'
    assert kept.read_text() == '{"slots": "not-a-list"}'


def test_restore_without_a_backup_refuses(board):
    board.write_text('{}')

    with pytest.raises(FileNotFoundError):
        config.recover('restore')

    # And leaves the file alone rather than half-recovering it.
    assert board.read_text() == '{}'


def test_restore_refuses_an_unusable_backup(board, tmp_path):
    """Trading one broken config for another must not report success."""
    (tmp_path / 'config.json.bak').write_text('{"groups": []}')
    board.write_text('{}')

    with pytest.raises(ValueError):
        config.recover('restore')

    assert board.read_text() == '{}'


def test_an_unknown_action_is_rejected(board):
    with pytest.raises(ValueError):
        config.recover('wipe-everything')


def test_recovery_clears_the_degraded_state(board, tmp_path, monkeypatch):
    """Otherwise the board keeps refusing to persist anything afterwards."""
    (tmp_path / 'config.json.bak').write_text(json.dumps(GOOD))
    monkeypatch.setattr(config, 'config_load_degraded', True, raising=False)

    health = config.recover('restore')

    assert config.config_load_degraded is False
    assert health['degraded'] is False


def test_health_reports_what_the_interface_needs(board, tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'config_load_degraded', True, raising=False)

    health = config.config_health()
    assert health['degraded'] is True
    assert health['backup_available'] is False

    (tmp_path / 'config.json.bak').write_text(json.dumps(GOOD))
    assert config.config_health()['backup_available'] is True
