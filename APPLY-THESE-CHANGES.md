# Wirelessboard — changes are applied. Here's what's left.

The 27 changed files were written directly into `C:\dev\wirelessboard` and verified
byte-for-byte against what I built and tested. Line endings were converted to CRLF to
match the rest of your Windows checkout, so git should show clean, minimal diffs.

Nothing was committed — the working tree is modified and staged for nothing, so you can
review before deciding.

## Verification note

I could not run `git status` usefully from my side. Your repo is mounted into a Linux VM
where `core.autocrlf` is unset and the git-lfs filters aren't configured, so git *in
there* reports nearly every file as modified — including files I never touched. I checked
this: untouched files like `README.md`, `docs/qlxd.md`, and `js/kbd.js` are byte-identical
to `origin/main` once CRLF is normalized, so the tree is fine. Run `git status` in your own
Windows terminal for the real picture; you should see exactly these 27 files.

```
.eslintrc.json                    (new)
.github/workflows/releases.yml
.gitignore
CHANGELOG.md
config/config.json.example        (new)
demo.html
docs/api.md
docs/pco.md
js/app.js  js/channelview.js  js/config.js  js/data.js  js/dnd.js
package.json
py/discover.py  py/google_drive.py  py/networkdevice.py  py/pco.py  py/shure.py
py/tornado_server.py
py/pco_mapping.py                 (new)
py/tests/test_pco_mapping.py      (new)
py/tests/test_pco_resolve.py      (new)
pytest.ini                        (new)
static/about.js  static/app.js  static/app.js.map   (rebuilt by webpack)
```

The `static/` bundles are already rebuilt, so the UI changes are live without running
`npm run build`. Re-run it any time if you'd rather generate them yourself.

---

## 1. Rotate the leaked Planning Center token — do this first

`config/config.json` is committed to the **public** GitHub repo with a live PCO Personal
Access Token in it (`token` plus the `pco_pat_...` secret). Revoke it in Planning Center
(Developer → Personal Access Tokens) and issue a new one. Nothing below fixes this —
removing a file from git does not un-leak a token that was publicly readable.

## 2. Delete the `_to_delete` folder

I can't delete files on your machine, only move them. `_to_delete\` contains:

- `util.py` — was `py/util.py`, held only an unused `TVLookup()` function
- `wirelessboard-changes.tar.gz` and `wirelessboard-pco-cleanup.patch` — how the change
  got delivered, now redundant

Delete the whole folder. Git needs to know `py/util.py` is gone:

```bash
cd C:\dev\wirelessboard
git rm --cached py/util.py
```

## 3. Run the tests

```bash
pip install pytest      # not currently installed
npm test                # runs: python -m pytest py/tests -q
```

82 tests. They pass here — I ran them against a fresh clone of your exact commit
(`42896165`) with these files applied. If they fail on your machine, that's a real signal
worth telling me about.

## 4. Commit

```bash
git checkout -b pco-position-mapping
git add -A
git status              # confirm only the 27 files above, plus py/util.py deleted
git commit -m "feat(pco): map assignments by team position name; clean up dead code"
```

## 5. Untrack what should never have been committed

Left for you deliberately — these change what git tracks. `.gitignore` already covers all
of them, so nothing comes back.

```bash
# 25,516 files, ~330 MB — why your .git directory is 228 MB
git rm -r --cached node_modules

# runtime config holding the PCO credentials (config/config.json.example replaces it)
git rm --cached config/config.json

# stray runtime / OS files
git rm --cached config/wirelessboard.log static/.DS_Store docs/.DS_Store

git commit -m "chore: stop tracking node_modules, runtime config, and OS metadata"
```

### Optional: also untrack the built bundles

`static/*.js` and their `.map` files are webpack output (~13 MB; `app.js.map` alone is
2.8 MB). `.gitignore` lists them, but ignore rules don't affect already-tracked files.

```bash
git rm --cached static/app.js static/app.js.map static/venue.js static/venue.js.map \
               static/web.js static/web.js.map static/about.js static/about.js.map \
               static/*.LICENSE.txt
git commit -m "chore: stop tracking webpack output"
```

**Trade-off:** after this a fresh clone has no frontend until someone runs `npm run build`.
Your release workflow and Dockerfile already build, so CI and packaged builds are fine —
but if your Pi is deployed by cloning and running `npm run server` directly, skip this one
or add a build step.

## 6. Purge the token from git history (optional)

`git rm --cached` leaves the old token reachable in history:

```bash
pip install git-filter-repo
git filter-repo --invert-paths --path config/config.json --path node_modules --force
git push --force origin main
```

Rewrites history, so any other clone has to be re-cloned. Rotating the token (step 1) is
the part that actually protects you.

---

## What changed in the Planning Center integration

Wirelessboard now identifies a scheduled person by their **PCO team position name**, read
from `PlanPerson.attributes.team_position_name` — that's where the mic name and number
live now. Someone under team `Vocal`, position `Vocal 1`, is mic 1.

Matching runs in three passes, stopping at the first that hits anything:

1. Slot `extended_id` equals the position — explicit and predictable, recommended.
2. A Shure channel name equals the position.
3. Trailing numbers agree, and the slot's prefix either matches the position's prefix or
   is a device word (`Mic`, `IEM`, `HH`, `BP`, …). When it names a device kind the slot's
   type has to agree — `IEM 1` only matches a `p10t`. So `Vocal 1` finds `Mic 1` and
   `IEM 1`, but never `Band 1`.

