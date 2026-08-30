import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ARRANGEMENTS, CARD_SHAPES, TEXT_POSITIONS, TYPE_SIZES,
  columnsFor, rowHeightFor, computeLayout, nextOption,
  isArrangement, isCardShape, isTextPosition, isTypeSize, isEdgePlacement,
  migrateArrangement, migrateCardShape,
} from './board-layout.mjs';

const WIDE = { slotCount: 12, maxColumns: 12 };

test('fit fills the width, as the board always has', () => {
  assert.equal(columnsFor({ ...WIDE, arrangement: 'fit' }), 12);
  assert.equal(columnsFor({ slotCount: 12, maxColumns: 4, arrangement: 'fit' }), 4);
});

test('row puts every channel on one line', () => {
  // The request that produced #75. Twelve channels, one row, whatever the
  // configured slot width says fits.
  assert.equal(columnsFor({ slotCount: 12, maxColumns: 4, arrangement: 'row' }), 12);
  assert.equal(columnsFor({ slotCount: 3, maxColumns: 1, arrangement: 'row' }), 3);
});

test('column stacks them', () => {
  assert.equal(columnsFor({ slotCount: 12, maxColumns: 12, arrangement: 'column' }), 1);
});

test('row and column deliberately overrule the width that fits', () => {
  // Everywhere else the slot width is a hard size and the column count bends to
  // it. Asking for one row is asking for the opposite, and honouring the width
  // there would hand back a grid -- which is the complaint that started this.
  assert.equal(columnsFor({ slotCount: 20, maxColumns: 2, arrangement: 'row' }), 20);
  assert.equal(columnsFor({ slotCount: 20, maxColumns: 20, arrangement: 'column' }), 1);
});

test('grid stays balanced, near the square root', () => {
  assert.equal(columnsFor({ ...WIDE, arrangement: 'grid' }), 4);
  const columns = columnsFor({ slotCount: 7, maxColumns: 7, arrangement: 'grid' });
  assert.equal(columns, 3);
  assert.ok(Math.ceil(7 / columns) <= columns, 'grid should be no taller than it is wide');
});

test('grid still cannot exceed the columns that physically fit', () => {
  // Unlike row/column, a balanced grid has no reason to overflow the width.
  assert.equal(columnsFor({ slotCount: 12, maxColumns: 3, arrangement: 'grid' }), 3);
});

test('a single slot is a single column whatever the arrangement', () => {
  ARRANGEMENTS.forEach((arrangement) => {
    assert.equal(columnsFor({ slotCount: 1, maxColumns: 8, arrangement }), 1, arrangement);
  });
});

test('auto row height divides the space so every row is on screen', () => {
  const height = rowHeightFor({
    shape: 'auto', cardWidth: 420, rows: 3, availableHeight: 900, gap: 0,
  });
  assert.equal(height, 300);
});

test('a named shape derives height from the card width, ignoring the space', () => {
  assert.equal(rowHeightFor({
    shape: 'wide', cardWidth: 1600, rows: 1, availableHeight: 10,
  }), 900);
  assert.equal(rowHeightFor({
    shape: 'tall', cardWidth: 300, rows: 1, availableHeight: 10,
  }), 400);
});

test('a shaped card uses the width it will really get, not the configured one', () => {
  // One row of twelve on a 1920px screen gives ~155px cards. A 16:9 height
  // computed from the configured 420px would be for a card that never existed.
  const { cardWidth, rowHeight } = computeLayout({
    slotCount: 12,
    containerWidth: 1920,
    availableHeight: 1080,
    slotWidth: 420,
    gap: 0,
    arrangement: 'row',
    shape: 'wide',
  });
  assert.equal(cardWidth, 160);
  assert.equal(rowHeight, 90);
});

test('a degenerate measurement does not collapse the board', () => {
  const height = rowHeightFor({
    shape: 'auto', cardWidth: 420, rows: 4, availableHeight: 0, gap: 0,
  });
  assert.ok(height > 0);
});

