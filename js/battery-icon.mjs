/**
 * The battery on the card (#130).
 *
 * The band carries a time — "3:34" — and a bare figure does not say what it is
 * a measure of. A battery beside it does, and it keeps saying something when
 * there is no time to show: the receivers that report only a level (and the
 * ones whose runtime has not arrived yet) still fill the icon.
 *
 * ⛔ The level vocabulary is the board's own: 1–5 bars, 0 for flat and 255 for
 * "nothing reported", which is what every adapter normalises onto
 * ([[shure-adapter-seam]] — the meaning is shared, the unit is not). 255 is not
 * a low battery and must never draw as one; an empty outline says "no idea"
 * while an empty *fill* would say "about to die".
 */

export const BATTERY_BARS = 5;
export const BATTERY_UNKNOWN = 255;

/**
 * How much of the icon to fill, 0–1, or null when nothing has been reported.
 *
 * Null rather than 0 on purpose: the two mean opposite things to anyone
 * glancing at the board, and the caller has to be able to tell them apart.
 */
export function batteryFraction(level) {
  // ⛔ `null` and `''` before `Number()` gets near them: both coerce to 0, and
  // 0 is a flat battery. A slot whose payload simply has no battery field would
  // otherwise draw as empty -- the most alarming reading of "we don't know".
  if (level === null || level === undefined || level === '') {
    return null;
  }
  const n = Number(level);
  if (!Number.isFinite(n) || n === BATTERY_UNKNOWN) {
    return null;
  }
  if (n < 0) {
    return null;
  }
  return Math.min(n, BATTERY_BARS) / BATTERY_BARS;
}

/**
 * What a screen reader, or a hover, should say about the battery.
 *
 * ⚠️ Says bars, because bars are what the board was told. Turning "4 of 5" into
 * a percentage would invent a precision no receiver sent.
 */
export function batteryDescription(level, runtime) {
  const fraction = batteryFraction(level);
  const time = typeof runtime === 'string' ? runtime.trim() : '';

  if (fraction === null) {
    return time ? `Battery unknown, ${time} remaining` : 'Battery unknown';
  }
  const bars = Math.round(fraction * BATTERY_BARS);
  return time
    ? `Battery ${bars} of ${BATTERY_BARS}, ${time} remaining`
    : `Battery ${bars} of ${BATTERY_BARS}`;
}
