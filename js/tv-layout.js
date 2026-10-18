import { micboard } from './app.js';
import { computeLayout, gridTemplateFor, layoutSlotCount } from './board-layout.mjs';
import { minColumnPixelsForScreen, screenById } from './display-geometry.mjs';
import { dockPositionsForScreen } from './docks.mjs';
import { reservedStripHeight } from './live-strip.mjs';
import { repageForCapacity } from './rotation-view.js';

let tvResizeObserver;
let tvMutationObserver;
let scheduled = false;
let bindingsReady = false;

function scheduleUpdate() {
  if (scheduled) {
    return;
  }
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    updateTvLayoutMetrics();
  });
}

function countVisibleSlots(board) {
  const slots = board.querySelectorAll('.col-sm');
  if (!slots.length) {
    return 0;
  }
  let count = 0;
  slots.forEach((slot) => {
    const style = window.getComputedStyle(slot);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return;
    }
    count += 1;
  });
  return count;
}

function readNumeric(value, fallback = 0) {
  if (!value) {
    return fallback;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function updateTvLayoutMetrics() {
  const container = document.getElementById('container');
  const board = document.getElementById('micboard');
  if (!container || !board) {
    return;
  }

  const isTvMode = container.classList.contains('tvmode');
  if (!isTvMode) {
    container.style.setProperty('--tvmode-rows', '1');
    container.style.setProperty('--tvmode-columns', '1');
    container.style.setProperty('--tvmode-slot-count', '0');
    container.style.setProperty('--tvmode-row-height', '100vh');
    container.style.setProperty('--tvmode-board-height', '100vh');
    container.style.setProperty('--tvmode-scale', '1');
    // ⛔ The board's grid template is this function's too, so it has to be put
    // back here (#204). Returning without it left whatever TV mode last wrote,
    // and `--tvmode-slot-width` does not exist outside `.tvmode` -- the
    // declaration then computed to `none` and desk mode collapsed to one
    // full-width column. Five of the six things reset above were, and this one
    // was not.
    board.style.gridTemplateColumns = gridTemplateFor({ isTvMode: false });
    // ⛔ Desk mode does not page by capacity: none of the layout controls apply
    // there, so there is no screenful to be over. Rotation through groups still
    // works -- `pagingReason` reaches that on the operator's preference, not on
    // this. `Infinity` is "never splits a group", which is what `buildPages`
    // did for every board before #201.
    micboard.boardCapacity = Infinity;
    return;
  }

  // ⛔⛔ What the board is SHOWING, not what it has drawn. See
  // `layoutSlotCount`: counting the rendered cards made capacity decay to 1 on
  // any board that paged, because each pass measured the previous page.
  const slotCount = layoutSlotCount({
    shown: micboard.displayList,
    drawn: countVisibleSlots(board),
  });
  const containerStyle = window.getComputedStyle(container);
  const slotWidth = readNumeric(containerStyle.getPropertyValue('--tvmode-slot-width'), 420);
  const gap = readNumeric(containerStyle.getPropertyValue('--tvmode-grid-gap'), 6);
  const paddingLeft = readNumeric(containerStyle.paddingLeft, 0);
  const paddingRight = readNumeric(containerStyle.paddingRight, 0);
  // ⛔⛔ The BOARD's padding too, not just the container's. The grid is laid
  // out inside `.wirelessboard-board`, which carries `padding-left` and
  // `padding-right` of one grid gap -- so measuring the container alone makes
  // the arithmetic 12px optimistic, and 12px is exactly the difference between
  // four columns and three at some widths.
  //
  // ⭐ Measured on a development board: a 1707px container computed
  // `--tvmode-columns: 4` while the grid laid out three, so `rows` was 3 where
  // the board needed 4 -- and the fourth row went below the fold. That is the
  // clipped bottom row photographed on the wall (#171): not the status bar
  // covering it, but the layout believing the board was one column wider than
  // it is.
  const boardStyle = window.getComputedStyle(board);
  const boardPadding = readNumeric(boardStyle.paddingLeft, 0) + readNumeric(boardStyle.paddingRight, 0);
  const containerWidth = Math.max(
    0,
    container.clientWidth - paddingLeft - paddingRight - boardPadding,
  );

  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || container.clientHeight || 1080;
  const containerRect = container.getBoundingClientRect();
  // ⭐⭐ The strip reserved for the status bar comes off the top (#188). This is
  // the real fix for the bottom row photographed clipped on the wall:
  // `.rotation-bar` is `position: fixed` at one end of the screen, over a board
  // laid out as though the whole height were available, so it sat on the last
  // row. The board now stops short of it.
  //
  // ⛔ Taken whether or not the board is paging. Reserving it only while the bar
  // is up would be a feedback loop: the strip lowers `availableHeight`, which
  // lowers `capacity`, which can be what makes the board page, which puts the
  // bar up. `off` is there for an operator who wants the pixels back.
  // ⛔⛔ A CONSTANT, and it has to stay one. It was briefly measured from the
  // rendered bar, to stop a bar taller than its strip landing on the cards --
  // and that reopened the loop the note above warns about, by a route the
  // change did not consider.
  //
  // The bar's *type* is root-relative, so the layout cannot change it. Its
  // **content** is not: at rest it reads "Showing all N channels" on one line,
  // and the moment a channel needs attention it gains a reason, the page dots
  // and a countdown, wraps to two lines and doubles in height. That shrinks
  // `availableHeight`, which shrinks `capacity`, which is what made the board
  // page in the first place -- so it keeps paging, and keeps the taller bar up.
  //
  // ⛔ Reported from the wall: switching on one transmitter dropped cards off
  // the board and left it saying "holding: a channel needs attention".
  //
  // The overlap it was trying to fix is now the bar's problem, not the
  // layout's: `.rotation-bar` is clamped to exactly this height and clips its
  // own content, so the reserve and the bar can never disagree.
  const statusStrip = micboard.statusBar === 'off'
    ? 0
    : readNumeric(containerStyle.getPropertyValue('--statusbar-height'), 0);

  // ⛔⛔ The service-position strip, which was never reserved at all (#121).
  // `.live-strip.live-at-bottom` is `position: fixed; bottom: 0` at z-index
  // 1020, and the only thing making room for it was a hard-coded
  // `padding-bottom: 2.25rem` on the board — which this arithmetic never knew
  // about, so the rows were sized for the full height and the last one ran on
  // underneath the strip. Reported from the wall: "when the service bar is on
  // the bottom, it overlaps the information on the cards."
  //
  // ⭐ Exactly the fault #188 fixed for the paging bar, in this same function,
  // left unfixed for its neighbour.
  //
  // ⚠️ Measured, not assumed. The strip's type is `calc(var(--tvmode-type-basis)
  // * 0.1)`, so on a television it is taller than 2.25rem and a fixed reserve
  // under-books it however correct the accounting is.
  const liveStripEl = document.getElementById('live-strip');
  const liveStrip = reservedStripHeight(
    micboard.livePlacement,
    liveStripEl ? liveStripEl.offsetHeight : 0,
  );
  // One number, three consumers: the board's padding and the status bar's
  // offset both read it, so the space reserved and the space left can never
  // disagree.
  //
  // ⛔⛔ On `body`, not on the container. `.rotation-bar` is appended to
  // `document.body` and is `position: fixed`, so it is NOT a descendant of the
  // container and inherits nothing set there -- it would silently fall back to
  // the hard-coded default and sit inside the service strip again.
  document.body.style.setProperty('--live-strip-height', `${liveStrip}px`);

  const availableHeight = Math.max(
    240,
    viewportHeight - containerRect.top - statusStrip - liveStrip,
  );

  // ⛔ The physical floor, where the screen has been described (#170). The
  // television hangs above the charging dock, so a column has to be wide
  // enough to point at the microphone underneath it. Undescribed screens get
  // null, which means no floor and the board behaves exactly as before.
  // ⚠️ Resolution from the browser, physical size from the configuration. The
  // screen reports its own pixels, so nobody has to type them and they cannot
  // describe a screen the board is not on.
  // ⛔⛔ **The docks, which were never passed.** `minColumnPixelsForScreen`
  // takes `docks = []` by default, and this call omitted it -- so the width
  // came from the legacy `min_column_inches` on the screen row or from
  // nothing at all, and the dock a screen names reached the layout NEVER.
  //
  // That is why #170/#201 "shipped three times and engaged zero": not the
  // save, not the screen description, this one argument. A described screen
  // over a described dock measured 3.9in positions and the board went on
  // laying itself out as though nothing was underneath it.
  const screens = (micboard.config && micboard.config.screens) || [];
  const docks = (micboard.config && micboard.config.docks) || [];
  const forScreen = {
    screens,
    screenId: micboard.screenId,
    docks,
  };
  const minColumnWidth = minColumnPixelsForScreen({
    ...forScreen,
    widthPx: (window.screen && window.screen.width) || window.innerWidth,
    heightPx: (window.screen && window.screen.height) || window.innerHeight,
  });

  // ⭐ And the dock's own count (A3). A column points at a physical place
  // below the screen, so where the places are counted the count is theirs --
  // eight channels under eleven places still draw eleven columns. Null unless
  // every dock under the screen declares its positions, and then nothing
  // changes.
  const dockPositions = dockPositionsForScreen({
    screen: screenById(screens, micboard.screenId),
    docks,
  });

  const {
    columns, rows, rowHeight, cardWidth, boardHeight, scale, scrolls, columnsLimitedByWidth,
    capacity,
  } = computeLayout({
    slotCount,
    containerWidth,
    availableHeight,
    slotWidth,
    gap,
    arrangement: micboard.arrangement,
    shape: micboard.cardShape,
    columns: micboard.columns,
    minColumnWidth,
    dockPositions,
  });

  container.style.setProperty('--tvmode-rows', rows.toString());
  container.style.setProperty('--tvmode-columns', columns.toString());
  container.style.setProperty('--tvmode-slot-count', slotCount.toString());
  container.style.setProperty('--tvmode-row-height', `${rowHeight}px`);
  container.style.setProperty('--tvmode-board-height', `${boardHeight}px`);
  container.style.setProperty('--tvmode-scale', scale.toFixed(4));

  // Only a fixed card aspect can outgrow the screen. TV mode hides overflow so
  // a fit-to-page board never scrolls by accident; when the operator has asked
  // for a shape instead, the rows below the fold have to be reachable.
  container.classList.toggle('tvmode-scrolls', Boolean(scrolls));

  container.style.setProperty('--tvmode-card-width', `${cardWidth}px`);

  // ⭐ How many channels one screenful holds, published for the rotation driver
  // (#201/#202). It is `buildPages`' `perPage`, which has been read from
  // `micboard.rotationPerPage` and written nowhere since #113 -- so a group has
  // never once been split.
  //
  // ⛔ Published rather than recomputed. The driver deriving it would mean two
  // places reading the container's width and calling `computeLayout`, and they
  // would disagree the first time either changed.
  const capacityChanged = micboard.boardCapacity !== capacity;
  micboard.boardCapacity = capacity;

  // ⭐ Tell the rotation driver at once, rather than leaving it to notice on its
  // next tick up to a second later. See `repageForCapacity` for why this is
  // deferred rather than called straight through -- this function is the one it
  // would otherwise re-enter.
  if (capacityChanged) {
    setTimeout(() => { try { repageForCapacity(); } catch (_) {} }, 0);
  }

  // ⚠️ So an operator who asked for one row and got two can tell a rule from
  // a bug. Nothing styles this yet; it is the hook for saying so.
  container.classList.toggle('tvmode-width-limited', Boolean(columnsLimitedByWidth));

  // ⭐ The same function the not-TV branch above calls, so the two cannot drift
  // (#204). Why `fit` and the not-TV case both come back empty is written where
  // the rule lives, in `board-layout.mjs`, rather than here where only half of
  // it is visible.
  board.style.gridTemplateColumns = gridTemplateFor({
    isTvMode: true,
    arrangement: micboard.arrangement,
    columns,
  });
}

export function requestTvLayoutUpdate() {
  scheduleUpdate();
}

export function startTvLayoutWatchers() {
  if (bindingsReady) {
    scheduleUpdate();
    return;
  }
  const container = document.getElementById('container');
  const board = document.getElementById('micboard');
  if (!container || !board) {
    return;
  }
  bindingsReady = true;

  window.addEventListener('resize', scheduleUpdate, { passive: true });

  if (typeof ResizeObserver === 'function') {
    tvResizeObserver = new ResizeObserver(scheduleUpdate);
    tvResizeObserver.observe(container);
  }

  if (typeof MutationObserver === 'function') {
    tvMutationObserver = new MutationObserver(scheduleUpdate);
    tvMutationObserver.observe(board, { childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  }

  scheduleUpdate();
}