test('auto never reports scrolling: it is fit-to-page by construction', () => {
  const { scrolls } = computeLayout({
    slotCount: 24, containerWidth: 1920, availableHeight: 1080, slotWidth: 420, gap: 6,
  });
  assert.equal(scrolls, false);
});

test('a named shape reports scrolling when the cards no longer fit', () => {
  const { scrolls } = computeLayout({
    slotCount: 24,
    containerWidth: 1920,
    availableHeight: 400,
    slotWidth: 420,
    gap: 6,
    shape: 'tall',
  });
  assert.equal(scrolls, true);
});

test('computeLayout defaults reproduce the old fit-to-page numbers', () => {
  // The board an existing site already has. Nothing about this change may move
  // it until somebody presses a key.
  const layout = computeLayout({
    slotCount: 12, containerWidth: 1920, availableHeight: 1080, slotWidth: 420, gap: 6,
  });
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 3);
  assert.equal(layout.scrolls, false);
  assert.ok(Math.abs(layout.rowHeight - (1080 - 12) / 3) < 0.001);
});

test('nextOption cycles and wraps', () => {
  assert.equal(nextOption(ARRANGEMENTS, 'fit'), 'row');
  assert.equal(nextOption(ARRANGEMENTS, 'grid'), 'fit');
  assert.equal(nextOption(CARD_SHAPES, 'auto'), 'wide');
  assert.equal(nextOption(CARD_SHAPES, 'tall'), 'auto');
});

test('text placement cycles through all three and returns to the default', () => {
  assert.equal(nextOption(TEXT_POSITIONS, 'middle'), 'top');
  assert.equal(nextOption(TEXT_POSITIONS, 'top'), 'bottom');
  assert.equal(nextOption(TEXT_POSITIONS, 'bottom'), 'middle');
});

test('the default text placement is the centred card the board has always had', () => {
  // First in the list is the default and the value the cycle starts from, which
  // is the convention the other two controls follow.
  assert.equal(TEXT_POSITIONS[0], 'middle');
  assert.equal(TEXT_POSITIONS.length, 3);
});

test('text size cycles through all three and returns to the default', () => {
  assert.equal(nextOption(TYPE_SIZES, 'medium'), 'small');
  assert.equal(nextOption(TYPE_SIZES, 'small'), 'large');
  assert.equal(nextOption(TYPE_SIZES, 'large'), 'medium');
  assert.equal(TYPE_SIZES[0], 'medium');
});

test('the size validator refuses anything it does not know', () => {
  ['medium', 'small', 'large'].forEach((v) => assert.ok(isTypeSize(v), v));
  ['tiny', 'MEDIUM', '', null, undefined, '1.25'].forEach((v) => {
    assert.equal(isTypeSize(v), false, String(v));
  });
});

test('top and bottom put the text against an edge; middle does not', () => {
  // Which placements want the scrim gathered at one edge rather than washed
  // evenly over the whole picture.
  assert.equal(isEdgePlacement('top'), true);
  assert.equal(isEdgePlacement('bottom'), true);
  assert.equal(isEdgePlacement('middle'), false);
  assert.equal(isEdgePlacement('nonsense'), false);
});

test('the type ranking keeps the name above the channel id', () => {
  // The complaint that produced the rebalance: the channel id was 0.08 against
  // the name's 0.085 -- near-identical, and a third of the text block's height
  // for the least useful line. The ordering matters more than the numbers, so
  // it is the ordering that is pinned.
  const scss = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );
  // Block-aware: these selectors appear more than once -- p.device-name leads a
  // shared text-shadow rule before it gets its own -- so take the first block
  // after the selector that actually sets a size.
  const multiplier = (selector) => {
    for (const chunk of scss.split(selector).slice(1)) {
      const found = chunk.split('}')[0].match(/--tvmode-type\)\s*\*\s*([0-9.]+)/);
      if (found) return Number(found[1]);
    }
    return null;
  };

  const name = multiplier('\n  .name {');
  const micId = multiplier('\n  .mic_id {');
  const device = multiplier('\n  p.device-name {');

  assert.ok(name > device, `name ${name} should outrank the device line ${device}`);
  assert.ok(device > micId, `device line ${device} should outrank the channel id ${micId}`);
});

