/**
 * Sparklines for the card's two signals (#195).
 *
 * ⭐ Pure, and deliberately so. Everything here is arithmetic on an array of
 * numbers, which means the shape of a line can be tested without a DOM — this
 * project has no jsdom, so anything that reaches the document cannot be tested
 * at all, and the geometry is the half most worth pinning.
 *
 * ⛔ Replaces a streaming `SmoothieChart` on a canvas. Nobody read a value off
 * that chart; the question a board answers is "is it steady?", and a trend line
 * answers it in a sixth of the height. The number beside it is more precise
 * than reading a pixel ever was.
 */

/**
 * How many samples a line remembers.
 *
 * ⚠️ Samples, not seconds. The board's payload arrives several times a second
 * and not on a fixed cadence, so a line of 40 points covers however long 40
 * updates took. The old chart plotted against real time and needed the server
 * clock for it (`setTimeMode`); a sparkline does not care when a sample
 * arrived, only in what order — which removes a whole class of fault on
 * embedded boards whose clock is out.
 */
export const SAMPLES = 40;

/**
 * The buffer with `value` appended, oldest dropped once it is full.
 *
 * Returns a new array rather than mutating: the caller keeps one per slot and
 * a mutating push makes it far too easy for two slots to end up sharing one.
 */
export function pushSample(values, value, limit = SAMPLES) {
  const kept = Array.isArray(values) ? values : [];
  // ⛔ A non-number is dropped rather than stored. `NaN` in the buffer makes
  // every later point of the polyline unparseable, so one bad payload would
  // blank the line until the buffer rolled over.
  //
  // ⚠️ `null` and `''` are rejected before `Number` sees them, because
  // `Number(null)` and `Number('')` are both **0** -- a channel reporting
  // nothing would have drawn a line along the floor, which is what a dead
  // microphone looks like. Absent is not silent.
  if (value === null || value === undefined || value === '') {
    return kept.slice(-limit);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return kept.slice(-limit);
  }
  const out = kept.concat(n);
  return out.length > limit ? out.slice(out.length - limit) : out;
}

/**
 * The `points` attribute for a `<polyline>`, in the box `width` x `height`.
 *
 * ⚠️ `min`/`max` are the *meter's* range, not the data's. Both signals are
 * normalised server-side to a percentage of full scale — `set_audio_level` and
 * `set_rf_level` each fold four different receiver encodings into 0-100 — so a
 * fixed range is what makes two cards comparable. Scaling each line to its own
 * extremes would make a dead channel's noise look like a healthy signal.
 */
export function sparklinePoints(values, {
  width = 92, height = 16, min = 0, max = 100,
} = {}) {
  const list = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(Number(v)));
  if (!list.length) {
    return '';
  }

  const span = Number(max) - Number(min);
  const safeSpan = span === 0 ? 1 : span;
  // Half a stroke in from each edge, so a line at full or zero scale is not
  // clipped in half by the viewBox.
  const top = 1;
  const usable = Math.max(1, Number(height) - 2);

  const y = (value) => {
    const clamped = Math.min(Math.max(Number(value), Number(min)), Number(max));
    const ratio = (clamped - Number(min)) / safeSpan;
    return +(top + (1 - ratio) * usable).toFixed(2);
  };

  // ⭐ One sample draws a flat line across the full width rather than a dot.
  // A single point in a polyline renders nothing at all, so a card that had
  // just appeared showed an empty box that read as "no signal" rather than
  // "not enough history yet".
  if (list.length === 1) {
    const only = y(list[0]);
    return `0,${only} ${Number(width)},${only}`;
  }

  const step = Number(width) / (list.length - 1);
  return list
    .map((value, i) => `${+(i * step).toFixed(2)},${y(value)}`)
    .join(' ');
}

/**
 * What the number beside a line reads.
 *
 * ⛔ A percentage, and never dB. Both levels arrive as a percentage of full
 * scale, folded there from four different receiver encodings by `set_audio_level`
 * and `set_rf_level` — a QLX-D doubles its raw audio, an AXT-D subtracts 20, an
 * SLX-D reports dBFS as 000-120. Printing "dB" beside the result would be wrong
 * in the same way `Hz` was wrong for the frequency (#194), and wrong for a
 * different reason on every receiver type.
 */
export function levelText(value) {
  // ⚠️ Same trap as `pushSample`: `Number(null)` is 0, so a channel with no
  // reading would have printed a confident "0%" rather than nothing.
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return '';
  }
  return `${Math.round(n)}%`;
}
