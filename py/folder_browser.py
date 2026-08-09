"""Enumerate directories so the settings page can offer a folder picker.

The board interface runs in the operator's own browser -- main.js opens the
service URL with shell.openExternal rather than loading it into an Electron
window -- so there is no native folder dialog to reach, and neither
`webkitdirectory` nor showDirectoryPicker() hands a page an absolute path.
Background media is read by the service, though, and the service runs on the
machine that holds it, so the picker asks the service what is on disk.

Directory names only. Nothing here reads a file, and nothing here writes.
"""

import os
import stat
import string
from typing import Any, Dict, List, Optional

# Folders under the operator's home worth offering directly. Most media lives
# in one of these, and typing a full path was the thing being replaced.
HOME_SHORTCUTS = ('Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Videos')


def _windows_drive_roots() -> List[str]:
    return [f'{letter}:\\' for letter in string.ascii_uppercase if os.path.isdir(f'{letter}:\\')]


def _is_hidden(entry: os.DirEntry) -> bool:
    if entry.name.startswith('.'):
        return True
    if os.name != 'nt':
        return False
    try:
        attributes = entry.stat(follow_symlinks=False).st_file_attributes
    except (OSError, AttributeError):
        return False
    hidden = getattr(stat, 'FILE_ATTRIBUTE_HIDDEN', 0) | getattr(stat, 'FILE_ATTRIBUTE_SYSTEM', 0)
    return bool(attributes & hidden)


def _parent_of(path: str) -> Optional[str]:
    """The directory above `path`, or None when `path` is already a root.

    os.path.dirname() of a root returns the root itself -- 'C:\\' on Windows,
    '/' on POSIX -- so comparing the two is what tells the picker to stop
    offering "Up one level" and fall back to the root list.
    """
    parent = os.path.dirname(path)
    if not parent or os.path.normcase(parent) == os.path.normcase(path):
        return None
    return parent


def roots(extra: Optional[List[str]] = None) -> List[Dict[str, str]]:
    """Starting points for the picker: home, its usual media folders, drives.

    `extra` puts the folder currently in use at the top, so reopening the
    picker starts where the operator already is rather than at home.
    """
    listed: List[Dict[str, str]] = []
    seen = set()

    def add(name: str, path: Optional[str]) -> None:
        if not path:
            return
        resolved = os.path.abspath(os.path.expanduser(path))
        key = os.path.normcase(resolved)
        if key in seen or not os.path.isdir(resolved):
            return
        seen.add(key)
        listed.append({'name': name, 'path': resolved})

    for path in extra or []:
        expanded = os.path.abspath(os.path.expanduser(path)) if path else ''
        add(os.path.basename(expanded) or expanded, expanded)

    home = os.path.expanduser('~')
    add('Home', home)
    for shortcut in HOME_SHORTCUTS:
        add(shortcut, os.path.join(home, shortcut))

    if os.name == 'nt':
        for drive in _windows_drive_roots():
            add(drive, drive)
    else:
        add('/', '/')

    return listed


def list_directory(path: str) -> Dict[str, Any]:
    """Subdirectories of `path`, sorted, hidden entries left out.

    Raises ValueError when the path is not a directory and PermissionError
    when it cannot be read -- the handler turns those into 400 and 403 so the
    picker can say which of the two happened.
    """
    target = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(target):
        raise ValueError(f'Not a folder: {target}')

    entries: List[Dict[str, str]] = []
    try:
        with os.scandir(target) as scan:
            for entry in scan:
                try:
                    if not entry.is_dir():
                        continue
                except OSError:
                    # A dead symlink or a volume that went away mid-scan. The
                    # rest of the listing is still worth showing.
                    continue
                if _is_hidden(entry):
                    continue
                entries.append({'name': entry.name, 'path': os.path.join(target, entry.name)})
    except PermissionError:
        raise PermissionError(f'Not allowed to read: {target}')

    entries.sort(key=lambda item: item['name'].lower())

    return {
        'path': target,
        'parent': _parent_of(target),
        'writable': os.access(target, os.W_OK),
        'entries': entries,
        'is_roots': False,
    }


def browse(path: Optional[str], extra_roots: Optional[List[str]] = None) -> Dict[str, Any]:
    """One shape for both views the picker shows: a directory, or the roots."""
    if path and path.strip():
        return list_directory(path)

    return {
        'path': None,
        'parent': None,
        'writable': False,
        'entries': roots(extra_roots),
        'is_roots': True,
    }
