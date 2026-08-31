"""The seam a second manufacturer will arrive through (#91).

The characterization suite proves Shure still behaves. This proves the device
layer actually goes *through* the adapter rather than around it -- which is a
different claim, and the one that decides whether adding Sennheiser (#92) or
Audio-Technica (#93) is a registration or another rewrite.

⭐ The fake adapter below is the point of the file. It speaks a protocol that
looks nothing like Shure's -- different port, pipe-delimited framing, commands
with no angle brackets anywhere -- and the receiver drives it correctly without
`networkdevice.py` knowing anything about it.
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import device_config  # noqa: E402
import networkdevice  # noqa: E402
import shure_protocol  # noqa: E402
import vendor  # noqa: E402


SHURE_TYPES = ['uhfr', 'qlxd', 'ulxd', 'axtd', 'slxd', 'slxdplus', 'p10t']


class FakeAdapter:
    """A manufacturer that shares no punctuation, port or vocabulary with Shure."""

    NAME = 'fake'
    TYPES = ('fakemic',)
    PORT = 9999

    def __init__(self):
        self.sent = []
        self.parsed = []

    def handles(self, type_):
        return type_ in self.TYPES

    def transport(self, _type):
        return 'TCP'

    def device_class(self, _type):
        return 'WirelessMic'

    def frame(self, _type, data):
        return [chunk for chunk in data.split('|') if chunk]

    def send(self, _sock, _type, ip, payload):
        self.sent.append((ip, payload))

    def get_all(self, _type, channels):
        return ['HELLO {}'.format(c) for c in channels]

    def query(self, _type, channels):
        return ['POLL {}'.format(c) for c in channels]

    def meter_start(self, _type, channels, interval):
        return ['METER {} @{}'.format(c, interval) for c in channels]

    def meter_stop(self, _type, channels):
        return ['QUIET {}'.format(c) for c in channels]

    def parse(self, device, message):
        self.parsed.append((device.ip, message))


@pytest.fixture
def fake(monkeypatch):
    adapter = FakeAdapter()
    monkeypatch.setattr(vendor, 'ADAPTERS', (shure_protocol, adapter))
    # ⛔ The remaining leak, and why this line is here rather than being
    # unnecessary: `ChannelDevice.__init__` still reads `BASE_CONST` directly
    # for its field-name map, so a type with no entry there cannot have
    # channels attached. Moving the channel-level semantics behind the adapter
    # is the next step of #91 -- it is where battery-as-bars lives.
    monkeypatch.setitem(device_config.BASE_CONST, 'fakemic', {
        'DEVICE_CLASS': 'WirelessMic',
        'PROTOCOL': 'TCP',
        'ch_const': {'battery': 'BATT', 'name': 'NAME'},
        'base_const': {'getAll': [], 'query': [], 'meter_stop': ''},
    })
    return adapter


def fake_device(channels=(1,)):
    rx = networkdevice.ShureNetworkDevice('10.0.0.9', 'fakemic')
    for number in channels:
        rx.add_channel_device({'slot': number, 'channel': number, 'type': 'fakemic'})
    return rx


# --------------------------------------------------------------------------
# The registry
# --------------------------------------------------------------------------

@pytest.mark.parametrize('type_', SHURE_TYPES)
def test_every_shure_type_resolves_to_the_shure_adapter(type_):
    assert vendor.adapter_for(type_) is shure_protocol


def test_an_unknown_type_resolves_to_nothing():
    assert vendor.adapter_for('sennheiser-ewdx') is None
    assert vendor.adapter_for('') is None
    assert vendor.adapter_for(None) is None


def test_offline_is_not_a_vendor():
    # It is a slot with no receiver behind it; config.py handles it separately.
    assert vendor.adapter_for('offline') is None
    assert 'offline' not in vendor.supported_types()


def test_supported_types_is_where_the_model_list_lives():
    assert sorted(vendor.supported_types()) == sorted(SHURE_TYPES)


def test_every_supported_type_is_offered_in_the_config_ui():
    """⛔ A type the adapter drives but the UI never offers is unreachable.

    SLX-D shipped exactly like that: the adapter, the tests and PCO matching all
    knew about it, while the slot Type dropdown in demo.html was a hand-written
    list that had not been touched. The only way to add one was editing
    config.json by hand.

    The dropdown's `value` is the stored slot type, so it is checkable.
    """
    demo = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        'demo.html')
    with open(demo, 'r', encoding='utf-8') as handle:
        markup = handle.read()

    select = markup.split('class="form-control cfg-type"')[1].split('</select>')[0]
    offered = set(re.findall(r'<option value="([^"]*)"', select))

    missing = set(vendor.supported_types()) - offered
    assert not missing, 'types the board can drive but nobody can select: {}'.format(
        sorted(missing))

    # `offline` is not a vendor type but is a real choice; anything else offered
    # and unsupported would be a dead option that saves a slot nothing can drive.
    unknown = offered - set(vendor.supported_types()) - {'', 'offline'}
    assert not unknown, 'options for types no adapter handles: {}'.format(sorted(unknown))


def test_registering_an_adapter_is_all_it_takes(fake):
    assert vendor.adapter_for('fakemic') is fake
    assert 'fakemic' in vendor.supported_types()
    # ...and it does not disturb the incumbent.
    assert vendor.adapter_for('ulxd') is shure_protocol


# --------------------------------------------------------------------------
# The receiver drives whatever adapter it was given
# --------------------------------------------------------------------------

def test_the_device_takes_its_commands_from_its_adapter(fake):
    rx = fake_device([1, 2])

    assert rx.get_all() == ['HELLO 1', 'HELLO 2']
    assert rx.get_query_strings() == ['POLL 1', 'POLL 2']

    rx.enable_metering(0.25)
    rx.disable_metering()
    assert list(rx.writeQueue.queue) == [
        'METER 1 @0.25', 'METER 2 @0.25', 'QUIET 1', 'QUIET 2',
    ]


def test_no_shure_punctuation_survives_a_foreign_adapter(fake):
    rx = fake_device([1])
    rx.enable_metering(0.1)

    emitted = rx.get_all() + rx.get_query_strings() + list(rx.writeQueue.queue)
    for command in emitted:
        assert '<' not in command and '*' not in command, command


def test_the_port_comes_from_the_adapter(fake):
    assert fake_device().adapter.PORT == 9999
    assert networkdevice.ShureNetworkDevice('10.0.0.5', 'ulxd').adapter.PORT == 2202


def test_parsing_is_delegated_whole(fake):
    rx = fake_device([1])
    rx.parse_raw_rx('anything at all')

    assert fake.parsed == [('10.0.0.9', 'anything at all')]


def test_framing_is_the_adapters_business(fake):
    assert fake.frame('fakemic', 'one|two|') == ['one', 'two']
    # Shure's own framing keeps the delimiter, because its grammar includes it.
    assert shure_protocol.frame('ulxd', '< REP 1 A >< REP 2 B >') == [
        '< REP 1 A >', '< REP 2 B >',
    ]
    # ⚠️ UHF-R loses its *leading* `*`, because splitting on the delimiter and
    # re-appending it only restores the closing one. That is pre-existing
    # behaviour, preserved exactly, and it is harmless: `parse()` strips `'* '`
    # from the front before doing anything with the message. Asserted so the
    # oddity is recorded rather than rediscovered.
    assert shure_protocol.frame('uhfr', '* REP 1 A ** REP 2 B *') == [
        ' REP 1 A *', ' REP 2 B *',
    ]


def test_the_channel_class_comes_from_the_adapter(fake):
    assert len(fake_device([1, 2]).channels) == 2


# --------------------------------------------------------------------------
# What the Shure adapter answers, independent of any device
# --------------------------------------------------------------------------

def test_the_shure_adapter_knows_its_own_models():
    assert shure_protocol.handles('ulxd') is True
    assert shure_protocol.handles('offline') is False
    assert shure_protocol.PORT == 2202


def test_transport_per_model():
    assert shure_protocol.transport('uhfr') == 'UDP'
    for type_ in ['qlxd', 'ulxd', 'axtd', 'p10t']:
        assert shure_protocol.transport(type_) == 'TCP', type_


def test_send_uses_the_call_the_transport_needs():
    class Sock:
        def __init__(self):
            self.all = []
            self.to = []

        def sendall(self, payload):
            self.all.append(payload)

        def sendto(self, payload, addr):
            self.to.append((payload, addr))

    tcp = Sock()
    shure_protocol.send(tcp, 'ulxd', '10.0.0.5', '< GET 1 ALL >')
    assert tcp.all == [bytearray(b'< GET 1 ALL >')] and tcp.to == []

    udp = Sock()
    shure_protocol.send(udp, 'uhfr', '10.0.0.5', '* GET 1 ALL *')
    assert udp.to == [(bytearray(b'* GET 1 ALL *'), ('10.0.0.5', 2202))]
    assert udp.all == []
