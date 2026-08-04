# Changelog

## [Unreleased]
### Added
- **The slot and group editors are reachable with a mouse.** Both could only ever be opened from the keyboard, with **n** and **e**. `app.js` has always carried click handlers for `go-extended` and `go-groupedit` — written in the same guarded style as the menu entries that do exist, and doing slightly more than the shortcuts do, closing the HUD and resetting the view — but neither id has ever appeared in the markup, so the handlers were dead and anyone on a touchscreen or without a keyboard was locked out of both editors. They are now **Edit Slot Names** and **Edit This Group** in the Menu. *Edit This Group* is shown only while a group is being viewed, since editing one is meaningless in the combined view.
- **The Hide inactive charts checkbox is back.** The setting was fully implemented on every side — the sidebar carried its *Hide inactive charts* label, `channelview.js` honoured `hide_charts` when drawing a group, and the group API persisted it — but the `<input type="checkbox" id="chartCheck">` itself was missing, leaving an empty Bootstrap addon where it belonged. The gap dates from the original import, and it was also what made `updateEditor` throw (see *Fixed*). Restoring the one input makes a per-group setting reachable that until now could only be changed by editing `config.json` by hand.
- **A Slot ID field on the configuration page.** `extended_id` is the position a slot answers to — `Vocal 1`, `Band 2` — and it is what PCO matches a plan's positions against, but the configuration editor had no field for it: IP, type, channel, device name and extended name, and nothing for the position. Until now it could only be set indirectly, by assigning a person in the slot editor with *Remember each person's position* enabled. It is now editable directly, beside the name it belongs with.

### Changed
- _Nothing yet._

### Fixed
- **Every request waited on a hostname lookup, and on some networks that cost five seconds each.** `localURL`, which builds the address for the QR code, resolved this host's own name on every call — and it is called from `/data.json`, which every open board requests every five seconds. Where that name does not resolve the lookup does not fail fast; it spends the full resolver timeout, and because the handler is synchronous it spends it holding the IOLoop, so every other request queues behind it. On site this showed as a floor of just over 5000 ms on *every* `/data.json`, with the backlog climbing past 100 seconds. The address is still re-resolved periodically, which was the point of doing it per request, but a slow or failing lookup now costs that once a minute instead of once per request, and failures are cached too — a lookup that times out is the expensive case. A lookup over a second now logs a warning naming `local_url`, which skips it entirely. Covered by `py/tests/test_local_url_cache.py`.
- **A rejected Planning Center token reported only "Unable to fetch service types".** A 401 and an unreachable API produced the same message, so telling them apart meant reading the server log. The reason matters here because **PCO credentials are kept in the computer's own system keyring, not in `config.json`** — so a token entered on one machine does not carry across to another, and the second machine fails with a 401 while its configuration looks completely correct. The message now says so, and reports the status for other failures.
- **The group editor sidebar never appeared, and the slot editor never opened.** Three independent faults, all dating from the original import, stacked on top of one another.

  `updateEditor` set `.checked` on an element with id `chartCheck` that was not in the markup, and `renderGroup` calls `updateEditor` on *every* invocation — so it threw every time, after the board itself had drawn but before anything the caller meant to do next. Pressing **n** never opened the slot editor, and pressing **e** left the sidebar heading on its hard-coded placeholder *Group 4* instead of the group being edited.

  `groupEditToggle` then added the `sidebar-open` class to `document.getElementsByClassName('container-fluid')[0]`. The navbar carries that class too and comes first in document order, so the class landed on an element the sidebar is not inside — and the rule that reveals it, `.sidebar-open .sidebar-nav`, needs an ancestor. The sidebar stayed `display: none` no matter what. It is now addressed by id, as every other module already did.

  Both editors now open, and the sidebar renders.
