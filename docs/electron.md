# Electron Wrapper
Python and JavaScript dependencies can be wrapped with Electron to make deployment a bit easier for those running macOS. This is far from the ideal way to package and deploy an application for the Mac, but it eliminates the need for the command line during the install process. A Cocoa or Swift wrapper should be made eventually—Electron adds ~300 MB to the ~19 MB Wirelessboard executable (the legacy Micboard bundle size is similar).

There are a few different layers.

The frontend is written in JavaScript. [webpack](https://webpack.js.org) packages JS, CSS, and font dependencies into a minified and distributable file.

The Wirelessboard server is written in Python. [PyInstaller](https://pyinstaller.readthedocs.io/en/stable/) packages a Python interpreter, Wirelessboard, and its dependencies into a single executable. (Legacy Micboard builds can still be produced by keeping the old package name.)

The Electron wrapper is written in JavaScript. It provides a menubar app with access to Wirelessboard, its configuration directory, and the Wirelessboard logs. The menu labels continue to include “Micboard” when running in legacy compatibility mode.

## Building Cross-Platform Releases
Wirelessboard now ships with repeatable release scripts and a GitHub Actions workflow that publish artefacts for macOS, Windows, and Raspberry Pi. The Python backend is bundled with PyInstaller while [`electron-builder`](https://www.electron.build) produces the desktop shells.

### Prerequisites
* Node.js 18+ (Node 20 is used in CI)
* Python 3.9+ with `pip`
* Xcode command-line tools (macOS) or Build Tools for Visual Studio (Windows) for native module compilation

Run `npm install` once per machine; the postinstall hook provisions `.venv/` with the Python dependencies listed in `py/requirements.lock` for repeatable installs.

### Desktop release commands
The scripts below generate artefacts in the `release/<platform>/` directories. They automatically build the webpack bundles, run PyInstaller, and invoke Electron Builder with the shared `electron-builder.yml` configuration.

```bash
# macOS: produces DMG and ZIP bundles in release/mac/ (no auto-publish)
npm run release:mac

# Windows 11: produces an NSIS installer in release/win/ (no auto-publish)
npm run release:win

# CI-only helpers that publish to GitHub Releases when GH_TOKEN is provided
npm run release:mac:ci
npm run release:win:ci
```

Electron Builder configuration lives in `electron-builder.yml`. You can still call the helper script directly when you need fine-grained control over targets:

```bash
BUILD_TARGET=linux node electron-build.js
```

### Raspberry Pi bundle
The Pi distribution remains a headless PyInstaller service packaged as a tarball together with the `wirelessboard.service` systemd unit. Run the release task on an ARM host (or a self-hosted GitHub runner):

```bash
npm run release:pi
```

The tarball is written to `release/pi/wirelessboard-pi-<version>.tar.gz`. Extract it on the Raspberry Pi, copy the service directory into place (for example `/opt/wirelessboard`), and install the bundled unit file into `/etc/systemd/system/`.

### Semantic versioning workflow
Wirelessboard releases adhere to [Semantic Versioning](https://semver.org/). The `npm version` command updates every place the version is tracked and prepares a tag that triggers the packaging workflow:

```bash
# Bump patch/minor/major as needed
npm version patch

# Push the commit and tag so GitHub Actions can build installers
git push --follow-tags
```

The helper updates `package.json`, regenerates `py/version.py` for Python artefacts, and creates a Git tag such as `v1.0.1`. Electron Builder, PyInstaller, and the Raspberry Pi tarball all embed that version number in their output names.

### Continuous integration
The workflow in `.github/workflows/releases.yml` executes the following pipeline whenever you push a tag starting with `v` or trigger it manually:

1. Lint/build job on Ubuntu validates the webpack bundle and compiles all Python sources.
2. macOS and Windows runners build desktop packages and upload them as workflow artefacts.
3. An optional Raspberry Pi job can be enabled for teams with a self-hosted ARM runner; it generates the server tarball described above.

Electron Builder automatically publishes the desktop bundles to the GitHub Release associated with the tag using the workflow token when the CI-only scripts (`release:mac:ci`, `release:win:ci`) run. Local invocations (`release:mac`, `release:win`) build installers without publishing so you never need to expose a personal token during development. Tags must be pushed with the `v` prefix for the workflow to execute.
