/**
 * How many columns the board uses, and how tall a slot is.
 *
 * TV mode used to answer both questions one way only: as many columns as fit
 * at the fixed slot width, and a row height that divided the viewport so
 * everything landed on one screen. That makes a slot's shape a side effect of
 * how many channels happen to be on -- twelve slots on a 1080p screen give
 * squat letterboxed cards, three give tall ones -- and the operator had no say.
 *
 * Two independent controls now:
 *
 *   orientation  the shape of the grid   auto | landscape | portrait
 *   aspect       the shape of one card   auto | landscape | portrait
 *
 * `auto` on both is exactly the old behaviour, and is the default, so an
 * existing board looks the same until someone asks for something else.
 *
 * Pure on purpose: every decision here is arithmetic over numbers the caller
 * measured, so it can be tested without a DOM.
 */

/**
 * How the channels are arranged. Named for what you get, not for a shape.
 *
 * The first version of this offered auto/landscape/portrait here *and* the
 * same three words for the card, which read as the same control twice and
 * still could not produce the thing operators asked for. Both orientations
 * were anchored near the square root of the slot count, so twelve channels
 * gave 4x3 either way and a single row was outside the option space entirely
 * (#75).
 */
export const ARRANGEMENTS = ['fit', 'row', 'column', 'grid'];

/**
 * How many columns the operator will allow on screen (#112).
 *
 * ⭐ A **ceiling, not an exact count**, which is what lets it compose with the
 * arrangements rather than fight them: `fit` still packs as many as fit and
 * simply stops at this number, `row` stops asking for every channel on one
 * line, and `column` is unaffected because one is already fewer than any
 * ceiling. One control, no precedence argument.
 *
 * ⛔ A channel over the ceiling wraps onto another row. It is never dropped.
 * Showing fewer channels than exist is paging (#113) and needs a way to bring
 * the rest round; a density control that quietly hid four channels during a
 * service would be worse than no control at all.
 *
 * Strings because that is what a hash carries and what storage returns, and
 * because `auto` has to live in the same list as the numbers.
 */
export const COLUMN_CHOICES = ['auto', '4', '6', '8', '10', '12'];

/** The default: whatever the arrangement would have chosen on its own. */
export const COLUMNS_AUTO = COLUMN_CHOICES[0];

export function isColumnChoice(value) {
  return COLUMN_CHOICES.includes(value);
}

/** The ceiling as a number, or null when the operator has not asked for one. */
export function columnCeiling(value) {
  if (!isColumnChoice(value) || value === COLUMNS_AUTO) {
    return null;
  }
  return Number(value);
}

/** The shape of one card. Deliberately a different vocabulary from above. */
export const CARD_SHAPES = ['auto', 'wide', 'tall'];

/**
 * ⛔ The text band's placement was a setting (`P`) and is not any more, as of
 * #130. It sits at the **bottom**, full stop.
 *
 * The maintainer's reason, after seeing both rendered: "I'd rather not move
 * things around in this case. I almost think a simplification would be best
 * and leave it at the bottom." Shading at the foot of the card is where it
 * least often lands on a face, and a board whose operators stand five feet
 * away does not gain from a second place to look for the same line.
 *
 * ⚠️ Removing it also removed the thing it cost: with the band at the top the
 * status chip landed on it and covered the name, so `.text-top` carried a
 * special case purely to undo a collision that only existed because the option
 * existed. `middle` had already gone the same way earlier in #130.
 */

/**
 * How the status colour meets the card (#130).
 *
 * `band` gives the colour to the text band and leaves the photograph alone;
 * `full` tints the whole card, which is what the board did before and reads
 * from further away. The maintainer asked to run `band` and compare the two on
 * the wall, so both ship and `W` switches between them.
 */
export const WASH_STYLES = ['band', 'full'];

export function isWashStyle(value) {
  return WASH_STYLES.includes(value);
}

/**
 * How large the card text is, as a multiplier on the sizes the layout derives.
 *
 * `medium` is first: the default, and the sizes the board already had.
 */
export const TYPE_SIZES = ['medium', 'small', 'large'];

