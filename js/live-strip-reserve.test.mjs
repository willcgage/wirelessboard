import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';

import { reservedStripHeight, PLACEMENTS } from './live-strip.mjs';

/**
 * ⛔⛔ The fault this pins, reported from the wall:
 *
 *   "when the service bar is on the bottom, it overlaps the information
 *    on the cards"
 *
 * `.live-strip.live-at-bottom` is `position: fixed; bottom: 0` at z-index 1020.
 * The only thing making room for it was `padding-bottom: 2.25rem` on the board,
 * which `tv-layout.js` never subtracted — so the rows were computed for the
 * full screen height and the last one ran on under the strip.
 */

test('⛔ top and bottom take height off the board', () => {
  assert.equal(reservedStripHeight('bottom', 44), 44);
  assert.equal(reservedStripHeight('top', 44), 44);
});

test('⛔⛔ `card` takes NO height — it claims a grid cell instead', () => {
  // Reserving height as well would take the space twice: `cellsForChannels`
  // already gives the strip a cell when the placement is `card`.
  assert.equal(reservedStripHeight('card', 44), 0);
});

test('`off` reserves nothing', () => {
  assert.equal(reservedStripHeight('off', 44), 0);
});

test('⚠️ an unmeasurable strip reserves nothing rather than NaN', () => {
  // `offsetHeight` is 0 for a hidden strip and the element may not exist at
  // all. Either way the board keeps its full height; a NaN here would poison
  // `availableHeight` and collapse the layout.
  for (const bad of [0, -5, NaN, null, undefined, '', 'tall', Infinity]) {
    const out = reservedStripHeight('bottom', bad);
    assert.ok(Number.isFinite(out) && out >= 0, `${bad} gave ${out}`);
    assert.equal(out, 0);
  }
});

test('every placement in the vocabulary is answered', () => {
  // A new placement must decide whether it costs height, rather than silently
  // defaulting to one of the answers.
  for (const spot of PLACEMENTS) {
    const out = reservedStripHeight(spot, 44);
    assert.ok(out === 0 || out === 44, `${spot} gave ${out}`);
  }
  // An unknown value falls back to the default placement, which is `bottom`.
  assert.equal(reservedStripHeight('nonsense', 44), 44);
});

test('⛔⛔ the id tv-layout measures is the id live-strip-view creates', () => {
  // The two files name the strip independently: one creates it, the other
  // looks it up to reserve its height. If they drift, `getElementById` returns
  // null, the reserve silently becomes 0, and the overlap comes back with
  // nothing failing — the quietest possible regression.
  const root = path.join(import.meta.dirname, '..');
  const view = fs.readFileSync(path.join(root, 'js', 'live-strip-view.js'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'js', 'tv-layout.js'), 'utf8');

  const created = view.match(/const STRIP_ID = '([^']+)'/);
  assert.ok(created, 'live-strip-view.js still declares STRIP_ID');
  assert.ok(
    layout.includes(`getElementById('${created[1]}')`),
    `tv-layout.js must look up '${created[1]}', the id live-strip-view creates`,
  );
});
