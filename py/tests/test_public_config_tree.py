"""Tests for the configuration payload served to clients.

The stored PCO auth block carries only metadata and has no `has_credentials`
flag — that exists solely in the public view. Serving the raw tree published the
salt and digest to every client and, worse, overwrote the browser's cached
`has_credentials` on each /data.json poll, so credentials saved successfully and
then read as unstored a second later. That is what produced "Cannot sync with
PCO: store credentials and save before syncing" immediately after a save that
logged "Credentials stored securely in system keyring".
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


@pytest.fixture
def stored_credentials(monkeypatch):
    tree = {
        'port': 8058,
        'slots': [{'slot': 1}],
        'pco': {
            'enabled': True,
            'service_type': 'Sunday',
            'auth': {
                'credential_id': 'default',
                'version': 1,
                'salt': 'c2FsdHk=',
                'token_digest': 'a' * 64,
            },
        },
    }
    monkeypatch.setattr(config, 'config_tree', tree)
    return tree


def test_public_tree_exposes_has_credentials(stored_credentials):
    payload = config.get_public_config_tree()

    # The flag the PCO sync button gates on must survive into the payload.
    assert payload['pco']['auth']['has_credentials'] is True


def test_public_tree_hides_salt_and_digest(stored_credentials):
    auth = config.get_public_config_tree()['pco']['auth']

    assert 'salt' not in auth
    assert 'token_digest' not in auth


def test_public_tree_keeps_non_auth_pco_settings(stored_credentials):
    pco = config.get_public_config_tree()['pco']

    assert pco['enabled'] is True
    assert pco['service_type'] == 'Sunday'


def test_public_tree_preserves_the_rest_of_the_config(stored_credentials):
    payload = config.get_public_config_tree()

    assert payload['port'] == 8058
    assert payload['slots'] == [{'slot': 1}]


def test_public_tree_does_not_mutate_the_stored_config(stored_credentials):
    config.get_public_config_tree()

    # Sanitizing must not strip the real credentials metadata from memory,
    # or the next save would write a config with no digest.
    assert stored_credentials['pco']['auth']['token_digest'] == 'a' * 64
    assert stored_credentials['pco']['auth']['salt'] == 'c2FsdHk='


def test_public_tree_without_pco_block(monkeypatch):
    monkeypatch.setattr(config, 'config_tree', {'port': 8058})

    assert config.get_public_config_tree() == {'port': 8058}
