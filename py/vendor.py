"""Which adapter speaks for a device type.

The seam #91 exists to create. Core code asks this module what to do with a
type; it does not know which manufacturers exist, and adding one should be a
registration here plus a new adapter module -- not an edit to `networkdevice.py`
or `config.py`.

Today there is exactly one adapter, which is the honest state of things: the
seam is proven by the Shure adapter going through it, not by pretending a second
manufacturer is supported. Sennheiser is #92 and Audio-Technica is #93, and
both are blocked on reading a protocol specification.

An adapter is a plain module exposing:

    NAME, TYPES, PORT
    handles(type) -> bool
    transport(type) -> 'TCP' | 'UDP'
    device_class(type) -> 'WirelessMic' | 'IEM'
    frame(type, data) -> [message]
    send(sock, type, ip, payload)
    get_all(type, channels) -> [command]
    query(type, channels) -> [command]
    meter_start(type, channels, interval) -> [command]
    meter_stop(type, channels) -> [command]
    parse(device, message)

A module rather than a class because there is no per-instance state: an adapter
is a body of knowledge about a protocol, and every function already takes the
type it is being asked about.
"""

import shure_protocol

ADAPTERS = (shure_protocol,)


def adapter_for(type_):
    """The adapter that speaks for a type, or None if nothing does."""
    for adapter in ADAPTERS:
        if adapter.handles(type_):
            return adapter
    return None


def supported_types():
    """Every device type any registered adapter handles.

    ⛔ Does not include `offline`, which is not a receiver and has no adapter --
    `config.py` handles it separately, as it always has.
    """
    types = []
    for adapter in ADAPTERS:
        types.extend(adapter.TYPES)
    return tuple(types)
