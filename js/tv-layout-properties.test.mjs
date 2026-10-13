/**
 * The TV layout, checked at the sizes televisions actually are (#173).
 *
 * ⛔ Four faults reached 2.0.0-beta.2 and were found by photographing a wall:
 * #169 #170 #171 #172. None of them needed a camera. `computeLayout` is a pure
 * function of a handful of numbers, and every one of those faults is visible in
 * its output — nobody had ever run it at 1920×1080.
 *
 * The reason nobody had is structural rather than careless: `updateTvLayoutMetrics`
 * calls this from inside `requestAnimationFrame`, which does not fire in either
 * browser available to this project's tooling, so TV mode could only ever be
 * checked in desk mode or by reasoning. This file is the replacement for the
 * browser nobody has.
 *
 * ⚠️ These are *properties*, not golden numbers. Asserting that a particular
 * screen gives a particular row height pins today's arithmetic and tells you
 * nothing about whether it is right. What follows are the things that have to
 * be true of a board on a wall at any size.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeLayout, BASE_HEIGHT, ARRANGEMENTS, CARD_SHAPES,
} from './board-layout.mjs';

/** Screens this actually runs on, plus the one in the venue. */
const SCREENS = [
  { name: '1080p television', width: 1920, height: 1080 },
  { name: '4K television', width: 3840, height: 2160 },
  { name: '768p panel', width: 1366, height: 768 },
  { name: 'tablet, landscape', width: 1180, height: 820 },
  { name: 'tablet, portrait', width: 820, height: 1180 },
];

const CHANNEL_COUNTS = [1, 4, 8, 12, 16, 24];
const COLUMN_CHOICES = ['auto', '4', '6', '8', '10', '12'];

/** Every combination an operator can actually select. */
function* everyBoard() {
  for (const screen of SCREENS) {
    for (const slotCount of CHANNEL_COUNTS) {
      for (const arrangement of ARRANGEMENTS) {
        for (const shape of CARD_SHAPES) {
          for (const columns of COLUMN_CHOICES) {
            yield {
              label: `${screen.name} · ${slotCount}ch · ${arrangement} · ${shape} · ${columns}`,
              screen,
              input: {
                slotCount,
                containerWidth: screen.width,
                availableHeight: screen.height,
                slotWidth: 420,
                gap: 6,
                arrangement,
                shape,
                columns,
              },
            };
          }
        }
      }
    }
  }
}

test('⛔ a board that fits the screen never reports that it scrolls', () => {
  // Property 1. On a wall nobody scrolls, so "scrolls" means "channels nobody
  // can see". The board may only claim it when it genuinely overflows.
  for (const { label, input } of everyBoard()) {
    const { boardHeight, scrolls } = computeLayout(input);
    const overflows = boardHeight > input.availableHeight + 0.5;
    assert.equal(scrolls, overflows, `${label}: scrolls=${scrolls} but board ${Math.round(boardHeight)} of ${input.availableHeight}`);
  }
});

test('⛔ the automatic card shape always fills the screen exactly and never overflows', () => {
  // Property 2. `auto` is the shape with no opinion of its own, so it has the
  // whole screen to work with and no excuse for leaving any of it — or for
  // taking more than there is, which is #171.
  for (const { label, input } of everyBoard()) {
    if (input.shape !== 'auto') continue;
    const { boardHeight } = computeLayout(input);
    assert.ok(
      Math.abs(boardHeight - input.availableHeight) < 1.5,
      `${label}: board ${Math.round(boardHeight)} of ${input.availableHeight} available`,
    );
  }
});

