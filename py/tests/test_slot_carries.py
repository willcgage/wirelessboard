"""What a channel carries, declared by the operator (#260).

⛔ The hardware never says this. A QLX-D serves a handheld or a bodypack, and a
bodypack is a headset on somebody's face or a pack on a guitar — the receiver
reports the same thing either way. So the board asks.

⛔⛔ Stored on the slot, which means it crosses the **three write paths** that
#238 already paid for once: a key only one of them knows about is wiped by the
next save from another. `config_mix` must keep it when a whole-slot save omits
it, and `update_slot` must take it partially.
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
        'extended_id': 'Acoustic Guitar',
        'carries': 'instrument',
        'chan_name_raw': 'SLOT 1',
    }]}
    monkeypatch.setattr(config, 'config_tree', tree)
    monkeypatch.setattr(config, 'save_current_config', lambda: None)
    return tree['slots']


class TestItSurvivesTheWritePaths:
    def test_a_whole_slot_save_that_omits_it_keeps_it(self, stored):
        # ⛔ The receivers editor sends whole slots. An older build, or any save
        # from a surface without the field, must not blank what was declared.
        out = config.config_mix([{
            'slot': 1, 'type': 'ulxd', 'ip': '10.0.0.1', 'channel': 1,
        }])[0]

        assert out['carries'] == 'instrument'

    def test_a_whole_slot_save_that_sends_it_replaces_it(self, stored):
        out = config.config_mix([{
            'slot': 1, 'type': 'ulxd', 'ip': '10.0.0.1', 'channel': 1,
            'carries': 'headset',
        }])[0]

        assert out['carries'] == 'headset'

    def test_sending_it_empty_clears_it(self, stored):
        # Blank is a real choice: "go back to working it out from the label".
        out = config.config_mix([{
            'slot': 1, 'type': 'ulxd', 'ip': '10.0.0.1', 'channel': 1,
            'carries': '',
        }])[0]

        assert 'carries' not in out

    def test_update_slot_takes_it_partially(self, stored):
        config.update_slot({'slot': 1, 'carries': 'handheld'})
        assert stored[0]['carries'] == 'handheld'

    def test_update_slot_leaves_it_alone_when_absent(self, stored):
        # ⚠️ Absent means "not editing this" — the partial shape every slot
        # write here follows (#114).
        config.update_slot({'slot': 1, 'extended_name': 'Alice'})
        assert stored[0]['carries'] == 'instrument'

    def test_update_slot_clears_it_when_empty(self, stored):
        config.update_slot({'slot': 1, 'carries': ''})
        assert 'carries' not in stored[0]


class TestOnlyTheFourValuesAreStored:
    def test_an_unknown_value_is_dropped_not_stored(self, stored):
        # ⛔ A field whose job is to settle a question must not become a second
        # source of nonsense.
        config.update_slot({'slot': 1, 'carries': 'trombone'})
        assert 'carries' not in stored[0]

    def test_an_unknown_value_in_a_whole_slot_save_is_dropped(self, stored):
        out = config.config_mix([{
            'slot': 1, 'type': 'ulxd', 'ip': '10.0.0.1', 'channel': 1,
            'carries': 'trombone',
        }])[0]

        assert 'carries' not in out

    def test_case_and_padding_do_not_make_a_new_value(self):
        assert config.normalize_carries('  HeadSet ') == 'headset'

    def test_the_four_values_are_the_four(self):
        assert set(config.CARRIES_VALUES) == {
            'handheld', 'headset', 'instrument', 'iem',
        }
