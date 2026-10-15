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

test('no channel is ever lost: a board either holds them all or says it pages', () => {
  // ⛔ A board that quietly shows eleven of twelve is the one failure this
  // display cannot afford. That rule has not moved -- what changed is how it is
  // kept.
  //
  // ⚠️ This used to assert `columns * rows >= slotCount`: every channel on the
  // screen at once, always. A named card shape cannot honour that -- twelve 3:4
  // cards need 1692px of a 1080px screen -- so the board used to overflow and
  // cut the last row off (#171). It now draws the rows that fit and pages the
  // rest (#201/#202), so the guarantee is the same promise by a different
  // route: **shown now, or on a page that exists.**
  for (const { label, input } of everyBoard()) {
    const {
      columns, rows, capacity, pages,
    } = computeLayout(input);

    assert.equal(
      capacity,
      columns * rows,
      `${label}: capacity ${capacity} should be ${columns}×${rows}`,
    );
    assert.ok(capacity >= 1, `${label}: a board has to hold at least one channel`);

    // The whole rule, in one line: it fits, or the board admits it pages.
    assert.ok(
      capacity >= input.slotCount || pages === true,
      `${label}: ${columns}×${rows} holds ${capacity} of ${input.slotCount} and does not say it pages`,
    );

    // ⛔ And never the other way round: a board that fits must not claim to page,
    // or it would rotate for no reason and look broken.
    if (capacity >= input.slotCount) {
      assert.equal(pages, false, `${label}: fits ${input.slotCount} but claims to page`);
    }

    // Rows are what the channels need, unless the screen could not take them.
    assert.ok(
      rows <= Math.ceil(input.slotCount / columns),
      `${label}: ${rows} rows is more than ${input.slotCount} channels need`,
    );
  }
});

/**
 * ⭐ #185. This test used to assert the defect — "expected the strip this issue
 * is about" — because at the time the board could only describe the waste, not
 * avoid it. Twelve 16:9 cards side by side on a 1080p screen were 155×87 and
 * filled **8% of the display**, which is what was photographed on the wall.
 *
 * The maintainer's call: **the photo size wins when it is specified.** So a
 * named shape now reduces the column count until the board fills the height.
 * The columns control is a *ceiling* ("Max 8"), so coming in under it is what
 * it already promises; the shape is a statement that cannot be partly honoured.
 */
test('⭐ a named card shape never overflows, and pages what it cannot show', () => {
  // ⚠️ This test has been rewritten twice and the reason matters both times.
  //
  // It first asserted the defect -- a 155x87 strip over 8% of the screen -- then
  // #185 made the column count give way so a shaped board *filled* the height,
  // and it asserted `used > 0.6`.
  //
  // ⛔ Filling is no longer always reachable, and that is the better trade. A
  // named shape fixes the row height from the card's width, so the screen holds
  // a whole number of rows and usually not a convenient one: twelve 3:4 cards at
  // 1920x1080 want 560px a row, and two rows is 1126px. The board used to draw
  // the extra row anyway and run off the bottom, which is #171. It now draws
  // what fits and pages the rest.
  //
  // So the guarantee is no longer "fills" -- it is "never overflows, never
  // hides". Whether it also fills is `a shaped board is the tallest one that
  // still fits`, below, which is the half #185 actually bought.
  for (const arrangement of ['fit', 'grid']) {
    for (const shape of ['wide', 'tall']) {
      const {
        boardHeight, scrolls, pages, capacity,
      } = computeLayout({
        slotCount: 12,
        containerWidth: 1920,
        availableHeight: 1080,
        slotWidth: 420,
        gap: 6,
        arrangement,
        shape,
        columns: 'auto',
      });

      const where = `${arrangement}/${shape}`;
      const used = boardHeight / 1080;
      assert.ok(used <= 1, `${where}: ${Math.round(used * 100)}% overflows rather than fits`);
      assert.equal(scrolls, false, `${where}: a board that fits must not claim it scrolls`);

      // ⛔ Nothing is lost by underfilling: what is not on the screen is on a
      // page. A board that showed fewer than twelve and did not say it pages
      // would be hiding channels, which is the one failure that matters.
      assert.ok(
        capacity >= 12 || pages === true,
        `${where}: holds ${capacity} of 12 and does not say it pages`,
      );
    }
  }
});

