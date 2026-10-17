import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { pairedSaveSummary, saveCounts } from './editor-rows.mjs';
import { saveCounts as screenCounts } from './screens-editor.mjs';
import { saveCounts as dockCounts } from './dock-editor.mjs';

/**
 * One Save button, two lists, one sentence that speaks for both (A2).
 *
 * From the beta.6 field test:
 *
 *   "I had to give the Dock a name before it would save. There is no Save
 *    Dock button; it is only a Save Screens and Docks button."
 *
 * ⛔ The combined button is deliberate and stays: a screen names the dock
 * beneath it, and two saves leave a window where a screen points at something
 * that does not exist yet. The fault is that only the SCREENS were ever
 * summarised. A dock with no name was dropped from the payload and the line
 * underneath talked about screens — so the requirement was real, enforced, and
 * never said out loud. The operator worked it out.
 *
 * ⭐ `dock-editor.mjs` had a `saveSummary` of its own the whole time. Nothing
 * imported it. Another function built and never reached, which is the shape
 * #243 was.
 */

const SCREENS = { one: 'screen', many: 'screens' };
const DOCKS = { one: 'dock', many: 'docks' };
const NOTHING = { nothing: 'Nothing described. Boards will have no minimum column width.' };

const say = (screens, docks) => pairedSaveSummary(
  [{ ...screens, ...SCREENS }, { ...docks, ...DOCKS }],
  NOTHING,
);

test('both lists saved reads as one sentence', () => {
  assert.equal(
    say({ saved: 2, incomplete: 0 }, { saved: 1, incomplete: 0 }),
    '2 screens and 1 dock saved.',
  );
});

test('⛔ a dock held back is attributed to the docks', () => {
  // The whole point. "1 incomplete row is still here" over two lists does not
  // say which list to go and look at.
  const line = say({ saved: 2, incomplete: 0 }, { saved: 0, incomplete: 1 });
  assert.match(line, /1 dock incomplete/);
  assert.doesNotMatch(line, /screens? incomplete/);
});

test('strays in both lists are named separately', () => {
  assert.equal(
    say({ saved: 1, incomplete: 1 }, { saved: 1, incomplete: 2 }),
    '1 screen and 1 dock saved. 1 screen and 2 docks incomplete — the rows are still here to finish.',
  );
});

test('a list with nothing in it is left out rather than reported as zero', () => {
  assert.equal(say({ saved: 0, incomplete: 0 }, { saved: 3, incomplete: 0 }), '3 docks saved.');
  assert.equal(say({ saved: 2, incomplete: 0 }, { saved: 0, incomplete: 0 }), '2 screens saved.');
});

test('⚠️ it says the rows are STILL HERE', () => {
  // Until #180 they were not — the sentence and the deletion together were the
  // fault, and the wording is the half that survived it.
  assert.match(say({ saved: 1, incomplete: 0 }, { saved: 0, incomplete: 1 }), /still here to finish/);
});

test('nothing described at all says what that means', () => {
  assert.equal(say({ saved: 0, incomplete: 0 }, { saved: 0, incomplete: 0 }), NOTHING.nothing);
  assert.equal(pairedSaveSummary([], NOTHING), NOTHING.nothing);
  assert.equal(pairedSaveSummary(null, NOTHING), NOTHING.nothing);
});

test('the counts come from the real editors', () => {
  // ⚠️ Through the editors rather than hand-built objects, so the sentence is
  // wired to the same rules that decide what actually gets sent.
  const wall = { name: 'Auditorium wall', diagonal_inches: 55 };
  const dock = { name: 'Green Room run', position_inches: 3.9, positions: 11 };

  assert.deepEqual(screenCounts([wall, { name: 'Half typed' }]), { saved: 1, incomplete: 1 });
  // ⛔ A dock with no name is exactly A2.
  assert.deepEqual(dockCounts([dock, { position_inches: 3.9 }]), { saved: 1, incomplete: 1 });

  assert.equal(
    say(screenCounts([wall]), dockCounts([dock, { position_inches: 3.9 }])),
    '1 screen and 1 dock saved. 1 dock incomplete — the row is still here to finish.',
  );
});

test('⛔ the save actually uses it', () => {
  // The previous version of this feature existed and nothing called it. A
  // sentence nothing prints is the same bug as a dock nothing saves.
  const config = fs.readFileSync(path.join(import.meta.dirname, 'config.js'), 'utf8');
  assert.match(config, /pairedSaveSummary\(/, 'config.js builds the combined summary');
  assert.match(config, /screensSaveCounts\(screenRows\)/);
  assert.match(config, /docksSaveCounts\(dockRows\)/);

  // And neither editor still carries a sentence of its own for nobody to read.
  const screens = fs.readFileSync(path.join(import.meta.dirname, 'screens-editor.mjs'), 'utf8');
  const docks = fs.readFileSync(path.join(import.meta.dirname, 'dock-editor.mjs'), 'utf8');
  assert.ok(!screens.includes('export function saveSummary'));
  assert.ok(!docks.includes('export function saveSummary'));
});

test('saveCounts is the same arithmetic for any list', () => {
  const spec = { problem: (r) => (r && r.ok ? null : 'no'), entry: (r) => ({ ...r }) };
  assert.deepEqual(saveCounts([{ ok: true }, {}, { ok: true }], spec), { saved: 2, incomplete: 1 });
  assert.deepEqual(saveCounts([], spec), { saved: 0, incomplete: 0 });
  assert.deepEqual(saveCounts(null, spec), { saved: 0, incomplete: 0 });
});
