# Changelog

## [Unreleased]
### Added
- Project-wide Python lockfile (`py/requirements.lock`) and `npm run pip:lock` helper to regenerate pinned dependencies alongside `py/requirements.txt`.
- Semantic versioning workflow powered by `npm version` and `scripts/sync-version.js`, keeping Python artefacts and release tags in sync.
- Dedicated versioning guide (`docs/versioning.md`) and CI check to ensure `package.json` and `py/version.py` remain aligned.
### Fixed
- Pinned the Electron runtime in development dependencies so `npm run release:mac` can build packages locally and in CI without missing-module failures.

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
