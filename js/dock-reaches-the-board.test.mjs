import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { columnsFor, computeLayout } from './board-layout.mjs';
import { minColumnPixelsForScreen } from './display-geometry.mjs';

/**
 * The dock has to actually reach the board.
 *
 * ⛔⛔ It never did. `minColumnPixelsForScreen` takes `docks = []` by default
 * and `tv-layout.js` called it without them, so the width came from the legacy
 * `min_column_inches` on the screen row or from nothing — and the dock a
 * screen names reached the layout **never**.
 *
 * That is the whole of "#170/#201 has shipped three times and engaged zero
 * times on hardware". Not the save, not the screen description, not the
 * NameError: one omitted argument. Everything downstream was built, tested and
 * correct, and was handed an empty list every time.
 *
 * ⭐ The lesson worth keeping: a defaulted parameter turns a missing argument
 * into a plausible answer. `docks = []` reads as "no docks described", which
 * is a real state, so nothing anywhere looked wrong.
 */

const SCREENS = [{
  id: 'green', name: 'Green Room Screen', diagonal_inches: 55, dock_ids: ['run'],
}];
const DOCKS = [{
  id: 'run', name: 'Green Room run', kind: 'charging', position_inches: 3.9, positions: 11,
}];

test('⛔⛔ the dock is what sets the floor, and it must be passed to get it', () => {
  const args = {
    screens: SCREENS, screenId: 'green', widthPx: 1920, heightPx: 1080,
  };

  // How it was called: no docks, so no floor at all.
  assert.equal(
    minColumnPixelsForScreen(args),
    null,
    'omitting the docks gives null — which reads as "nothing underneath"',
  );

  // How it is called now.
  const px = minColumnPixelsForScreen({ ...args, docks: DOCKS });
  assert.ok(px > 0, 'with the docks passed there is a floor');
});

test('⛔ the board passes them', () => {
  // The call site itself, because every test above it passed for years while
  // this one argument was missing.
  const layout = fs.readFileSync(path.join(import.meta.dirname, 'tv-layout.js'), 'utf8');

  assert.match(layout, /micboard\.config\.docks/, 'tv-layout reads the docks');
  assert.match(layout, /dockPositionsForScreen\(/, 'and asks how many places there are');
  assert.match(layout, /dockPositions,/, 'and hands the count to the layout');

  // ⚠️ `docks` must be inside the object given to `minColumnPixelsForScreen`,
  // not merely present in the file.
  const call = layout.slice(
    layout.indexOf('minColumnPixelsForScreen({'),
    layout.indexOf('});', layout.indexOf('minColumnPixelsForScreen({')),
  );
  assert.ok(
    call.includes('forScreen') || call.includes('docks'),
    'the docks reach the call, not just the module',
  );
});

test('⭐ the count is the dock\'s, which this file has claimed since #201', () => {
  const base = {
    maxColumns: 12, arrangement: 'fit', columns: 'auto', maxColumnsAtMinimum: 12,
  };

  // Eight channels under eleven places draws eleven columns. Before this it
  // drew eight, which lined up with nothing.
  assert.equal(columnsFor({ ...base, slotCount: 8, dockPositions: 11 }), 11);
  assert.equal(columnsFor({ ...base, slotCount: 12, dockPositions: 11 }), 11);
});

test('⛔ an absent count changes nothing at all', () => {
  const base = {
    maxColumns: 12, arrangement: 'fit', columns: 'auto', maxColumnsAtMinimum: 12,
  };
  // ⛔ `toCount(null)` is **1** — its fallback — so using it here would have
  // given every board without a described dock a single column. The same
  // shape as `Number(null)` being 0, which cost a phantom channel in #243.
  [null, undefined, 0, -3, 'eleven', NaN, false].forEach((value) => {
    assert.equal(
      columnsFor({ ...base, slotCount: 8, dockPositions: value }),
      8,
      `${JSON.stringify(value)} must read as "no opinion"`,
    );
  });
});

test('⚠️ the operator\'s ceiling and the width floor still bind it', () => {
  const base = {
    maxColumns: 12, arrangement: 'fit', slotCount: 8, dockPositions: 11,
  };

  // A preference they stated.
  assert.equal(columnsFor({ ...base, columns: '6', maxColumnsAtMinimum: 12 }), 6);
  // And physics: eleven places on a screen that fits eight of them is eight,
  // because the other three cannot be pointed at.
  assert.equal(columnsFor({ ...base, columns: 'auto', maxColumnsAtMinimum: 8 }), 8);
});

test('Stacked is one column whatever is underneath it', () => {
  assert.equal(columnsFor({
    slotCount: 8, maxColumns: 12, arrangement: 'column', columns: 'auto', dockPositions: 11,
  }), 1);
});

test('the whole layout carries it through', () => {
  const without = computeLayout({
    slotCount: 8, containerWidth: 1920, availableHeight: 1080, slotWidth: 420,
  });
  const with_ = computeLayout({
    slotCount: 8,
    containerWidth: 1920,
    availableHeight: 1080,
    slotWidth: 420,
    dockPositions: 11,
    minColumnWidth: 150,
  });

  assert.equal(without.columns, 4, 'eight channels on a 1920px board, as before');
  assert.equal(with_.columns, 11, 'eleven places means eleven columns');
  assert.ok(with_.capacity >= 11, 'and a screenful holds at least that many');
});

/**
 * ⛔⛔ And the gear's note, which is where an operator LOOKS to check.
 *
 * `describeScreenChoice` takes the same `docks = []` default, and the view
 * panel called it without them too — so the one line that says whether the
 * chain is working reported "nothing underneath it" about a screen with a
 * dock described. The most misleading thing it could possibly have said, on
 * the surface built to confirm the thing that has never worked.
 */
test('⛔⛔ the gear note names the dock rather than denying it', async () => {
  const { describeScreenChoice } = await import('./display-geometry.mjs');
  const args = {
    screens: [{
      id: 'green', name: 'Green Room Screen', diagonal_inches: 55, dock_ids: ['run'],
    }],
    screenId: 'green',
    widthPx: 1920,
    heightPx: 1080,
  };

  assert.match(
    describeScreenChoice(args),
    /nothing underneath/,
    'without the docks it denies the dock — this is what the panel used to show',
  );

  const told = describeScreenChoice({ ...args, docks: DOCKS });
  assert.match(told, /Green Room run/, 'with them it names the dock');
  assert.doesNotMatch(told, /nothing underneath/);
});

test('⛔ the view panel passes them', async () => {
  const panel = fs.readFileSync(path.join(import.meta.dirname, 'view-panel.js'), 'utf8');
  const app = fs.readFileSync(path.join(import.meta.dirname, 'app.js'), 'utf8');

  const call = panel.slice(
    panel.indexOf('describeScreenChoice({'),
    panel.indexOf('});', panel.indexOf('describeScreenChoice({')),
  );
  assert.match(call, /docks: board\.getDocks\(\)/, 'the note is given the docks');
  assert.match(
    app,
    /getDocks: \(\) => \(micboard\.config && micboard\.config\.docks\)/,
    'and the board can supply them',
  );
});
