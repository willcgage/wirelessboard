"""Tests for where configuration is read from and written to.

A frozen build resolves app_dir() to sys._MEIPASS, a directory inside the
application bundle. Configuration must never land there: on macOS the bundle is
signed and notarized, so writing into it fails and invalidates the signature,
and the directory is replaced wholesale on upgrade. This went unnoticed because
it cannot reproduce from a source checkout, where app_dir() is the project root.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    """A fake frozen bundle plus a separate user configuration directory."""

    bundle_dir = tmp_path / 'bundle'
    user_dir = tmp_path / 'user'
    bundle_dir.mkdir()
    user_dir.mkdir()

    (bundle_dir / 'democonfig.json').write_text('{"demo": true}', encoding='utf-8')

    def fake_app_dir(folder=None):
        return str(bundle_dir / folder) if folder else str(bundle_dir)

    def fake_config_path(folder=None):
        return str(user_dir / folder) if folder else str(user_dir)

    monkeypatch.setattr(config, 'app_dir', fake_app_dir)
    monkeypatch.setattr(config, 'config_path', fake_config_path)
    return bundle_dir, user_dir


def test_frozen_build_ignores_config_inside_the_bundle(bundle, monkeypatch):
    bundle_dir, user_dir = bundle
    # The exact situation that broke PCO settings: a config.json present inside
    # the bundle was preferred over the user's real configuration.
    (bundle_dir / 'config.json').write_text('{"from": "bundle"}', encoding='utf-8')
    (user_dir / 'config.json').write_text('{"from": "user"}', encoding='utf-8')
    monkeypatch.setattr(sys, 'frozen', True, raising=False)

    assert config.config_file() == str(user_dir / 'config.json')


def test_frozen_build_writes_to_the_user_directory_when_no_config_exists(bundle, monkeypatch):
    bundle_dir, user_dir = bundle
    (bundle_dir / 'config.json').write_text('{"from": "bundle"}', encoding='utf-8')
    monkeypatch.setattr(sys, 'frozen', True, raising=False)

    resolved = config.config_file()

    assert resolved == str(user_dir / 'config.json')
    # The demo config is seeded into the user directory, not read from the bundle.
    assert os.path.exists(resolved)


def test_source_checkout_still_honours_a_config_beside_the_project(bundle, monkeypatch):
    bundle_dir, user_dir = bundle
    (bundle_dir / 'config.json').write_text('{"from": "project"}', encoding='utf-8')
    monkeypatch.delattr(sys, 'frozen', raising=False)

    assert config.config_file() == str(bundle_dir / 'config.json')


def test_missing_democonfig_does_not_raise(bundle, monkeypatch):
    bundle_dir, user_dir = bundle
    (bundle_dir / 'democonfig.json').unlink()
    monkeypatch.setattr(sys, 'frozen', True, raising=False)

    # Previously this called copyfile() on a path that does not exist.
    assert config.config_file() == str(user_dir / 'config.json')