**Every** slot matched in the winning pass gets the person's name — that's what lets one
position fill both a mic channel and its IEM channel. Comparisons ignore case,
punctuation, spacing, and leading zeros, so `Vocal 1`, `vocal-01`, and `VOCAL_1` are the
same label.

Device and channel names are never written to. Only `extended_name` changes, unless you
turn on `seed_extended_id`.

### Since you weren't sure how your slots are labelled

Don't guess — use the new **Preview Sync** button in the Planning Center view (or
`POST /api/pco/preview`). It resolves the whole mapping and shows which slots each
position matched, which rule matched them, anyone who matched nothing, and any slot two
people are both claiming — without writing to `config.json`.

Read the `tried` value on each unmatched row: that's the exact label Wirelessboard looked
for. Compare it to the `extended_id`s in the Config view and you'll know immediately
whether your labels line up.

### New settings in the PCO view

| Setting | Default | What it does |
| --- | --- | --- |
| Assignment Source | Team position, then note category | `position_or_note` / `position` / `note_or_brackets` (the old behaviour) |
| Match by trailing number | on | Lets `Vocal 1` match `Mic 1` / `IEM 1`. Off requires exact labels. |
| Fill empty slot IDs | off | Writes the position name into slots with no `extended_id` yet |

Your existing config keeps working: `strategy` is absent or `note_or_brackets` today and
both still load. `note_or_brackets` now also falls back to the position as a last resort,
so it can only match more than before, never less.

`team_name_filter` is now a case-insensitive **substring** match everywhere. It was an
exact match during sync and a substring match in the people list — a real inconsistency.
`"Vocal"` now also covers a team named `"Vocal Team A"`. Note the direction: `"Vocals"`
will *not* match a team named `"Vocal"`.

---

## Everything else in the change set

**Cleanup**
- Deleted `py/util.py` (unused), the dead `micboard_json()` wrapper, both unused
  reload-config handler classes, and the unreachable second `return` in `localURL()`.
- Removed leftover debug output: `print("IT DONE!")`, `print("RECONFIG")`, debug prints in
  request handlers, and ~10 debug `console.log` calls across `js/`. Kept the deliberate
  startup and diagnostic logs.
- Errors silently swallowed in `py/shure.py`, `py/discover.py`, and `py/google_drive.py`
  now log at debug level with a traceback. Behaviour is unchanged — they still continue —
  but a failure is diagnosable instead of invisible.
- Bare `except:` narrowed to `except Exception:` / `except OSError:`.

**Correctness bugs found while testing the new code**
- Slot resolution stopped at the *first* match, so someone on both a mic and an IEM only
  ever got one of them updated.
- `split_label` stripped spaces before finding the trailing number, so `"Vocal 1 2"` read
  as the number **12** and would cross-match a slot labelled `Mic 12`.
- Two people resolving to the same slot silently overwrote each other. Conflicts are now
  logged and surfaced in the sync/preview response and UI.

**Tests and CI** — the repo had zero tests. There are now 82 under `py/tests/`, covering
label normalization, the three matching passes, the type check on IEM fallback, assignment
resolution and application, idempotency, device-name preservation, PCO payload flattening,
dedupe, and conflict detection. CI runs them, plus `npm run lint` (non-blocking).

**Docs** — `docs/pco.md` rewritten for the position-based mapping, with a worked example
and troubleshooting. `docs/api.md` claimed a `/micboard.json` endpoint "remains available
for backwards compatibility"; no such route exists, so that claim is gone.

**ESLint** — `eslint`, `eslint-config-airbnb-base`, and `eslint-plugin-import` were
installed with no config and no script. Added `.eslintrc.json` and `npm run lint`. I
couldn't get an error count — the eslint copy in my sandbox is missing internal modules.
Expect a lot of warnings on first run; rules are lenient on purpose as a starting point.

---

## Not done — worth its own pass

Skipped deliberately: large mechanical refactors that would have buried the functional
change in noise.

- **`js/config.js` is 3,214 lines** covering at least six unrelated concerns (log viewer,
  PCO panel, discovery settings, background library, device-name editing, tab management).
  Splitting it into `config/logs.js`, `config/pco.js`, etc. with `config.js` as a thin
  orchestrator would mirror how `app.js` already composes small modules.
- `py/config.py` (997 lines), `py/tornado_server.py` (~810), and `py/pco.py` (~1,100 even
  after extracting `pco_mapping.py`) are similarly god-modules.
- **The frontend global state object is still named `micboard`** — 230 references across
  10 files, plus `window.micboard`. Every logger namespace is still `micboard.*`
  (`micboard.web`, `micboard.pco`, …), and `docs/api.md` and `docs/configuration.md` tell
  users to reference those names. A rename needs a migration note for anyone with
  per-logger level overrides.
- `py/config.py` imports `tornado_server`, which imports `config` — a circular import that
  works only by accident of import order. It's why the tests have to install tornado just
  to import `config`.
- `index.html` at the repo root is a dead entry point; `/` renders `demo.html`.
  `data.json` at the repo root is a dead fixture — the real `/data.json` is generated live.
- `server` and `server:venv` in `package.json` are byte-identical.
