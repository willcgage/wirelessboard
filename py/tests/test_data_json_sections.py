"""/data.json survives one broken section, and names it (#183).

The venue board logged ``500 GET /data.json`` twice with "Uncaught exception"
and nothing else. The whole payload was one expression, so any of its eleven
calls raising took the endpoint out with no indication of which — and the
traceback sat behind a collapsed block in the log viewer.

⛔ These tests do not fix that fault, because it was never diagnosed. They fix
what made it undiagnosable, and they pin the behaviour that matters: a board
that loses one section still gets the others.
"""
import json

import pytest

import tornado_server as ts


def _receivers(payload):
    """The real receivers, without the offline placeholder.

    ⚠️ `offline_json()` contributes an entry of its own to `receivers`, so a
    test counting the list directly counts one too many — which is what the
    first version of these did.
    """
    return [r for r in payload['receivers'] if r.get('type') != 'offline']


@pytest.fixture(autouse=True)
def _clear_failures():
    del ts._DATA_JSON_FAILURES[:]
    yield
    del ts._DATA_JSON_FAILURES[:]


def _raises(message):
    def boom(*_args, **_kwargs):
        raise RuntimeError(message)
    return boom


class TestOneSectionFailing:
    def test_a_failing_section_does_not_take_the_payload_with_it(self, monkeypatch):
        """The whole point: a board losing its discovery list keeps its receivers."""
        monkeypatch.setattr(ts.discover, 'time_filterd_discovered_list',
                            _raises('discovery exploded'))

        payload = json.loads(ts.wirelessboard_json([]))

        assert payload['discovered'] == [], 'the failed section falls back, empty'
        assert 'receivers' in payload, 'and everything else is still there'
        assert 'config' in payload

    def test_the_log_names_the_section_rather_than_the_endpoint(self, monkeypatch, caplog):
        monkeypatch.setattr(ts.discover, 'time_filterd_discovered_list',
                            _raises('discovery exploded'))

        with caplog.at_level('ERROR'):
            ts.wirelessboard_json([])

        messages = ' '.join(r.getMessage() for r in caplog.records)
        assert 'discovery list' in messages, 'says which of the eleven calls it was'
        assert 'discovery exploded' in caplog.text, 'and carries the traceback'

    def test_what_has_failed_is_remembered(self, monkeypatch):
        """So a report can say more than "it broke once"."""
        monkeypatch.setattr(ts.discover, 'time_filterd_discovered_list',
                            _raises('discovery exploded'))
        ts.wirelessboard_json([])
        assert 'discovery list' in ts._DATA_JSON_FAILURES

    def test_the_background_list_falls_back_to_empty_not_missing(self, monkeypatch):
        """⚠️ The shape has to survive too.

        The board reads `media['image']` and friends straight out of this, so a
        fallback of `None` would move the failure into the browser instead of
        containing it here.
        """
        monkeypatch.setattr(ts, 'background_file_lists', _raises('no folder'))
        payload = json.loads(ts.wirelessboard_json([]))
        for key in ('gif', 'image', 'video', 'jpg', 'mp4'):
            assert key in payload, '%s must still be present' % key


class TestOneReceiverFailing:
    def test_one_bad_receiver_does_not_hide_the_others(self):
        """⛔ The failure this board cannot afford is a channel silently absent.

        A receiver that cannot describe itself is skipped and named, rather than
        taking every other receiver off the board with it.
        """
        class Good:
            ip = '192.168.1.10'

            def net_json(self):
                return {'ip': self.ip, 'channels': []}

        class Bad:
            ip = '192.168.1.11'

            def net_json(self):
                raise RuntimeError('half torn down')

        payload = json.loads(ts.wirelessboard_json([Good(), Bad(), Good()]))

        assert len(_receivers(payload)) == 2, 'the two good ones survive'
        assert any('192.168.1.11' in name for name in ts._DATA_JSON_FAILURES), \
            'and the bad one is named by its address'


class TestTheListBeingRebuiltUnderneath:
    def test_the_device_list_is_copied_before_iterating(self):
        """⚠️ `_reconfig_locked` does `del shure.NetworkDevices[:]` on a worker
        thread and then sleeps two seconds. Iterating the live list means a
        clear part-way through ends the loop early and serves a board **fewer
        receivers than it has**, with no error anywhere — the quietest possible
        version of the one failure that matters.
        """
        class Device:
            ip = '192.168.1.10'

            def __init__(self, devices):
                self._devices = devices

            def net_json(self):
                # Empty the list mid-iteration, exactly as a save does.
                del self._devices[:]
                return {'ip': self.ip, 'channels': []}

        devices = []
        devices.extend([Device(devices), Device(devices), Device(devices)])

        payload = json.loads(ts.wirelessboard_json(devices))

        assert len(_receivers(payload)) == 3, \
            'all three are described even though the list emptied during the first'
