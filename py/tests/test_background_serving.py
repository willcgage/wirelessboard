"""Background media is actually served from where the configuration points.

⛔ It was not. `BackgroundAssetHandler` overrode `get_absolute_path` to resolve
against `config.get_gif_dir()`, but Tornado *validates* the result separately —
and that validation still used the route's own `path`, which is `''`. So every
file was checked against the server's current working directory and anything
outside it was refused with "is not in root static directory".

The default backgrounds folder is never inside the working directory
(`%LOCALAPPDATA%\\wirelessboard\\backgrounds`, `~/Library/Application
Support/wirelessboard/backgrounds`), so **the photo wall could not load a single
picture out of the box.** It went unnoticed because nothing had ever put a photo
on a card through this code — the one thing the media work was never exercised
against.

⚠️ The second test is the one that keeps the fix honest. The easy "fix" is to
stop validating, which serves the photos and opens the backgrounds route to
`../../config.json` at the same time.
"""

import os
import sys

import pytest
from tornado.testing import AsyncHTTPTestCase
import tornado.web as web

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import tornado_server  # noqa: E402


PIXEL = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000'
    '00907753de0000000c4944415408d76360000002000154a24f5e0000'
    '000049454e44ae426082'
)


class BackgroundsServeFromOutsideTheWorkingDirectory(AsyncHTTPTestCase):
    def get_app(self):
        return web.Application([(r'/bg/(.*)', tornado_server.BackgroundAssetHandler,
                                 {'path': ''})])

    def setUp(self):
        super().setUp()
        # ⚠️ tmp_path is deliberately nowhere near the working directory --
        # which is the whole point. A folder *inside* it always worked, which
        # is why a casual test would have passed against the broken code.
        import tempfile
        self._dir = tempfile.mkdtemp(prefix='wb-bg-')
        with open(os.path.join(self._dir, 'brad aylor.png'), 'wb') as fh:
            fh.write(PIXEL)
        with open(os.path.join(self._dir, 'secret.txt'), 'wb') as fh:
            fh.write(b'not a background')
        self._real_gif_dir = tornado_server.config.get_gif_dir
        tornado_server.config.get_gif_dir = lambda: self._dir

    def tearDown(self):
        tornado_server.config.get_gif_dir = self._real_gif_dir
        super().tearDown()

    def test_a_photo_in_the_configured_folder_is_served(self):
        # The folder is outside the working directory, as every real one is.
        response = self.fetch('/bg/brad%20aylor.png')

        assert response.code == 200, (
            'backgrounds outside the working directory are refused; '
            'the photo wall cannot load a picture'
        )
        assert response.body == PIXEL

    def test_a_name_with_spaces_and_odd_case_still_resolves(self):
        # Real folders are full of "firstname lastname.jpg".
        with open(os.path.join(self._dir, 'Casie Hamilton.JPG'), 'wb') as fh:
            fh.write(PIXEL)

        assert self.fetch('/bg/Casie%20Hamilton.JPG').code == 200

    def test_it_still_refuses_to_leave_the_backgrounds_folder(self):
        # The easy way to make the test above pass is to stop validating at
        # all, which also serves config.json.
        outside = os.path.join(os.path.dirname(self._dir), 'outside.txt')
        with open(outside, 'wb') as fh:
            fh.write(b'should never be served')

        for path in ('..%2foutside.txt', '%2e%2e%2foutside.txt',
                     'sub%2f..%2f..%2foutside.txt'):
            response = self.fetch('/bg/' + path)
            assert response.code in (403, 404), (
                f'{path} escaped the backgrounds folder with {response.code}'
            )

    def test_something_that_is_not_there_is_not_found(self):
        assert self.fetch('/bg/nobody.png').code == 404
