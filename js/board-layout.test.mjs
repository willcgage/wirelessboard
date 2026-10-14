import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ARRANGEMENTS, CARD_SHAPES, TYPE_SIZES,
  columnsFor, rowHeightFor, computeLayout, nextOption,
  TOP_BAR_STATES,
  isArrangement, isCardShape, isTypeSize, isTopBarState,
  migrateArrangement, migrateCardShape,
  COLUMN_CHOICES, COLUMNS_AUTO, isColumnChoice, columnCeiling,
  WASH_STYLES, isWashStyle, gridTemplateFor,
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
  // ⚠️ Updated for #185. This used to assert 160x90 — one row of twelve, which
  // is an 87px strip on a 1080p screen. A named shape now reduces the column
  // count until the board fills the height, so that board is no longer built.
  //
  // The invariant the test exists for is unchanged and is asserted directly:
  // the row height is derived from the width a card is *actually* given.
  const {
    columns, cardWidth, rowHeight, boardHeight,
  } = computeLayout({
    slotCount: 12,
    containerWidth: 1920,
    availableHeight: 1080,
    slotWidth: 420,
    gap: 0,
    arrangement: 'row',
    shape: 'wide',
  });

  assert.equal(columns, 3, 'twelve 16:9 cards in one row would be an 87px strip');
  assert.ok(
    Math.abs(rowHeight - cardWidth / (16 / 9)) < 0.01,
    `the 16:9 height must follow the real card width, got ${rowHeight} for ${cardWidth}`,
  );
  assert.ok(boardHeight <= 1080, 'and the board it chose still fits the screen');
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

test('the wash has three styles and starts on the band', () => {
  // ⭐ `rail` added in #193. It is a third value of this control rather than a
  // second card: the question "where does the status colour live" is the one
  // this control already answers.
  assert.deepEqual(WASH_STYLES, ['band', 'full', 'rail']);
  assert.equal(nextOption(WASH_STYLES, 'band'), 'full');
  assert.equal(nextOption(WASH_STYLES, 'full'), 'rail');
  assert.equal(nextOption(WASH_STYLES, 'rail'), 'band', 'and it cycles back to the default');
  for (const style of WASH_STYLES) {
    assert.ok(isWashStyle(style));
  }
  for (const junk of ['', 'tint', null, undefined]) {
    assert.ok(!isWashStyle(junk));
  }
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

test('the top bar toggles, and starts shown', () => {
  assert.equal(TOP_BAR_STATES[0], 'shown');
  assert.equal(nextOption(TOP_BAR_STATES, 'shown'), 'hidden');
  assert.equal(nextOption(TOP_BAR_STATES, 'hidden'), 'shown');
  ['shown', 'hidden'].forEach((v) => assert.ok(isTopBarState(v), v));
  ['visible', 'true', '', null, undefined].forEach((v) => {
    assert.equal(isTopBarState(v), false, String(v));
  });
});

test('the top bar is hidden from body, not from the container', () => {
  // ⛔ The whole point. `.tvmode .navbar` sat in the stylesheet for years
  // looking like TV mode hid the bar; it never did, because `tvmode` is a class
  // on #container and the bar is a sibling of it. A rule scoped to the
  // container cannot reach the bar, so this one must not be.
  const scss = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );

  assert.match(scss, /body\.topbar-hidden \.navbar/, 'the hide rule should hang off body');

  // Comments stripped first: this file now *discusses* the dead rule at length,
  // and prose about it should not read as the rule itself.
  const rules = scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(
    rules,
    /\.tvmode[^{}]*\.navbar\s*\{[^}]*display:\s*none/,
    'a container-scoped rule cannot reach the top bar; it would be dead code again',
  );
});

test('the name has a row and the runtime has the one below it', () => {
  // ⛔ Two rows, one column, since #206. It was two columns -- the device name
  // at the start, the runtime at the end -- but the device name had already
  // moved to the column heading in 1.15.0 and the band's copy was left behind,
  // so every card printed the same string twice. Removing it empties the left
  // half, and the runtime takes the side the device had, which is what that
  // move said it would do.
  const scss = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );

  // ⚠️ Scan for the band's own area list rather than the first one in the file:
  // `.mic_name` has a single-area grid of its own since #130.
  const areas = scss.split('.mic_name .card-band {')[1].split('}')[0];
  assert.match(areas, /"name"/, 'the name should have the row above');
  assert.match(areas, /"runtime"/, 'and the runtime the one below it');
  assert.doesNotMatch(
    areas,
    /"position/,
    'there is no position area: nothing ever filled it but a duplicate (#206)',
  );

  // These selectors each appear more than once, so scan the blocks rather than
  // assuming the first one is the placement rule.
  const declares = (selector, pattern) => scss
    .split(selector).slice(1)
    .some((chunk) => pattern.test(chunk.split('}')[0]));

  // ⛔ The device name is a column header (#130) and ONLY a column header
  // (#206): it is the same string on every row of the board, so it reads once
  // above the card and never inside it. The runtime takes the start of its row
  // -- the place the device name used to hold -- so the card has one left edge.
  assert.ok(
    declares('.mic_name .card-runtime {', /justify-self:\s*start/),
    'the runtime should sit at the start of its row',
  );
  assert.doesNotMatch(
    scss,
    /\.mic_id/,
    'the band must not style a device name of its own; the heading is the only one',
  );
});

