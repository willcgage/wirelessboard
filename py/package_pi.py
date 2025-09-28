"""Bundle a Raspberry Pi release tarball from the PyInstaller output."""
from __future__ import annotations

import shutil
import tarfile
from pathlib import Path

from version import __version__

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = PROJECT_ROOT / 'dist'
SERVICE_DIR = DIST_DIR / 'wirelessboard-service'
RELEASE_ROOT = PROJECT_ROOT / 'release' / 'pi'
PACKAGE_ROOT = RELEASE_ROOT / 'wirelessboard'
SERVICE_UNIT = PROJECT_ROOT / 'wirelessboard.service'
README = PACKAGE_ROOT / 'README.txt'

PI_README = """Wirelessboard Raspberry Pi bundle
=====================================

Contents
--------
* wirelessboard-service/  - PyInstaller binary built for Linux ARM
* wirelessboard.service   - systemd unit file

Installation
------------
1. Copy this archive to the Raspberry Pi host and extract it:
       tar -xzf wirelessboard-pi.tar.gz
2. Copy the service directory somewhere permanent, for example `/opt/wirelessboard`.
3. Copy `wirelessboard.service` into `/etc/systemd/system/`, adjusting the ExecStart path
   if you moved the service directory.
4. Reload systemd and enable the service:
       sudo systemctl daemon-reload
       sudo systemctl enable --now wirelessboard.service
5. Place your configuration and backgrounds in `~/.local/share/wirelessboard/` (or the
   legacy `micboard/` path if you still use it).

The packaged binary expects static assets to live alongside the executable exactly as
produced by PyInstaller. Rebuild the bundle from source if you change Wirelessboard's
frontend assets or Python dependencies.
"""


def prepare_release_root() -> None:
    if RELEASE_ROOT.exists():
        shutil.rmtree(RELEASE_ROOT)
    PACKAGE_ROOT.mkdir(parents=True)


def copy_payload() -> None:
    if not SERVICE_DIR.exists():
        raise SystemExit(
            'PyInstaller output missing. Run "npm run bundle:server" before packaging the Pi release.'
        )
    shutil.copytree(SERVICE_DIR, PACKAGE_ROOT / 'wirelessboard-service')
    if SERVICE_UNIT.exists():
        shutil.copy2(SERVICE_UNIT, PACKAGE_ROOT / SERVICE_UNIT.name)
    README.write_text(PI_README)


def make_tarball() -> Path:
    tar_name = f'wirelessboard-pi-{__version__}.tar.gz'
    tar_path = RELEASE_ROOT / tar_name
    with tarfile.open(tar_path, 'w:gz') as tar:
        tar.add(PACKAGE_ROOT, arcname='wirelessboard')
    return tar_path


def main() -> None:
    prepare_release_root()
    copy_payload()
    tar_path = make_tarball()
    print(f'Created Raspberry Pi bundle at {tar_path}')


if __name__ == '__main__':
  main()
