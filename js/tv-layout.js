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
  const maxColumns = Math.max(1, Math.floor((containerWidth + gap) / (slotWidth + gap)));
  const columns = Math.max(1, Math.min(maxColumns, slotCount));
  const rows = Math.max(1, Math.ceil(slotCount / columns));

  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || container.clientHeight || 1080;
  const containerRect = container.getBoundingClientRect();
  const availableHeight = Math.max(240, viewportHeight - containerRect.top);
  const rowHeight = (availableHeight - gap * (rows - 1)) / rows;
  const scale = rowHeight / 1080;
  const boardHeight = rowHeight * rows + gap * (rows - 1);

  container.style.setProperty('--tvmode-rows', rows.toString());
  container.style.setProperty('--tvmode-columns', columns.toString());
  container.style.setProperty('--tvmode-slot-count', slotCount.toString());
  container.style.setProperty('--tvmode-row-height', `${rowHeight}px`);
  container.style.setProperty('--tvmode-board-height', `${boardHeight}px`);
  container.style.setProperty('--tvmode-scale', scale.toFixed(4));
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
