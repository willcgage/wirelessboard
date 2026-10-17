import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CROP, aspectMismatch, photoScale, visibleFraction, blurRadius,
} from './photo-fit.mjs';

/**
 * The venue's real numbers, so these fail against the board rather than against
 * an idea of it:
 *
 *   33 of 38 background photographs are 1920x1080 landscape.
 *   One row of twelve  -> photo box 160 x 861   (what the dock rule produces)
 *   Two rows of six    -> photo box 320 x 341
 */
const SHOT = [1920, 1080];
const ONE_ROW = [160, 861];
const SIX_COL = [320, 341];
const CASIE = [1305, 1637];     // the one portrait shot in the set

test('⛔ the fault, stated as a number: cover shows 10% of the picture', () => {
  const seen = visibleFraction(...SHOT, ...ONE_ROW, 1);
  assert.ok(seen < 0.11, `cover shows ${(seen * 100).toFixed(1)}% of the width`);
});

test('⭐⭐ the cap holds the SAME promise on both cards', () => {
  // This is the whole reason the model is a cap and not a blend. The two cards
  // disagree with a 16:9 photo by 9.6x and 1.9x respectively; a fixed fraction
  // of the way to cover gave 21% on one and 71% on the other.
  const wide = visibleFraction(...SHOT, ...ONE_ROW);
  const square = visibleFraction(...SHOT, ...SIX_COL);
  assert.ok(Math.abs(wide - square) < 0.001,
    `one row ${(wide * 100).toFixed(1)}% vs six col ${(square * 100).toFixed(1)}%`);
  assert.ok(Math.abs(wide - (1 - MAX_CROP)) < 0.001, 'and it is exactly 1 - MAX_CROP');
});

test('⭐ nothing is cropped at all when the cap is zero', () => {
  for (const box of [ONE_ROW, SIX_COL, [500, 500], [1920, 200]]) {
    assert.equal(photoScale(...SHOT, ...box, 0), 1);
    assert.equal(visibleFraction(...SHOT, ...box, 0), 1);
  }
});

test('a cap of 1 is exactly cover — the old behaviour is still reachable', () => {
  const m = aspectMismatch(...SHOT, ...ONE_ROW);
  assert.equal(photoScale(...SHOT, ...ONE_ROW, 1), m);
});

test('⭐ a photo already the card\'s shape fills it, with no blur earned', () => {
  // The cap is never *reached*, so the result is plain `cover` and the filler
  // is covered over completely. The treatment only appears where it is needed.
  const scale = photoScale(...CASIE, ...SIX_COL);
  const cover = aspectMismatch(...CASIE, ...SIX_COL);
  assert.equal(scale, cover, 'a near-matching photo still goes full bleed');
  assert.ok(scale < 1 / (1 - MAX_CROP), 'it never reaches the cap');
  assert.equal(photoScale(1000, 1000, 500, 500), 1, 'identical shapes: no scaling');
});

test('⛔⛔ nothing is EVER cropped harder than it is today', () => {
  // The fault a fixed `scale(1.45)` would have introduced: pictures that were
  // fine get cropped worse than before — the exact complaint, reintroduced on
  // the photographs that had no problem.
  for (const img of [SHOT, CASIE, [1080, 1620], [476, 504], [2808, 2954], [1000, 1000]]) {
    for (const box of [ONE_ROW, SIX_COL, [480, 167], [300, 300]]) {
      const s = photoScale(...img, ...box);
      assert.ok(s >= 1, 'never smaller than contain');
      assert.ok(s <= aspectMismatch(...img, ...box) + 1e-9,
        `${img} in ${box}: ${s} is past cover`);
    }
  }
});

test('⚠️ nonsense in, no scaling out — never NaN into a transform', () => {
  // `transform: scale(NaN)` is invalid, so the browser drops the declaration
  // and silently restores the old crop. A fallback of 1 is visible instead.
  for (const bad of [[0, 100], [100, 0], [NaN, 100], [null, 100], ['', 100]]) {
    assert.equal(photoScale(...bad, 320, 341), 1);
    assert.equal(aspectMismatch(...bad, 320, 341), null);
  }
  assert.equal(photoScale(...SHOT, 0, 0), 1);
  assert.equal(photoScale(...SHOT, ...SIX_COL, -5), 1, 'a negative cap crops nothing');
  assert.equal(photoScale(...SHOT, ...SIX_COL, 99),
    aspectMismatch(...SHOT, ...SIX_COL), 'a cap past 1 is still only cover');
  assert.ok(Number.isFinite(photoScale(...SHOT, ...SIX_COL, NaN)));
});

test('the blur follows the card size and stays in bounds', () => {
  assert.ok(blurRadius(...SIX_COL) > blurRadius(...ONE_ROW),
    'a wider card gets a softer wash');
  for (const box of [[1, 1], [10000, 10000], [0, 0], [NaN, NaN]]) {
    const r = blurRadius(...box);
    assert.ok(Number.isFinite(r) && r >= 6 && r <= 48, `blur ${r} out of bounds`);
  }
});
