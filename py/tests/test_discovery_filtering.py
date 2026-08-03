"""Discovery must only report receivers this build can actually drive.

Reported as "getting back more devices than we actually have". Three separate
routes let a non-device into the list:

  1. any host that accepted a TCP connection on 2202, even in total silence
  2. any multicast sender, even with a DCID meaning nothing
  3. Shure gear that is not a receiver -- 668 of the 942 bundled DCIDs are
     transmitters and other models
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import discover  # noqa: E402


# A real ULX-D reply, and the shapes that are not one.
SHURE_REPLY = '< REP 1 DEVICE_ID {ULXD4} >'
UHFR_REPLY = '* REPORT 1 DEVICE_ID UR4D *'


class TestLooksLikeShureReply:
    def test_accepts_a_framed_reply(self):
        assert discover.looks_like_shure_reply(SHURE_REPLY) is True

    def test_accepts_the_uhfr_star_framing(self):
        assert discover.looks_like_shure_reply(UHFR_REPLY) is True

    def test_rejects_silence(self):
        """The main source of phantom devices: a port that opens and says nothing."""
        for quiet in ['', None]:
            assert discover.looks_like_shure_reply(quiet) is False

    def test_rejects_traffic_that_is_not_shure(self):
        for other in [
            'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n',
            'SSH-2.0-OpenSSH_9.6\r\n',
            '220 smtp.example.com ESMTP\r\n',
            '{"jsonrpc": "2.0", "result": "ok"}',
        ]:
            assert discover.looks_like_shure_reply(other) is False, other

    def test_rejects_a_frame_with_no_reply_verb(self):
        # Our own probe echoed back is not evidence of a device.
        assert discover.looks_like_shure_reply('< GET 1 DEVICE_ID >') is False


class TestIsSupportedReceiver:
    def test_accepts_a_resolved_receiver_type(self):
        assert discover._is_supported_receiver({'type': 'ulxd'}) is True

    def test_rejects_a_device_with_no_resolved_type(self):
        """Transmitters resolve to a model but never to a driveable type."""
        assert discover._is_supported_receiver({'model': 'ADTx', 'dcid': 'abc'}) is False
        assert discover._is_supported_receiver({}) is False


@pytest.fixture
def captured(monkeypatch):
    """Record what discovery would add, without touching the shared list."""
    added = []
    monkeypatch.setattr(discover, 'add_rx_to_dlist',
                        lambda ip, **kw: added.append({'ip': ip, **kw}))
    return added


class TestMulticastAnnouncements:
    def test_a_known_receiver_is_added(self, captured, monkeypatch):
        monkeypatch.setattr(discover, 'dcid_find', lambda payload: 'KNOWN-DCID')
        monkeypatch.setattr(discover, 'dcid_get',
                            lambda dcid: {'model': 'ULX-DQuad', 'model_name': 'ULXD4Q', 'band': 'G50'})
        monkeypatch.setattr(discover, 'dcid_model_lookup', lambda model: ('ulxd', 4))

        discover._handle_multicast_packet(b'announcement', '10.0.0.5')

        assert len(captured) == 1
        assert captured[0]['ip'] == '10.0.0.5'
        assert captured[0]['rx_type'] == 'ulxd'
        assert captured[0]['channels'] == 4

    def test_an_unknown_dcid_is_ignored(self, captured, monkeypatch):
        monkeypatch.setattr(discover, 'dcid_find', lambda payload: 'NOT-IN-THE-MAP')
        monkeypatch.setattr(discover, 'dcid_get', lambda dcid: None)

        discover._handle_multicast_packet(b'announcement', '10.0.0.6')

        assert captured == []

    def test_shure_gear_that_is_not_a_receiver_is_ignored(self, captured, monkeypatch):
        """A bodypack announcing itself is not a receiver to put on the board."""
        monkeypatch.setattr(discover, 'dcid_find', lambda payload: 'TX-DCID')
        monkeypatch.setattr(discover, 'dcid_get',
                            lambda dcid: {'model': 'ADTx', 'model_name': 'AD1 Bodypack', 'band': 'JB'})
        monkeypatch.setattr(discover, 'dcid_model_lookup', lambda model: None)

        discover._handle_multicast_packet(b'announcement', '10.0.0.7')

        assert captured == []

    def test_an_undecodable_packet_is_ignored(self, captured, monkeypatch):
        monkeypatch.setattr(discover, 'dcid_find', lambda payload: None)
        monkeypatch.setattr(discover, 'dcid_get', lambda dcid: None)

        discover._handle_multicast_packet(b'\xff\xfe\x00nonsense', '10.0.0.8')

        assert captured == []


class TestActiveProbe:
    """_probe_ip against a fake socket, so no network is involved."""

    def _fake_socket(self, monkeypatch, response: bytes):
        class FakeConn:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def settimeout(self, _): pass
            def sendall(self, _): pass
            def recv(self, _): return response

        monkeypatch.setattr(discover.socket, 'create_connection',
                            lambda addr, timeout=None: FakeConn())

    def test_a_receiver_is_reported(self, monkeypatch):
        self._fake_socket(monkeypatch, SHURE_REPLY.encode())
        monkeypatch.setattr(discover, '_parse_probe_payload',
                            lambda payload: {'type': 'ulxd', 'channels': 4, 'model': 'ULXD4Q'})

        result = discover._probe_ip('10.0.0.9', 0.5)

        assert result is not None
        assert result['ip'] == '10.0.0.9'
        assert result['type'] == 'ulxd'
        assert result['source'] == 'active'

    def test_a_silent_open_port_is_not_a_device(self, monkeypatch):
        """The reported bug: anything listening on 2202 became a receiver."""
        self._fake_socket(monkeypatch, b'')

        assert discover._probe_ip('10.0.0.10', 0.5) is None

    def test_another_service_on_2202_is_not_a_device(self, monkeypatch):
        self._fake_socket(monkeypatch, b'SSH-2.0-OpenSSH_9.6\r\n')

        assert discover._probe_ip('10.0.0.11', 0.5) is None

    def test_shure_gear_that_is_not_a_receiver_is_not_reported(self, monkeypatch):
        self._fake_socket(monkeypatch, SHURE_REPLY.encode())
        monkeypatch.setattr(discover, '_parse_probe_payload',
                            lambda payload: {'model': 'ADTx', 'dcid': 'TX-DCID'})

        assert discover._probe_ip('10.0.0.12', 0.5) is None

    def test_an_unreachable_host_is_not_a_device(self, monkeypatch):
        def refuse(addr, timeout=None):
            raise ConnectionRefusedError()
        monkeypatch.setattr(discover.socket, 'create_connection', refuse)

        assert discover._probe_ip('10.0.0.13', 0.5) is None
