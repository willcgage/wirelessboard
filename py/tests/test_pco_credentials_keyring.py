"""Tests for keyring failure reporting.

A packaged build that lacks keyring's backend modules or its entry-point
metadata selects keyring.backends.fail, which raises NoKeyringError on every
call. That produced a generic "store credentials and save before syncing"
message in the UI with nothing in the log identifying the cause, so these pin
the diagnosis into the error itself.
"""

import os
import sys

import pytest
from keyring import errors as keyring_errors

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco_credentials  # noqa: E402


def test_missing_backend_names_itself_when_storing(monkeypatch):
    def raise_no_keyring(*_args, **_kwargs):
        raise keyring_errors.NoKeyringError('no backend')

    monkeypatch.setattr(pco_credentials.keyring, 'set_password', raise_no_keyring)
    monkeypatch.setattr(pco_credentials, 'active_backend_name', lambda: 'keyring.backends.fail.Keyring')

    with pytest.raises(pco_credentials.CredentialError) as excinfo:
        pco_credentials._persist_in_keyring('default', 'tok', 'sec')

    message = str(excinfo.value)
    assert 'No system keyring is available' in message
    assert 'keyring.backends.fail.Keyring' in message


def test_missing_backend_names_itself_when_loading(monkeypatch):
    def raise_no_keyring(*_args, **_kwargs):
        raise keyring_errors.NoKeyringError('no backend')

    monkeypatch.setattr(pco_credentials.keyring, 'get_password', raise_no_keyring)
    monkeypatch.setattr(pco_credentials, 'active_backend_name', lambda: 'keyring.backends.fail.Keyring')

    with pytest.raises(pco_credentials.CredentialError) as excinfo:
        pco_credentials._load_from_keyring('default')

    assert 'keyring.backends.fail.Keyring' in str(excinfo.value)


def test_other_keyring_errors_still_reported(monkeypatch):
    def raise_keyring_error(*_args, **_kwargs):
        raise keyring_errors.PasswordSetError('denied')

    monkeypatch.setattr(pco_credentials.keyring, 'set_password', raise_keyring_error)

    with pytest.raises(pco_credentials.CredentialError) as excinfo:
        pco_credentials._persist_in_keyring('default', 'tok', 'sec')

    assert 'Unable to write credentials' in str(excinfo.value)


def test_active_backend_name_is_a_dotted_path():
    name = pco_credentials.active_backend_name()

    assert isinstance(name, str) and name
    # Either a real backend class path or the explicit unavailable marker.
    assert '.' in name or name.startswith('unavailable')
