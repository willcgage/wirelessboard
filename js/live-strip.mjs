/**
 * Where the service has got to, on the board (#121).
 *
 * ⛔ **Live is often not running.** The strip has to look deliberate when there
 * is nothing to show, because that is most services here. Every state it can be
 * in says something specific; none of them is an empty box.
 *
 * ⚠️ Two settings, on two different sides of the line #116 drew:
 *
 * - **whether to follow Live at all** is server-side and global. It costs API
 *   calls against one Planning Center account, so one board turning it on
 *   spends everyone's allowance; it belongs with the rest of the PCO config.
 * - **where the strip appears** is a view preference, per device. The wall
 *   wants the spare card; a phone in a pocket wants the top. Those are not the
 *   same board disagreeing, they are two surfaces with different shapes.
 */

/** Where the strip can sit. `card` claims a grid cell the channels are not using. */
export const PLACEMENTS = ['bottom', 'top', 'card', 'off'];
export const DEFAULT_PLACEMENT = 'bottom';

export const PLACEMENT_LABELS = {
  bottom: 'Bottom', top: 'Top', card: 'Spare card', off: 'Hidden',
};

export function placement(value) {
  const text = String(value || '').trim().toLowerCase();
  return PLACEMENTS.includes(text) ? text : DEFAULT_PLACEMENT;
}

/**
 * Whether the strip should be on screen at all.
 *
 * ⚠️ `off` here is the operator hiding it on *this* screen, which is a
 * different fact from the server saying `state: 'off'` because nobody enabled
 * following Live. Both end in nothing being drawn, and only one of them is
 * worth a setting.
 */
export function isVisible(live, where) {
  if (placement(where) === 'off') {
    return false;
  }
  return !!live && live.state && live.state !== 'off';
}

/**
 * Whether the strip is taking a cell out of the grid.
 *
 * ⛔ The card does **not** rotate: once placed it holds its cell on every page
 * of #113's rotation. A panel that appeared and vanished as the wall paged
 * would be unreadable — so the cell is simply gone from the channel layout for
 * as long as the strip is placed there.
 */
export function claimsCell(live, where) {
  return placement(where) === 'card' && isVisible(live, where);
}

/**
 * How many cells the channels may use.
 *
 * ⚠️ Never returns fewer than one. A board configured down to a single cell
 * with the card placed would otherwise show no channels at all, which is a
 * worse answer than ignoring the placement.
 */
export function cellsForChannels(total, live, where) {
  const cells = Number(total);
  if (!Number.isFinite(cells) || cells <= 0) {
    return 0;
  }
  if (!claimsCell(live, where)) {
    return cells;
  }
  return Math.max(1, cells - 1);
}

/**
 * The warning to show beside the placement control, or null.
 *
 * ⭐ Said when the choice is made, not discovered afterwards. Picking the card
 * on a full board silently drops a channel off the end, and a channel missing
 * from a wall is exactly the failure this board exists to prevent.
 */
export function placementCost(where, { cells, channels } = {}) {
  if (placement(where) !== 'card') {
    return null;
  }
  const total = Number(cells);
  const used = Number(channels);
  if (!Number.isFinite(total) || !Number.isFinite(used)) {
    return null;
  }
  if (used < total) {
    return null;
  }
  const hidden = used - (total - 1);
  return `There is no spare cell, so ${hidden} channel${hidden === 1 ? '' : 's'} will not fit.`;
}

/** The headline: the current item, or why there isn't one. */
export function headline(live) {
  if (!live || !live.state) {
    return '';
  }
  if (live.state === 'running' || live.state === 'stale') {
    return (live.current && live.current.title) || 'Untitled item';
  }
  return live.label || '';
}

/**
 * What comes after the current item, or null.
 *
 * ⚠️ Only while something is actually running. "Next: Welcome" on a board
 * where Live was never started describes a plan, not a service, and reads as
 * though the service were under way.
 */
export function upNext(live) {
  if (!live || live.state !== 'running') {
    return null;
  }
  const title = live.next && live.next.title;
  return title ? String(title) : null;
}

/**
 * The timer, or null when there is nothing to count.
 *
 * ⛔ `known: false` yields null rather than a zero. A mode whose inputs are
 * missing cannot be shown as "0:00" — that is a statement about the service,
 * and it would be a false one.
 */
export function timerText(live) {
  if (!live || live.state !== 'running') {
    return null;
  }
  const { timer } = live;
  if (!timer || timer.known !== true) {
    return null;
  }
  return live.clock || null;
}

/** True when the current item has run past its time — Live turns red here. */
export function isOver(live) {
  return !!(live && live.state === 'running' && live.timer && live.timer.over === true);
}

/**
 * The class the strip wears, so the stylesheet says what each state looks like
 * rather than this module setting colours.
 */
export function stripClass(live) {
  const state = (live && live.state) || 'off';
  return `live-strip live-${state}${isOver(live) ? ' live-over' : ''}`;
}

/**
 * How much board height the strip takes away from the grid.
 *
 * ⛔⛔ Zero for every placement except `top` and `bottom`. `card` claims a grid
 * cell instead — `cellsForChannels` already accounts for that — and reserving
 * height for it as well would take the space twice. `off` draws nothing.
 *
 * ⚠️ `height` is measured from the rendered strip, never assumed. Its type
 * scales with the board (`--tvmode-type-basis`), so on a television it is
 * taller than the 2.25rem that used to be hard-coded for it, and a fixed
 * reserve under-books the space however correct the arithmetic around it is.
 *
 * Pure so the rule can be tested without a layout: the caller does the
 * measuring, this decides whether it counts.
 */
export function reservedStripHeight(where, height) {
  const spot = placement(where);
  if (spot !== 'top' && spot !== 'bottom') {
    return 0;
  }
  const px = Number(height);
  return Number.isFinite(px) && px > 0 ? px : 0;
}