test('⛔⛔ the spacing scale follows both dimensions, exactly as the type does', () => {
  // Property 3, and the root cause of #169 and #172.
  //
  // `--tvmode-type-basis` is `min(rowHeight, cardWidth * 1.6)` — #81's rule,
  // that the type scale must follow every dimension the layout can vary. The
  // spacing scale is derived separately and must not disagree, because it is
  // what reserves room for the info drawer:
  //
  //     .elinfo11 .col-sm .mic_name { height: calc(100% - (var(--tvmode-scale) * 375px)) }
  //
  // Derived from row height alone, a tall narrow card reserves as though it
  // were a full-screen one and the drawer paints over the band.
  for (const { label, input } of everyBoard()) {
    const { scale, rowHeight, cardWidth } = computeLayout(input);
    const basis = Math.min(rowHeight, cardWidth * 1.6);
    assert.ok(
      Math.abs(scale - basis / BASE_HEIGHT) < 1e-6,
      `${label}: scale ${scale.toFixed(3)} ignores a ${Math.round(cardWidth)}×${Math.round(rowHeight)} card`
      + ` (should be ${(basis / BASE_HEIGHT).toFixed(3)})`,
    );
  }
});

test('⛔ a narrow card never reserves more for the drawer than the card is tall', () => {
  // The failure in #169 stated directly: whatever the scale, the space the
  // stylesheet takes away for the info drawer has to leave a card behind.
  const DRAWER_AT_FULL_SIZE = 375;
  for (const { label, input } of everyBoard()) {
    const { scale, rowHeight, cardWidth } = computeLayout(input);
    const reserved = scale * DRAWER_AT_FULL_SIZE;
    assert.ok(
      reserved < rowHeight * 0.6,
      `${label}: drawer reserves ${Math.round(reserved)}px of a ${Math.round(rowHeight)}px row`,
    );
    // ⛔ And the half that actually bit: a drawer sized for a full-screen card
    // inside a 155px-wide column. Its contents are sized from the type basis,
    // so the space it takes has to answer to the card's width as well.
    assert.ok(
      reserved < cardWidth * 0.8,
      `${label}: drawer reserves ${Math.round(reserved)}px inside a ${Math.round(cardWidth)}px-wide card`,
    );
  }
});

test('the column count never exceeds what the operator allowed', () => {
  for (const { label, input } of everyBoard()) {
    const ceiling = input.columns === 'auto' ? Infinity : Number(input.columns);
    const { columns } = computeLayout(input);
    assert.ok(columns <= ceiling, `${label}: ${columns} columns past a ceiling of ${ceiling}`);
    assert.ok(columns >= 1);
  }
});

test('the grid always has room for every channel', () => {
  // ⛔ A board that quietly shows eleven of twelve is the one failure this
  // display cannot afford.
  //
  // ⚠️ Only "has room for". A column ceiling legitimately makes the grid wider
  // than the channel count needs — six channels at Max 6 is 6×1 with no waste,
  // and eight is 6×2 with four empty cells, which is what a ceiling means.
  for (const { label, input } of everyBoard()) {
    const { columns, rows } = computeLayout(input);
    assert.ok(
      columns * rows >= input.slotCount,
      `${label}: ${columns}×${rows} cannot hold ${input.slotCount}`,
    );
    assert.ok(
      rows === Math.ceil(input.slotCount / columns),
      `${label}: ${rows} rows is not what ${input.slotCount} channels over ${columns} columns needs`,
    );
  }
});

test('⚠️ a fixed card shape may waste the screen, and the board says so', () => {
  // #170. A fixed aspect at a high column count is arithmetically correct and
  // practically unusable — 3:4 across twelve columns on a 1080p screen is a
  // 206px strip, 19% of the display. That is the operator's choice to make,
  // but the board has to be able to tell them, so the number has to be
  // available rather than implicit.
  const { boardHeight, scrolls } = computeLayout({
    slotCount: 12,
    containerWidth: 1920,
    availableHeight: 1080,
    slotWidth: 420,
    gap: 6,
    arrangement: 'row',
    shape: 'tall',
    columns: 'auto',
  });

  assert.ok(boardHeight / 1080 < 0.25, 'expected the strip this issue is about');
  assert.equal(scrolls, false, 'it wastes the screen rather than overflowing it');
});

