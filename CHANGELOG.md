# Changelog

## [Unreleased]
### Added
- **The PCO panel picks teams from the plan instead of asking you to type them.** The team filter was a free-text, comma-separated box matched case-insensitively as a substring, so a team was one `&`-versus-`and` away from silently matching nobody — and nothing on screen showed which teams existed or that a name had failed to match. Choosing a plan now lists its teams as tick boxes with a head count each, taken from a new `GET /api/pco/teams`. That endpoint deliberately ignores `mapping.team_name_filter`, because a filtered-out team still has to be listed for it to be re-addable.
- **A Service Type selector.** The interface has always read `pco-service-type-id` when building its payload, but the control was never added to the page, so the plan list aggregated every service type in the account — dozens of unrelated plans on a mid-sized church account. Picking a service type now scopes the list.

### Changed
- The PCO panel is laid out as numbered steps — connect, choose the plan, pick the teams, then how positions match slots. Mapping options used to be configured above the plan chooser, so they were set before there was any real data to set them against.
- Plan labels no longer read `Aug 2 — ` when a plan has no title, or when scoping to a single service type drops the service name from the response.
- **`mapping.position_number_fallback` now defaults to off.** A slot serves a *position*, not a team, so a position only auto-matches a slot whose own label says so. The fallback keys on the trailing number alone, and position names are unique within a Planning Center team rather than across a plan — so with more than one team scheduled, `Vocal 1` (Vocal Team), `Guitar 1` (Band) and `Host 1` (Speakers and Hosts) all reduce to `1` and every one of them claims the same `Mic 1` slot, producing a three-way conflict and an arbitrary winner. Anything the exact-label passes cannot place is now left unmatched for the operator to assign by hand rather than guessed at. Labelling both the mic and the IEM channel with the position name still fills both from one position. The option remains available for single-team plans.

  Existing installations are **not** migrated: the interface wrote this key on every save with its checkbox defaulting to checked, so anything that ever saved PCO settings carries an explicit `true`. Clear **Match by trailing number when the label differs** in the PCO panel and save to pick up the new behaviour.

### Fixed
- _Nothing yet._

## [1.4.8] - 2026-08-02
### Fixed
- **Receivers can be discovered on macOS 15 and later.** Discovery listens for Shure announcements on multicast `239.255.254.253:8427` and probes receivers on TCP 2202. Recent macOS versions gate both behind the Local Network privacy permission, and the application never declared why it needed that access, so the request carried no explanation — and because Wirelessboard runs in the menu bar with no window, there was nothing on screen to associate the prompt with. Denied access produced no devices and no error. The application now declares its local network usage.
- **Saved Planning Center credentials no longer read as missing a moment later.** `/data.json`, and both `/api/config` responses, served the raw configuration tree. The stored PCO auth block contains only `credential_id`, `version`, `salt` and `token_digest` — it has no `has_credentials` flag, because that exists only in the sanitized view. The browser replaces its cached configuration from `/data.json` on every poll, so the flag the Sync button checks was wiped seconds after each save. Saving logged *"Credentials stored securely in system keyring"* and syncing still reported *"store credentials and save before syncing"*.

### Security
- The PCO credential salt and token digest are no longer published to every client polling `/data.json`. All configuration payloads now go through a sanitizer that reduces the PCO block to its public view.

## [1.4.6] - 2026-08-02
### Fixed
- **PCO credentials can be stored from a packaged build.** Credentials live in the operating system keyring, and keyring chooses its backend at runtime through entry points declared in its distribution metadata. PyInstaller does not carry that metadata into the bundle, so the packaged app fell back to `keyring.backends.fail`, whose write raises. Saving credentials therefore never succeeded outside a source checkout, and the interface reported *"Cannot sync with PCO: store credentials and save before syncing."* The bundle now includes keyring's metadata and every backend module.
- A missing keyring backend now names itself in the error and the log, instead of surfacing as a generic message with nothing recorded.
- **Configuration is never read from or written to a frozen bundle.** `config_file()` preferred `app_dir()`, which in a packaged build is `sys._MEIPASS` — a directory inside the application bundle. Any `config.json` there took precedence over the user's real configuration, and on macOS writing inside a signed, notarized bundle both fails and invalidates the signature. That branch now applies only to source checkouts.

## [1.4.5] - 2026-08-02
### Fixed
- The macOS app declared both `LSBackgroundOnly` and `LSUIElement`. The first says the process presents no interface at all; the second makes it a menu-bar agent that may show a tray icon and windows, which is what this app actually does. `LSBackgroundOnly` has been dropped. Reported as an immediate crash on an M4 running macOS Tahoe 26.5.

