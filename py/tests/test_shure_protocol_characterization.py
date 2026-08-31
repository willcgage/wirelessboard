"""What Wirelessboard currently does with Shure receivers, pinned before it moves.

⭐ These are **characterization tests**: they assert what the code does today,
not what anyone thinks it should do. They exist because #91 wants to make the
device layer support more than Shure, and its acceptance criterion is "Shure
behaviour unchanged" -- which was unprovable, because `networkdevice.py`,
`shure.py`, `mic.py` and `iem.py` had **no tests at all**. The suite could not
have detected the refactor breaking the thing being refactored.

That matters more here than almost anywhere else in this project: this is the
code that talks to receivers during live services. A regression is not a wrong
pixel, it is a board that stops reporting battery mid-sermon.

⛔ So if one of these fails during the #91 refactor, the default assumption is
that the refactor is wrong -- not the test. Where a change to behaviour is
genuinely intended, change the assertion **in the same commit** and say why.

What is deliberately NOT asserted: anything requiring a socket. Every value
here is reachable by constructing objects and feeding them strings, which is
also why the whole file runs in milliseconds.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import channel  # noqa: E402
import networkdevice  # noqa: E402
from iem import IEM  # noqa: E402
from mic import WirelessMic  # noqa: E402


MIC_TYPES = ['uhfr', 'qlxd', 'ulxd', 'axtd']


@pytest.fixture(autouse=True)
def clean_update_lists():
    """`channel.py` keeps two module-level lists the render loop drains."""
    channel.chart_update_list.clear()
    channel.data_update_list.clear()
    yield
    channel.chart_update_list.clear()
    channel.data_update_list.clear()


def device(type_, channels=(1,)):
    """A receiver with channels attached, and no socket anywhere near it."""
    rx = networkdevice.ShureNetworkDevice('10.0.0.5', type_)
    for number in channels:
        rx.add_channel_device({'slot': number, 'channel': number, 'type': type_})
    return rx


def mic(type_, channel_number=1):
    return device(type_, [channel_number]).channels[0]


# --------------------------------------------------------------------------
# Which class a type produces
# --------------------------------------------------------------------------

@pytest.mark.parametrize('type_', MIC_TYPES)
def test_mic_types_produce_a_wireless_mic(type_):
    assert isinstance(mic(type_), WirelessMic)


def test_p10t_produces_an_iem():
    assert isinstance(mic('p10t'), IEM)


# --------------------------------------------------------------------------
# The command vocabulary -- exact strings, because a receiver parses them
# --------------------------------------------------------------------------

def test_get_all_strings():
    assert device('ulxd').get_all() == ['< GET 1 ALL >']
    assert device('qlxd').get_all() == ['< GET 1 ALL >']
    assert device('axtd').get_all() == ['< GET 1 ALL >']
    assert device('uhfr').get_all() == [
        '* GET 1 CHAN_NAME *',
        '* GET 1 BATT_BARS *',
        '* GET 1 GROUP_CHAN *',
    ]
    assert device('p10t').get_all() == [
        '< GET 1 CHAN_NAME >\r\n',
        '< GET 1 FREQUENCY >\r\n',
    ]


def test_query_strings_are_emitted_for_every_channel_in_order():
    # A quad receiver polls all four; the order is per-channel, not per-command.
    assert device('ulxd', [1, 2]).get_query_strings() == [
        '< GET 1 CHAN_NAME >',
        '< GET 1 BATT_BARS >',
        '< GET 2 CHAN_NAME >',
        '< GET 2 BATT_BARS >',
    ]


def test_metering_start_strings():
    rx = device('ulxd')
    rx.enable_metering(0.1)
    assert list(rx.writeQueue.queue) == ['< SET 1 METER_RATE 00100 >']

    uhfr = device('uhfr')
    uhfr.enable_metering(0.1)
    # ⛔ Not a typo: uhfr divides by 30 before scaling, so 0.1 becomes 003.
    assert list(uhfr.writeQueue.queue) == ['* METER 1 ALL 003 *']


def test_metering_stop_strings():
    for type_, expected in [
        ('ulxd', '< SET 1 METER_RATE 0 >'),
        ('qlxd', '< SET 1 METER_RATE 0 >'),
        ('axtd', '< SET 1 METER_RATE 0 >'),
        ('p10t', '< SET 1 METER_RATE 0 >'),
        ('uhfr', '* METER 1 ALL STOP *'),
    ]:
        rx = device(type_)
        rx.disable_metering()
        assert list(rx.writeQueue.queue) == [expected], type_


# --------------------------------------------------------------------------
# Routing a message off the wire to a channel
# --------------------------------------------------------------------------

def test_a_channel_report_reaches_that_channel():
    rx = device('ulxd', [1, 2])
    rx.parse_raw_rx('< REP 2 CHAN_NAME Jane Smith >')

    assert rx.channels[1].chan_name_raw == 'Jane Smith'
    assert rx.channels[0].chan_name_raw == 'SLOT 1', 'channel 1 should be untouched'


def test_the_framing_characters_are_stripped():
    # Shure wraps in < > (or * for uhfr) and pads names with { }.
    rx = device('ulxd')
    rx.parse_raw_rx('< REP 1 CHAN_NAME {Jane Smith} >')
    assert rx.channels[0].chan_name_raw == 'Jane Smith'

    uhfr = device('uhfr')
    uhfr.parse_raw_rx('* REPORT 1 CHAN_NAME Bob *')
    assert uhfr.channels[0].chan_name_raw == 'Bob'


def test_a_receiver_level_report_is_stored_on_the_receiver():
    rx = device('ulxd')
    rx.parse_raw_rx('< REP DEVICE_ID Main Rack >')
    assert rx.raw['DEVICE_ID']['value'] == 'Main Rack'


def test_a_report_for_an_unknown_channel_is_survivable():
    # A quad's config may list fewer channels than the receiver reports on.
    rx = device('ulxd', [1])
    rx.parse_raw_rx('< REP 4 CHAN_NAME Nobody >')  # must not raise
    assert rx.channels[0].chan_name_raw == 'SLOT 1'


def test_a_malformed_payload_is_survivable():
    rx = device('ulxd')
    rx.parse_raw_rx('< >')
    rx.parse_raw_rx('')
    rx.parse_raw_rx('< REP >')


# --------------------------------------------------------------------------
# Value semantics -- the vendor meanings most at risk in a refactor
# --------------------------------------------------------------------------

@pytest.mark.parametrize('type_,raw,expected', [
    ('ulxd', '40', 80),      # doubled
    ('qlxd', '40', 80),
    ('axtd', '40', 20),      # offset by -20
    ('uhfr', '8', 50),       # ceil(MSB(8) * 100/8) -> MSB(8) == 4
])
def test_audio_level_scaling_is_per_model(type_, raw, expected):
    m = mic(type_)
    m.set_audio_level(raw)
    assert m.audio_level == expected


@pytest.mark.parametrize('type_,raw,expected', [
    ('ulxd', '115', 100),
    ('qlxd', '115', 100),
    ('axtd', '115', 100),
    ('uhfr', '20', 100),     # inverted: 100 * ((100 - 20) / 80)
])
def test_rf_level_scaling_is_per_model(type_, raw, expected):
    m = mic(type_)
    m.set_rf_level(raw)
    assert m.rf_level == expected


def test_battery_unknown_is_255_and_the_last_good_reading_is_kept():
    m = mic('ulxd')
    m.set_battery('4')
    assert m.battery == 4
    assert m.prev_battery == 4

    m.set_battery('U')
    assert m.battery == 255
    assert m.prev_battery == 4, 'the last real reading is what drives PREV_ status'


def test_runtime_is_formatted_as_hours_and_minutes_inside_its_window():
    m = mic('ulxd')
    m.set_runtime('90')
    assert m.runtime == '1:30'

    m.set_runtime('65533')  # outside the window
    assert m.runtime == ''


def test_tx_offset_is_per_model_and_255_means_absent():
    ulxd = mic('ulxd')
    ulxd.set_tx_offset('12')
    assert ulxd.tx_offset == 12

    axtd = mic('axtd')
    axtd.set_tx_offset('12')
    assert axtd.tx_offset == 0, 'axtd offsets are reported 12 higher'

    absent = mic('ulxd')
    absent.set_tx_offset('255')
    assert absent.tx_offset == 255, 'unchanged from its initial value'


def test_power_lock_vocabulary():
    m = mic('ulxd')
    for value in ['OFF', 'UNKN', 'UNKNOWN', 'NONE']:
        m.set_power_lock(value)
        assert m.power_lock == 'OFF', value
    for value in ['ON', 'ALL', 'POWER']:
        m.set_power_lock(value)
        assert m.power_lock == 'ON', value


def test_a_loud_signal_raises_the_peak_flag():
    m = mic('ulxd')
    m.set_audio_level('40')  # doubles to 80, the ulxd peak threshold
    assert m in channel.data_update_list

    quiet = mic('ulxd')
    quiet.set_audio_level('10')
    assert quiet not in channel.data_update_list


def test_the_top_bit_of_the_audio_bitmap_is_the_peak_flag():
    m = mic('axtd')
    m.process_audio_bitmap('128')
    assert m in channel.data_update_list

    m2 = mic('axtd')
    m2.process_audio_bitmap('127')
    assert m2 not in channel.data_update_list


# --------------------------------------------------------------------------
# SAMPLE field positions -- pure positional protocol knowledge
# --------------------------------------------------------------------------

def test_slxd_sample_positions_differ_from_ulxd():
    """⛔ The trap in adding SLX-D.

    Its SAMPLE is `< SAMPLE ch ALL audPeak audRms rfRssi >`, so slots 3/4/5 mean
    something entirely different from ULX-D's antenna/rf/audio. Parsing it with
    the ULX-D branch would put an audio level in the antenna field and RF where
    audio belongs -- wrong in a way that still renders.

    Documented values: both audio and RSSI are reported 000-120, real value is
    the reported number minus 120 (dBFS and dBm respectively).
    """
    for type_ in ('slxd', 'slxdplus'):
        m = mic(type_)
        m.parse_raw_ch('SAMPLE 1 ALL 114 060 120')

        assert m.audio_level == 50, type_       # 060 of 120 full scale
        assert m.rf_level == 100, type_         # 120 of 120
        assert m.antenna == 'XX', 'SLX-D reports no antenna; it must stay unset'


def test_slxd_battery_and_runtime_use_the_shared_semantics():
    # TX_BATT_BARS is 000-005 with 255 unknown, and TX_BATT_MINS is the same
    # 0-65532 window ULX-D uses -- so these need no per-model handling at all.
    m = mic('slxd')
    m.parse_raw_ch('REP 1 TX_BATT_BARS 004')
    assert m.battery == 4

    m.parse_raw_ch('REP 1 TX_BATT_MINS 00125')
    assert m.runtime == '2:05'

    m.parse_raw_ch('REP 1 TX_BATT_MINS 65535')
    assert m.runtime == '', 'unknown/calculating must not render as a duration'


def test_slxd_is_a_mic_on_the_shure_adapter():
    import shure_protocol
    import vendor

    for type_ in ('slxd', 'slxdplus'):
        assert vendor.adapter_for(type_) is shure_protocol, type_
        assert isinstance(mic(type_), WirelessMic), type_
        assert device(type_).get_all() == ['< GET 1 ALL >'], type_


def test_slxd_metering_uses_the_five_digit_form():
    rx = device('slxd')
    rx.enable_metering(0.1)
    rx.disable_metering()
    assert list(rx.writeQueue.queue) == [
        '< SET 1 METER_RATE 00100 >',
        '< SET 1 METER_RATE 00000 >',
    ]


def test_sample_field_positions_per_model():
    # ⛔ These offsets are the protocol. Any adapter must keep reading the same
    # field from the same place, so they are spelled out rather than derived.
    ulxd = mic('ulxd')
    ulxd.parse_raw_ch('SAMPLE 1 ALL A 115 40')
    assert (ulxd.antenna, ulxd.rf_level, ulxd.audio_level) == ('A', 100, 80)

    uhfr = mic('uhfr')
    uhfr.parse_raw_ch('SAMPLE 1 ALL AX 20 X 4 8')
    assert (uhfr.antenna, uhfr.rf_level, uhfr.battery) == ('AX', 100, 4)

    axtd = mic('axtd')
    axtd.parse_raw_ch('SAMPLE 1 ALL 5 0 X 40 AB X 115')
    assert (axtd.quality, axtd.audio_level, axtd.antenna, axtd.rf_level) == (5, 20, 'AB', 100)


def test_a_sample_queues_a_chart_point():
    m = mic('ulxd')
    m.parse_raw_ch('SAMPLE 1 ALL A 115 40')
    assert len(channel.chart_update_list) == 1
    assert channel.chart_update_list[0]['slot'] == 1


def test_a_report_queues_a_data_update():
    m = mic('ulxd')
    m.parse_raw_ch('REP 1 BATT_BARS 4')
    assert m in channel.data_update_list
    assert m.battery == 4


# --------------------------------------------------------------------------
# The record everything above the device layer consumes
# --------------------------------------------------------------------------

def test_channel_json_keys():
    """⭐ This key set is the contract #91 has to preserve.

    The board, the card, PCO matching and the backgrounds all read this and
    none of them know what produced it. A vendor adapter is free to fill these
    differently; it is not free to stop filling one.
    """
    assert set(mic('ulxd').ch_json()) == {
        'id', 'name', 'channel', 'antenna', 'audio_level', 'rf_level',
        'frequency', 'battery', 'tx_offset', 'quality', 'status', 'slot',
        'raw', 'type', 'name_raw', 'power_lock', 'runtime',
    }


def test_receiver_json_shape():
    rx = device('ulxd', [1, 2])
    payload = rx.net_json()

    assert set(payload) == {'ip', 'type', 'status', 'raw', 'tx'}
    assert payload['ip'] == '10.0.0.5'
    assert payload['type'] == 'ulxd'
    assert len(payload['tx']) == 2


def test_a_disconnected_receiver_overrides_every_channel_status():
    rx = device('ulxd', [1, 2])
    rx.set_rx_com_status('DISCONNECTED')

    assert [ch['status'] for ch in rx.net_json()['tx']] == ['RX_COM_ERROR'] * 2


def test_battery_maps_to_status():
    # The colour of a card comes from here.
    for battery, expected in [(5, 'GOOD'), (4, 'GOOD'), (3, 'REPLACE'), (2, 'CRITICAL'),
                              (0, 'CRITICAL')]:
        m = mic('ulxd')
        m.rx.set_rx_com_status('CONNECTED')
        m.set_battery(str(battery))
        assert m.tx_state() == expected, battery


def test_an_unknown_battery_falls_back_to_the_previous_reading():
    m = mic('ulxd')
    m.rx.set_rx_com_status('CONNECTED')
    m.set_battery('5')
    m.set_battery('U')
    assert m.tx_state() == 'PREV_GOOD'


def test_the_iem_reports_two_audio_channels():
    iem = mic('p10t')
    payload = iem.ch_json()
    assert 'audio_level_l' in payload and 'audio_level_r' in payload
