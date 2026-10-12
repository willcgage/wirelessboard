/**
 * Drawing the service-position strip (#121).
 *
 * ⛔ Kept out of the payload handler. The board's data arrives several times a
 * second; the Live position changes every few minutes and is fetched on its
 * own slow timer. Mixing the two would mean either polling Planning Center at
 * board speed or redrawing the strip for nothing.
 */

import {
  placement, isVisible, headline, upNext, timerText, stripClass,
} from './live-strip.mjs';

const STRIP_ID = 'live-strip';
const BOARD_POLL_MS = 15000;

let lastRendered = '';
let timer = null;
/**
 * The last answer from the server.
 *
 * ⚠️ Kept so moving the strip redraws it at once. Without this, pressing the
 * placement key does nothing visible until the next poll — up to fifteen
 * seconds of an operator thinking the key is broken and pressing it again.
 */
let lastLive = null;
let lastPlacement = 'bottom';

/** Where the strip is mounted for each placement. */
function hostFor(where) {
  if (where === 'card') {
    // The grid itself, so the strip sits in a cell alongside the channels.
    return document.getElementById('micboard') || document.body;
  }
  return document.body;
}

function removeStrip() {
  const existing = document.getElementById(STRIP_ID);
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
  document.body.classList.remove('live-strip-top', 'live-strip-bottom', 'live-strip-card');
  lastRendered = '';
}

/**
 * Draw, update or remove the strip.
 *
 * ⚠️ Rebuilt only when what it says changes. The timer ticks every second on a
 * board that is otherwise static, and replacing the node each time would
 * retrigger any transition and fight the browser over text selection.
 */
export function renderLiveStrip(live, where = 'bottom') {
  if (typeof document === 'undefined' || !document.body) {
    return;
  }

  lastLive = live;
  lastPlacement = placement(where);
  const spot = lastPlacement;
  if (!isVisible(live, spot)) {
    removeStrip();
    return;
  }

  const title = headline(live);
  const clock = timerText(live);
  const next = upNext(live);
  const signature = `${spot}|${stripClass(live)}|${title}|${clock}|${next}`;
  if (signature === lastRendered) {
    return;
  }

  let strip = document.getElementById(STRIP_ID);
  const host = hostFor(spot);
  if (!strip || strip.parentElement !== host) {
    if (strip && strip.parentElement) strip.parentElement.removeChild(strip);
    strip = document.createElement('div');
    strip.id = STRIP_ID;
    strip.setAttribute('role', 'status');
    host.appendChild(strip);
  }

  strip.className = `${stripClass(live)} live-at-${spot}`;
  document.body.classList.remove('live-strip-top', 'live-strip-bottom', 'live-strip-card');
  document.body.classList.add(`live-strip-${spot}`);

  strip.innerHTML = '';

  const titleEl = document.createElement('div');
  titleEl.className = 'live-title';
  titleEl.textContent = title;
  strip.appendChild(titleEl);

  if (clock) {
    const clockEl = document.createElement('div');
    clockEl.className = 'live-clock';
    clockEl.textContent = clock;
    strip.appendChild(clockEl);
  }

  if (next) {
    const nextEl = document.createElement('div');
    nextEl.className = 'live-next';
    // ⚠️ Labelled. On a wall, a second line of text under an item title reads
    // as part of the item unless something says otherwise.
    nextEl.textContent = `Next: ${next}`;
    strip.appendChild(nextEl);
  }

  lastRendered = signature;
}

/** Redraw with whatever the server last said — for when the placement moves. */
export function refreshLiveStrip(where) {
  renderLiveStrip(lastLive, where === undefined ? lastPlacement : where);
}

/**
 * Keep the strip fed.
 *
 * ⚠️ Its own timer, slower than the board's. Planning Center rate limits are
 * real and a board left running all week must not hammer them — the same
 * discipline #140's watcher follows.
 *
 * ⛔ A failed fetch leaves the last state up rather than blanking the strip.
 * The server already distinguishes "cannot reach Planning Center" from "Live
 * not running"; a blank strip would throw that distinction away at the browser.
 */
export function startLiveStrip(getPlacement) {
  if (timer) {
    return;
  }
  const tick = () => {
    fetch(`api/pco/live?_=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((live) => renderLiveStrip(live, getPlacement()))
      .catch(() => { /* keep whatever is on screen */ });
  };
  tick();
  timer = setInterval(tick, BOARD_POLL_MS);
}
