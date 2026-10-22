"""How long a switched-off transmitter keeps its last known state.

⛔⛔ Reported from the venue, looking at the wall:

    "the status and other information stays on the board even after a mic is
     switched off. HH-7 for example right now seems stuck and is reporting a
     blue status."

HH-7 was not stuck. Read off the live board, every idle channel was in the
same physical state — `antenna: XX`, `battery: 255` — but only two of them
were blue:

    HH-1..6, BP-10..12   TX_COM_ERROR    (off for longer than the hold)
    HH-7, HH-8           PREV_GOOD       (off for less than the hold)
    BP-9                 GOOD            (actually on, battery 5)

The hold itself is deliberate: somebody who switches off between segments
should not have their name and status vanish. It was thirty minutes.
"""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mic  # noqa: E402


class FakeRx:
    type = 'qlxd'
    rx_com_status = 'CONNECTED'


def channel(battery, prev_battery, age_seconds):
    """A channel whose last real battery reading was `age_seconds` ago."""
    ch = mic.WirelessMic.__new__(mic.WirelessMic)
    ch.rx = FakeRx()
    ch.battery = battery
    ch.prev_battery = prev_battery
    ch.timestamp = time.time() - age_seconds
    ch.peakstamp = 0
    return ch


def test_the_hold_is_two_minutes():
    # ⭐ The maintainer's number. Long enough to cover a segment break, short
    # enough that a board left alone tells the truth about what is on.
    assert mic.BATTERY_TIMEOUT == 120


def test_a_mic_just_switched_off_keeps_its_last_state():
    # ⚠️ The half worth keeping. A pack switched off between segments holds
    # its name and status rather than blanking mid-service.
    assert channel(255, 5, age_seconds=10).tx_state() == 'PREV_GOOD'
    assert channel(255, 3, age_seconds=10).tx_state() == 'PREV_REPLACE'
    assert channel(255, 1, age_seconds=10).tx_state() == 'PREV_CRITICAL'


def test_it_lets_go_once_the_hold_expires():
    # ⛔ The reported fault. At thirty minutes this still said PREV_GOOD.
    assert channel(255, 5, age_seconds=130).tx_state() == 'TX_COM_ERROR'


def test_the_old_thirty_minute_hold_would_still_be_holding():
    # ⛔⛔ The regression this exists for, stated as the venue saw it: a mic
    # switched off five minutes ago must not still be reporting good battery.
    five_minutes = 5 * 60
    assert five_minutes > mic.BATTERY_TIMEOUT, 'the hold must be shorter than this'
    assert channel(255, 5, age_seconds=five_minutes).tx_state() == 'TX_COM_ERROR'


@pytest.mark.parametrize('age', [0, 60, 119])
def test_inside_the_window_it_holds(age):
    assert channel(255, 5, age_seconds=age).tx_state() == 'PREV_GOOD'


@pytest.mark.parametrize('age', [121, 300, 3600])
def test_outside_the_window_it_does_not(age):
    assert channel(255, 5, age_seconds=age).tx_state() == 'TX_COM_ERROR'


def test_a_transmitter_that_is_actually_on_is_unaffected():
    # ⚠️ The hold is only about the 255 branches. A live battery reading is
    # reported whatever the clock says, because `set_battery` keeps it fresh.
    assert channel(5, 5, age_seconds=10).tx_state() == 'GOOD'
    assert channel(3, 3, age_seconds=10).tx_state() == 'REPLACE'
    assert channel(1, 1, age_seconds=10).tx_state() == 'CRITICAL'