test('⛔ the text band is fixed at the bottom and is no longer a setting', () => {
  // Removed in #130. The maintainer's reason: "I'd rather not move things
  // around in this case... leave it at the bottom." Nothing should reintroduce
  // the vocabulary without reintroducing the CSS and the chip-collision fix
  // that came with it.
  const scss = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );

  assert.ok(scss.includes('&.text-bottom .mic_name'), 'the band still needs its rule');
  assert.ok(!scss.includes('text-top'), 'the top variant and its special cases should be gone');

  // ⚠️ The scrim gathers at the band's edge, so it runs the other way: the
  // direction names the far edge, which is easy to write backwards.
  const rule = scss.split('&.text-bottom .mic_name .slot-media.is-active::after')[1];
  assert.ok(rule, 'css/style.scss has no scrim rule for the band');
  assert.ok(rule.split('}')[0].includes('to top'), 'the scrim should run to top');
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

// --------------------------------------------------------------------------
// Columns on screen (#112) -- a ceiling, not an exact count
// --------------------------------------------------------------------------

test('auto leaves every arrangement exactly as it was', () => {
  for (const arrangement of ARRANGEMENTS) {
    assert.equal(
      columnsFor({ ...WIDE, arrangement, columns: 'auto' }),
      columnsFor({ ...WIDE, arrangement }),
      `${arrangement} changed under an explicit auto`,
    );
  }
});

test('a ceiling caps the arrangement rather than replacing it', () => {
  // row would take all twelve; the ceiling stops it at six.
  assert.equal(columnsFor({
    slotCount: 12, maxColumns: 4, arrangement: 'row', columns: '6',
  }), 6);
  // fit would take four at this width, and the wider ceiling must not widen it:
  // the narrower of the two always wins, so cards never go under the slot width
  // unless something explicitly asks them to.
  assert.equal(columnsFor({
    slotCount: 12, maxColumns: 4, arrangement: 'fit', columns: '8',
  }), 4);
  // grid balances to 4x3 for twelve; a ceiling of 10 is no constraint at all.
  assert.equal(
    columnsFor({ ...WIDE, arrangement: 'grid', columns: '10' }),
    columnsFor({ ...WIDE, arrangement: 'grid' }),
  );
});

test('a ceiling never invents columns there are no channels for', () => {
  assert.equal(columnsFor({
    slotCount: 3, maxColumns: 12, arrangement: 'row', columns: '12',
  }), 3);
  assert.equal(columnsFor({
    slotCount: 1, maxColumns: 12, arrangement: 'fit', columns: '8',
  }), 1);
});

test('stacking ignores the ceiling, because one is already fewer', () => {
  assert.equal(columnsFor({ ...WIDE, arrangement: 'column', columns: '4' }), 1);
});

test('⛔ a ceiling wraps channels onto more rows and never drops one', () => {
  // The whole risk of this control: a board that quietly shows eight of twelve
  // during a service. Paging (#113) is how a board shows fewer on purpose;
  // until then every channel has to be on the board somewhere.
  for (const ceiling of ['4', '6', '8', '10', '12']) {
    const layout = computeLayout({
      slotCount: 12,
      containerWidth: 1920,
      availableHeight: 1040,
      arrangement: 'row',
      columns: ceiling,
    });
    assert.ok(
      layout.columns * layout.rows >= 12,
      `ceiling ${ceiling} left room for only ${layout.columns * layout.rows} of 12`,
    );
    assert.equal(layout.columns, Number(ceiling));
  }
});

test('a ceiling still divides the height so the rows fit the page', () => {
  const layout = computeLayout({
    slotCount: 12,
    containerWidth: 1920,
    availableHeight: 1000,
    gap: 0,
    arrangement: 'row',
    columns: '6',
  });
  assert.equal(layout.rows, 2);
  assert.equal(layout.rowHeight, 500);
  assert.equal(layout.scrolls, false);
});

test('the column validators accept exactly the supported values', () => {
  for (const choice of COLUMN_CHOICES) {
    assert.ok(isColumnChoice(choice), `${choice} should be valid`);
  }
  for (const junk of ['5', '0', '-4', 'lots', '', null, undefined, 6]) {
    assert.ok(!isColumnChoice(junk), `${junk} should be refused`);
  }
  assert.equal(columnCeiling('auto'), null);
  assert.equal(columnCeiling('nonsense'), null);
  assert.equal(columnCeiling('8'), 8);
  assert.equal(COLUMNS_AUTO, 'auto');
});

// ---------------------------------------------------------------------------
// #204 — the board's inline grid template, and the case that broke
// ---------------------------------------------------------------------------

test('⛔ desk mode gets an empty grid template, for every arrangement', () => {
  // ⛔ This is the bug. `updateTvLayoutMetrics` has two exits; the TV one wrote
  // this property and the desk one returned before reaching it, so a template
  // written in TV mode survived the switch. `--tvmode-slot-width` is declared
  // on `.tvmode` only, so in desk mode the var() is invalid at computed-value
  // time, the declaration computes to `none`, and the board collapses to one
  // full-width column -- measured at 1600x1000 as five 304px tracks becoming
  // one of 1569px.
  //
  // ⚠️ Every arrangement, because the old code only wrote the property when the
  // arrangement was not `fit`. A board that had never left `fit` could not
  // reach the fault, which is why it survived.
  for (const arrangement of ARRANGEMENTS) {
    assert.equal(
      gridTemplateFor({ isTvMode: false, arrangement, columns: 12 }),
      '',
      `desk mode must not keep a template for ${arrangement}`,
    );
  }
});

test('⛔ the not-TV answer does not depend on anything else being passed', () => {
  // The desk branch has no column count in scope -- it returns before the
  // layout is computed. If the rule needed one, the caller would have to invent
  // a number to ask for nothing, which is how the reset gets skipped again.
  assert.equal(gridTemplateFor({ isTvMode: false }), '');
  assert.equal(gridTemplateFor({}), '');
  assert.equal(gridTemplateFor(), '');
});

test('TV mode states the column count for a named arrangement', () => {
  for (const arrangement of ['row', 'column', 'grid']) {
    assert.equal(
      gridTemplateFor({ isTvMode: true, arrangement, columns: 12 }),
      'repeat(12, minmax(0, var(--tvmode-slot-width)))',
      `${arrangement} has to state its count or auto-fit would ignore it`,
    );
  }
});

test('TV mode leaves `fit` to the stylesheet', () => {
  // `fit` is driven by auto-fit, which packs as many across as fit. An explicit
  // count would override exactly the behaviour it is named for.
  assert.equal(gridTemplateFor({ isTvMode: true, arrangement: 'fit', columns: 8 }), '');
  assert.equal(gridTemplateFor({ isTvMode: true, arrangement: '', columns: 8 }), '');
  assert.equal(gridTemplateFor({ isTvMode: true, columns: 8 }), '');
});

test('⛔ both branches of the caller read this one function', () => {
  // ⚠️ A property test cannot see the caller: `tv-layout.js` reaches the DOM and
  // imports `app.js`, and there is no jsdom here, so it cannot be imported in a
  // test at all. What can be checked is that neither branch builds the string
  // itself -- which is the shape the bug had, one branch holding a rule the
  // other had to remember.
  const src = readFileSync(
    fileURLToPath(new URL('../js/tv-layout.js', import.meta.url)),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.doesNotMatch(
    src,
    /repeat\(\$\{/,
    'tv-layout.js should not assemble a grid template; gridTemplateFor owns it',
  );
  assert.equal(
    (src.match(/gridTemplateColumns/g) || []).length,
    2,
    'both exits should set it: the TV one and the desk one',
  );
});
