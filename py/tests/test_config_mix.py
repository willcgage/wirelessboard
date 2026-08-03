"""How a configuration save merges with what is already stored.

extended_id carries the position a slot answers to ("Vocal 1"), which the PCO
seed workflow writes and later syncs match against. A save must be able to
change or clear it deliberately, and must never drop it by accident.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


@pytest.fixture
def stored(monkeypatch):
    tree = {'slots': [{
        'slot': 1,
        'type': 'ulxd',
        'ip': '10.0.0.1',
        'channel': 1,
        'extended_id': 'Vocal 1',
        'extended_name': 'Alice',
        'chan_name_raw': 'SLOT 1',
    }]}
    monkeypatch.setattr(config, 'config_tree', tree)
    return tree['slots'][0]


def mix_one(payload):
    return config.config_mix([payload])[0]


class TestExtendedId:
    def test_a_save_that_omits_it_keeps_the_stored_value(self, stored):
        """The important one: a config save must not wipe seeded positions."""
        out = mix_one({'slot': 1, 'type': 'ulxd'})

        assert out['extended_id'] == 'Vocal 1'

    def test_it_can_be_changed(self, stored):
        out = mix_one({'slot': 1, 'type': 'ulxd', 'extended_id': 'Guitar 3'})

        assert out['extended_id'] == 'Guitar 3'

    def test_clearing_it_removes_it_rather_than_storing_empty(self, stored):
        out = mix_one({'slot': 1, 'type': 'ulxd', 'extended_id': ''})

        assert 'extended_id' not in out


class TestExtendedName:
    def test_a_save_that_omits_it_keeps_the_stored_value(self, stored):
        out = mix_one({'slot': 1, 'type': 'ulxd'})

        assert out['extended_name'] == 'Alice'

    def test_it_can_be_changed(self, stored):
        out = mix_one({'slot': 1, 'type': 'ulxd', 'extended_name': 'Bob'})

        assert out['extended_name'] == 'Bob'

    def test_clearing_it_removes_it(self, stored):
        out = mix_one({'slot': 1, 'type': 'ulxd', 'extended_name': ''})

        assert 'extended_name' not in out


class TestDeviceName:
    def test_the_hardware_supplied_name_is_never_taken_from_the_payload(self, stored):
        """chan_name_raw comes from the receiver, so the editor cannot set it."""
        out = mix_one({'slot': 1, 'type': 'ulxd', 'chan_name_raw': 'SPOOFED'})

        assert out['chan_name_raw'] == 'SLOT 1'

    def test_it_is_dropped_once_cleared_from_the_stored_config(self, monkeypatch):
        monkeypatch.setattr(config, 'config_tree', {'slots': [{'slot': 1, 'type': 'ulxd'}]})

        out = mix_one({'slot': 1, 'type': 'ulxd', 'chan_name_raw': 'STALE'})

        assert 'chan_name_raw' not in out


class TestUnknownSlot:
    def test_a_slot_with_no_stored_counterpart_passes_through(self, stored):
        out = mix_one({'slot': 9, 'type': 'offline', 'extended_id': 'New 1'})

        assert out['extended_id'] == 'New 1'
