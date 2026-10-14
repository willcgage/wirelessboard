/**
 * The two signal lines in a card's info drawer (#195).
 *
 * ⛔ Replaces `chart-smoothie.js` and the `smoothie` dependency with it. That
 * module drew a framed, axed, streaming plot about `scale x 200px` tall, and
 * the maintainer's reading of it was that nobody takes a value off it -- the
 * question is "is it steady?". Two 16px trend lines answer that and give the
 * photograph the rest of the height back.
 *
 * ⚠️ Same four exports as the module it replaces, so the five call sites change
 * only their import path.
 */

import { micboard } from './app.js';
import { pushSample, sparklinePoints, levelText } from './sparkline.mjs';

/**
 * Per-slot sample history, keyed by slot.
 *
 * ⚠️ Kept as a module-level map rather than on the element, because `dnd.js`
 * and `channelview.js` both reach for it by slot and the card's element is
 * replaced whenever the board re-renders.
 */
export const charts = {};

/**
 * ⛔ Kept for the clock-skew warning and nothing else.
 *
 * The old chart plotted against real time, so an embedded board whose clock was
 * out drew its history in the wrong place and this decided whether to trust the
 * server's clock or the local one. A sparkline plots against sample *order* and
 * does not care, so nothing here steers the drawing any more -- but the warning
 * is the only thing in the project that notices a board with a bad clock, and
 * that is worth keeping on its own.
 */
export function setTimeMode(servertimeString) {
  const servertime = Date.parse(servertimeString);
  const localtime = new Date().getTime();
  const delta = Math.abs(localtime - servertime);

  if (delta > (30 * 1000)) {
    console.log(`Clock skew: ${delta} ms between this board and the server.`);
    micboard.chartTimeSrc = 'LOCAL';
  } else {
    micboard.chartTimeSrc = 'SERVER';
  }
}

/** The two lines a given receiver type has. */
function seriesFor(type) {
  if (micboard.IEM_MODELS && micboard.IEM_MODELS.indexOf(type) > -1) {
    // ⚠️ An IEM has no RF level to report and two audio channels instead, so
    // its pair of lines is left and right rather than audio and RF.
    return [
      { key: 'left', label: 'L', field: 'audio_level_l' },
      { key: 'right', label: 'R', field: 'audio_level_r' },
    ];
  }
  return [
    { key: 'audio', label: 'AF', field: 'audio_level' },
    { key: 'rf', label: 'RF', field: 'rf_level' },
  ];
}

/**
 * Draw one line into the elements captured when the slot was started.
 *
 * ⛔ Elements, never a root to search from. `initChart` is handed the template's
 * DocumentFragment *before* it is appended, and appending moves its children
 * out and leaves the fragment empty -- so anything that searched from it found
 * nothing the moment the card was on the board. The elements themselves survive
 * being moved, which is why the chart this replaced captured its canvas rather
 * than the thing holding it.
 */
function paint(refs, values, current) {
  if (!refs) {
    return;
  }
  if (refs.line) {
    refs.line.setAttribute('points', sparklinePoints(values));
  }
  if (refs.value) {
    refs.value.textContent = levelText(current);
  }
}

/**
 * Take one payload's samples and redraw that slot's lines.
 *
 * ⚠️ Still guarded on `displayList`. A board paging through its channels (#201)
 * renders only one page at a time, so most payloads arriving are for cards that
 * are not on screen -- appending to their buffers would be work nobody sees,
 * and the history would be meaningless anyway once the card came back with a
 * gap in the middle of it.
 */
export function updateChart(data) {
  if (!micboard.displayList.includes(data.slot)) {
    return;
  }
  const state = charts[data.slot];
  if (!state) {
    return;
  }

  state.series.forEach((series) => {
    const value = data[series.field];
    if (value === undefined) {
      return;
    }
    state.values[series.key] = pushSample(state.values[series.key], value);
    if (micboard.transmitters[data.slot]) {
      micboard.transmitters[data.slot][series.field] = value;
    }
    paint(state.refs[series.key], state.values[series.key], value);
  });
}

/**
 * Start a slot's lines, and label them for the kind of receiver it is.
 *
 * ⛔ Returns the state rather than a chart object with a `stop()` on it. The
 * old one ran an animation loop per card that had to be stopped by hand when a
 * card left the board, and a missed `stop()` left it drawing forever. There is
 * no loop here: a line is redrawn when a payload arrives and does nothing in
 * between, so a card that goes away simply stops being painted.
 */
export function initChart(slotSelector, data) {
  const series = seriesFor(data && data.type);
  const state = { series, values: {}, refs: {} };

  series.forEach((entry, index) => {
    state.values[entry.key] = [];
    const row = slotSelector.querySelector(`.spark-row-${index === 0 ? 'first' : 'second'}`);
    if (!row) {
      return;
    }
    // Named for the series it carries, so the stylesheet can colour RF
    // differently from audio without the markup knowing which is which.
    row.className = `spark-row spark-${entry.key}`;

    const label = row.querySelector('.spark-label');
    const line = row.querySelector('polyline');
    const value = row.querySelector('.spark-value');
    if (label) {
      label.textContent = entry.label;
    }
    if (line) {
      line.setAttribute('points', '');
    }
    if (value) {
      value.textContent = '';
    }

    // ⛔ The elements, held directly. See `paint`.
    state.refs[entry.key] = { line, value };
  });

  return state;
}