## [1.4.4] - 2026-07-27
### Fixed
- **macOS builds are signed and notarized.** 1.4.3 signed both apps correctly and then failed notarization with `HTTP status code: 401. Invalid credentials`, because the stored app-specific password was not the one Apple expected. The credentials are now verified against Apple with `notarytool` before being stored, rather than discovered to be wrong by a release.

## [1.4.3] - 2026-07-26
> Never released. Signing succeeded on both architectures; notarization was rejected with a 401. Use 1.4.4.

### Fixed
- **macOS signing works.** The certificate supplied to CI had been exported by OpenSSL 3, which defaults to AES-256 with a SHA-256 MAC. Apple's Security framework reads only the legacy PKCS#12 encoding and rejects anything else as `MAC verification failed during PKCS12 import (wrong password?)` — a misleading message, since the password was correct. Re-exported with `PBE-SHA1-3DES` and a SHA-1 MAC.
- The certificate diagnostic lists every identity rather than only valid ones. An isolated keychain has no search-list context to chain a leaf through Apple's intermediate to the root, so the previous check reported zero valid identities for a perfectly good certificate.

## [1.4.2] - 2026-07-26
> Never released. The Windows installer built, but both macOS jobs failed importing the signing certificate. Use 1.4.3.

### Fixed
- **macOS builds are now genuinely signed and notarized.** 1.4.1 shipped the configuration for this but not the result: the certificate available to CI held no valid `Developer ID Application` identity, so electron-builder logged a warning, skipped signing, and the job still reported success. The certificate has been reissued and the release workflow now prints the identities it finds before building, so a missing one fails loudly instead of silently.
- **The Windows installer is back.** 1.4.1 produced none. `CSC_LINK` and `CSC_KEY_PASSWORD` are electron-builder's generic signing variables rather than macOS-specific ones, so setting them for the whole job handed the Apple certificate to `signtool`, which rejected it. They are now scoped to macOS.

## [1.4.1] - 2026-07-26
> Never released. The macOS builds from this tag are unsigned despite the entries below, and no Windows installer was produced. Use 1.4.2.

### Added
- macOS builds are signed with a Developer ID Application certificate and notarized by Apple. Signing turns on when the Apple credentials are configured, so a fork without them still builds (unsigned) rather than failing.
- Hardened-runtime entitlements in `resources/`, covering the JIT and unsigned executable memory Electron needs and the library validation the bundled Python service requires.

### Changed
- The macOS installers are built on separate runners per architecture: Apple Silicon on `macos-latest`, Intel on `macos-15-intel`.
- CI installs with `npm ci` instead of `npm install`, so every build starts from exactly what `package-lock.json` specifies.
- Lint configuration moved from `.eslintrc.json` to `.eslintrc.cjs` so each deviation from `airbnb-base` records why it exists.

### Fixed
- **The Intel macOS app shipped an Apple Silicon Python service and could never have run.** The bundled service is built natively and is not universal, but both architectures were packaged on one Apple Silicon runner, so the x64 app received an arm64 binary.
- **macOS refused to open the app with "damaged and can't be opened".** Nothing in the release was signed, and that is the message macOS shows for an unsigned app carrying a quarantine flag. Users of 1.4.0 and earlier can clear it with `xattr -dr com.apple.quarantine "/Applications/Wirelessboard Server.app"`.
- `node_modules` was tracked in Git despite being listed in `.gitignore`. Every checkout carried 25,516 stale files, and installing over them left packages whose contents did not match their versions, which is why the CI lint step died on files missing from inside eslint.
- The release workflow failed after publishing: the Windows job looked for its output in `release/win`, which electron-builder never writes, and the verification step's `find | head` pipeline aborted under `bash -eo pipefail`.
- `js/demodata.js` assigned to the global `window.name` while collecting transmitter names, and compared display styles with `==` in `js/channelview.js`. Removed dead code and unused imports throughout `js/`.
- `docs/installation.md` said the macOS desktop app was discontinued. It now documents which disk image to download for which Mac.