/**
 * Whether the Wirelessboard bar across the top of the page is shown.
 *
 * ⛔ Not a TV-mode-only control, unlike the four above. The bar sits outside
 * `#container` -- it is a sibling of it, not a child -- so it is on screen in
 * both modes and eats the same strip of height in both.
 *
 * That sibling relationship is also why the stylesheet's own
 * `.tvmode .navbar { display: none }` never did anything: `tvmode` is a class on
 * `#container`, so a descendant selector cannot reach the bar. It read like
 * this feature already existed. It did not, and that rule is gone.
 *
 * `shown` is first: the default, and what every board does today.
 */
export const TOP_BAR_STATES = ['shown', 'hidden'];

/**
 * The state that puts the bar back.
 *
 * Named rather than written as a string wherever something needs to restore the
 * bar instead of cycling it: `H` toggles, but the escape control added for #110
 * only ever moves one way, and a literal 'shown' in another module is a rename
 * waiting to go unnoticed.
 */
export const TOP_BAR_SHOWN = TOP_BAR_STATES[0];

/**
 * 1.11.0 shipped the old names and boards have them stored. Map rather than
 * discard: silently resetting somebody's wall display to the default because
 * the vocabulary changed is a worse greeting than a near-equivalent layout.
 */
const LEGACY_ARRANGEMENTS = { auto: 'fit', landscape: 'grid', portrait: 'column' };
const LEGACY_CARD_SHAPES = { auto: 'auto', landscape: 'wide', portrait: 'tall' };

export function migrateArrangement(value) {
  if (ARRANGEMENTS.includes(value)) return value;
  return LEGACY_ARRANGEMENTS[value] || null;
}

export function migrateCardShape(value) {
  if (CARD_SHAPES.includes(value)) return value;
  return LEGACY_CARD_SHAPES[value] || null;
}

// The height the scale factor is expressed against; --tvmode-scale is
// rowHeight/BASE_HEIGHT and drives the clamped font sizes.
export const BASE_HEIGHT = 1080;

// Card shapes, as width:height. 16:9 matches the displays these boards are
// usually shown on; 3:4 is upright enough for a headshot without going so
// narrow that the name has nowhere to sit.
// ⚠️ Mirrors `--tvmode-type-basis` in style.scss, which is
// `min(row-height, card-width * 1.6)`. The two have to stay in step: if this
// changes, that changes. `tv-layout-properties.test.mjs` fails if they drift.
export const TYPE_WIDTH_RATIO = 1.6;

const LANDSCAPE_RATIO = 16 / 9;
const PORTRAIT_RATIO = 3 / 4;

function toCount(value, fallback = 1) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The next value in a list, wrapping. Used by the keyboard shortcuts, which
 * cycle rather than set, so there is one key per control instead of three.
 */
export function nextOption(options, current) {
  if (!Array.isArray(options) || options.length === 0) {
    return current;
  }
  const i = options.indexOf(current);
  return options[(i + 1) % options.length];
}

export function isArrangement(value) {
  return ARRANGEMENTS.includes(value);
}

export function isCardShape(value) {
  return CARD_SHAPES.includes(value);
}

export function isTypeSize(value) {
  return TYPE_SIZES.includes(value);
}

export function isTopBarState(value) {
  return TOP_BAR_STATES.includes(value);
}

/**
 * How many columns to use.
 *
 * - `fit`    as many as fit at the slot width. The board's original behaviour.
 * - `row`    every channel on one line.
 * - `column` every channel in one stack.
 * - `grid`   balanced, near the square root of the count.
 *
 * ⭐ `row` and `column` deliberately ignore `maxColumns`. Everywhere else the
 * slot width is a hard size and the number of columns bends to it; asking for
 * one row is asking for the opposite, and honouring the width there would
 * silently give back a grid -- which is exactly the complaint that produced
 * this. The width becomes a maximum instead and the cards get narrower, which
 * the CSS already allows: the track is minmax(0, var(--tvmode-slot-width)).
 * Twelve channels on a 1920px screen means ~155px cards, and that is the trade
 * being asked for.
 */
