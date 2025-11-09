# Changelog

## [Unreleased]
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- _Nothing yet._

## [1.3.0] - 2025-11-08
### Added
- Google Drive background provider with OAuth flow, REST endpoints, and Config UI controls for uploading client secrets, managing tokens, and browsing shared media.

### Changed
- Minimum supported Python runtime is now 3.12; local virtualenv bootstrap prefers `python3.12`, and release bundles are built from the Homebrew 3.12 toolchain.
- Background Library card now groups local folders and cloud providers, preventing layout overlap with discovered devices and keeping background settings together.
- Top navigation now surfaces a consolidated Menu dropdown: Help opens the HUD overlay, and Background Library / Planning Center launch their own full-screen configuration views.

### Fixed
- PyInstaller distribution now embeds the Python 3.12 framework, restoring the packaged UI launch on macOS after adding Google API dependencies.
- Google Drive OAuth flow now reuses the scopes negotiated during authorization when reporting state back to the UI, preventing missing scope metadata after consent.
- Added an inline close control so the Config and PCO sections can be dismissed reliably on 4K televisions and other ultra-high-resolution displays.

## [1.2.5] - 2025-11-08

### Added
- Discovery controls now live alongside the Discovered Devices list in the Config view, with an inline alert that surfaces Shure Update Utility/DCID requirements.

### Changed
- Configuration API responses (`GET/POST /api/config`) and downstream UI now expose live discovery/DCID status so the browser reflects backend readiness without a reload.

## [1.2.0] - 2025-11-05
### Added
- Background Library picker inside the Config view so operators can choose or reset the background media folder without editing files.
- REST endpoint (`GET/POST /api/backgrounds`) powering the picker, returning the active path and persisting updates when no CLI override is present.
- PCO assignment table now surfaces inline warnings when slots are missing device or extended names, guiding operators to update Config before syncing people.

### Changed
- Background asset handler now resolves the folder dynamically, so updates made via the picker take effect immediately for `/bg/...` requests.
- Documentation refreshed to cover the in-app folder selector, command-line overrides, default per-platform paths, and the PCO credential workflow.

### Fixed
- Extended names on the channel faceplate now resize and align without overlapping the primary label.

## [1.1.0] - 2025-10-06
### Added
- Project-wide Python lockfile (`py/requirements.lock`) and `npm run pip:lock` helper to regenerate pinned dependencies alongside `py/requirements.txt`.
- Semantic versioning workflow powered by `npm version` and `scripts/sync-version.js`, keeping Python artefacts and release tags in sync.
- Dedicated versioning guide (`docs/versioning.md`) and CI check to ensure `package.json` and `py/version.py` remain aligned.
- Secure Planning Center credential store backed by the host keyring (`py/pco_credentials.py`) with automatic migration from plaintext tokens.
- PCO configuration API now returns a sanitized credential summary and the UI surfaces keyring status indicators without echoing secrets in the browser.
### Changed
- Saving the PCO configuration only persists metadata in `config.json`; credentials are migrated into the keyring on demand and verified via stored digests.
- Frontend PCO workflows hide token/secret inputs after save and require stored credentials before syncing assignments to prevent accidental plaintext reuse.
- `api/pco/config` responses reuse sanitized metadata for both initial loads and POST responses, keeping `micboard.config` free of sensitive values.
### Fixed
- Pinned the Electron runtime in development dependencies so `npm run release:mac` can build packages locally and in CI without missing-module failures.
- CI macOS builds now remove the temporary virtualenv after bundling so Electron Builder no longer encounters symlinks to system Python binaries.
- Eliminated npm install warnings by forcing published `@electron/rebuild` releases and vendoring a maintained `boolean` shim, removing git-based `node-gyp` and deprecated transitive packages.

## [1.0.4] - 2025-10-04
### Added
- Bundled-server build now auto-detects Python interpreters, allowing macOS releases to succeed even when `/usr/bin/python` shims are missing.
### Changed
- Ignored generated `dist/` and `release/` artefacts so local builds don't pollute git status.

## [1.0.3] - 2025-09-27
### Changed
- Documented that macOS and Windows release jobs publish directly to the tag's GitHub Release using the workflow token.
### Fixed
- Exported `GH_TOKEN` in the desktop packaging workflow so Electron Builder can upload artefacts during tagged builds.

## [1.0.2] - 2025-09-27
> Superseded by 1.0.3 before publication.

## [0.9.0] - 2025-09-27
### Added
- Planning Center Online (PCO) integration: backend endpoints (`GET/POST /api/pco/config`, `GET /api/pco/plans`, `GET /api/pco/people`, `POST /api/pco/sync`).
- Dedicated PCO settings page: enable/credentials, note category, team filter, global plan selector, people loader, assignment preview and apply.
- Config editor enhancements: discovered devices list, add-all-discovered, slot rendering from config, add/delete row controls, clear IDs/Names.
- Device name maintenance tools: API endpoints and Config buttons to clear slot names and re-fetch live device labels without disturbing extended names.
- URL-hash navigation for `settings=true` and `pco=true`, with back button handling to move between PCO and Config.
- Python virtualenv helpers: `setup:venv`, `postinstall` to auto-install Python deps; `npm run server` uses the project venv by default.

### Changed
- Frontend modernized to Bootstrap 5 with a responsive PCO UI and HUD overlay.
- Build pipeline updated to Webpack 5 with SCSS and IBM Plex fonts.
- Demo-mode HUD auto-opens only on initial load and no longer blocks Config/PCO.
- Unified single-view behavior: Micboard, Config, and PCO now toggle through a common visibility utility.
- Docker and Python versions updated; npm packages refreshed.
- Development watch task now ignores local config JSON so editing slots doesn't force a server restart loop.
- Documented recommended TV background image dimensions and background directory location for PSD templates.

### Fixed
- Duplicate IDs and stray tags in `demo.html` causing autofill and layout issues; removed duplicate templates and invalid tags.
- Config editor errors and typos: missing `renderSlotList`, misspelled `renderDiscoverdDeviceList`, undefined `dragSetup`; implemented correct functions and removed undefined calls.
- Config editor behaviors: hide/show IP/Channel for offline/empty types, delete-row wiring, clear-config workflows.
- Stale build artifacts causing runtime ReferenceErrors; ensured clean rebuild and consistent asset loading.
- PCO slot assignments now only update Extended Names; the Shure device name column continues to reflect the receiver label.
- Clearing extended or device names now persists correctly after saving, and UI buttons show feedback when actions run.

## [0.8.7-updates] - 2022-03-08

## [0.8.7] - 2021-05-28


## [0.8.5] - 2019-10-10
### Added
- Device configuration page.
- Estimated battery times for devices using Shure rechargeable batteries.
- Offline device type for devices like PSM900s.
- Added color guide to help HUD.
- Custom QR code support using `local_url` config key.
- docker-compose for simplified docker deployment.

### Changed
- Migrated CSS display from flex to grid based system.
- Cleaned up node dependencies.
- Updated DCID map with additional devices.

### Fixed
- Disable caching for background images.
- Updated Dockerfile to Node 10.
- Invalid 'p10t' device type in configuration documentation.
- Resolved issue with PyInstaller that required the Mac app to be occasionally restarted.
- Cleaned up device discovery code.


## [0.8.0] - 2019-8-29
Initial public beta

[0.8.5]: https://github.com/karlcswanson/micboard/compare/v0.8.0...v0.8.5
[0.8.0]: https://github.com/karlcswanson/micboard/releases/tag/v0.8.0
