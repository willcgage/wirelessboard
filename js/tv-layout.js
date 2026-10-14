import { micboard } from './app.js';
import { computeLayout, gridTemplateFor } from './board-layout.mjs';
import { minColumnPixelsForScreen } from './display-geometry.mjs';

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
    return;
  }

  const slotCount = countVisibleSlots(board) || 1;
  const containerStyle = window.getComputedStyle(container);
  const slotWidth = readNumeric(containerStyle.getPropertyValue('--tvmode-slot-width'), 420);
  const gap = readNumeric(containerStyle.getPropertyValue('--tvmode-grid-gap'), 6);
  const paddingLeft = readNumeric(containerStyle.paddingLeft, 0);
  const paddingRight = readNumeric(containerStyle.paddingRight, 0);
  const containerWidth = Math.max(0, container.clientWidth - paddingLeft - paddingRight);

  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || container.clientHeight || 1080;
  const containerRect = container.getBoundingClientRect();
  const availableHeight = Math.max(240, viewportHeight - containerRect.top);

  // ⛔ The physical floor, where the screen has been described (#170). The
  // television hangs above the charging dock, so a column has to be wide
  // enough to point at the microphone underneath it. Undescribed screens get
  // null, which means no floor and the board behaves exactly as before.
  // ⚠️ Resolution from the browser, physical size from the configuration. The
  // screen reports its own pixels, so nobody has to type them and they cannot
  // describe a screen the board is not on.
  const screens = (micboard.config && micboard.config.screens) || [];
  const minColumnWidth = minColumnPixelsForScreen({
    screens,
    screenId: micboard.screenId,
    widthPx: (window.screen && window.screen.width) || window.innerWidth,
    heightPx: (window.screen && window.screen.height) || window.innerHeight,
  });

  const {
    columns, rows, rowHeight, cardWidth, boardHeight, scale, scrolls, columnsLimitedByWidth,
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
