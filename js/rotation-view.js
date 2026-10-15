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
  pagesForBoard, nextPage, rotationLabel, DEFAULT_DWELL_SECONDS,
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

// ⛔ The slot list currently on the board, so a page whose *contents* changed
// is redrawn even though its index did not (#215). The driver used to redraw
// only when `pageIndex` moved, so anything that changes what a page holds --
// a resize or a card-shape change moving `capacity`, a sync rewriting a group,
// the operator picking a different group -- left the old cards up while the bar
// described the new page. Measured on a development board: capacity 4 over
// twelve channels drew **two** cards.
let drawn = '';

/** Put a page up, if it is not already up. */
function showPage(page) {
  const slots = (page && page.slots) || [];
  const key = slots.join(',');
  if (key === drawn) {
    return;
  }
  drawn = key;
  renderDisplayList(slots);
}

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
// ⛔ No DOM overflow measurement any more (#202). It read
// `board.scrollHeight > board.clientHeight` on the full board -- but under
// capacity-driven paging the full board is never rendered, so it would have
// read false for ever and paging would never have started. The layout says
// whether every channel fits, arithmetically, before anything is drawn.

/**
 * What the board is showing, and how much of it fits.
 *
 * ⭐ `capacity` is published by `updateTvLayoutMetrics`, which already computed
 * it. Deriving it again here would mean two places reading the container's width
 * and calling `computeLayout`, which is the fault #57 was about -- and they
 * would disagree the first time one of them was changed.
 *
 * ⛔⛔ `displayList` is the Showing selection, and that is the point (#215).
 * `renderGroup` sets it to `allSlots()` for *All channels* and to the group's own
 * slots for a group, and `renderDisplayList(page.slots)` never writes it back --
 * so it is still the whole selection after paging has started. The version this
 * replaces read `config.groups` instead and never consulted it, which handed a
 * board showing everything one group's slots in one group's order.
 */
function boardState() {
  const capacity = Number(micboard.boardCapacity) > 0
    ? Number(micboard.boardCapacity)
    : Infinity;
  const shown = (micboard.displayList || []).filter((slot) => Number(slot) > 0);
  const groups = micboard.config && Array.isArray(micboard.config.groups)
    ? micboard.config.groups
    : [];
  return { capacity, shown, groups };
}

/**
 * The bar at the foot of the wall.
 *
 * %s It says *why* the board is moving, because "required" and "requested" look
 * identical on screen and are not the same thing to the person watching. A
 * board paging because it must also says how many channels there are, which is
 * the question an operator actually has when a wall starts moving on its own:
 * am I seeing everything? The answer is yes, in parts.
 *
 * %s No countdown while holding. A hold has no end time, and a number that never
 * reaches zero reads as a frozen board -- the one impression this must never
 * give.
 */
function renderBar(pages, {
  held = false, heldReason = '', why = null, secondsLeft = null, shown = 0, total = 0,
} = {}) {
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

  // %s Built from spans rather than one string, because the parts are styled
  // differently and were previously concatenated into `textContent` -- which is
  // why the dots, set on `dataset`, were never drawn by anything.
  bar.textContent = '';
  const part = (text, className) => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    bar.appendChild(el);
    return el;
  };

  part(held ? `${name} — holding: ${heldReason}` : name, 'rotation-bar__name');

  // The channel count, only when the board is paging because it has to. On a
  // rotation the operator asked for, nothing is being withheld, so saying
  // "12 of 12" would raise a question that does not exist.
  if (why === 'required' && Number(total) > 0) {
    part(`${shown} of ${total} channels`, 'rotation-bar__scope');
  }

  part(dots, 'rotation-bar__dots');

  if (!held && Number.isFinite(secondsLeft)) {
    part(`${Math.max(0, Math.ceil(secondsLeft))}s`, 'rotation-bar__secs');
  }

  bar.dataset.dots = dots;
  bar.dataset.why = why || '';
  bar.classList.toggle('is-held', !!held);
  bar.classList.toggle('is-required', why === 'required');
}

function stopRendering() {
  const bar = document.getElementById(BAR_ID);
  if (bar && bar.parentElement) bar.parentElement.removeChild(bar);
}

function tick() {
  const { capacity, shown, groups } = boardState();
  const total = shown.length;

  // ⛔ One decider, and it answers *why* **and what** (#215). Nothing else in
  // here asks `micboard.rotation` directly, so the preference and the overflow
  // cannot be read as contending answers to the same question -- and nothing
  // else chooses the pages, so the reason and the content cannot disagree.
  const { pages, why } = pagesForBoard({
    capacity, shown, group: micboard.group, groups, rotationPref: micboard.rotation,
  });

  // ⛔ So the view panel can say why the switch is not in force. A board
  // visibly paging while the panel reads "Off" is the bug, even when the code
  // is right -- that was the maintainer's warning about this being "a little
  // bit of both".
  micboard.pagingReason = why;
  micboard.pagingScope = why ? { shown: capacity, total } : null;

  if (!why) {
    // ⛔ Everything fits and the operator did not ask. The board goes back to
    // showing what it was showing and says nothing -- this is not a screensaver.
    //
    // ⛔⛔ "Goes back to showing" has to actually redraw (#215). It used to only
    // take the bar down, so a board that stopped needing to page was left on
    // whichever page it had reached -- two of twelve channels on screen, no bar,
    // and nothing anywhere saying ten were missing. That is the one failure this
    // display cannot afford, and it is the quietest form of it.
    //
    // ⚠️ Only on the way out of paging. `tick` runs every second and
    // `renderDisplayList` rebuilds the board and its charts; doing that on every
    // idle tick would be a redraw a second for ever.
    if (applied) {
      drawn = '';
      renderDisplayList(micboard.displayList || []);
    }
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
    showPage(pages[pageIndex]);
    renderBar(pages, {
      why,
      secondsLeft: (pages[pageIndex] && pages[pageIndex].dwell) || DEFAULT_DWELL_SECONDS,
      shown: pages[pageIndex].slots.length,
      total,
    });
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
      showPage(pages[pageIndex]);
    }
    renderBar(pages, {
      held: true,
      heldReason: step.reason,
      why,
      shown: pages[pageIndex].slots.length,
      total,
    });
    return;
  }

  if (elapsed < currentDwell) {
    // ⚠️ Still this page's turn, but its contents may have changed under us.
    showPage(pages[pageIndex]);
    // ⭐ The countdown was computed here all along and never passed on:
    // `elapsed` and `currentDwell` are both above, and `renderBar` only ever
    // received the page name.
    renderBar(pages, {
      why,
      secondsLeft: currentDwell - elapsed,
      shown: pages[pageIndex].slots.length,
      total,
    });
    return;
  }

  pageIndex = step.index;
  heldSince = Date.now();
  showPage(pages[pageIndex]);
  // ⚠️ The page has just turned, so the countdown starts at this page's own
  // dwell rather than carrying the one that ran out.
  renderBar(pages, {
    why,
    secondsLeft: (pages[pageIndex] && pages[pageIndex].dwell) || DEFAULT_DWELL_SECONDS,
    shown: pages[pageIndex].slots.length,
    total,
  });
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
  drawn = '';
  heldSince = Date.now();
  // ⛔ Turning the rotation on is not "somebody is using the board". The key
  // press that starts it would otherwise count as interaction and hold the
  // first page for the whole quiet period -- press R, watch nothing happen for
  // thirty seconds, conclude it is broken.
  lastInteraction = 0;
  // ⛔ Nothing to measure here any more (#202). Whether the show fits is
  // arithmetic from the layout, not something that has to be read off the DOM
  // in the one instant before the first page replaces the full board.
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