- A second dead id, `go-groupedit`, was dereferenced unguarded in `infoToggle`, taking down every caller of it the same way. `app.js` already null-checks that id; the two remaining sites now do too.
- **Saving the configuration threw away rows that had no device type, and said it had saved.** A row still missing its type was skipped — deliberately, since there is nothing useful to write — but the save then reported success and reloaded the page, so the row simply vanished. Filling in a receiver's address and pressing Save before picking the type from the dropdown was enough to lose it, with a green *saved* message as the only feedback. The save now stops instead: nothing is written, the rows stay on screen with what was typed into them, and a message beneath the Save button names each unfinished row and its address — *Nothing was saved. Choose a device type for slot 4 (10.100.50.77), or clear the row to discard it.* Untouched blank rows from **Add Row** are still ignored, as before. The message sits with the Save button rather than with the discovery settings well above it, where a save result could easily be off screen.
- **Saving a group silently dropped any slot that was not on screen at that moment.** The saved slot list is read back off the board, and the board only draws slots that have a transmitter — so a slot whose transmitter had not arrived yet was absent from the reading and was written out of the group for good. Nothing indicated it: the slot's own entry in `slots` survived, so only its membership of the group disappeared, and it was not offered in the editor's spare-slots tray either, leaving nothing to notice or drag back. A slot that is missing only because it has no transmitter is now kept in place. One that was genuinely dragged out is still removed — to be dragged it had to be drawn, which means it has a transmitter, and that is exactly what separates *never shown* from *deliberately removed*.
- **The slot editor crashed when a transmitter and the configuration disagreed.** Each list can briefly hold a slot the other does not — a configured slot has no transmitter until the next data push builds one, and a transmitter can outlive its entry in the configuration — and both were indexed without a guard, so the gap threw and took the editor down with it. Each side is now skipped when its counterpart is missing, matching what `renderDisplayList` already did.
- **Clear IDs on the configuration page wiped every receiver's IP address.** The button was wired to `.cfg-ip`, so pressing the control labelled *Clear IDs* emptied the address column and disconnected every configured receiver — the field it was meant to clear, the slot's position, had no input on that page at all (see *Added*). It now clears the Slot ID and leaves the addresses untouched.
- **Saving the configuration could discard the positions PCO had seeded.** `config_mix` treated an absent `extended_id` as an instruction to drop it, so any save from a page that did not send the field erased the positions written by the assign-once workflow. An absent field now means *not editing this* and the stored value stands; only a field that is present and empty clears it, which is what the operator pressing *Clear IDs* actually means.
- **Discovery reported far more devices than exist.** Three separate routes let something that is not a usable receiver into the list. An active scan reported **any host that accepted a TCP connection on port 2202**, even one that answered nothing at all — the probe returned a device record regardless of what came back. A multicast announcement was added **unconditionally**, with an unrecognised DCID merely logged afterwards. And Shure gear that is not a receiver this build can drive was added as `unknown`: only 274 of the 942 bundled DCIDs resolve to a supported receiver, the rest being transmitters and other models. A device is now reported only when it answers in Shure's framed reply format *and* resolves to a type Wirelessboard can actually drive; everything rejected is logged with the reason. (#21)
- **Clear IDs and Clear Extended Names did nothing in the slot editor.** Both buttons carried the same `id` as the pair on the settings page, and because the settings page sits inside `#micboard` — where the slot editor's own controls are cloned — it came first in document order. `getElementById` returns the first match, so those handlers attached to the settings buttons instead: the slot editor's own buttons were inert, while the settings ones quietly gained a second handler every time the editor was opened. The cloned controls now have their own ids, and the clone is removed before being re-added so reopening the editor cannot put duplicate ids back into the document.
- The duplicate-slot guard when saving the configuration compared a slot number against an array of objects, so it never matched and did nothing.

## [1.6.0] - 2026-08-03
The menu bar stops being silent: it says whether the server is up, and whether a
newer version exists. Alongside that, the build stops shipping 327 MB of tooling
it never used, and the release pipeline moves to Node 22 — which is what finally
cleared a deprecation list open since October.

**Intel Macs:** 1.5.1 was the last release with an `x64` build. See *Removed*.

