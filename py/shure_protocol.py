"""Everything Wirelessboard knows that is specific to Shure receivers.

Before this module the knowledge was scattered: a port constant in
`networkdevice.py`, the message grammar in its `parse_raw_rx`, the framing
character and the sendall/sendto choice inside `shure.py`'s socket loop, the
metering commands in two places with the model list written out by hand in each,
and the same model list again in `config.py`. Adding a second manufacturer
(#91) meant finding all of that first.

⭐ **The rule this module exists to enforce: nothing outside it should know a
Shure model string, a Shure command, or how a Shure message is punctuated.**

The five things a vendor has to answer, and where they are here:

  transport   `transport()` and `PORT`
  framing     `frame()` -- bytes off the socket to whole messages
  parsing     `parse()` -- a message to a channel's fields
  commands    `get_all()`, `query()`, `meter_start()`, `meter_stop()`
  discovery   still in `py/discover.py`; see #91

`py/vendor.py` is the registry that picks between adapters. Today there is one.
"""

import logging

from device_config import BASE_CONST

logger = logging.getLogger('micboard.device')

NAME = 'shure'

# Every model this adapter speaks for. ⛔ The one list -- `config.py` and the
# registry read it from here rather than repeating it.
TYPES = ('uhfr', 'qlxd', 'ulxd', 'axtd', 'slxd', 'slxdplus', 'p10t')

# Shure's control port, the same across every model above.
PORT = 2202

# UHF-R is the odd one: an older grammar punctuated with `*` rather than `<  >`,
# carried over UDP, and a metering rate expressed in a different unit. It is not
# that UDP implies the grammar -- they simply arrived together on that product --
# so the two are kept as separate facts rather than one inferred from the other.
_UHFR = 'uhfr'

_METER_START_DEFAULT = ('< SET {} METER_RATE {:05d} >', 1000)
_METER_START = {
    # ⛔ Divided by 30, not a typo: UHF-R counts in a coarser unit, so the 0.1s
    # the board asks for becomes 003 rather than 00100.
    _UHFR: ('* METER {} ALL {:03d} *', 1000 / 30),
}


def handles(type_) -> bool:
    return type_ in TYPES


def transport(type_) -> str:
    """'TCP' or 'UDP'."""
    return BASE_CONST[type_]['PROTOCOL']


def device_class(type_) -> str:
    """'WirelessMic' or 'IEM' -- which channel object a model produces."""
    return BASE_CONST[type_]['DEVICE_CLASS']


def frame(type_, data: str):
    """Split a read off the socket into whole messages.

    Shure does not length-prefix, so a read can hold several replies or half of
    one; the closing punctuation is the only boundary there is.
    """
    delimiter = '*' if type_ == _UHFR else '>'
    return [chunk + delimiter for chunk in data.split(delimiter) if chunk]


def send(sock, type_, ip, payload: str) -> None:
    """Write one command, by whichever call this model's transport needs."""
    encoded = bytearray(payload, 'UTF-8')
    if transport(type_) == 'UDP':
        sock.sendto(encoded, (ip, PORT))
    else:
        sock.sendall(encoded)


def get_all(type_, channels):
    """The opening question asked of every channel when a receiver connects."""
    templates = BASE_CONST[type_]['base_const']['getAll']
    return [t.format(channel) for channel in channels for t in templates]


def query(type_, channels):
    """The periodic poll. Per channel, not per command -- the order is on the wire."""
    templates = BASE_CONST[type_]['base_const']['query']
    return [t.format(channel) for channel in channels for t in templates]


def meter_start(type_, channels, interval):
    template, scale = _METER_START.get(type_, _METER_START_DEFAULT)
    return [template.format(channel, int(interval * scale)) for channel in channels]


def meter_stop(type_, channels):
    template = BASE_CONST[type_]['base_const']['meter_stop']
    return [template.format(channel) for channel in channels]


def parse(device, data: str) -> None:
    """Route one message to the channel it is about, or to the receiver.

    `device` is the receiver object: this needs `get_device_by_channel` to find
    the channel and `raw` to record receiver-level replies. Kept as a function
    over the device rather than a method on it so the grammar lives with the
    rest of the vendor's knowledge.

    ⛔ Tolerant on purpose. A quad reports on channels a config may not list,
    and a truncated read is normal rather than exceptional; neither should take
    the socket down.
    """
    data = data.strip('< >').strip('* ')
    data = data.replace('{', '').replace('}', '')
    data = data.rstrip()
    if not data:
        return

    split = data.split()
    try:
        if split[0] in ['REP', 'REPORT', 'SAMPLE'] and split[1] in ['1', '2', '3', '4']:
            channel = device.get_device_by_channel(int(split[1]))
            if channel is None:
                logger.warning(
                    'Received data for unknown channel %s', split[1],
                    extra={'context': {'data': data, 'ip': device.ip}})
            else:
                channel.parse_raw_ch(data)

        elif split[0] in ['REP', 'REPORT']:
            device.raw[split[1]]['value'] = ' '.join(split[2:])
    except Exception:
        logger.warning(
            'Index error while parsing RX payload',
            extra={'context': {'data': data, 'ip': device.ip}})
