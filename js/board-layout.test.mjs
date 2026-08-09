import test from 'node:test';
import assert from 'node:assert/strict';

import {
  columnsFor, rowHeightFor, computeLayout, nextOption,
  isOrientation, isAspect, ORIENTATIONS, ASPECTS,
} from './board-layout.mjs';

// A wide screen where twelve 420px slots would all fit across, which is what
// makes auto and the shaped orientations visibly different.
const WIDE = { slotCount: 12, maxColumns: 12 };

test('auto fills the width, as the board always has', () => {
  assert.equal(columnsFor({ ...WIDE, orientation: 'auto' }), 12);
});

test('landscape gives a grid no taller than it is wide', () => {
  const c = columnsFor({ ...WIDE, orientation: 'landscape' });
  const rows = Math.ceil(12 / c);
  assert.equal(c, 4);
  assert.equal(rows, 3);
  assert.ok(c >= rows, 'columns should be at least rows');
});

test('portrait gives a grid strictly taller than it is wide', () => {
  const c = columnsFor({ ...WIDE, orientation: 'portrait' });
  const rows = Math.ceil(12 / c);
  assert.equal(c, 3);
  assert.equal(rows, 4);
  assert.ok(rows > c, 'rows should exceed columns');
});

test('the shaped orientations stay on their side of square across counts', () => {
  for (let n = 2; n <= 40; n += 1) {
    const wide = columnsFor({ slotCount: n, maxColumns: 999, orientation: 'landscape' });
    assert.ok(wide >= Math.ceil(n / wide), `landscape n=${n} produced a tall grid`);

    const tall = columnsFor({ slotCount: n, maxColumns: 999, orientation: 'portrait' });
    assert.ok(Math.ceil(n / tall) > tall, `portrait n=${n} was not taller than wide`);
  }
});

test('a single slot is a single column whatever the orientation', () => {
  ORIENTATIONS.forEach((orientation) => {
    assert.equal(columnsFor({ slotCount: 1, maxColumns: 9, orientation }), 1);
  });
});

test('no orientation asks for more columns than physically fit', () => {
  // A narrow or rotated screen wins the argument.
  ORIENTATIONS.forEach((orientation) => {
    assert.equal(columnsFor({ slotCount: 12, maxColumns: 2, orientation }), 2);
  });
});

test('auto row height divides the space so every row is on screen', () => {
  // 3 rows, 1000px, 10px gaps -> (1000 - 20) / 3
  assert.equal(rowHeightFor({
    aspect: 'auto', slotWidth: 420, rows: 3, availableHeight: 1000, gap: 10,
  }), 326.6666666666667);
});

test('a named aspect derives height from the slot width, ignoring the space', () => {
  assert.equal(rowHeightFor({
    aspect: 'landscape', slotWidth: 1600, rows: 4, availableHeight: 100,
  }), 900);
  assert.equal(rowHeightFor({
    aspect: 'portrait', slotWidth: 300, rows: 4, availableHeight: 100,
  }), 400);
});

test('a degenerate measurement does not collapse the board', () => {
  // A hidden container reports 0 height; dividing it would give rows no height
  // at all and the board would vanish rather than merely look wrong.
  const h = rowHeightFor({
    aspect: 'auto', slotWidth: 480, rows: 4, availableHeight: 0, gap: 6,
  });
  assert.ok(h > 0, 'expected a positive fallback height');
});

test('auto never reports scrolling: it is fit-to-page by construction', () => {
  const out = computeLayout({
    slotCount: 24, containerWidth: 1920, availableHeight: 1080, slotWidth: 420, gap: 6,
  });
  assert.equal(out.scrolls, false);
  assert.ok(out.boardHeight <= 1080 + 0.5);
});

test('a fixed aspect reports scrolling when the cards no longer fit', () => {
  const out = computeLayout({
    slotCount: 24,
    containerWidth: 1920,
    availableHeight: 1080,
    slotWidth: 420,
    gap: 6,
    aspect: 'portrait',
    orientation: 'portrait',
  });
  assert.equal(out.rowHeight, 560);
  assert.ok(out.scrolls, 'portrait cards at this count should overflow');
});

test('computeLayout defaults reproduce the old fit-to-page numbers', () => {
  // 1920 wide fits four 420px slots; 12 slots therefore make a 4x3 grid whose
  // rows divide the height. This is the behaviour before the setting existed.
  const out = computeLayout({
    slotCount: 12, containerWidth: 1920, availableHeight: 1080, slotWidth: 420, gap: 6,
  });
  assert.equal(out.columns, 4);
  assert.equal(out.rows, 3);
  assert.equal(out.rowHeight, (1080 - 12) / 3);
  assert.equal(out.scale, out.rowHeight / 1080);
});

test('nextOption cycles and wraps', () => {
  assert.equal(nextOption(ORIENTATIONS, 'auto'), 'landscape');
  assert.equal(nextOption(ORIENTATIONS, 'landscape'), 'portrait');
  assert.equal(nextOption(ORIENTATIONS, 'portrait'), 'auto');
  // An unrecognised current value starts the cycle rather than sticking.
  assert.equal(nextOption(ORIENTATIONS, 'sideways'), 'auto');
  assert.equal(nextOption([], 'auto'), 'auto');
});

test('the validators accept exactly the supported values', () => {
  assert.deepEqual(ORIENTATIONS, ['auto', 'landscape', 'portrait']);
  assert.deepEqual(ASPECTS, ['auto', 'landscape', 'portrait']);
  assert.equal(isOrientation('portrait'), true);
  assert.equal(isOrientation('sideways'), false);
  assert.equal(isAspect('landscape'), true);
  assert.equal(isAspect(undefined), false);
});
