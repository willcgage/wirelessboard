"""Audio-Technica network receiver protocol adapter.

Implements the documented TCP control protocol used by the ATW-R5220,
ATW-DR3120 and network-enabled ATW-R3210N.  The devices use UTF-8 text,
space-delimited envelopes, comma-delimited payloads and CR termination.
"""

import csv
import logging

from channel import chart_update_list, data_update_list


logger = logging.getLogger('micboard.device')

NAME = 'audio-technica'
TYPES = (
    'atw-r5220', 'atw-r5220dan',
    'atw-dr3120', 'atw-dr3120dan',
    'atw-r3210n',
)
PORT = 17300


def handles(type_):
    return type_ in TYPES


def transport(_type):
    return 'TCP'


def device_class(_type):
    return 'WirelessMic'


def frame(_type, data):
    """Return complete CR-terminated messages from one socket read."""
    return [message for message in data.split('\r') if message.strip()]


def frame_buffered(_type, data, remainder):
    """Preserve a partial TCP message until its terminating CR arrives."""
    chunks = (remainder + data).split('\r')
    remainder = chunks.pop()
    return [message for message in chunks if message.strip()], remainder


def send(sock, _type, _ip, payload):
    sock.sendall(payload.encode('UTF-8'))


def _command(command, channel):
    return '{} O 0000 00 NC {}\r'.format(command, channel)


def get_all(_type, channels):
    return [
        command
        for channel in channels
        for command in (_command('gprch', channel), _command('garlv', channel))
    ]


def query(_type, channels):
    return [_command('garlv', channel) for channel in channels]


def meter_start(_type, _channels, _interval):
    # Level notifications are multicast UDP.  The first implementation polls
    # garlv over the already-managed TCP connection instead.
    return []


def meter_stop(_type, _channels):
    return []


def _payload(message):
    message = message.strip()
    if message.startswith('MD '):
        message = message[3:]
    parts = message.split(' ', 4)
    if len(parts) != 5:
        return None, None
    try:
        fields = next(csv.reader([parts[4]]))
    except (csv.Error, StopIteration):
        return None, None
    return parts[0].lower(), fields


def _integer(fields, index, minimum=None, maximum=None):
    try:
        value = int(fields[index])
    except (IndexError, TypeError, ValueError):
        return None
    if minimum is not None and value < minimum:
        return None
    if maximum is not None and value > maximum:
        return None
    return value


def _channel(device, fields):
    number = _integer(fields, 0, 1, 2)
    if number is None:
        return None
    return device.get_device_by_channel(number)


def _parse_name(channel, fields):
    if len(fields) < 2:
        return
    name = fields[1].strip()
    if name:
        channel.set_chan_name_raw(name)
        channel.raw['audio_technica_name'] = name
        if channel not in data_update_list:
            data_update_list.append(channel)


def _parse_levels(channel, fields):
    if len(fields) < 29:
        return

    tx_audio = _integer(fields, 1, 0, 16)
    rx_audio = _integer(fields, 2, 0, 16)
    audio = tx_audio if tx_audio is not None else rx_audio
    antenna_a = _integer(fields, 3, 0, 12)
    antenna_b = _integer(fields, 5, 0, 12)
    rf_values = [value for value in (antenna_a, antenna_b) if value is not None]
    selected_antenna = _integer(fields, 7, 0, 2)
    tx_lock = _integer(fields, 20, 0, 1)
    battery_bucket = _integer(fields, 25, 0, 4)
    frequency = fields[26].strip()

    if audio is not None:
        channel.audio_level = round(audio * 100 / 16)
    if rf_values:
        channel.rf_level = round(max(rf_values) * 100 / 12)
    if selected_antenna is not None:
        channel.set_antenna({0: 'XX', 1: 'A', 2: 'B'}[selected_antenna])
    if tx_lock is not None:
        channel.set_power_lock('ON' if tx_lock else 'OFF')
    if battery_bucket is not None:
        # Wirelessboard's existing five-step battery display is 1..5.  The
        # receiver reports five percentage buckets as 0..4.
        channel.set_battery(battery_bucket + 1)
    if len(frequency) == 9 and frequency.isdigit():
        channel.set_frequency(frequency)

    channel.raw['audio_technica_levels'] = fields
    chart_update_list.append(channel.chart_json())
    if channel not in data_update_list:
        data_update_list.append(channel)


def parse(device, message):
    command, fields = _payload(message)
    if command is None:
        return
    channel = _channel(device, fields)
    if channel is None:
        logger.warning(
            'Received Audio-Technica data for an unknown channel',
            extra={'context': {'data': message, 'ip': device.ip}},
        )
        return

    if command in ('gprch', 'nprch'):
        _parse_name(channel, fields)
    elif command in ('garlv', 'narlv', 'naulv'):
        _parse_levels(channel, fields)
