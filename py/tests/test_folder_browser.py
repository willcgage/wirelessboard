"""The folder picker's listings must be safe to walk to the end of a disk.

The picker exists because the interface runs in the operator's own browser,
where no dialog can produce an absolute path. That puts a filesystem walk
behind an HTTP endpoint, so the two things worth pinning are that it only ever
reports directories and that it knows when it has reached a root -- an "Up"
button that loops on itself is how a picker traps somebody.
"""

import os

import pytest

import folder_browser


def test_lists_only_directories(tmp_path):
    (tmp_path / 'shots').mkdir()
    (tmp_path / 'clips').mkdir()
    (tmp_path / 'alice.jpg').write_text('not a folder', encoding='utf-8')

    listing = folder_browser.list_directory(str(tmp_path))

    assert [entry['name'] for entry in listing['entries']] == ['clips', 'shots']
    assert all(os.path.isdir(entry['path']) for entry in listing['entries'])


def test_entries_are_sorted_case_insensitively(tmp_path):
    for name in ('Zulu', 'alpha', 'Bravo'):
        (tmp_path / name).mkdir()

    listing = folder_browser.list_directory(str(tmp_path))

    assert [entry['name'] for entry in listing['entries']] == ['alpha', 'Bravo', 'Zulu']


def test_hidden_folders_are_left_out(tmp_path):
    (tmp_path / '.git').mkdir()
    (tmp_path / 'backgrounds').mkdir()

    listing = folder_browser.list_directory(str(tmp_path))

    assert [entry['name'] for entry in listing['entries']] == ['backgrounds']


def test_parent_points_one_level_up(tmp_path):
    child = tmp_path / 'backgrounds'
    child.mkdir()

    listing = folder_browser.list_directory(str(child))

    assert listing['parent'] == str(tmp_path)


def test_a_root_reports_no_parent():
    root = 'C:\\' if os.name == 'nt' else '/'

    listing = folder_browser.list_directory(root)

    # os.path.dirname() of a root is the root itself. Returning that would give
    # the picker an Up button that never arrives anywhere.
    assert listing['parent'] is None


def test_a_missing_folder_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        folder_browser.list_directory(str(tmp_path / 'nope'))


def test_a_file_is_not_a_folder(tmp_path):
    target = tmp_path / 'alice.jpg'
    target.write_text('x', encoding='utf-8')

    with pytest.raises(ValueError):
        folder_browser.list_directory(str(target))


def test_browse_without_a_path_offers_roots():
    listing = folder_browser.browse('')

    assert listing['is_roots'] is True
    assert listing['path'] is None
    assert listing['parent'] is None
    assert listing['entries'], 'the picker needs somewhere to start'


def test_the_current_folder_leads_the_root_list(tmp_path):
    current = tmp_path / 'backgrounds'
    current.mkdir()

    listing = folder_browser.browse('', extra_roots=[str(current)])

    # Reopening the picker should start where the operator already is.
    assert listing['entries'][0]['path'] == str(current)


def test_a_root_that_does_not_exist_is_skipped(tmp_path):
    listing = folder_browser.browse('', extra_roots=[str(tmp_path / 'gone')])

    assert all(entry['path'] != str(tmp_path / 'gone') for entry in listing['entries'])


def test_roots_are_not_repeated():
    listed = folder_browser.roots(extra=[os.path.expanduser('~')])

    keys = [os.path.normcase(entry['path']) for entry in listed]
    assert len(keys) == len(set(keys))
