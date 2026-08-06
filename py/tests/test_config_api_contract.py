"""/api/config must report configuration health on every response.

The interface can only offer a way out of a damaged config.json if it is told
there is one to offer. Health was added to the POST response and missed on the
GET -- and GET is the one the config view actually calls on open, so the banner
never appeared. Unit tests on config.py all passed; only a request caught it.

Hence a contract test at the HTTP boundary rather than another one below it.
"""

import json
import os
import sys
from unittest import mock

import tornado.web as web
from tornado.testing import AsyncHTTPTestCase

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tornado_server  # noqa: E402


HEALTH = {
    'degraded': True,
    'backup_available': True,
    'config_path': '/tmp/config.json',
    'backup_path': '/tmp/config.json.bak',
}


class ConfigEndpointContract(AsyncHTTPTestCase):
    def get_app(self):
        return web.Application([
            (r'/api/config/recover', tornado_server.ConfigRecoveryHandler),
            (r'/api/config', tornado_server.ConfigHandler),
        ])

    def setUp(self):
        super().setUp()
        patches = [
            mock.patch.object(tornado_server.config, 'config_health', return_value=dict(HEALTH)),
            mock.patch.object(tornado_server.config, 'get_public_config_tree', return_value={}),
            mock.patch.object(tornado_server.config, 'get_discovery_settings', return_value={}),
            mock.patch.object(tornado_server.config, 'ensure_discovery_defaults', return_value={}),
            mock.patch.object(tornado_server.discover, 'get_dcid_status', return_value={}),
            mock.patch.object(tornado_server.SocketHandler, 'close_all_ws'),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_get_reports_health(self):
        """The call the config view makes when it opens."""
        body = json.loads(self.fetch('/api/config').body)

        assert body['health']['degraded'] is True
        assert body['health']['backup_available'] is True

    def test_recovery_rejects_an_unknown_action(self):
        response = self.fetch(
            '/api/config/recover', method='POST', body=json.dumps({'action': 'wipe'}))

        assert response.code == 400
        assert json.loads(response.body)['ok'] is False

    def test_recovery_requires_an_action(self):
        response = self.fetch('/api/config/recover', method='POST', body='{}')

        assert response.code == 400

    def test_recovery_rejects_malformed_json(self):
        response = self.fetch('/api/config/recover', method='POST', body='not json')

        assert response.code == 400

    def test_a_missing_backup_is_a_refusal_not_a_crash(self):
        """409 so the interface can say why; a 500 would read as "try again"."""
        with mock.patch.object(
            tornado_server.config, 'recover',
            side_effect=FileNotFoundError('No configuration backup is available to restore'),
        ):
            response = self.fetch(
                '/api/config/recover', method='POST', body=json.dumps({'action': 'restore'}))

        assert response.code == 409
        assert 'backup' in json.loads(response.body)['error']

    def test_a_successful_recovery_returns_the_new_health(self):
        healthy = dict(HEALTH, degraded=False)
        with mock.patch.object(tornado_server.config, 'recover', return_value=healthy):
            response = self.fetch(
                '/api/config/recover', method='POST', body=json.dumps({'action': 'defaults'}))

        body = json.loads(response.body)
        assert response.code == 200
        assert body['ok'] is True
        assert body['action'] == 'defaults'
        assert body['health']['degraded'] is False