export function columnsFor({
  slotCount, maxColumns, arrangement = 'fit', columns = COLUMNS_AUTO,
  maxColumnsAtMinimum = null,
}) {
  const n = toCount(slotCount);
  const fits = toCount(maxColumns);
  const ceiling = columnCeiling(columns);
  // ⛔ A physical floor, where the screen has been described (#170). The
  // television hangs above the charging dock, so a column points at the
  // microphone underneath it -- narrower than a dock position and it points at
  // nothing. Unlike the operator's ceiling this is not a preference, so it
  // binds every arrangement including the ones that are otherwise allowed to
  // make cards as narrow as they like.
  const floorLimit = Number.isFinite(maxColumnsAtMinimum) && maxColumnsAtMinimum > 0
    ? Math.floor(maxColumnsAtMinimum)
    : null;
  const capped = (c) => {
    let out = ceiling === null ? c : Math.min(c, ceiling);
    if (floorLimit !== null) out = Math.min(out, floorLimit);
    return Math.max(1, out);
  };

  if (arrangement === 'row') {
    return capped(n);
  }

  if (arrangement === 'column') {
    return 1;
  }

  if (arrangement === 'grid') {
    let c = Math.ceil(Math.sqrt(n));
    // Widen until the grid is no taller than it is wide.
    while (c < n && Math.ceil(n / c) > c) {
      c += 1;
    }
    return capped(Math.max(1, Math.min(fits, c)));
  }

  return capped(Math.max(1, Math.min(fits, n)));
}

/**
 * How tall one row is.
 *
 * `auto` divides the space so every row is on screen -- fit-to-page, whatever
 * the arrangement. With `row` that means one row filling the height, so the
 * cards come out narrow and tall; `wide` is the natural companion there and is
 * one keypress away.
 *
 * A named shape derives the height from the card width instead, so the card
 * keeps its proportions and the board scrolls when there are too many. That is
 * the trade being asked for; pretending otherwise would just reproduce the
 * squashing this exists to fix.
 *
 * `cardWidth` is the width a card will actually get, which is not the
 * configured slot width once an arrangement is allowed to shrink it. Passing
 * the configured width here would give a 16:9 card a height computed from a
 * size it never had.
 */
export function rowHeightFor({
  shape = 'auto', cardWidth, rows, availableHeight, gap = 0,
}) {
  const width = Number(cardWidth) > 0 ? Number(cardWidth) : 420;

  if (shape === 'wide') {
    return width / LANDSCAPE_RATIO;
  }
  if (shape === 'tall') {
    return width / PORTRAIT_RATIO;
  }

  const r = toCount(rows);
  const height = Number(availableHeight);
  const usable = (Number.isFinite(height) ? height : 0) - gap * (r - 1);
  // A degenerate measurement (a hidden container reports 0) would otherwise
  // produce a zero or negative row height and collapse the board.
  return usable > 1 ? usable / r : width / LANDSCAPE_RATIO;
}

/**
 * The geometry a given column count produces.
 *
 * ⛔ Extracted so `computeLayout` and `columnsForShape` cannot drift: one of
 * them chooses the column count by measuring boards, the other builds the board
 * it chose, and they have to measure the same way or the choice is made against
 * geometry that never ships.
 */
function geometryFor({
  columns, slotCount, containerWidth, availableHeight, slotWidth, gap, shape,
}) {
  const rows = Math.max(1, Math.ceil(slotCount / columns));
  const measured = Number(containerWidth);
  const share = Number.isFinite(measured) && measured > 0
    ? (measured - gap * (columns - 1)) / columns
    : slotWidth;
  const cardWidth = Math.max(1, Math.min(slotWidth, share));
  const rowHeight = rowHeightFor({
    shape, cardWidth, rows, availableHeight, gap,
  });
  return {
    rows, cardWidth, rowHeight, boardHeight: rowHeight * rows + gap * (rows - 1),
  };
}

/**
 * ⭐ The shape wins when it was asked for (#185).
 *
 * `auto` is fit-to-page by construction, so it is left exactly as it was. A
 * *named* shape is a statement about the photograph, and the maintainer's call
 * is that it beats the column count: "photo size wins when specified".
 *
 * Without this, Side by side asks for all twelve in one row and 16:9 asks for a
 * shape, and on a 1920x1080 screen both were honoured literally — 155x87 cards
 * filling **8% of the screen** and the rest black. Neither choice was wrong on
 * its own; the pair is unsatisfiable, and the column count is the half that can
 * give way, because the control is a *ceiling* ("Max 8"), so coming in under it
 * is what it already promises.
 *
 * Returns the column count whose board comes closest to filling the height
 * without passing it. ⚠️ Every count is measured rather than assuming board
 * height falls monotonically with columns: `rows` is a step function and
 * `cardWidth` is capped at the slot width, so the curve is flat in places.
 *
 * ⛔ Never returns more columns than it was given. The ceiling, the physical
 * floor (#170) and the arrangement have all had their say before this runs, and
 * none of them may be overridden here.
 */