test('⛔ giving way to a shape never adds columns, only removes them', () => {
  // The ceiling, the physical floor (#170) and the arrangement have all had
  // their say before the shape does. None of them may be overridden here.
  for (const { label, input } of everyBoard()) {
    if (input.shape === 'auto') continue;

    const shaped = computeLayout(input);
    const unshaped = computeLayout({ ...input, shape: 'auto' });

    assert.ok(
      shaped.columns <= unshaped.columns,
      `${label}: a shape asked for ${shaped.columns} columns, more than the ${unshaped.columns} allowed`,
    );
    assert.ok(shaped.columns >= 1, `${label}: ${shaped.columns} columns`);
  }
});

/**
 * ⚠️ Stated as optimality, not as a percentage.
 *
 * A threshold ("never under half the screen") reads well and is simply false:
 * four 3:4 cards on a landscape tablet reach 47% and three columns would
 * overflow, so 47% *is* the best board available. A few 16:9 cards on a 4K
 * screen stop at 45% because the card is already at its configured maximum
 * width. Neither is the fault #185 is about.
 *
 * What has to be true is that nothing better was passed over.
 */
test('⭐ a shaped board is the tallest one that still fits', () => {
  for (const { label, input } of everyBoard()) {
    // `row` is where `columnsFor` maps a ceiling to exactly that many columns,
    // so an alternative can be requested precisely. It is also where the fault
    // was photographed.
    if (input.shape === 'auto' || input.arrangement !== 'row') continue;

    const chosen = computeLayout(input);
    if (chosen.scrolls) continue;

    const allowed = computeLayout({ ...input, shape: 'auto' }).columns;
    for (let c = 1; c <= allowed; c += 1) {
      const alt = computeLayout({ ...input, columns: String(c) });
      if (alt.columns !== c) continue;
      if (alt.boardHeight > input.availableHeight + 0.5) continue;

      assert.ok(
        alt.boardHeight <= chosen.boardHeight + 0.5,
        `${label}: ${c} columns would have used ${Math.round(alt.boardHeight)}px of `
        + `${input.availableHeight}px, better than the ${Math.round(chosen.boardHeight)}px chosen`,
      );
    }
  }
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

test('⭐ the minimum narrows the venue board to the dock, and pages the rest', () => {
  // The fault in the photographs: Side by side with no ceiling gave twelve
  // 155px columns. A 4.5in dock position is 180px on that screen, so the board
  // may not go narrower.
  //
  // ⚠️ It used to *wrap* to 10x2. It now stays one row of ten and pages the other
  // two (#201): a column points at a position on the dock below the
  // screen, and the second row pointed at nothing.
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
  assert.deepEqual([after.columns, after.rows], [10, 1], 'narrowed to the dock, still one row');
  assert.equal(after.capacity, 10, 'ten positions, so ten channels at a time');
  assert.equal(after.pages, true, 'and the other two are a second page');
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

  // Side by side honours the ceiling, stays on the screen, and is one row.
  // ⚠️ Was [6, 2]: twelve channels wrapping into two rows of six. One row now
  // (#201), six channels at a time, the other six on a second page -- and the
  // cards are twice as tall for it.
  const six = at('row', '6', 'auto');
  assert.deepEqual([six.columns, six.rows], [6, 1]);
  assert.equal(six.capacity, 6);
  assert.equal(six.pages, true);
  assert.ok(Math.abs(six.boardHeight - 1080) < 1.5);

  // ⛔ The one that used to overflow: twelve 3:4 cards over four columns need
  // 1692px of a 1080px screen. It no longer runs off the bottom -- the board
  // draws the rows that fit and pages the rest (#201/#202), which is both what
  // #202 asked for and what #171 is about.
  const overflow = at('fit', 'auto', 'tall');
  assert.ok(overflow.boardHeight <= 1080 + 1.5, 'the board no longer runs off the screen');
  assert.equal(overflow.pages, true, 'it pages instead, and says so');
  assert.ok(
    overflow.capacity < 12,
    `expected fewer than twelve on screen, got ${overflow.capacity}`,
  );
  assert.ok(
    overflow.rowsNeeded > overflow.rows,
    'and the rows it could not draw are what the pages are for',
  );
});
