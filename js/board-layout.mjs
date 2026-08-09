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

export const ORIENTATIONS = ['auto', 'landscape', 'portrait'];
export const ASPECTS = ['auto', 'landscape', 'portrait'];

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

export function isOrientation(value) {
  return ORIENTATIONS.includes(value);
}

export function isAspect(value) {
  return ASPECTS.includes(value);
}

/**
 * How many columns to use.
 *
 * - `auto` fills the width, which is what the board has always done.
 * - `landscape` aims for a grid at least as wide as it is tall.
 * - `portrait` aims for one strictly taller than it is wide.
 *
 * Both shaped options sit near the square root of the slot count and are then
 * nudged to the side of square they are named for. Neither can exceed the
 * number of columns that physically fit, so a narrow or rotated screen still
 * wins the argument.
 */
export function columnsFor({ slotCount, maxColumns, orientation = 'auto' }) {
  const n = toCount(slotCount);
  const fits = toCount(maxColumns);

  if (orientation === 'landscape') {
    let c = Math.ceil(Math.sqrt(n));
    // Widen until the grid is no taller than it is wide.
    while (c < n && Math.ceil(n / c) > c) {
      c += 1;
    }
    return Math.max(1, Math.min(fits, c));
  }

  if (orientation === 'portrait') {
    let c = Math.max(1, Math.floor(Math.sqrt(n)));
    // Narrow until the grid is strictly taller than it is wide. n === 1 has
    // nowhere to go and stays a single square.
    while (c > 1 && Math.ceil(n / c) <= c) {
      c -= 1;
    }
    return Math.max(1, Math.min(fits, c));
  }

  return Math.max(1, Math.min(fits, n));
}

/**
 * How tall one row is.
 *
 * `auto` divides the space so every row is on screen, which is the fit-to-page
 * behaviour. A named aspect derives the height from the slot width instead, so
 * the card keeps its shape and the board scrolls when there are too many --
 * that is the trade being asked for, and pretending otherwise would just
 * reproduce the squashing.
 */
export function rowHeightFor({
  aspect = 'auto', slotWidth, rows, availableHeight, gap = 0,
}) {
  const width = Number(slotWidth) > 0 ? Number(slotWidth) : 420;

  if (aspect === 'landscape') {
    return width / LANDSCAPE_RATIO;
  }
  if (aspect === 'portrait') {
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
  orientation = 'auto', aspect = 'auto',
}) {
  const n = toCount(slotCount);
  const width = Number(slotWidth) > 0 ? Number(slotWidth) : 420;
  const maxColumns = Math.max(1, Math.floor((Number(containerWidth) + gap) / (width + gap)) || 1);

  const columns = columnsFor({ slotCount: n, maxColumns, orientation });
  const rows = Math.max(1, Math.ceil(n / columns));
  const rowHeight = rowHeightFor({
    aspect, slotWidth: width, rows, availableHeight, gap,
  });
  const boardHeight = rowHeight * rows + gap * (rows - 1);

  return {
    columns,
    rows,
    rowHeight,
    boardHeight,
    scale: rowHeight / BASE_HEIGHT,
    // Only a named aspect can overflow; auto is fit-to-page by construction.
    scrolls: boardHeight > Number(availableHeight) + 0.5,
  };
}
