import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolvePref } from './view-prefs.mjs';

/**
 * B5: a view preference that is stored but not written to the URL is lost.
 *
 * From the venue, on 2.0.0-beta.6:
 *
 *   "No, when I selected Pocket, then reloaded, it went to Board. Then when I
 *    set it to Rack and reloaded, it went to board."
 *
 * ⭐ **Board twice is the tell.** Board is not the fallback -- Rack is -- so
 * nothing was falling back. Something was actively choosing Board.
 *
 * The hash carries the display mode as `tvmode=<drawer>` and its *presence* is
 * the opinion: a Board writes the parameter, a Rack or Pocket board writes
 * nothing, and an absent parameter means "no opinion" so the stored value
 * stands. `setDisplayMode` wrote the stored value and never updated the hash,
 * so leaving Board left a stale `tvmode=` behind to overrule it next load.
 *
 * Two kinds of test here: the precedence rule itself, and a source guard that
 * no setter can store a preference without also writing the URL.
 */

const DISPLAY = readFileSync(new URL('./display.js', import.meta.url), 'utf8');

/**
 * The source of ONE exported function, and nothing else.
 *
 * ⛔ Slicing from one function's name to the *next function I happened to
 * think of* spans everything in between. The first version of this took
 * `setDisplayMode` .. `setInfoDrawer` -- some 340 lines holding three other
 * functions that call `updateHash()` -- so the guard passed on the very bug it
 * was written for. Splitting on the export keyword is what actually isolates
 * one body.
 */
const EXPORT_MARKER = '\nexport function ';

function exported(name) {
  const part = DISPLAY.split(EXPORT_MARKER).slice(1)
    .find((p) => p.startsWith(`${name}(`));
  if (!part) throw new Error(`no exported function ${name} in display.js`);
  return part;
}

const isDisplayMode = (v) => ['deskmode', 'tvmode', 'pocketmode'].includes(v);

function resolveMode({ hashHasTvmode, stored }) {
  // Exactly the call `app.js` makes.
  return resolvePref({
    hashValue: hashHasTvmode ? 'tvmode' : undefined,
    storage: {
      getItem: () => stored ?? null,
      setItem: () => {},
    },
    key: 'displayMode',
    isValid: isDisplayMode,
    fallback: 'deskmode',
  });
}

test('⛔ the venue case: a stale tvmode in the URL overrules a stored Pocket', () => {
  // This is the bug, stated as the rule that produced it. The precedence is
  // correct and deliberate -- a link that names a mode must win -- so the fix
  // is never to weaken it, it is to stop leaving the parameter behind.
  assert.equal(resolveMode({ hashHasTvmode: true, stored: 'pocketmode' }), 'tvmode');
  assert.equal(resolveMode({ hashHasTvmode: true, stored: 'deskmode' }), 'tvmode');
});

test('⭐ with the parameter gone, the stored mode is what comes back', () => {
  // Which is the whole of B5: "it comes back in the mode you left it in".
  assert.equal(resolveMode({ hashHasTvmode: false, stored: 'pocketmode' }), 'pocketmode');
  assert.equal(resolveMode({ hashHasTvmode: false, stored: 'deskmode' }), 'deskmode');
  assert.equal(resolveMode({ hashHasTvmode: false, stored: 'tvmode' }), 'tvmode');
});

test('a board that has never been told anything opens as Rack', () => {
  // ⛔ Rack is the default by decision (#233). Board twice in the venue report
  // could therefore never have been a fallback.
  assert.equal(resolveMode({ hashHasTvmode: false, stored: null }), 'deskmode');
  assert.equal(resolveMode({ hashHasTvmode: false, stored: 'nonsense' }), 'deskmode');
});

test('⛔ setDisplayMode writes the URL as well as the store', () => {
  // The defect in one line: it was the only view setter that stored a
  // preference without writing it to the hash, and the two then disagreed.
  const body = exported('setDisplayMode');
  assert.ok(body.includes('writePref('), 'it stores the choice');
  assert.ok(body.includes('updateHash()'), 'and it must also write the URL');
});

test('⚠️ a mode the operator did not choose touches neither record', () => {
  // The slot-name editor forces Rack because two text fields per card cannot
  // be typed into from across a room. That is the editor's need, not an
  // opinion about this screen -- so `remember: false` must keep BOTH the
  // stored value and the hash, or a board power-cut mid-edit comes back wrong.
  const body = exported('setDisplayMode');
  const guarded = body.slice(body.indexOf('if (remember) {'));
  assert.ok(
    guarded.includes('updateHash()'),
    'the hash write is inside the remember guard, like the stored write',
  );
});

test('⛔ no view setter stores a preference without writing the URL', () => {
  // The general shape of B5, so the next preference added cannot repeat it.
  // Every exported setter in display.js that calls `writePref` must also call
  // `updateHash` -- otherwise the two records of the same choice can diverge
  // and whichever the URL says wins on the next load.
  const offenders = [];
  const parts = DISPLAY.split(/\nexport function /).slice(1);

  parts.forEach((part) => {
    const name = part.slice(0, part.indexOf('('));
    if (!part.includes('writePref(')) return;
    if (!part.includes('updateHash()')) offenders.push(name);
  });

  assert.deepEqual(offenders, [], `these store a preference the URL never hears about: ${offenders}`);
});

test('the guard above can actually see a violation', () => {
  // ⛔ Plant it. A source guard that has only ever run against correct code is
  // worth nothing -- two of these have passed on everything before.
  const broken = `
export function setSomething(value, { remember = true } = {}) {
  if (remember) {
    writePref({ storage: safeStorage(), key: 'k', value });
  }
}

export function setOther(value) {
  writePref({ storage: safeStorage(), key: 'j', value });
  updateHash();
}
`;
  const offenders = [];
  broken.split(/\nexport function /).slice(1).forEach((part) => {
    const name = part.slice(0, part.indexOf('('));
    if (!part.includes('writePref(')) return;
    if (!part.includes('updateHash()')) offenders.push(name);
  });

  assert.deepEqual(offenders, ['setSomething'], 'the guard must name the one that forgot');
});
