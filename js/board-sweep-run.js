/**
 * Driving the sweep against a live board (#273, #274, #276).
 *
 * ⛔⛔ **Measures the real board, never a reconstruction.** Every failed
 * diagnosis this answers came from a card assembled by hand in one
 * configuration — no payload, no status classes, no type scale from a layout
 * pass. So this changes the board's own controls, waits for its own layout
 * pass, and reads what is on screen.
 *
 * Run it by loading the board with `#sweep=true`, or from a console:
 *
 *     await window.micboard.sweep()                    // everything
 *     await window.micboard.sweep({ wash: ['rail'] })  // just #274's question
 *
 * ⚠️ It is slow on purpose. Each step waits for the layout to settle, and a
 * measurement taken before it has is the kind of false reading that cost two
 * wrong diagnoses — the recorded case is eighteen combinations passing at
 * 1500ms where two of them failed at 700ms, and those two failures were real.
 */

import { micboard } from './app.js';
import { setViewOption, setInfoDrawer } from './display.js';
import { combinations, formatReport } from './board-sweep.mjs';

/** How long to let the board settle after changing a control. */
const SETTLE_MS = 900;

const rect = (el) => {
  const r = el.getBoundingClientRect();
  return {
    top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height,
  };
};

/**
 * Which elements are painted with the status colour.
 *
 * ⛔ Resolved from what the browser computed, never from the stylesheet. The
 * whole of #274's wrong diagnosis was a rule that reads as though it paints the
 * card and does not — so the only trustworthy question is what colour the
 * element actually ended up.
 *
 * ⚠️ The rail is a pseudo-element, so it needs its own look; a sweep that only
 * walked real elements would miss the half of #274 that is on screen.
 */
function resolveColour(value) {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

function statusPainted(cardEl, micEl) {
  const status = getComputedStyle(micEl).getPropertyValue('--status').trim();
  // ⛔ No flat status colour: `PREV_REPLACE` is a striped gradient. Nothing to
  // look for, so say "cannot tell" rather than "nowhere".
  if (!status) return null;

  const want = resolveColour(status);
  // ⛔⛔ And the states whose status colour IS the neutral ground --
  // `TX_COM_ERROR`, `UNASSIGNED` -- resolve `--status` to #262626, the same
  // value an unpainted card has. Matching those reports every element as
  // painted, which is exactly the false confirmation this sweep produced the
  // first time it ran.
  const neutral = resolveColour(
    getComputedStyle(document.documentElement).getPropertyValue('--color-black').trim() || '#262626',
  );
  if (want === neutral) return null;

  const painted = [];
  const is = (value) => value && value === want;
  if (is(getComputedStyle(micEl).backgroundColor)) painted.push('card');
  // ⚠️ Only when the pseudo-element exists. A `::before` that was never
  // generated still answers `getComputedStyle`, and reading its background as
  // though it were drawn is the other half of the same false positive.
  const before = getComputedStyle(micEl, '::before');
  if (before.content && before.content !== 'none' && is(before.backgroundColor)) painted.push('rail');
  const band = cardEl.querySelector('.card-band');
  if (band && is(getComputedStyle(band).backgroundColor)) painted.push('band');
  return painted;
}

function measureBoard(config) {
  const container = document.getElementById('container');
  const read = (name) => getComputedStyle(container).getPropertyValue(name).trim();
  const cards = [...document.querySelectorAll('.col-sm')].map((cardEl) => {
    const mic = cardEl.querySelector('.mic_name');
    const part = (sel) => {
      const el = cardEl.querySelector(sel);
      return el ? rect(el) : null;
    };
    return {
      slot: Number(cardEl.dataset.slot || (mic && mic.dataset.slot) || 0) || null,
      box: rect(cardEl),
      parts: {
        deviceName: part('p.device-name'),
        role: part('p.card-role'),
        name: part('.card-band .name'),
        runtime: part('.card-runtime'),
        drawer: part('.info-drawer'),
        figures: part('.drawer-figures'),
        sparkFirst: part('.spark-row-first'),
        sparkSecond: part('.spark-row-second'),
        chip: part('.status-chip'),
      },
      statusPainted: mic ? statusPainted(cardEl, mic) : [],
    };
  });
  return {
    config,
    columns: read('--tvmode-columns') || '?',
    rows: read('--tvmode-rows') || '?',
    cards,
  };
}

const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Walk the matrix, measure each board, and report.
 *
 * ⛔ Every control is set through `setViewOption`, which is what the gear's own
 * rows call. Writing `micboard.<pref>` directly would describe a board the
 * product never holds — the layout pass recomputes what it likes, and forcing a
 * value it owns is how a previous sweep "verified" a state that never existed.
 */
export async function sweepBoard(only = {}, { onStep } = {}) {
  if (micboard.displayMode !== 'tvmode') {
    return 'The sweep only applies to Board mode. Switch to Board and run it again.';
  }
  const before = {
    arrangement: micboard.arrangement,
    cardShape: micboard.cardShape,
    wash: micboard.wash,
    columns: micboard.columns,
    statusBar: micboard.statusBar,
    livePlacement: micboard.livePlacement,
    infoDrawerMode: micboard.infoDrawerMode,
  };

  const plan = combinations(only);
  const results = [];
  try {
    for (let i = 0; i < plan.length; i += 1) {
      const config = plan[i];
      for (const [id, value] of Object.entries(config)) {
        // ⚠️ The drawer is not a stored view preference and has its own
        // setter; `setViewOption` silently refuses an id it does not know, so
        // the sweep would have walked the matrix without ever changing it.
        if (id === 'infoDrawerMode') {
          setInfoDrawer(value, { switchToTv: false });
        } else {
          setViewOption(id, value);
        }
      }
      // ⛔ Sequential on purpose, which is what `no-await-in-loop` is
      // warning about. The board has one layout; running these in
      // parallel would mean every step measuring whichever
      // configuration happened to be applied last.
      // eslint-disable-next-line no-await-in-loop
      await settle(SETTLE_MS);
      results.push(measureBoard(config));
      if (onStep) onStep(i + 1, plan.length, config);
    }
  } finally {
    // ⚠️ Always put the board back. This runs on a wall that may be in use, and
    // a sweep that leaves it on the last configuration it tried is worse than
    // no sweep at all.
    for (const [id, value] of Object.entries(before)) {
      if (value == null) continue;
      if (id === 'infoDrawerMode') {
        setInfoDrawer(value, { switchToTv: false });
      } else {
        setViewOption(id, value);
      }
    }
  }

  const report = formatReport(results);
  micboard.sweepResults = results;
  return report;
}

/** Hooked onto the board so a console — or `#sweep=true` — can reach it. */
export function installSweep() {
  micboard.sweep = (only) => sweepBoard(only, {
    onStep: (done, total, config) => {
      if (done === 1 || done === total || done % 25 === 0) {
        // eslint-disable-next-line no-console
        console.log(`sweep ${done}/${total}`, config);
      }
    },
  });
}
