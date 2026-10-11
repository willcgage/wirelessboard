"""Which handheld or bodypack a channel is, separate from who is on it.

Receivers are conventionally labelled "HH-1 Dave" or "BP-9", so `chan_name_raw`
carries the equipment *and* often a person. The board needs the equipment half
on its own: somebody walking up to the rack is asking which pack to pick up,
and the person is already named on the card.

⛔ Parsed here rather than in the browser. `get_chan_name` already picks this
prefix out of the same string, and two places deriving one value from one
string is the fault #57 was about.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import channel  # noqa: E402
import device_config  # noqa: E402


class FakeRx:
    type = 'ulxd'


@pytest.fixture(autouse=True)
def ulxd_const():
    # ChannelDevice reads the field-name map for its type on construction.
    assert 'ulxd' in device_config.BASE_CONST


def make(raw, slot=1, cfg=None):
    device = channel.ChannelDevice(FakeRx(), {'slot': slot, 'channel': 1, **(cfg or {})})
    if raw is not None:
        device.set_chan_name_raw(raw)
    return device


class TestTheEquipmentHalf:
    def test_a_label_with_a_person_on_it_keeps_only_the_equipment(self):
        assert make('HH-1 Dave').device_id() == 'HH-1'
        assert make('BP-9 Lena P.').device_id() == 'BP-9'

    def test_a_label_that_is_only_equipment_is_returned_whole(self):
        assert make('HH-1').device_id() == 'HH-1'
        assert make('BP12').device_id() == 'BP12'

    def test_an_iem_identifier_is_two_words(self):
        assert make('IEM 1 Dave').device_id() == 'IEM 1'

    def test_a_label_with_no_number_is_the_name_of_the_thing(self):
        # Nothing to split on, so the whole label is the equipment's name.
        assert make('Lectern').device_id() == 'Lectern'

    def test_underscores_are_spaces_like_everywhere_else(self):
        assert make('HH-1_Dave').device_id() == 'HH-1'


class TestNothingReportedYet:
    def test_the_placeholder_is_not_a_device_name(self):
        # channel.py seeds "SLOT n" and only replaces it when the receiver says
        # what it is called. Printing that would be inventing hardware.
        assert make(None, slot=5).device_id() == ''
        assert make('SLOT 5', slot=5).device_id() == ''

    def test_an_empty_label_reports_nothing(self):
        assert make('   ').device_id() == ''


class TestItIsIndependentOfTheAssignment:
    def test_a_pco_position_does_not_become_the_device_name(self):
        # extended_id overrides the displayed `id` -- that is the position in
        # the service, "Teaching". The equipment is still HH-1.
        device = make('HH-1 Dave', cfg={'extended_id': 'Teaching', 'extended_name': 'Dave R.'})

        assert device.device_id() == 'HH-1'
        assert device.get_chan_name() == ('Teaching', 'Dave R.')

    def test_the_person_never_leaks_into_it(self):
        device = make('HH-1', cfg={'extended_name': 'Marcy L.'})

        assert device.device_id() == 'HH-1'
        assert 'Marcy' not in device.device_id()
