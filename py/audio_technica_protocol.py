"""Framing and command helpers for Audio-Technica network receivers.

The ATW network protocol is ASCII, space-delimited and CR-terminated.  This
module deliberately contains no socket or device-state code; it can therefore
be tested from captures before a receiver is connected.
"""

PORT_TCP = 17300
PORT_UDP = 17000


def frame(buffer: str):
    """Return complete CR-terminated messages and the incomplete remainder."""
    parts = buffer.split('\r')
    return [part for part in parts[:-1] if part], parts[-1]


def parse(line: str):
    """Parse one protocol line without interpreting model-specific fields."""
    text = line.rstrip('\r')
    fields = text.split(' ')
    return {
        'raw': text,
        'command': fields[0] if fields else '',
        'fields': fields[1:],
    }


def get_channel(receiver: int, channel: int) -> str:
    """Build the documented channel read command."""
    return f'gprch {receiver:04d} {channel:02d}\r'


def get_levels(receiver: int, channel: int) -> str:
    """Build the documented level read command."""
    return f'garlv {receiver:04d} {channel:02d}\r'

