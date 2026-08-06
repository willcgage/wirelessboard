/**
 * No getElementById may name an id that appears in no markup at all.
 *
 * This is housekeeping right up until it isn't. Two unguarded ones were serious:
 * `chartCheck` threw on every renderGroup and made both editors unopenable, and
 * `go-groupedit` did the same to infoToggle. Both were invisible in review — the
 * code reads fine; the id simply is not there.
 *
 * #44 audited these by hand and noted the audit was "worth re-running after any
 * markup change". Re-running it by hand is the part that does not happen, so it
 * runs here instead.
 *
 * Deliberately permissive: it pools the ids from every HTML file rather than
 * checking each bundle against only the page that hosts it. A stricter check
 * would also catch app.js reaching for an about.html-only id, but it needs a
 * module-to-entry map that goes stale every time a file is added — and a test
 * that fails for the wrong reason gets deleted. Pooling still catches the case
 * that actually bites: an id that exists nowhere.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

const HTML = [
  'demo.html',
  'index.html',
  'static/about.html',
  'static/multivenue_template.html',
  'static/update.html',
];

/**
 * Ids that are referenced on purpose while absent, with the reason. Each was
 * confirmed in the #44 audit; anything else appearing here is a regression.
 */
const INTENTIONAL = new Map([
  ['micboard-version', 'legacy name, second in a || chain behind wirelessboard-version'],
  ['pco-back', 'legacy name, second in a || chain behind pco-close'],
  ['pco-credential-status', 'created on demand by ensurePcoCredentialStatusElement'],
]);

function markupIds() {
  const ids = new Set();
  for (const rel of HTML) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/id=["']([^"']+)["']/g)) ids.add(m[1]);
  }
  return ids;
}

function referencedIds() {
  const dir = path.join(ROOT, 'js');
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(js|mjs)$/.test(name) || name.endsWith('.test.mjs')) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      found.push({ id: m[1], where: `js/${name}:${src.slice(0, m.index).split('\n').length}` });
    }
  }
  return found;
}

test('every getElementById names an id that exists in some markup', () => {
  const ids = markupIds();
  const dead = referencedIds()
    .filter((r) => !ids.has(r.id) && !INTENTIONAL.has(r.id));

  assert.deepEqual(
    dead,
    [],
    `getElementById targets ids present in no HTML file:\n${
      dead.map((r) => `  ${r.id}  (${r.where})`).join('\n')
    }\nAdd the control to the markup, delete the dead code, or record it in INTENTIONAL with a reason.`,
  );
});

test('the intentional list has not gone stale', () => {
  // An entry that now exists in markup is no longer an exception, and leaving it
  // listed would hide a real dead id if the markup were removed again.
  const ids = markupIds();
  const stale = [...INTENTIONAL.keys()].filter((id) => ids.has(id));

  assert.deepEqual(
    stale,
    [],
    `these are in the markup now and should be dropped from INTENTIONAL: ${stale.join(', ')}`,
  );
});

test('every intentional exception is still referenced somewhere', () => {
  // Otherwise the list accumulates ids nobody looks up any more.
  const referenced = new Set(referencedIds().map((r) => r.id));
  const unused = [...INTENTIONAL.keys()].filter((id) => !referenced.has(id));

  assert.deepEqual(
    unused,
    [],
    `no code references these any more; drop them from INTENTIONAL: ${unused.join(', ')}`,
  );
});

test('the settings pane has the close control its handler expects', () => {
  // The specific gap #44 turned up: app.js has bound a handler for this since
  // the import, and the button was never in the markup, so the only way out of
  // this view was Escape -- which reloads the whole page.
  assert.ok(markupIds().has('close-settings-inline'));
});
