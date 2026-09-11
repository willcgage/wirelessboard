"""Characterization of the Audio-Technica IP control adapter (#93)."""

import os
import sys

import pytest


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import audio_technica_protocol as protocol  # noqa: E402
import channel  # noqa: E402
import networkdevice  # noqa: E402
import vendor  # noqa: E402


TYPES = (
    'atw-r5220', 'atw-r5220dan',
    'atw-dr3120', 'atw-dr3120dan',
    'atw-r3210n',
)


@pytest.fixture(autouse=True)
def clean_update_lists():
    channel.chart_update_list.clear()
    channel.data_update_list.clear()
    yield
    channel.chart_update_list.clear()
    channel.data_update_list.clear()


def device(type_='atw-r5220', channels=(1,)):
    receiver = networkdevice.ShureNetworkDevice('10.0.0.93', type_)
    for number in channels:
        receiver.add_channel_device({'slot': number, 'channel': number, 'type': type_})
    return receiver


def test_models_are_registered_as_tcp_wireless_receivers():
    for type_ in TYPES:
        assert vendor.adapter_for(type_) is protocol
        assert protocol.transport(type_) == 'TCP'
        assert protocol.device_class(type_) == 'WirelessMic'
    assert protocol.PORT == 17300


def test_commands_follow_the_documented_envelope_and_cr_termination():
    receiver = device(channels=(1, 2))
    assert receiver.get_all() == [
        'gprch O 0000 00 NC 1\r',
        'garlv O 0000 00 NC 1\r',
        'gprch O 0000 00 NC 2\r',
        'garlv O 0000 00 NC 2\r',
    ]
    assert receiver.get_query_strings() == [
        'garlv O 0000 00 NC 1\r',
        'garlv O 0000 00 NC 2\r',
    ]


def test_send_and_framing_use_utf8_and_carriage_return():
    class Socket:
        def __init__(self):
            self.sent = []

        def sendall(self, payload):
            self.sent.append(payload)

    sock = Socket()
    protocol.send(sock, 'atw-r5220', '10.0.0.93', 'gprch O 0000 00 NC 1\r')
    assert sock.sent == [b'gprch O 0000 00 NC 1\r']
    assert protocol.frame('atw-r5220', 'one\rtwo\r') == ['one', 'two']


def test_tcp_fragment_is_preserved_until_the_carriage_return_arrives():
    receiver = device()
    assert receiver.frame_messages('gprch 0000 00 NC 1,"VOC') == []
    assert receiver.frame_messages('AL 1 ",,1,,,0,470125000,0,0,0\r') == [
        'gprch 0000 00 NC 1,"VOCAL 1 ",,1,,,0,470125000,0,0,0'
    ]


def test_name_answer_preserves_quoted_spaces_and_routes_to_target_channel():
    receiver = device(channels=(1, 2))
    receiver.parse_raw_rx('gprch 0000 00 NC 2,"VOCAL 2 ",,1,,,0,470125000,0,0,0')
    assert receiver.channels[0].chan_name_raw == 'SLOT 1'
    assert receiver.channels[1].chan_name_raw == 'VOCAL 2'


def test_level_answer_normalizes_audio_rf_battery_and_frequency():
    receiver = device()
    receiver.parse_raw_rx(
        'garlv 0000 00 NC '
        '1,10,9,8,-80,9,-78,1,0,0,0,,0,0,0,0,,0,1,1,0,0,1,7,0,4,474325000,0,0'
    )
    mic = receiver.channels[0]
    assert mic.audio_level == 62
    assert mic.rf_level == 75
    assert mic.antenna == 'A'
    assert mic.power_lock == 'OFF'
    assert mic.battery == 5
    assert mic.frequency == '474.325000'
    assert len(channel.chart_update_list) == 1
    assert channel.chart_update_list[0]['audio_level'] == 62
    assert channel.chart_update_list[0]['rf_level'] == 75
    assert channel.chart_update_list[0]['slot'] == 1
    assert channel.data_update_list == [mic]


def test_malformed_and_unconfigured_channel_messages_are_ignored():
    receiver = device()
    receiver.parse_raw_rx('garlv broken')
    receiver.parse_raw_rx(
        'garlv 0000 00 NC '
        '2,10,9,8,-80,9,-78,1,0,0,0,,0,0,0,0,,0,1,1,0,0,1,7,0,4,474325000,0,0'
    )
    assert receiver.channels[0].battery == 255
    assert channel.data_update_list == []