test('⛔ a described screen never puts a column under the physical minimum', () => {
  // #170. The television hangs above the charging dock, so a column has to be
  // wide enough to point at the microphone underneath it. This is the property
  // that rule becomes: whatever the arrangement asks for, no column is ever
  // narrower than the dock position it stands above.
  //
  // ⚠️ Measured as *pitch* -- a column's share of the screen, centre to
  // centre -- because the gap between cards lives inside that share. A dock of
  // twelve 4in positions under a 48in picture is exactly twelve columns.
  const MIN = 180; // a 4.5in position on a 55in 1080p panel
  for (const { label, input } of everyBoard()) {
    const { columns } = computeLayout({ ...input, minColumnWidth: MIN });
    const pitch = input.containerWidth / columns;
    assert.ok(
      pitch >= MIN || columns === 1,
      `${label}: ${columns} columns gives a ${Math.round(pitch)}px pitch, under the ${MIN}px minimum`,
    );
  }
});

test('⛔ and an undescribed screen is left exactly as it was', () => {
  // A board that has never been measured must behave identically to one from
  // before any of this existed -- null is "no rule", not "a rule of zero".
  for (const { label, input } of everyBoard()) {
    const without = computeLayout(input);
    for (const nothing of [null, undefined, 0]) {
      const withNothing = computeLayout({ ...input, minColumnWidth: nothing });
      assert.deepEqual(withNothing, without, `${label}: minColumnWidth=${nothing} changed the layout`);
    }
  }
});

test('⭐ the minimum wraps the venue board instead of making slivers', () => {
  // The fault in the photographs: Side by side with no ceiling gave twelve
  // 155px columns. A 4.5in dock position is 180px on that screen, so the board
  // has to wrap rather than go narrower.
  const venue = {
    slotCount: 12,
    containerWidth: 1920,
    availableHeight: 1080,
    slotWidth: 420,
    gap: 6,
    arrangement: 'row',
    shape: 'auto',
    columns: 'auto',
  };

  const before = computeLayout(venue);
  const after = computeLayout({ ...venue, minColumnWidth: 180 });

  assert.deepEqual([before.columns, before.rows], [12, 1], 'the fault as photographed');
  assert.deepEqual([after.columns, after.rows], [10, 2], 'wrapped rather than narrowed');
  assert.ok(after.cardWidth > before.cardWidth);
  assert.equal(after.columnsLimitedByWidth, true, 'and says why, so a rule is not mistaken for a bug');
});

test('⭐ the 1080p television in the venue, every arrangement, twelve channels', () => {
  // The configurations in the photographs, so a change that moves any of them
  // has to be looked at deliberately.
  const at = (arrangement, columns, shape) => computeLayout({
    slotCount: 12,
    containerWidth: 1920,
    availableHeight: 1080,
    slotWidth: 420,
    gap: 6,
    arrangement,
    shape,
    columns,
  });

  // Fit and Grid both fill the screen with four across and three down.
  for (const arrangement of ['fit', 'grid']) {
    const r = at(arrangement, 'auto', 'auto');
    assert.deepEqual([r.columns, r.rows], [4, 3], `${arrangement} should be 4×3`);
    assert.ok(Math.abs(r.boardHeight - 1080) < 1.5);
  }

  // Side by side honours the ceiling and stays on the screen.
  const six = at('row', '6', 'auto');
  assert.deepEqual([six.columns, six.rows], [6, 2]);
  assert.ok(Math.abs(six.boardHeight - 1080) < 1.5);

  // ⛔ And the one that overflows: a fixed shape over four columns needs 1692px
  // of a 1080px screen. The board must report it so #113 can page instead.
  const overflow = at('fit', 'auto', 'tall');
  assert.ok(overflow.boardHeight > 1080, 'expected the overflow this is about');
  assert.equal(overflow.scrolls, true, 'and the board has to admit it');
});
