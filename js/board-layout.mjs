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

/** The shape of one card. Deliberately a different vocabulary from above. */
export const CARD_SHAPES = ['auto', 'wide', 'tall'];

/**
 * Where the text block sits inside a card.
 *
 * A third vocabulary again, for the same reason as the second: this moves the
 * text *within* a card, which is a different question from the card's shape or
 * the grid's. ⛔ Deliberately not called "position" — the card's third line is
 * the person's position in the service (#69), and reusing the word in the help
 * overlay would make two unrelated things read as one.
 *
 * `middle` is first because it is the default and because it is what every
 * board did before this existed: `.mic_name` has always been a centred flex
 * column. Only TV mode can honour these — a desk-mode card hugs its content, so
 * there is no slack to move the text within.
 */
export const TEXT_POSITIONS = ['middle', 'top', 'bottom'];

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

export function isTextPosition(value) {
  return TEXT_POSITIONS.includes(value);
}

export function isTypeSize(value) {
  return TYPE_SIZES.includes(value);
}

export function isTopBarState(value) {
  return TOP_BAR_STATES.includes(value);
}

/**
 * Whether a placement puts the text against an edge, and so wants a scrim
 * gathered at that edge rather than spread over the whole picture.
 */
export function isEdgePlacement(value) {
  return value === 'top' || value === 'bottom';
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
export function columnsFor({ slotCount, maxColumns, arrangement = 'fit' }) {
  const n = toCount(slotCount);
  const fits = toCount(maxColumns);

  if (arrangement === 'row') {
    return n;
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
    return Math.max(1, Math.min(fits, c));
  }

  return Math.max(1, Math.min(fits, n));
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

export function computeLayout({
  slotCount, containerWidth, availableHeight, slotWidth = 420, gap = 0,
  arrangement = 'fit', shape = 'auto',
}) {
  const n = toCount(slotCount);
  const width = Number(slotWidth) > 0 ? Number(slotWidth) : 420;
  const maxColumns = Math.max(1, Math.floor((Number(containerWidth) + gap) / (width + gap)) || 1);

  const columns = columnsFor({ slotCount: n, maxColumns, arrangement });
  const rows = Math.max(1, Math.ceil(n / columns));

  // The width a card will actually be given. `fit` and `grid` never ask for
  // more columns than fit, so this is the configured width; `row` and `column`
  // may, and there the configured width is a maximum the cards fall below.
  const measured = Number(containerWidth);
  const share = Number.isFinite(measured) && measured > 0
    ? (measured - gap * (columns - 1)) / columns
    : width;
  const cardWidth = Math.max(1, Math.min(width, share));

  const rowHeight = rowHeightFor({
    shape, cardWidth, rows, availableHeight, gap,
  });
  const boardHeight = rowHeight * rows + gap * (rows - 1);

  return {
    columns,
    rows,
    rowHeight,
    cardWidth,
    boardHeight,
    scale: rowHeight / BASE_HEIGHT,
    // Only a named shape can overflow; auto is fit-to-page by construction.
    scrolls: boardHeight > Number(availableHeight) + 0.5,
  };
}
