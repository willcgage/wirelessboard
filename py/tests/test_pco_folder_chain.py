"""Where a service type sits in the Services folder tree (#120 profiles).

Churches organise Services into folders -- "Sunday Morning", "Youth",
"Special" -- and folders nest. A profile bound to a folder covers every service
type filed under it, which is one rule instead of one per service type, and it
keeps covering service types created later.

⚠️ The walk is one HTTP request per level, on the path an operator is waiting
on. Everything here is about not paying for it twice, and about never paying
for it forever.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pco  # noqa: E402


HEADERS = {'Authorization': 'Basic x'}


@pytest.fixture(autouse=True)
def clean_cache():
    pco.forget_folder_chains()
    yield
    pco.forget_folder_chains()


def tree(**parents):
    """A fake Services tree. `parents` maps a url fragment to its parent folder id."""
    calls = []

    def get(url, _headers, params=None):
        calls.append(url)
        key = url.rsplit('/', 2)
        ident = f'{key[-2]}/{key[-1]}'
        parent = parents.get(ident)
        if parent is None:
            return {'data': {'relationships': {}}}
        return {'data': {'relationships': {
            'parent': {'data': {'type': 'Folder', 'id': parent}},
        }}}

    get.calls = calls
    return get


class TestWalk:
    def test_a_service_type_at_the_top_level_has_no_folders(self, monkeypatch):
        # The common case for a church that never made folders -- and the one
        # that must stay cheap.
        monkeypatch.setattr(pco, '_http_get', tree())

        assert pco.folder_chain('12', HEADERS) == ()

    def test_one_folder_deep(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', tree(**{'service_types/12': '100'}))

        assert pco.folder_chain('12', HEADERS) == ('100',)

    def test_nested_folders_come_back_nearest_first(self, monkeypatch):
        # ⭐ Order is the contract: `select_profile` stops at the first match,
        # so nearest-first is what makes "Youth inside Weekend" beat "Weekend".
        monkeypatch.setattr(pco, '_http_get', tree(**{
            'service_types/12': '200',
            'folders/200': '100',
        }))

        assert pco.folder_chain('12', HEADERS) == ('200', '100')

    def test_a_missing_service_type_is_not_a_crash(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: None)

        assert pco.folder_chain('12', HEADERS) == ()

    def test_no_service_type_asks_nothing(self, monkeypatch):
        def explode(*_a, **_k):
            raise AssertionError('should not have called Planning Center')

        monkeypatch.setattr(pco, '_http_get', explode)

        assert pco.folder_chain(None, HEADERS) == ()
        assert pco.folder_chain('', HEADERS) == ()
        assert pco.folder_chain('   ', HEADERS) == ()


class TestWhatCountsAsAParent:
    def test_a_parent_that_is_not_a_folder_is_ignored(self, monkeypatch):
        # ⛔ A service type's parent is a Folder today, but nothing promises it
        # stays the only kind. Treating some other resource as a folder would
        # match profiles to the wrong plans, silently.
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: {'data': {'relationships': {
            'parent': {'data': {'type': 'Campus', 'id': '5'}},
        }}})

        assert pco.folder_chain('12', HEADERS) == ()

    def test_the_type_check_is_case_insensitive(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', lambda url, *a, **k: (
            {'data': {'relationships': {'parent': {'data': {'type': 'folder', 'id': '7'}}}}}
            if 'service_types' in url else {'data': {'relationships': {}}}))

        assert pco.folder_chain('12', HEADERS) == ('7',)

    def test_an_empty_relationship_block_is_the_top_level(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', lambda *a, **k: {'data': {'relationships': {
            'parent': {'data': None},
        }}})

        assert pco.folder_chain('12', HEADERS) == ()


class TestCost:
    def test_the_answer_is_cached(self, monkeypatch):
        get = tree(**{'service_types/12': '100'})
        monkeypatch.setattr(pco, '_http_get', get)

        pco.folder_chain('12', HEADERS)
        pco.folder_chain('12', HEADERS)
        pco.folder_chain('12', HEADERS)

        # One for the service type, one for the folder, then nothing.
        assert len(get.calls) == 2

    def test_the_cache_expires(self, monkeypatch):
        # ⚠️ The clock has to be fake from the first call, or the entry is
        # stamped with the real monotonic clock and no plausible fake "later"
        # is actually later than it.
        now = [1000.0]
        monkeypatch.setattr(pco.time, 'monotonic', lambda: now[0])
        get = tree(**{'service_types/12': '100'})
        monkeypatch.setattr(pco, '_http_get', get)

        pco.folder_chain('12', HEADERS)
        before = len(get.calls)

        now[0] += pco._FOLDER_CHAIN_TTL_SECONDS + 1
        pco.folder_chain('12', HEADERS)

        assert len(get.calls) > before

    def test_the_cache_holds_until_it_expires(self, monkeypatch):
        now = [1000.0]
        monkeypatch.setattr(pco.time, 'monotonic', lambda: now[0])
        get = tree(**{'service_types/12': '100'})
        monkeypatch.setattr(pco, '_http_get', get)

        pco.folder_chain('12', HEADERS)
        now[0] += pco._FOLDER_CHAIN_TTL_SECONDS - 1
        pco.folder_chain('12', HEADERS)

        assert len(get.calls) == 2

    def test_different_service_types_are_cached_apart(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', tree(**{
            'service_types/12': '100',
            'service_types/34': '200',
        }))

        assert pco.folder_chain('12', HEADERS) == ('100',)
        assert pco.folder_chain('34', HEADERS) == ('200',)

    def test_forgetting_the_cache_makes_it_ask_again(self, monkeypatch):
        get = tree(**{'service_types/12': '100'})
        monkeypatch.setattr(pco, '_http_get', get)
        pco.folder_chain('12', HEADERS)
        pco.forget_folder_chains()
        pco.folder_chain('12', HEADERS)

        assert len(get.calls) == 4


class TestItCannotRunAway:
    def test_a_cycle_terminates(self, monkeypatch):
        # ⛔ Not a tuning knob -- a guard. Tornado is single-threaded here, so a
        # loop of HTTP calls is the whole board gone, not one slow request.
        monkeypatch.setattr(pco, '_http_get', tree(**{
            'service_types/12': '100',
            'folders/100': '200',
            'folders/200': '100',
        }))

        chain = pco.folder_chain('12', HEADERS)

        assert chain == ('100', '200')

    def test_a_folder_that_is_its_own_parent_terminates(self, monkeypatch):
        monkeypatch.setattr(pco, '_http_get', tree(**{
            'service_types/12': '100',
            'folders/100': '100',
        }))

        assert pco.folder_chain('12', HEADERS) == ('100',)

    def test_an_absurdly_deep_tree_stops(self, monkeypatch):
        depth = pco._FOLDER_CHAIN_MAX_DEPTH + 10
        parents = {'service_types/12': 'f0'}
        for n in range(depth):
            parents[f'folders/f{n}'] = f'f{n + 1}'
        monkeypatch.setattr(pco, '_http_get', tree(**parents))

        assert len(pco.folder_chain('12', HEADERS)) == pco._FOLDER_CHAIN_MAX_DEPTH
