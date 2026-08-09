import { micboard } from './app.js';
import { computeLayout } from './board-layout.mjs';

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

  const {
    columns, rows, rowHeight, boardHeight, scale, scrolls,
  } = computeLayout({
    slotCount,
    containerWidth,
    availableHeight,
    slotWidth,
    gap,
    orientation: micboard.gridOrientation,
    aspect: micboard.slotAspect,
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

  // The grid template is driven by auto-fit at the slot width, which always
  // packs as many across as fit. A chosen orientation has to state the column
  // count outright or it would be ignored.
  board.style.gridTemplateColumns = micboard.gridOrientation && micboard.gridOrientation !== 'auto'
    ? `repeat(${columns}, minmax(0, var(--tvmode-slot-width)))`
    : '';
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
