"""Saving configuration must not be able to destroy config.json.

Reconstructed from a site failure: three POST /api/config arrived together, all
three returned 500 with ``KeyError: 'slots'`` out of read_json_config, and the
operator's config.json was left empty. Every start after that raised the same
KeyError out of init_config -- which runs before the web thread starts -- so the
server never came up and there was no interface left to repair it from.

Three separate defects made that one outcome, and each is pinned here:
  * reconfig mutated a module global with no lock while the handler ran it on a
    thread pool, so two saves could interleave;
  * write_json_config truncated the real file before writing it;
  * read_json_config indexed ['slots'] and so refused to load a config without
    the key, rather than reporting an empty board.
"""

import json
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    """Point config at a throwaway file and start from a valid tree."""
    path = tmp_path / 'config.json'
    tree = {
        'slots': [{'slot': 1, 'type': 'offline', 'ip': '10.0.0.1'}],
        'groups': [],
        'port': 8058,
    }
    path.write_text(json.dumps(tree))

    monkeypatch.setattr(config, 'config_file', lambda: str(path))
    monkeypatch.setattr(config, 'config_tree', dict(tree), raising=False)
    return path


def test_a_config_without_slots_still_loads(tmp_path, monkeypatch):
    """The exact file the race produced: an empty object.

    This used to raise KeyError out of read_json_config, and because
    init_config() runs before the web thread is started, that ended the process
    rather than the board.
    """
    path = tmp_path / 'config.json'
    path.write_text('{}')
    monkeypatch.setattr(config, 'config_file', lambda: str(path))
    monkeypatch.setattr(config, 'get_gif_dir', lambda: str(tmp_path))
    monkeypatch.setattr(config, 'get_version_number', lambda: '1.6.1')

    config.read_json_config(str(path))

    assert config.config_tree.get('slots', []) == []


def test_a_config_without_slots_is_not_rewritten(tmp_path, monkeypatch):
    """Loading a damaged file must leave it damaged, not paper over it.

    Silently writing a repaired config back would destroy the evidence of what
    went wrong and, on a file that was only temporarily unreadable, would
    replace a recoverable config with an empty one.

    Byte-for-byte on purpose. Load fills the tree with defaults from four
    ensure_* helpers, so *any* write-back here persists invented settings; two
    separate paths did it -- the pco migration marker and uuid_init -- and each
    looked individually harmless.
    """
    path = tmp_path / 'config.json'
    path.write_text('{}')
    monkeypatch.setattr(config, 'config_file', lambda: str(path))
    monkeypatch.setattr(config, 'get_gif_dir', lambda: str(tmp_path))
    monkeypatch.setattr(config, 'get_version_number', lambda: '1.6.1')

    config.read_json_config(str(path))
    config.uuid_init()

    assert path.read_text() == '{}'


def test_an_explicit_save_after_a_degraded_load_does_write(config_file, monkeypatch):
    """Holding writes back must not leave the operator unable to repair it.

    The interface is the way out of a damaged config, so the save it sends is
    the one write that has to go through -- and it has to clear the degraded
    state, or the board silently stops persisting anything from then on.
    """
    monkeypatch.setattr(config, 'config_load_degraded', True, raising=False)
    monkeypatch.setattr(config, 'ensure_discovery_defaults', lambda: {})
    monkeypatch.setattr(config, 'config_mix', lambda slots: slots)
    monkeypatch.setattr(config, 'time', type('T', (), {'sleep': staticmethod(lambda n: None)}))
    monkeypatch.setattr(config, 'config', lambda: None)

    config.reconfig({'slots': [{'slot': 7, 'type': 'offline', 'ip': '10.0.0.7'}]})

    written = json.loads(config_file.read_text())
    assert written['slots'][0]['slot'] == 7
    assert config.config_load_degraded is False


def test_a_failed_write_leaves_the_previous_config_intact(config_file, monkeypatch):
    """The old file must survive a write that cannot complete.

    open(..., 'w') emptied config.json before anything was written to it, so
    failing part-way left an empty or half-written file behind -- the same
    unstartable state the race produced.
    """
    original = config_file.read_text()

    class Unserialisable:
        pass

    with pytest.raises(TypeError):
        config.write_json_config({'slots': [], 'bad': Unserialisable()})

    assert config_file.read_text() == original


def test_a_completed_write_leaves_no_temporary_file(config_file):
    config.write_json_config({'slots': [], 'port': 8058})

    siblings = os.listdir(os.path.dirname(str(config_file)))
    assert siblings == ['config.json']


def test_concurrent_saves_cannot_interleave(monkeypatch):
    """Two saves must not overlap inside reconfig.

    Not a test of the outcome of one interleaving, but of the property that
    made every such interleaving possible: reconfig reads and clears a module
    global, and the handler runs it on a thread pool.
    """
    overlaps = []
    inside = threading.Event()

    def slow_body(payload):
        if inside.is_set():
            overlaps.append(payload)
        inside.set()
        threading.Event().wait(0.05)
        inside.clear()

    monkeypatch.setattr(config, '_reconfig_locked', slow_body)

    threads = [
        threading.Thread(target=config.reconfig, args=({'slots': []},))
        for _ in range(3)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert overlaps == []


def test_a_save_that_fails_to_reload_keeps_the_running_config(config_file, monkeypatch):
    """A failed rebuild must not leave the process holding a cleared tree.

    reconfig clears config_tree before calling config() to reload it. When that
    reload raised, the server carried on serving the empty tree -- no slots, no
    port, no pco block -- until someone restarted it.
    """
    monkeypatch.setattr(config, 'ensure_discovery_defaults', lambda: {})
    monkeypatch.setattr(config, 'config_mix', lambda slots: slots)
    monkeypatch.setattr(config, 'time', type('T', (), {'sleep': staticmethod(lambda n: None)}))

    def exploding_config():
        raise KeyError('slots')

    monkeypatch.setattr(config, 'config', exploding_config)

    with pytest.raises(KeyError):
        config.reconfig({'slots': [{'slot': 1, 'type': 'offline', 'ip': '10.0.0.1'}]})

    assert config.config_tree.get('slots')
    assert config.config_tree.get('port') == 8058
