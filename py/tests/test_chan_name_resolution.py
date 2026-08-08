"""Who is on a channel beats what the transmitter is called.

The displayed name is not cosmetic: `updateBackground` in js/gif.js builds the
photo/video filename from it, so whatever wins here decides whether a slot's
media is looked up under the person or under the device.

Reported as the photo/video section mapping to the device instead of the
person. It did, for every slot Planning Center had assigned -- see
test_a_person_shows_without_a_device_snapshot.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import channel  # noqa: E402


class FakeRx:
    type = 'ulxd'


def chan(cfg, live_name):
    device = channel.ChannelDevice(FakeRx(), dict(cfg))
    device.set_chan_name_raw(live_name)
    return device


ASSIGNED = {'slot': 1, 'channel': 1, 'extended_id': 'Vocal 1', 'extended_name': 'Jane Smith'}


def test_a_person_shows_without_a_device_snapshot():
    """The reported bug.

    Planning Center writes extended_name and deliberately does NOT write
    chan_name_raw -- _apply_assignments preserves the hardware naming keys so a
    sync can never overwrite a channel label. The old gate required that
    snapshot to be present before it would apply the assignment at all, so
    every PCO-assigned person was displayed as their transmitter and their
    photo resolved to the device.
    """
    chan_id, chan_name = chan(ASSIGNED, 'MIC1 Bob Device').get_chan_name()

    assert chan_name == 'Jane Smith'
    assert chan_id == 'Vocal 1'


def test_a_person_shows_when_the_snapshot_matches():
    device = chan(dict(ASSIGNED, chan_name_raw='MIC1 Bob Device'), 'MIC1 Bob Device')

    assert device.get_chan_name() == ('Vocal 1', 'Jane Smith')


def test_a_repatched_transmitter_stops_showing_the_old_person():
    """The reason the gate exists at all, and it still holds.

    A snapshot that no longer matches the hardware is positive evidence the
    assignment is stale -- the transmitter has been given to someone else, and
    showing the previous person would be worse than showing the device.
    """
    device = chan(dict(ASSIGNED, chan_name_raw='MIC1 Bob Device'), 'MIC1 Someone Else')

    chan_id, chan_name = device.get_chan_name()

    assert chan_name == 'Someone Else'
    assert chan_id == 'MIC1'


def test_a_repatched_transmitter_does_not_destroy_the_assignment():
    """It used to pop both keys and save -- from inside a getter.

    ch_json calls this, and every open board triggers ch_json every five
    seconds, so a transmitter renamed mid-service wrote the operator's
    assignment out of config.json with no record of what it had been. Ignoring
    it for display is enough.
    """
    device = chan(dict(ASSIGNED, chan_name_raw='MIC1 Bob Device'), 'MIC1 Someone Else')

    device.get_chan_name()

    assert device.cfg['extended_name'] == 'Jane Smith'
    assert device.cfg['extended_id'] == 'Vocal 1'
    assert device.cfg['chan_name_raw'] == 'MIC1 Bob Device'


def test_get_chan_name_never_writes_config(monkeypatch):
    """Nothing reached from a render path may persist anything.

    Guarded explicitly because the previous implementation did, and it is the
    kind of thing that gets reintroduced by someone tidying up.
    """
    import config as config_module

    def explode():
        raise AssertionError('get_chan_name must not save configuration')

    monkeypatch.setattr(config_module, 'save_current_config', explode)

    chan(dict(ASSIGNED, chan_name_raw='MIC1 Bob Device'), 'MIC1 Someone Else').get_chan_name()
    chan(ASSIGNED, 'MIC1 Bob Device').get_chan_name()


def test_a_channel_that_has_not_reported_keeps_its_assignment():
    """SLOT n is the placeholder set in __init__, not a re-patch.

    Treating it as one would drop the assignment on every restart, in the
    window before the receiver first answers.
    """
    device = chan(dict(ASSIGNED, chan_name_raw='MIC1 Bob Device'), 'SLOT 1')

    assert device.get_chan_name() == ('Vocal 1', 'Jane Smith')


def test_an_unassigned_slot_still_shows_the_device():
    chan_id, chan_name = chan({'slot': 2, 'channel': 1}, 'MIC2 Spare').get_chan_name()

    assert chan_id == 'MIC2'
    assert chan_name == 'Spare'


def test_an_empty_assignment_does_not_blank_the_display():
    """An empty string is "not set", not "show nothing"."""
    cfg = {'slot': 3, 'channel': 1, 'extended_id': '', 'extended_name': ''}

    chan_id, chan_name = chan(cfg, 'MIC3 Alex').get_chan_name()

    assert chan_id == 'MIC3'
    assert chan_name == 'Alex'


def test_a_person_alone_is_enough():
    """seed_extended_id is off by default, so PCO commonly writes only the name."""
    cfg = {'slot': 4, 'channel': 1, 'extended_name': 'Sam Reed'}

    chan_id, chan_name = chan(cfg, 'MIC4 Bob Device').get_chan_name()

    assert chan_name == 'Sam Reed'
    # The device's own id survives; only the person was assigned.
    assert chan_id == 'MIC4'
