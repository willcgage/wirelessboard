/**
 * A column has to be as wide as the microphone it points at (#170).
 *
 * ⭐ The rule came from the maintainer looking at the wall: the television is
 * mounted above the charging dock, so a column corresponds to a dock position.
 * Narrower than that and it corresponds to nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pixelsPerInch, minColumnPixels, maxColumnsAtMinimum,
  normalizeScreens, screenById, screenChoices,
  minColumnPixelsForScreen, describeScreenChoice,
} from './display-geometry.mjs';

/** What an installation with two rooms would have configured. */
const SCREENS = [
  {
    id: 'wall', name: 'Auditorium wall', diagonal_inches: 55, min_column_inches: 4.5,
  },
  {
    id: 'youth', name: 'Youth room TV', diagonal_inches: 43, min_column_inches: 4.5,
  },
  { id: 'foh', name: 'FOH laptop', diagonal_inches: 15 },
];

/** The venue's screen. */
const VENUE = { widthPx: 1920, heightPx: 1080, diagonalInches: 55 };

test('pixels per inch comes off the diagonal, not the width', () => {
  // ⚠️ A panel is sold by its diagonal, and width alone would be wrong on
  // anything that is not exactly 16:9.
  const ppi = pixelsPerInch(VENUE);

  // sqrt(1920² + 1080²) = 2202.9 px across 55 inches.
  assert.ok(Math.abs(ppi - 40.05) < 0.01, `got ${ppi}`);
});

test('a bigger panel at the same resolution has fewer pixels per inch', () => {
  const small = pixelsPerInch({ ...VENUE, diagonalInches: 32 });
  const large = pixelsPerInch({ ...VENUE, diagonalInches: 75 });

  assert.ok(small > large);
  // And the same physical column costs more pixels on the denser screen.
  assert.ok(
    minColumnPixels({ ...VENUE, diagonalInches: 32, minColumnInches: 2 })
    > minColumnPixels({ ...VENUE, diagonalInches: 75, minColumnInches: 2 }),
  );
});

test('⛔ an undescribed screen has no minimum, not a minimum of zero', () => {
  // A board with nothing configured has to behave exactly as it did before.
  // Zero would be a floor every layout trivially clears; null is "no rule".
  assert.equal(pixelsPerInch({ widthPx: 1920, heightPx: 1080 }), null);
  assert.equal(minColumnPixels({ ...VENUE }), null, 'no column width given');
  assert.equal(minColumnPixels({ diagonalInches: 55, minColumnInches: 2 }), null, 'no resolution');
  assert.equal(minColumnPixels({}), null);
});

test('nonsense is refused rather than propagated', () => {
  for (const bad of [0, -55, 'big', null, undefined, NaN, Infinity]) {
    assert.equal(pixelsPerInch({ ...VENUE, diagonalInches: bad }), null, `diagonal ${bad}`);
    assert.equal(minColumnPixels({ ...VENUE, minColumnInches: bad }), null, `column ${bad}`);
  }
});

test('⭐ a two-inch dock position on the venue screen is about 80px', () => {
  const px = minColumnPixels({ ...VENUE, minColumnInches: 2 });

  assert.equal(px, 80);
});

test('⛔ and that is what stops twelve channels becoming twelve slivers', () => {
  // The fault in #170: Side by side with no ceiling gave 155px columns on this
  // screen. A dock position is wider than that, so the board must not offer it.
  const minimum = minColumnPixels({ ...VENUE, minColumnInches: 4 });
  const fits = maxColumnsAtMinimum({ containerWidth: 1920, minColumnWidth: minimum });

  assert.equal(minimum, 160);
  // ⭐ Exactly twelve, because the measurement is pitch. A dock of twelve 4in
  // positions under a 48in-wide picture *is* twelve columns; counting card
  // widths and adding the gaps on top would say eleven and break the alignment
  // the rule exists to create.
  assert.equal(fits, 12);
});

test('⛔ a wider dock position forces the board to wrap', () => {
  const minimum = minColumnPixels({ ...VENUE, minColumnInches: 5 });

  assert.equal(maxColumnsAtMinimum({ containerWidth: 1920, minColumnWidth: minimum }), 9);
});