export function columnsForShape({
  columns, slotCount, containerWidth, availableHeight, slotWidth, gap, shape,
}) {
  const height = Number(availableHeight);
  if (shape === 'auto' || !Number.isFinite(height) || height <= 0) {
    return columns;
  }

  const measure = (c) => geometryFor({
    columns: c, slotCount, containerWidth, availableHeight, slotWidth, gap, shape,
  }).boardHeight;

  // Already taller than the screen: fewer columns can only make it taller, so
  // there is nothing to win here. That board overflows, which is #171's
  // question and not this one's.
  if (measure(columns) > height + 0.5) {
    return columns;
  }

  let best = columns;
  let bestHeight = measure(columns);
  for (let c = columns - 1; c >= 1; c -= 1) {
    const boardHeight = measure(c);
    if (boardHeight <= height + 0.5 && boardHeight > bestHeight) {
      best = c;
      bestHeight = boardHeight;
    }
  }
  return best;
}

export function computeLayout({
  slotCount, containerWidth, availableHeight, slotWidth = 420, gap = 0,
  arrangement = 'fit', shape = 'auto', columns: columnChoice = COLUMNS_AUTO,
  minColumnWidth = null,
}) {
  const n = toCount(slotCount);
  const width = Number(slotWidth) > 0 ? Number(slotWidth) : 420;
  const maxColumns = Math.max(1, Math.floor((Number(containerWidth) + gap) / (width + gap)) || 1);

  // How many columns the screen can carry without any going under the physical
  // minimum. Null when the screen has not been described, which means no floor
  // and the board behaves exactly as it did before.
  // ⛔ Pitch, not card width -- the gap lives inside a column's share of the
  // screen. See `maxColumnsAtMinimum`, which this has to agree with.
  const floor = Number(minColumnWidth) > 0
    ? Math.max(1, Math.floor(Number(containerWidth) / Number(minColumnWidth)))
    : null;

  const asked = columnsFor({
    slotCount: n,
    maxColumns,
    arrangement,
    columns: columnChoice,
    maxColumnsAtMinimum: floor,
  });

  // ⭐ A named shape beats the column count (#185). `auto` is untouched.
  const columns = columnsForShape({
    columns: asked, slotCount: n, containerWidth, availableHeight, slotWidth: width, gap, shape,
  });

  // The width a card will actually be given. `fit` and `grid` never ask for
  // more columns than fit, so this is the configured width; `row` and `column`
  // may, and there the configured width is a maximum the cards fall below.
  const {
    rows, cardWidth, rowHeight, boardHeight,
  } = geometryFor({
    columns, slotCount: n, containerWidth, availableHeight, slotWidth: width, gap, shape,
  });

  return {
    columns,
    rows,
    rowHeight,
    cardWidth,
    boardHeight,
    // ⛔ Both dimensions, not just the row height (#169, #173).
    //
    // This drives `--tvmode-scale`, which the stylesheet spends on the padding,
    // the gaps and -- the one that matters -- the height reserved for the info
    // drawer: `height: calc(100% - (var(--tvmode-scale) * 375px))`.
    //
    // Derived from `rowHeight` alone it ignored how *wide* a card is, so one
    // row of twelve on a 1080p screen gave a 155px-wide card a scale of 1.0 and
    // reserved 375px for a drawer sized for a full-screen card. The drawer then
    // painted over the name band, which is what was photographed on the wall.
    //
    // ⭐ `min(rowHeight, cardWidth * 1.6)` is not a new idea here -- it is
    // exactly what `--tvmode-type-basis` already uses, and #81 settled that the
    // scale must follow every dimension the layout can vary. The type honoured
    // that rule and the spacing did not; now they agree, and they agree by
    // construction rather than by both being maintained.
    scale: Math.min(rowHeight, cardWidth * TYPE_WIDTH_RATIO) / BASE_HEIGHT,
    // Only a named shape can overflow; auto is fit-to-page by construction.
    scrolls: boardHeight > Number(availableHeight) + 0.5,
    // ⚠️ So a caller can say *why* a board wrapped. Without it, an operator
    // who asked for one row and got two has no way to tell a bug from a rule.
    columnsLimitedByWidth: floor !== null && columns >= floor && n > floor,
  };
}
