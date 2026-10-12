/**
 * Driving the wall's rotation (#113).
 *
 * ⛔ Kept out of the render path. The board redraws several times a second and
 * the rotation moves every twenty; mixing the two would either page the wall at
 * payload speed or leave the timer fighting the renderer for the display list.
 */

import { micboard } from './app.js';
import { renderDisplayList } from './channelview.js';
import {
  buildPages, shouldPage, nextPage, rotationLabel,
} from './rotation.mjs';

const BAR_ID = 'rotation-bar';

// How often the driver wakes. It compares elapsed time against the current
// page's own dwell, so groups can hold for different lengths without each
// needing its own timer.
const TICK_MS = 1000;

// ⚠️ How long the board stays still after somebody touches it. Long enough
// that reading a card is not a race, short enough that a wall nobody is at
// returns to rotating on its own.
const QUIET_SECONDS = 30;

let timer = null;
let pageIndex = 0;
let heldSince = 0;
let lastInteraction = 0;
let applied = false;

/** Channels the board would want somebody to look at right now. */
function criticalSlots() {
  const transmitters = micboard.transmitters || {};
  return Object.keys(transmitters)
    .filter((slot) => {
      const status = String((transmitters[slot] || {}).status || '').toUpperCase();
      return status === 'CRITICAL' || status === 'TX_COM_ERROR' || status === 'RX_COM_ERROR';
    })
    .map((slot) => Number(slot));
}

/**
 * Whether **all** the channels overflow the screen.
 *
 * ⛔ Captured while everything is on display, and then trusted. Measuring the
 * live DOM during a rotation asks the wrong question: once paging has shrunk
 * the board to one group it fits, so the rotation concluded it was no longer
 * needed and stopped after the first page.
 *
 * ⚠️ An earlier attempt measured a card instead, to compute capacity -- but
 * `.mic_name` is the name bar, not the card, so it worked out that twenty-one
 * rows fitted and nothing ever overflowed. The board's own scroll height is the
 * honest measure; it just has to be taken at the right moment.
 */
let overflowedWhenFull = false;
let measured = false;

/**
 * Take the measurement, but only once there is something to measure.
 *
 * ⛔ Taken at startup it was always false: the driver starts on
 * DOMContentLoaded and the board has no cards yet, so nothing overflowed and
 * that answer was then trusted for the life of the session. It has to wait for
 * the first render, and it has to happen before a page replaces the full board.
 */
function measureOverflowOnce() {
  if (measured) return;
  const board = document.getElementById('micboard');
  if (!board || !board.querySelector('.mic_name')) return;
  overflowedWhenFull = board.scrollHeight > board.clientHeight + 1;
  measured = true;
}

function pagesNow() {
  const groups = micboard.config && Array.isArray(micboard.config.groups)
    ? micboard.config.groups
    : [];
  return buildPages(groups, { perPage: micboard.rotationPerPage });
}

function renderBar(pages, held, reason) {
  let bar = document.getElementById(BAR_ID);
  if (!pages.length) {
    if (bar && bar.parentElement) bar.parentElement.removeChild(bar);
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.className = 'rotation-bar';
    bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }

  // ⚠️ Says it is holding and why. A rotation that simply stops looks like a
  // frozen board, which is the one impression this must never give.
  const name = rotationLabel(pages, pageIndex);
  const dots = pages.map((_, i) => (i === pageIndex ? '●' : '○')).join(' ');
  bar.textContent = held ? `${name} — holding: ${reason}` : name;
  bar.dataset.dots = dots;
  bar.classList.toggle('is-held', !!held);
}

function stopRendering() {
  const bar = document.getElementById(BAR_ID);
  if (bar && bar.parentElement) bar.parentElement.removeChild(bar);
}

function tick() {
  measureOverflowOnce();
  const pages = pagesNow();
  const enabled = micboard.rotation === 'on';

  if (!shouldPage({ enabled, overflows: overflowedWhenFull, pageCount: pages.length })) {
    // ⛔ Everything fits, or rotation is off. The board goes back to showing
    // what it was showing and says nothing — this is not a screensaver.
    stopRendering();
    applied = false;
    return;
  }

  // ⚠️ The first tick that decides paging is needed has to put page 0 up; the
  // advance path only fires once a dwell has elapsed, and the hold path only
  // redraws when the page changes.
  if (!applied) {
    applied = true;
    heldSince = Date.now();
    renderDisplayList(pages[pageIndex].slots);
    renderBar(pages, false, '');
    return;
  }

  const interacting = (Date.now() - lastInteraction) / 1000 < QUIET_SECONDS;
  const elapsed = (Date.now() - heldSince) / 1000;
  const currentDwell = (pages[pageIndex] && pages[pageIndex].dwell) || 20;

  const step = nextPage({
    pages, current: pageIndex, criticalSlots: criticalSlots(), interacting,
  });

  // A hold applies immediately; an advance waits for the page's own dwell.
  if (step.held) {
    if (step.index !== pageIndex) {
      pageIndex = step.index;
      heldSince = Date.now();
      renderDisplayList(pages[pageIndex].slots);
    }
    renderBar(pages, true, step.reason);
    return;
  }

  if (elapsed < currentDwell) {
    renderBar(pages, false, '');
    return;
  }

  pageIndex = step.index;
  heldSince = Date.now();
  renderDisplayList(pages[pageIndex].slots);
  renderBar(pages, false, '');
}

/** Note that somebody is using the board, so the page does not move under them. */
export function noteInteraction() {
  lastInteraction = Date.now();
}

/**
 * Start the rotation driver.
 *
 * ⚠️ One timer, cleared before another is made. A board left running overnight
 * must not accumulate them, and this is called again whenever the view changes.
 */
export function startRotation() {
  stopRotation();
  pageIndex = 0;
  applied = false;
  heldSince = Date.now();
  // ⛔ Turning the rotation on is not "somebody is using the board". The key
  // press that starts it would otherwise count as interaction and hold the
  // first page for the whole quiet period -- press R, watch nothing happen for
  // thirty seconds, conclude it is broken.
  lastInteraction = 0;
  // ⛔ Measured here, before the first page replaces the full board. This is
  // the only moment the question "does the whole show fit" can be answered by
  // looking.
  measured = false;
  measureOverflowOnce();
  // ⚠️ And show the first page now rather than on the next tick. The hold
  // branch only redraws when the page *changes*, so starting on page 0 left
  // the board showing every channel while the bar said "Worship".
  timer = setInterval(tick, TICK_MS);
  tick();
}

export function stopRotation() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  stopRendering();
}