## [1.4.0] - 2026-07-26
### Added
- PCO sync now identifies each scheduled person by their Planning Center **team position name** (for example `Vocal 1`), read from `PlanPerson.attributes.team_position_name`. This is where the mic name and number now live.
- A single position can resolve to several slots, so the person under `Vocal 1` fills both the mic channel and its matching IEM channel in one sync.
- New `mapping.strategy` values: `position_or_note` (the new default) and `position`. The previous behaviour remains available as `note_or_brackets`.
- New `mapping.position_number_fallback` option (on by default). Lets position `Vocal 1` match slots labelled `Mic 1` and `IEM 1`, with the slot's configured device type checked so an `IEM` label only matches a PSM1000 (`p10t`) slot.
- New `mapping.seed_extended_id` option (off by default). Writes the position name into slots that have no `extended_id` yet, so later syncs match exactly.
- New `POST /api/pco/preview` endpoint and a **Preview Sync** button in the Planning Center view. Both resolve the full mapping without writing to `config.json`, reporting which slots each position matched, which rule matched them, anyone who matched nothing, and any slot claimed by two people.
- Sync and preview responses now include `slots_matched`, `unmatched`, and `conflicts`, and each assignment reports `position`, `team`, and `matched_via`.
- Python test suite under `py/tests/` (`npm test`), covering label normalization, the three matching passes, the device-type check, assignment resolution and application, idempotency, device-name preservation, PCO payload flattening, dedupe, and conflict detection. CI runs it alongside the build.
- ESLint configuration and an `npm run lint` script, so the existing eslint dev dependencies are actually used.
- `config/config.json.example` as a sanitized configuration template.

### Changed
- The PCO sync result table now shows position, person, team, matched slots, and the matching rule, with separate lists for unmatched people and conflicting slots.
- `mapping.team_name_filter` is applied consistently as a case-insensitive substring match everywhere. It previously required an exact match during sync while the people list used a substring match.
- Label comparison ignores case, punctuation, spacing, and leading zeros, so `Vocal 1`, `vocal-01`, and `VOCAL_1` are treated as the same label.
- Plan selection and plan-people fetching are shared between sync and the notes preview instead of being duplicated.
- Matching rules moved into a dedicated `py/pco_mapping.py`, free of network and config side effects.
- `.gitignore` now covers webpack output, `config/config.json`, and nested `.DS_Store` files.

### Fixed
- Slot resolution stopped at the first matching slot, so a person assigned to both a mic and an IEM only ever had one of the two updated.
- Label parsing stripped spaces before locating the trailing number, so `Vocal 1 2` was read as the number `12` and could cross-match a slot labelled `Mic 12`.
- Two people resolving to the same slot silently overwrote each other. Conflicts are now logged and reported in the sync and preview responses.
- Socket, discovery, and Google Drive failures that were silently swallowed now log at debug level with a traceback. Behaviour is unchanged; the failures are simply diagnosable now.
- Bare `except:` clauses narrowed to `except Exception:` / `except OSError:`.
- `docs/api.md` no longer claims a `/micboard.json` endpoint exists; only `/data.json` is served.
- The Docker frontend stage installed with `--omit=dev` and then relied on the committed `node_modules` arriving via `COPY . .` to supply webpack. It now installs devDependencies properly and skips the postinstall virtualenv helper, and a `.dockerignore` keeps the host tree from overwriting the install.

### Removed
- `py/util.py`, whose only symbol `TVLookup()` was never imported.
- The dead `micboard_json()` wrapper, the two unused reload-config handler classes, and the unreachable second `return` in `localURL()`.
- Leftover debug `print` and `console.log` statements from request handlers and the frontend.
- `node_modules`, `config/config.json`, and `config/wirelessboard.log` are no longer tracked in Git. A fresh clone now requires `npm install`, and `config/config.json` is created at runtime from your own settings (see `config/config.json.example`).

## [1.3.4] - 2025-12-13
### Added
- PCO Note Category field now has a Fetch Notes preview button that shows the plan’s notes inline and lets you choose People vs Plan notes.

### Changed
- Demo PCO config form now displays explicit labels for all fields to improve accessibility and clarity.
- Switched IBM Plex imports to the compiled CSS to remove Sass @import deprecation warnings and rebuilt frontend bundles.

### Fixed
- PCO people loader now applies the Team Name Filter when fetching plan people.
- PCO sync results now show the note content read from the configured Note Category.
- TV mode backgrounds now add a dark scrim and label chips so overlay text stays readable on images and videos.
- PCO sync now preserves device/channel names and only updates extended IDs/labels, preventing PCO data from overwriting device naming.
- Google Drive OAuth flow now falls back to stored scopes and rejects unexpected credential types when completing authorization.
- Git ignores Python bytecode caches to keep working trees clean.
- Upgraded urllib3 to 2.6.1 to address compressed-response decompression DoS (CWE-409).

## [1.3.2] - 2025-11-12
### Added
- Background Library option to choose a default TV mode background (images or videos) and auto-enable it when TV mode activates.

### Changed
- _Nothing yet._

### Fixed
- _Nothing yet._

## [1.3.1] - 2025-11-08
### Fixed
- Wirelessboard Server tray icon now bundles the current rotating log files so the "Open log file" item matches the UI log viewer.

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
