"""Connecting to Planning Center as its own action (#120).

⛔ Connecting used to be a side effect of saving the whole form, and nothing
exercised the credentials until the operator tried to fetch plans. First-time
setup was therefore save → fetch → discover the token was wrong → save again,
and a bad token sat in the keyring looking like a good one.

Two orderings carry the weight here and both are pinned below:

1. **Verify, then store.** Never the other way round.
2. **Network off the IOLoop, writes on it.** `verify_credentials` makes every
   HTTP call and writes nothing; `store_credentials` writes config.json and
   makes no calls. The handler is what joins them — see `PcoConnectHandler`,
   and `PcoSyncHandler` for why the split exists at all.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import pco  # noqa: E402


@pytest.fixture(autouse=True)
def no_leftover_http_status():
    pco._LAST_HTTP_ERROR = None
    yield
    pco._LAST_HTTP_ERROR = None


@pytest.fixture
def stored(monkeypatch):
    """Records what would have been written to config.json."""
    writes = []
    monkeypatch.setattr(config, 'update_pco_config', lambda payload: writes.append(payload))
    return writes


def service_types(count=1):
    return {'data': [{'id': str(n), 'attributes': {'name': f'Sunday {n}'}} for n in range(count)]}


def me(name='Will Gage'):
    return {'data': {'attributes': {'name': name}}}


class TestVerify:
    def test_empty_credentials_never_reach_the_network(self, monkeypatch):
        def explode(*_a, **_k):
            raise AssertionError('should not have called Planning Center')

        monkeypatch.setattr(pco, '_http_get', explode)

        assert pco.verify_credentials('', '')['ok'] is False
        assert pco.verify_credentials('tok', '')['ok'] is False
        assert pco.verify_credentials('', 'sec')['ok'] is False

    def test_a_working_token_connects(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            me() if '/people/' in url else service_types(2)))

        result = pco.verify_credentials('tok', 'sec')

        assert result['ok'] is True
        assert result['who'] == 'Will Gage'
        assert result['service_types'] == 2

    def test_it_checks_services_not_identity(self, monkeypatch):
        # ⭐ A Personal Access Token can authenticate perfectly and still have no
        # access to Services. Reporting "Connected" on such a token tells the
        # operator the opposite of the truth, so the check is a Services call.
        asked = []

        def spy(url, *_a, **_k):
            asked.append(url)
            return me() if '/people/' in url else service_types()

        monkeypatch.setattr(pco, '_http_get', spy)
        pco.verify_credentials('tok', 'sec')

        assert any('/services/v2/service_types' in u for u in asked)

    def test_a_rejected_token_says_it_was_rejected(self, monkeypatch):
        def refuse(*_a, **_k):
            pco._LAST_HTTP_ERROR = 401
            return None

        monkeypatch.setattr(pco, '_http_get', refuse)

        result = pco.verify_credentials('tok', 'sec')

        assert result['ok'] is False
        assert '401' in result['error']

    def test_an_unreachable_api_is_not_a_rejected_token(self, monkeypatch):
        # These looked identical before `_fetch_error`; a board on a dead
        # network must not tell the operator their token is wrong.
        monkeypatch.setattr(pco, '_http_get', lambda *_a, **_k: None)

        result = pco.verify_credentials('tok', 'sec')

        assert result['ok'] is False
        assert '401' not in result['error']

    def test_authenticated_with_nothing_to_read_warns(self, monkeypatch):
        # ⛔ Authenticated, authorised, and no service types. Every later step
        # comes back empty, and without saying so it reads as a broken board
        # rather than a permission on the token.
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            me() if '/people/' in url else service_types(0)))

        result = pco.verify_credentials('tok', 'sec')

        assert result['ok'] is True
        assert 'no service types' in result['warning']

    def test_a_missing_display_name_is_not_a_failure(self, monkeypatch):
        # ⚠️ The People API is a different product from Services and refuses a
        # Services-only token. Failing Connect over a name would reject
        # credentials that work perfectly for everything this board does.
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            None if '/people/' in url else service_types(1)))

        result = pco.verify_credentials('tok', 'sec')

        assert result['ok'] is True
        assert result['who'] == ''

    def test_it_writes_nothing(self, monkeypatch):
        # ⛔ This half runs on a worker thread. If it ever writes config.json it
        # puts a second thread in front of the file whose corruption once left a
        # server that could not start.
        writes = []
        monkeypatch.setattr(config, 'update_pco_config', lambda p: writes.append(p))
        monkeypatch.setattr(config, 'save_current_config', lambda: writes.append('save'))
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            me() if '/people/' in url else service_types(1)))

        pco.verify_credentials('tok', 'sec')

        assert writes == []


class TestStore:
    def test_a_verified_credential_is_stored(self, stored):
        result = pco.store_credentials('tok', 'sec', {'ok': True, 'who': 'Will Gage'})

        assert result['ok'] is True
        assert stored == [{'enabled': True, 'auth': {'token': 'tok', 'secret': 'sec'}}]

    def test_connecting_turns_the_integration_on(self, stored):
        # ⭐ Pressing Connect is an explicit statement that PCO should work.
        # Leaving `enabled` false would mean an operator who just connected
        # still had to tick a box and Save before anything loaded -- the
        # friction #120 exists to remove.
        pco.store_credentials('tok', 'sec', {'ok': True})

        assert stored[0]['enabled'] is True

    def test_a_failed_check_stores_nothing_and_is_passed_through(self, stored):
        checked = {'ok': False, 'error': 'Planning Center rejected these credentials (401)'}

        result = pco.store_credentials('tok', 'sec', checked)

        assert result == checked
        assert stored == []

    def test_credentials_are_trimmed_before_storing(self, stored):
        # A PAT pasted from a browser arrives with a trailing newline often
        # enough that the digest check would fail later for no visible reason.
        pco.store_credentials('  tok\n', ' sec ', {'ok': True})

        assert stored[0]['auth'] == {'token': 'tok', 'secret': 'sec'}

    def test_a_storage_failure_says_the_credentials_were_fine(self, monkeypatch):
        # ⚠️ Otherwise a keyring problem reads as a bad token and the operator
        # goes hunting for a new PAT they do not need.
        def boom(_payload):
            raise RuntimeError('no keyring backend')

        monkeypatch.setattr(config, 'update_pco_config', boom)

        result = pco.store_credentials('tok', 'sec', {'ok': True})

        assert result['ok'] is False
        assert 'valid but could not be stored' in result['error']
        assert 'no keyring backend' in result['error']

    def test_the_warning_survives_the_store(self, stored):
        result = pco.store_credentials('tok', 'sec', {
            'ok': True, 'who': '', 'service_types': 0, 'warning': 'Connected, but nothing to read.',
        })

        assert result['warning'] == 'Connected, but nothing to read.'

    def test_the_answer_never_echoes_the_credentials(self, stored):
        import json
        blob = json.dumps(pco.store_credentials('tok-secret-value', 'sec-value', {'ok': True}))

        assert 'tok-secret-value' not in blob
        assert 'sec-value' not in blob