test('every text size has a stylesheet rule to act on', () => {
  const scss = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );
  TYPE_SIZES.forEach((size) => {
    assert.ok(
      scss.includes(`&.type-${size} {`),
      `css/style.scss has no rule for type-${size}`,
    );
  });
});

test('each edge placement gathers the scrim at its own edge', () => {
  // The text is readable over the photo only because of these, and a scrim
  // pointing the wrong way is worse than none: it dims the half of the picture
  // the text is not on and leaves the text on the bright half.
  const scss = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );
  // `bottom` gathers at the bottom, so the gradient runs `to top`, and vice
  // versa -- the direction is the far edge, which is easy to write backwards.
  const direction = { bottom: 'to top', top: 'to bottom' };

  TEXT_POSITIONS.filter(isEdgePlacement).forEach((position) => {
    const rule = scss.split(`&.text-${position} .mic_name .slot-media.is-active::after`)[1];
    assert.ok(rule, `css/style.scss has no scrim rule for text-${position}`);
    assert.ok(
      rule.split('}')[0].includes(direction[position]),
      `the text-${position} scrim should run ${direction[position]}`,
    );
  });
});

test('every text placement has a stylesheet rule to act on', () => {
  // Unlike arrangement and card shape -- whose classes exist only to make the
  // state legible, the geometry arriving as custom properties -- text placement
  // is done entirely in CSS. So a value added here with no matching rule would
  // cycle, store itself and change the URL while the text never moved, which is
  // the kind of nothing that is hard to spot.
  const scss = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );

  TEXT_POSITIONS.forEach((position) => {
    assert.ok(
      scss.includes(`&.text-${position} .mic_name`),
      `css/style.scss has no rule for text-${position}`,
    );
  });
});

test('the validators accept exactly the supported values', () => {
  ['fit', 'row', 'column', 'grid'].forEach((v) => assert.ok(isArrangement(v), v));
  ['auto', 'wide', 'tall'].forEach((v) => assert.ok(isCardShape(v), v));
  ['middle', 'top', 'bottom'].forEach((v) => assert.ok(isTextPosition(v), v));

  // This one reaches a CSS class name straight off a link, so it has to refuse
  // anything it does not recognise rather than pass it through.
  ['centre', 'center', 'middle ', '', null, undefined, 'top; }'].forEach((v) => {
    assert.equal(isTextPosition(v), false, String(v));
  });

  // The old vocabulary is no longer valid on its own; it has to be migrated.
  ['landscape', 'portrait', 'auto', '', null, undefined, 'sideways'].forEach((v) => {
    assert.equal(isArrangement(v), false, String(v));
  });
  ['landscape', 'portrait', 'wide-ish', null].forEach((v) => {
    assert.equal(isCardShape(v), false, String(v));
  });
});

test('preferences written by 1.11.0 are translated, not discarded', () => {
  // Boards have these stored. Ignoring them would quietly reset a wall display
  // to the default because the vocabulary changed under it.
  assert.equal(migrateArrangement('auto'), 'fit');
  assert.equal(migrateArrangement('landscape'), 'grid');
  assert.equal(migrateArrangement('portrait'), 'column');
  assert.equal(migrateCardShape('landscape'), 'wide');
  assert.equal(migrateCardShape('portrait'), 'tall');
  assert.equal(migrateCardShape('auto'), 'auto');
});

test('migration passes current values through and refuses nonsense', () => {
  assert.equal(migrateArrangement('row'), 'row');
  assert.equal(migrateCardShape('wide'), 'wide');
  assert.equal(migrateArrangement('sideways'), null);
  assert.equal(migrateCardShape(''), null);
  assert.equal(migrateArrangement(undefined), null);
});
