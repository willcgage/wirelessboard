<p align="center">
  <a href="https://github.com/willcgage/wirelessboard"><img width="90px" height="90px" src="docs/img/logo.png"></a>
</p>

<h1 align="center">Wirelessboard</h1>

A visual monitoring tool for network enabled Shure devices.  Wirelessboard simplifies microphone monitoring and storage for artists, engineers, and volunteers.  View battery, audio, and RF levels from any device on the network.

> Wirelessboard is the new name for the project previously released as **Micboard**.  Existing configurations, environment variables, and automation targeting Micboard continue to work, and migration tips are documented throughout this repo.

![Wirelessboard Storage Photo](docs/img/wccc.jpg)


![wirelessboard diagram](docs/img/slug.png)

## Screenshots
#### Desktop
![Desktop](docs/img/desktop_ui.png)


#### Mobile
<p align="center">
  <img width="33%" src="docs/img/phone_home.png"><img width="33%" src="docs/img/phone_ui.png"><img width="33%" src="docs/img/phone_ui_exp.png">
</p>

#### Mic Storage
![wirelessboard storage](docs/img/tv_imagebg.png)

## Compatible Devices
Wirelessboard supports the following devices -
* Shure UHF-R
* Shure QLX-D<sup>[1](#qlxd)</sup>
* Shure ULX-D
* Shure Axient Digital
* Shure PSM 1000

Wirelessboard uses IP addresses to connect to RF devices.  RF devices can be addressed through static or reserved IPs.  They just need to be consistent.


## Key Features
* **Cross-browser motion artwork** – Per-channel artwork is rendered with HTML5 `<img>` / `<video>` elements, so JPEG stills or muted, looping MP4s play automatically in Chrome, Edge, Safari, and Firefox. Filenames are matched to the visible channel name; see the [configuration guide](docs/configuration.md#background-images) for details.
* **TV mode layout controls** – Slots keep a consistent width across channel counts, preventing stretched backgrounds on large displays. The width can be customised via CSS before building.
* **HUD help overlay with version info** – The in-app help modal now shows the running Wirelessboard version, shortcuts, and quick links without auto-opening on launch.


## Documentation
* [Installation](docs/installation.md)
* [Configuration](docs/configuration.md)
* [Wirelessboard MultiVenue](docs/multivenue.md)

#### Developer Info
* [Git LFS Setup](docs/git-lfs.md)
* [Building the Electron wrapper for macOS](docs/electron.md)
* [Extending Wirelessboard using the API](docs/api.md)
* [Versioning and release process](docs/versioning.md)

### Live development workflow

Wirelessboard now ships with a watch-based workflow that keeps the Python server and compiled assets in sync while you work:

1. Install dependencies if you haven't already: `npm install`
2. Start the dev environment with `npm run dev`
  * Webpack runs in watch mode, rebuilding the bundles on every change.
  * `nodemon` restarts the Python server whenever the generated `static/` assets, templates, or files in `py/` change, so a browser refresh shows the latest UI without a manual server restart.

Press `Ctrl+C` to stop both processes. The traditional one-shot build (`npm run build`) and manual server start (`npm run server`) still work for production-style testing.

### Python dependency lockfile

Python packages live in `py/requirements.txt`, and a fully pinned snapshot is tracked in `py/requirements.lock`. Installations should prefer the lockfile for repeatable builds:

- `pip3 install -r py/requirements.lock`

When dependencies change, update both files by reinstalling into the project virtualenv and running `npm run pip:lock`. The helper script regenerates `py/requirements.lock` using the current virtualenv so releases and CI pick up the new pins.

### Versioning and releases

Wirelessboard follows [Semantic Versioning](https://semver.org/) for Git tags, desktop bundles, and the Raspberry Pi tarball. The `npm version` command keeps all metadata in sync and prepares a release tag:

1. Choose the appropriate bump (`patch`, `minor`, or `major`) and run `npm version <level>`.
  * This updates `package.json`, regenerates `py/version.py`, commits the change, and creates a Git tag such as `v1.0.1`.
2. Push the commit and tag with `git push --follow-tags` to trigger the release workflow.

The GitHub Actions workflow builds platform installers named with the new version, and Raspberry Pi bundles now include the semantic version in their filename.

> ℹ️ The desktop packaging scripts auto-detect a Python interpreter. If your system does not expose `python` or `python3` in `PATH`, create the project virtualenv via `npm install` or set `WIRELESSBOARD_PYTHON` to the interpreter you want PyInstaller to use. GitHub Actions removes the temporary `.venv` after bundling to avoid packaging symlinks; set `WIRELESSBOARD_KEEP_VENV=1` if you need to retain it in custom CI.


## Known Issues
<a name="qlxd">1</a>: [QLX-D Firmware](docs/qlxd.md)
