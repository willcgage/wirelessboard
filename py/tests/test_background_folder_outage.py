"""A background folder that blinks out does not take the faces with it (#183).

⛔⛔ Measured on the venue board: the folder is a Google Drive mount, and twice
in one week it was missing for about three seconds. `/data.json` then sent
empty lists, so any board that loaded in that window showed no faces until it
was reloaded -- and before #213 the same `FileNotFoundError` was the 500.
"""

import logging
import shutil

import pytest

import tornado_server


@pytest.fixture
def folder(tmp_path, monkeypatch):
    path = tmp_path / 'photos'
    path.mkdir()
    (path / 'Jane Smith.jpg').write_bytes(b'x')
    (path / 'intro.mp4').write_bytes(b'x')
    monkeypatch.setattr(tornado_server.config, 'get_gif_dir', lambda: str(path))
    monkeypatch.setattr(tornado_server, '_LAST_MEDIA', {})
    monkeypatch.setattr(tornado_server, '_MEDIA_OUTAGE', {})
    return path


def test_the_last_listing_is_served_while_the_folder_is_gone(folder):
    before = tornado_server.background_file_lists()
    shutil.rmtree(folder)

    during = tornado_server.background_file_lists()

    assert during == before
    assert during['image'] == ['Jane Smith.jpg']


def test_a_long_outage_is_one_warning_and_its_end_is_said(folder, caplog):
    caplog.set_level(logging.INFO, logger='micboard.web')
    tornado_server.background_file_lists()
    shutil.rmtree(folder)
    for _ in range(5):
        tornado_server.background_file_lists()
    folder.mkdir()
    (folder / 'Sam Reed.png').write_bytes(b'x')

    after = tornado_server.background_file_lists()

    messages = [r.getMessage() for r in caplog.records if r.name == 'micboard.web']
    assert sum('could not be read' in m for m in messages) == 1
    assert any('can be read again' in m for m in messages)
    assert after['image'] == ['Sam Reed.png']


def test_a_folder_never_listed_still_fails_loudly(folder):
    shutil.rmtree(folder)
    with pytest.raises(OSError):
        tornado_server.background_file_lists()


def test_a_different_folder_never_gets_the_old_ones_files(folder, tmp_path, monkeypatch):
    tornado_server.background_file_lists()
    other = tmp_path / 'missing'
    monkeypatch.setattr(tornado_server.config, 'get_gif_dir', lambda: str(other))
    with pytest.raises(OSError):
        tornado_server.background_file_lists()
