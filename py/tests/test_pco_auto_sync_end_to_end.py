"""Automatic sync through the REAL watcher, not a hand-made status (venue, 2026-11-21).

⛔⛔ On the venue board plan 92179141 read "changed in Planning Center" for 41
hours with automatic sync on, and nothing synced. `run_plan_watch` never stored
`updated_at`, which `pco_auto_sync.attempt_key` needs, so every decision was
"the change could not be identified". Every test of the rule built its status
by hand with the field present -- so each one passed on the very bug.

These tests only stub the network edge (`plan_updated_at`, the end-of-service
check) and let the watcher, the status and the rule run for real.
"""

import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    pco.forget_plan_watch()
    pco.forget_last_sync()
    pco._AUTO_SYNC_TRIED.clear()
    monkeypatch.setattr(pco, 'get_pco_config', lambda: {
        'auth': {'token': 't', 'secret': 's'},
        'services': {},
        'mapping': {'auto_sync': True},
        'watch_active_plan': True,
    })
    monkeypatch.setattr(pco, 'watch_has_finished', lambda *a, **k: None)
    yield
    pco.forget_plan_watch()
    pco.forget_last_sync()
    pco._AUTO_SYNC_TRIED.clear()


def _changed_in_pco(monkeypatch, version='v2'):
    monkeypatch.setattr(pco, 'plan_updated_at', lambda *a, **k: version)


def test_a_changed_plan_is_synced_automatically(monkeypatch):
    pco.record_sync('92179141', 'v1', None)
    _changed_in_pco(monkeypatch)

    pco.run_plan_watch()
    decision = pco.auto_sync_decision()

    assert decision['go'] is True, decision['reason']
    assert decision['key'] == ('92179141', 'v2')
    assert decision['plan_id'] == '92179141'


def test_the_same_version_is_tried_once_not_every_check(monkeypatch):
    pco.record_sync('92179141', 'v1', None)
    _changed_in_pco(monkeypatch)
    pco.run_plan_watch()
    pco.note_auto_sync_attempt(pco.auto_sync_decision()['key'])

    pco._PLAN_WATCH['checked_at'] = 0
    pco.run_plan_watch()

    assert pco.auto_sync_decision()['go'] is False


def test_a_newer_version_is_tried_again(monkeypatch):
    pco.record_sync('92179141', 'v1', None)
    _changed_in_pco(monkeypatch, 'v2')
    pco.run_plan_watch()
    pco.note_auto_sync_attempt(pco.auto_sync_decision()['key'])

    _changed_in_pco(monkeypatch, 'v3')
    pco._PLAN_WATCH['checked_at'] = 0
    pco.run_plan_watch()

    assert pco.auto_sync_decision()['go'] is True


def test_the_change_is_logged_once_not_every_check(monkeypatch, caplog):
    pco.record_sync('92179141', 'v1', None)
    _changed_in_pco(monkeypatch)

    with caplog.at_level(logging.INFO, logger=pco.logger.name):
        for _ in range(5):
            pco._PLAN_WATCH['checked_at'] = 0
            pco.run_plan_watch()

    lines = [r for r in caplog.records if 'has changed in Planning Center' in r.getMessage()]
    assert len(lines) == 1


def test_a_further_change_is_logged_again(monkeypatch, caplog):
    pco.record_sync('92179141', 'v1', None)
    with caplog.at_level(logging.INFO, logger=pco.logger.name):
        _changed_in_pco(monkeypatch, 'v2')
        pco.run_plan_watch()
        _changed_in_pco(monkeypatch, 'v3')
        pco._PLAN_WATCH['checked_at'] = 0
        pco.run_plan_watch()

    lines = [r for r in caplog.records if 'has changed in Planning Center' in r.getMessage()]
    assert len(lines) == 2
