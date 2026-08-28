"""What the board is offered as a background, and how many disk walks it costs.

Two things are worth pinning here.

The first is the format and capitalisation rule. A background is named after the
person on the channel, and the operator naming that file is working from a phone
photo, a screenshot or a stock export -- so it arrives as ``.JPG`` as often as
``.jpg``, and as a png or webp as often as a jpeg. Both halves have to agree:
this module decides what the board is offered, ``js/background-key.mjs`` decides
what it picks, and a format missing here can never be picked no matter what the
frontend accepts.

The second is that listing the folder is a blocking call made from inside
/data.json, which every open board requests every five seconds, on the single
thread that serves the entire board. Walking the folder once per format was
affordable when there were three; it is the shape of fault this project has
already hit three times, so the count is asserted rather than left to drift.
"""

import os

import pytest

import tornado_server


@pytest.fixture
def backgrounds(tmp_path, monkeypatch):
    """A background folder, with tornado_server pointed at it."""
    monkeypatch.setattr(tornado_server.config, 'get_gif_dir', lambda: str(tmp_path))
    return tmp_path


def write(folder, *names):
    for name in names:
        (folder / name).write_bytes(b'not really an image')


def test_every_accepted_photo_format_is_offered(backgrounds):
    write(backgrounds, 'jane.jpg', 'sam.jpeg', 'alex.png', 'kim.webp')

    images = tornado_server.background_file_lists()['image']

    assert sorted(images) == ['alex.png', 'jane.jpg', 'kim.webp', 'sam.jpeg']


def test_capitalised_and_pascal_case_files_are_offered(backgrounds):
    # The bug this rule exists for: a correctly named photo sitting unused
    # because the operator's camera wrote the extension in capitals.
    write(backgrounds, 'Jane Smith.JPG', 'Sam Reed.Png', 'Alex Doe.WebP')

    images = tornado_server.background_file_lists()['image']

    assert sorted(images) == ['Alex Doe.WebP', 'Jane Smith.JPG', 'Sam Reed.Png']


def test_names_are_returned_as_they_are_on_disk(backgrounds):
    # /bg/ serves these straight off the filesystem, so lowercasing the name
    # here would hand the board a URL that 404s on a case-sensitive disk.
    write(backgrounds, 'Jane Smith.JPG')

    assert tornado_server.background_file_lists()['image'] == ['Jane Smith.JPG']


def test_every_accepted_video_format_is_offered(backgrounds):
    write(backgrounds, 'jane.mp4', 'Sam Reed.MOV')

    videos = tornado_server.background_file_lists()['video']

    assert sorted(videos) == ['Sam Reed.MOV', 'jane.mp4']


def test_kinds_do_not_leak_into_each_other(backgrounds):
    write(backgrounds, 'jane.jpg', 'jane.mp4', 'jane.mov', 'jane.gif', 'jane.bmp', 'notes.txt')

    lists = tornado_server.background_file_lists()

    assert lists['image'] == ['jane.jpg']
    assert sorted(lists['video']) == ['jane.mov', 'jane.mp4']
    assert lists['gif'] == ['jane.gif']


def test_the_folder_is_walked_once_per_request(backgrounds, monkeypatch):
    """The whole board waits on this listing, so it happens exactly once."""
    write(backgrounds, 'jane.jpg', 'jane.mp4', 'jane.gif')

    calls = []
    real_listdir = os.listdir

    def counting_listdir(path):
        calls.append(path)
        return real_listdir(path)

    monkeypatch.setattr(tornado_server.os, 'listdir', counting_listdir)

    lists = tornado_server.background_file_lists()

    assert len(calls) == 1, 'one listing per request, not one per format'
    assert lists['image'] == ['jane.jpg']


def test_the_frontend_and_the_server_accept_the_same_formats():
    """A format the server never lists can never be chosen by the board.

    js/background-key.mjs holds the same list and picks between what it is
    offered; the two drifting apart is silent -- the file simply never appears.
    """
    source = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        'js', 'background-key.mjs')
    with open(source, 'r', encoding='utf-8') as handle:
        frontend = handle.read()

    images = frontend.split('IMG:', 1)[1].split(']', 1)[0]
    videos = frontend.split('MP4:', 1)[1].split(']', 1)[0]
    # Prove each slice found the list it meant to and not half the file, or the
    # loops below pass for the wrong reason.
    assert '.jpg' in images and '.mp4' not in images, images
    assert '.mp4' in videos and '.jpg' not in videos, videos

    for extension in tornado_server.IMAGE_EXTENSIONS:
        assert "'{}'".format(extension) in images, (
            '{} is listed by the server but not accepted by the board'.format(extension))

    for extension in tornado_server.VIDEO_EXTENSIONS:
        assert "'{}'".format(extension) in videos, (
            '{} is listed by the server but not accepted by the board'.format(extension))