### Added
- **The menu bar tells you when a new version is released.** Wirelessboard now asks GitHub for the latest release half a minute after start and every six hours after that, and reports either *Up to date (1.5.1)* or *Update available: 1.6.0* — the latter opening the release page when clicked. It is **notify only**: nothing is downloaded or installed on its own, because this runs during live services and an update that restarts the app mid-service is worse than one that waits. The check uses `/releases/latest`, which excludes drafts, so a version that has been built but not yet published is never announced. A failed check is logged and otherwise ignored rather than interrupting anyone. (#27)
- **JavaScript tests.** `npm test` now runs the Python suite and a new `npm run test:js` covering main-process logic, using `node:test` from Node 22 — no test framework added, and CI runs it. This is why the update check lives in `electron/update-check.js` with its network call injected: the whole thing is exercisable without a network or a running application.
- **The menu bar says what the server is doing.** Starting the application showed nothing at all until, five seconds later, a browser window appeared. The tray now reports *Starting the server…*, then *Server running* or *Server failed to start*, in both the tooltip and as the first item of its menu, and **Launch Wirelessboard** / **Edit Configuration** stay disabled until the server actually answers. (#14)

### Fixed
- **Tray → Open log file opened a stale log on Windows and Linux, not the one the interface shows.** The Electron process located the service's directory with `app.getPath('appData')`, which is not where the service writes on two of three platforms — Windows puts it under `AppData\Local` while `appData` is `AppData\Roaming`, and Linux uses `~/.local/share` against `~/.config`. Finding nothing there, it fell through to whatever pre-rename `micboard` file happened to exist, which looked like current output but was months old. **Open Configuration Directory** was resolved the same way and could land somewhere unrelated. Both now mirror `os_config_path()` in `py/config.py`, verified against it on all three platforms. macOS was always correct, which is why this only ever appeared on Windows. (#14)
- The last-resort log fallback no longer opens a path that does not exist, or a stale `micboard`-era file. If nothing has been written yet it says so and names the directory it expected.
- **Startup no longer guesses.** The browser was opened on a flat five-second timer regardless of whether the server was up — too early on a slow start, an unnecessary wait on a fast one. It now opens when the server answers, and reports a failure if it never does.
- The tray URL honours `WIRELESSBOARD_PORT` / `MICBOARD_PORT`, which the service already respected. A port set only in `config.json` is still not picked up by the tray.

### Changed
- **Load People moved into the PCO People section.** It sat in the plan row two steps above the table it fills. It is now at the top of that section with a line saying what it does and why it is disabled. (#31)
- **The PCO People table shows Position.** A row is one assignment, not one person, so somebody holding two positions on the same team produced two rows identical in every visible column — `Christian Nuckels / Band` twice, which reads as a duplicate. Both rows were correct; the column that distinguished them was missing.

### Security
- **eslint 8 → 9, clearing the rest of the deprecation list.** eslint 8 is end of life and its `@humanwhocodes/config-array` and `@humanwhocodes/object-schema` internals are deprecated, but `eslint-config-airbnb-base` declares peer `eslint ^7 || ^8` and has not shipped since 2022, so this needed a config replacement rather than a version bump. `.eslintrc.cjs` becomes `eslint.config.mjs` on `eslint-config-airbnb-extended`, a maintained flat-config port of the same rules. Every documented deviation was carried across, and two rules the port made stricter than airbnb-base — `brace-style` and `max-statements-per-line` — were restored to airbnb's own settings, checked against that package's source. Lint output is unchanged: the same 15 files, the same 12 warnings, no errors. A clean install now warns about 2 deprecated packages, down from 7; both remaining are `glob@7`/`inflight` required upstream by `@electron/asar`. (#12)
- **`urllib3` 2.6.3 → 2.7.0**, the one dependency here that reaches users — it is pinned in `py/requirements.txt` and ships inside the bundled service. **This raises the minimum Python to 3.10**, since 2.7 dropped 3.9. CI already builds on 3.11 and `npm run setup:venv` prefers 3.12, so only a source checkout pinned to 3.9 is affected; the documented prerequisite has been corrected from 3.9+ to 3.10+.
- Build-time: `@babel/plugin-transform-modules-systemjs` 7.27.1 → 7.29.8, `immutable` 5.1.3 → 5.1.9.
- **CI moves to Node 22 and electron-builder to 26.15.3, clearing the `node-gyp` deprecations.** `@electron/rebuild` had been held at 3.6.1 by an `overrides` entry ever since 4.0.1 broke the build — 4.x requires Node ≥ 22.12 and every workflow job ran Node 20. That old release dragged in `node-gyp@9`, and with it `npmlog`, `gauge`, `are-we-there-yet` and `@npmcli/move-file`, all deprecated and unsupported. electron-builder 26.10+ depends on `@electron/rebuild` 4.x directly, so with the runners on Node 22 the override is unnecessary and has been removed rather than repointed. Build-time vulnerabilities drop from 31 to 10, with **no criticals** (was 3), and a clean install now warns about 5 deprecated packages instead of 7. Verified by packaging locally: the native rebuild step still completes. (#12)
- **Build-time dependency updates:** `postcss` 8.5.6 → 8.5.25, `fast-uri` 3.1.0 → 3.1.5, `shell-quote` → 1.9.0, `concurrently` → 9.2.4. None of these reach a user; the packaged application still contains no third-party JavaScript beyond the vendored `boolean` stub.
- **`urllib3` 2.6.1 → 2.6.3.** The only dependency update here that reaches users: it is pinned in `py/requirements.txt` and ships inside the bundled service.
- **The application no longer packages 327 MB of build tooling.** `app-builder-lib` — electron-builder's own library — was listed as a runtime dependency, and electron-builder packages runtime dependencies into the app. Nothing in the application imports it; `main.js` requires only `electron`, `path`, `child_process` and `fs`, so there were never any third-party runtime dependencies at all. Moving it to `devDependencies` takes the packaged dependency tree from 309 packages to 2, and the production vulnerability count from 22 (18 high, 1 critical) to zero. Verified by packaging locally: `app-builder-lib` no longer appears anywhere in `app.asar`.

### Removed
- **Intel macOS builds.** Releases are Apple Silicon only from here. **1.5.1 is the last release with an `x64` disk image**, and it keeps working — Intel users should download [1.5.1](https://github.com/willcgage/wirelessboard/releases/tag/v1.5.1) rather than the latest release. There is no in-app updater, so nothing will try to move an Intel install onto a build it cannot run.

  The Intel job cost 200 of the 313 billable minutes a release takes: macOS bills at 10× and the Intel runner took twice as long as arm64 for identical work, making one architecture 64% of every release. It could not be folded into the arm64 job, because the bundled PyInstaller service is built natively and is not universal — packaging both arches on one runner puts an arm64 service inside the Intel app. GitHub also removes the last x86_64 image in Aug 2027. See #30.

## [1.5.1] - 2026-08-02
### Fixed
- **Upgrading no longer leaves the browser running the previous version's JavaScript and stylesheet.** Tornado sends no `Cache-Control` for static files, so browsers applied heuristic freshness and reused `app.js` without asking whether it was still current. After upgrading to 1.5.0 the server rendered the new markup while the script and stylesheet came from the 1.4.8 cache, and reloading did not help because the browser never asked. That one stale file produced three separate symptoms: the Teams chooser rendered but stayed permanently empty, plan labels kept their old `Aug 2 — ` format, the Service Type selector did nothing, and the panel wore the pre-1.5.0 colours. `/static/*` is now served with `Cache-Control: no-cache`, which keeps the cached copy and revalidates it — an unchanged bundle still costs only a `304`.
- The head count beside each team (`— 9 people`) was `#616161`, measuring 3.39:1 against the panel and failing the 4.5:1 AA floor. The team chooser also had no colour of its own, so anything inside it without a class — the empty-state line, the saved-filter list — inherited Bootstrap's near-black at 1.36:1.

### Changed
- **Notes is its own step.** The Note Category field sat beside the team tick boxes under the heading *Pick the teams that need mics*, which is not what it does. It is now step 4, and *How positions match slots* becomes step 5, review 6 and assign 7. Notes are only consulted when a position does not name a slot on its own, and the step says so.
- The team chooser is taller and full width, so a typical plan's teams are all visible without scrolling.

## [1.5.0] - 2026-08-02
Planning Center mapping, largely rebuilt around one correction: a slot serves a
*position*, not a team. Found while running three teams — Vocal Team, Band and
Speakers & Hosts — through a single rack.

### Added
- **The PCO panel picks teams from the plan instead of asking you to type them.** The team filter was a free-text, comma-separated box matched case-insensitively as a substring, so a team was one `&`-versus-`and` away from silently matching nobody — and nothing on screen showed which teams existed or that a name had failed to match. Choosing a plan now lists its teams as tick boxes with a head count each, taken from a new `GET /api/pco/teams`. That endpoint deliberately ignores `mapping.team_name_filter`, because a filtered-out team still has to be listed for it to be re-addable.
- **Hand assignments now teach the slot, so the next plan matches on its own.** Applying an assignment only ever wrote the person's name, which is the one part that changes week to week — so a rack whose slots carry no position label stayed manual forever. The assignment step now offers *Remember each person's position on the slot*, which writes the Planning Center position (`Electric Guitar 1`, not `Joe Spring`) into that slot's `extended_id`, and a **Slot ID** column showing what each slot has learned. Verified against a real plan: three slots assigned by hand, and the next resolution matched all three `via position` with no conflicts. Slots that already have an ID are never overwritten, so labels set up by hand still win.
- **A Service Type selector.** The interface has always read `pco-service-type-id` when building its payload, but the control was never added to the page, so the plan list aggregated every service type in the account — dozens of unrelated plans on a mid-sized church account. Picking a service type now scopes the list.

### Changed
- The PCO panel is laid out as numbered steps — connect, choose the plan, pick the teams, then how positions match slots. Mapping options used to be configured above the plan chooser, so they were set before there was any real data to set them against.
- Plan labels no longer read `Aug 2 — ` when a plan has no title, or when scoping to a single service type drops the service name from the response.
- **`mapping.position_number_fallback` now defaults to off.** A slot serves a *position*, not a team, so a position only auto-matches a slot whose own label says so. The fallback keys on the trailing number alone, and position names are unique within a Planning Center team rather than across a plan — so with more than one team scheduled, `Vocal 1` (Vocal Team), `Guitar 1` (Band) and `Host 1` (Speakers and Hosts) all reduce to `1` and every one of them claims the same `Mic 1` slot, producing a three-way conflict and an arbitrary winner. Anything the exact-label passes cannot place is now left unmatched for the operator to assign by hand rather than guessed at. Labelling both the mic and the IEM channel with the position name still fills both from one position. The option remains available for single-team plans.

  Existing installations are corrected on first start, once. The panel wrote this key on every save with its checkbox defaulting to checked, so anything that ever saved PCO settings carries an explicit `true` that was never a decision, and a changed default could not reach it. That value is turned off and the correction recorded under a top-level `migrations` key, so turning it back on — correct for a single-team plan — survives every later restart. The change is written to `config.json` and noted in the log.

### Fixed
- **Somebody scheduled to more than one team no longer loses all but one of their assignments.** `/api/pco/people` collapsed rows by person, keeping whichever team came back first, so a vocalist also rostered under Band was reported as a Band member and their vocal position disappeared from the plan entirely — on a real Sunday plan the Vocal Team roster read `Vocal 2`–`Vocal 6` with no `Vocal 1`, and the person holding it could not be given a microphone at all. Filtering to that team dropped them completely, since their row claimed a different one. Rows are now keyed by person *and* team *and* position, and still collapse across service times so a slot is never written twice.

  The sync path was never affected — `_dedupe_people` already keyed on position — which meant the assignment table and a sync disagreed about who was scheduled. They now report the same 20 assignments on the plan this was found on.
- **Running from source no longer serves the previous JavaScript bundle after a rebuild.** Tornado caches each static file's content hash for the life of the process and never invalidates it, so a server started before `npm run build` kept answering `304 Not Modified` against the hash it captured at startup — and the browser went on running the old bundle through a hard reload and in a new tab, because the validator still matched. `curl` sends no validator, reads from disk and shows the new bytes, so the file, the build and the served response all looked correct while the page was stale. Source checkouts now hash per request, which keeps conditional requests working and simply makes them tell the truth: a current validator still gets a `304`, a stale one now gets a `200`. Packaged builds are unchanged and keep the cached hash, since their bundle cannot change while the app runs. Development only.

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