test('the ceiling is how many fit, never how many to use', () => {
  // ⛔ A four-channel board does not grow to eleven columns because eleven fit.
  const fits = maxColumnsAtMinimum({ containerWidth: 1920, minColumnWidth: 160 });

  assert.ok(fits >= 1);
  assert.equal(
    maxColumnsAtMinimum({ containerWidth: 300, minColumnWidth: 400 }),
    1,
    'a screen narrower than one column still shows one',
  );
});

test('no minimum means no ceiling', () => {
  assert.equal(maxColumnsAtMinimum({ containerWidth: 1920, minColumnWidth: null }), null);
  assert.equal(maxColumnsAtMinimum({ containerWidth: 1920 }), null);
});

test('⭐ the same dock position is a different number of pixels on each screen', () => {
  // The reason one global setting could never have worked. A 4.5in column is
  // 180px on the 55in wall and 231px on the denser 43in panel beside it.
  const at = (screenId) => minColumnPixelsForScreen({
    screens: SCREENS, screenId, widthPx: 1920, heightPx: 1080,
  });

  assert.equal(at('wall'), 180);
  assert.equal(at('youth'), 231);
});

test('⛔ a device that has not been told which screen it is has no minimum', () => {
  // Which is exactly how every board behaved before any of this existed.
  const at = (screenId) => minColumnPixelsForScreen({
    screens: SCREENS, screenId, widthPx: 1920, heightPx: 1080,
  });

  assert.equal(at(''), null);
  assert.equal(at(undefined), null);
  assert.equal(at('a screen that was deleted'), null);
});

test('⛔ a screen with nothing underneath it imposes no minimum', () => {
  // The laptop at front of house is a real screen with a real size, and no
  // dock below it. Describing it must not invent a rule for it.
  assert.equal(
    minColumnPixelsForScreen({
      screens: SCREENS, screenId: 'foh', widthPx: 1920, heightPx: 1080,
    }),
    null,
  );
  // ⚠️ Wording changed with #203, deliberately: "no column minimum set" said
  // what the board was not doing, and "nothing underneath it" says why — which
  // is now the actual model. A screen's minimum comes from the furniture below
  // it, so a screen with none has nothing to take one from.
  assert.match(describeScreenChoice({
    screens: SCREENS, screenId: 'foh', widthPx: 1920, heightPx: 1080,
  }), /nothing underneath it/);
});

test('unusable screen entries are dropped rather than offered', () => {
  const cleaned = normalizeScreens([
    ...SCREENS,
    { name: 'no id', diagonal_inches: 50 },
    { id: 'nosize', name: 'no size' },
    { id: 'wall', name: 'duplicate id', diagonal_inches: 99 },
    null,
    'nonsense',
  ]);

  assert.deepEqual(cleaned.map((s) => s.id), ['wall', 'youth', 'foh']);
  assert.equal(cleaned[0].diagonal_inches, 55, 'the first definition wins, not the duplicate');
});

test('a screen with no name falls back to its id rather than showing blank', () => {
  assert.equal(normalizeScreens([{ id: 'wall', diagonal_inches: 55 }])[0].name, 'wall');
});

test('the picker offers "not set" first, and that is the default', () => {
  const choices = screenChoices(SCREENS);

  assert.equal(choices[0].value, '');
  assert.match(choices[0].label, /Not set/);
  assert.equal(choices.length, 4);
  // With nothing configured there is still a choice, and it is "no minimum".
  const none = screenChoices(null);
  assert.equal(none.length, 1);
  assert.equal(none[0].value, '');
});

test('screenById finds what the device picked, and nothing it did not', () => {
  assert.equal(screenById(SCREENS, 'youth').name, 'Youth room TV');
  assert.equal(screenById(SCREENS, 'gone'), null);
  assert.equal(screenById(SCREENS, ''), null);
  assert.equal(screenById(null, 'wall'), null);
});

test('the panel can say what the choice means on this screen', () => {
  const described = describeScreenChoice({
    screens: SCREENS, screenId: 'wall', widthPx: 1920, heightPx: 1080,
  });

  assert.match(described, /Auditorium wall/);
  assert.match(described, /180px/);
  assert.match(describeScreenChoice({ screens: SCREENS, screenId: '' }), /No minimum/);
});
