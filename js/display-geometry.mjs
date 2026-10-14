import { positionInchesForScreen, furnitureById } from './furniture.mjs';

/**
 * Turning a screen's physical size into a minimum column width (#170).
 *
 * ⭐ The rule this exists for is not about wasted space. The television sits
 * above the charging dock, and a column is meant to point at the microphone
 * underneath it. A column narrower than a dock position does not merely look
 * cramped — it stops corresponding to anything, which is the whole reason the
 * board is on that wall.
 *
 * ⛔ A browser cannot discover a screen's physical size. There is no API for
 * it: `screen.width` is pixels, `devicePixelRatio` is a ratio, and Electron's
 * display metrics are device-independent pixels, not millimetres. So the
 * diagonal has to be configured. It is one number, measured once, and it is
 * printed on the box the television came in.
 *
 * Pure, so the arithmetic can be checked without a screen.
 */

/** A number, or null when it is not one we can use. */
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * CSS pixels per inch on a screen of this size.
 *
 * ⚠️ Uses the diagonal of the pixel grid against the diagonal of the panel,
 * which is the only pair that is directly comparable — a panel's advertised
 * size is its diagonal, and width alone would be wrong on anything that is not
 * exactly 16:9.
 */
export function pixelsPerInch({ widthPx, heightPx, diagonalInches }) {
  const w = positive(widthPx);
  const h = positive(heightPx);
  const diagonal = positive(diagonalInches);
  if (!w || !h || !diagonal) {
    return null;
  }
  return Math.sqrt(w * w + h * h) / diagonal;
}

/**
 * How wide a column has to be, in CSS pixels, to span `minColumnInches` of
 * actual wall.
 *
 * Returns null when the screen has not been described, which callers must read
 * as "no minimum" rather than "zero" — a board with nothing configured has to
 * behave exactly as it did before.
 */
export function minColumnPixels({
  widthPx, heightPx, diagonalInches, minColumnInches,
}) {
  const ppi = pixelsPerInch({ widthPx, heightPx, diagonalInches });
  const inches = positive(minColumnInches);
  if (!ppi || !inches) {
    return null;
  }
  return Math.round(ppi * inches);
}

/**
 * The most columns a screen can carry without any of them going under the
 * minimum.
 *
 * ⛔ A ceiling, never a target. It answers "how many will fit", and the
 * arrangement still decides how many to ask for — a board with four channels
 * does not grow to twelve columns because twelve would fit.
 */
export function maxColumnsAtMinimum({ containerWidth, minColumnWidth }) {
  const width = positive(containerWidth);
  const minimum = positive(minColumnWidth);
  if (!width || !minimum) {
    return null;
  }
  // ⛔ Pitch, not card width. What has to line up with a dock position is the
  // column's share of the screen centre to centre; the gap between cards lives
  // *inside* that share. Measuring the card instead makes a dock that fits
  // exactly come out one column short -- twelve 4in positions across a 48in
  // screen is exactly twelve columns, and `(width + gap) / (minimum + gap)`
  // says eleven.
  return Math.max(1, Math.floor(width / minimum));
}

/**
 * The screens an installation has described, cleaned up.
 *
 * ⭐ A list rather than one block, because the minimum column width is a fact
 * about *one screen in one place*. The television above the charging dock has a
 * dock position to match; the laptop at front of house has nothing underneath
 * it and wants no minimum at all. One global number cannot say that.
 *
 * ⚠️ The resolution is **not** here. Every browser reports its own, so asking a
 * human for it invites a mismatch between what was typed and the screen the
 * board is actually on — and a plausible wrong answer is worse than none.
 */
export function normalizeScreens(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  return list.reduce((out, entry) => {
    if (!entry || typeof entry !== 'object') return out;
    const id = String(entry.id || '').trim();
    const diagonal = positive(entry.diagonal_inches);
    // ⛔ An entry without an id or a size cannot be chosen or used, so it is
    // dropped rather than carried as a half-thing somebody might select.
    if (!id || seen.has(id) || !diagonal) return out;
    seen.add(id);
    out.push({
      id,
      name: String(entry.name || '').trim() || id,
      diagonal_inches: diagonal,
      // ⭐ Which piece of furniture is underneath (#203). A screen with nothing
      // under it is still worth describing; it simply imposes no minimum.
      furniture_id: String(entry.furniture_id || '').trim() || null,
      // ⛔ Legacy, and deliberately still read. Before #203 the position width
      // lived here. A board configured under the old shape keeps its floor
      // until the screens are next saved -- see `positionInchesForScreen`.
      min_column_inches: positive(entry.min_column_inches),
    });
    return out;
  }, []);
}

export function screenById(screens, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  return normalizeScreens(screens).find((s) => s.id === wanted) || null;
}

/**
 * What the device picker offers. "Not set" first, and it is the default.
 *
 * ⚠️ Takes the furniture now (#203), because the column width it quotes is no
 * longer the screen's own. Called without it the labels simply say less rather
 * than saying something wrong.
 */
export function screenChoices(screens, furniture = []) {
  return [{ value: '', label: 'Not set — no minimum' }]
    .concat(normalizeScreens(screens).map((s) => {
      const inches = positionInchesForScreen({ screen: s, furniture });
      return {
        value: s.id,
        label: inches
          ? `${s.name} — ${s.diagonal_inches}in, ${inches}in columns`
          : `${s.name} — ${s.diagonal_inches}in`,
      };
    }));
}

/**
 * The minimum column width for the screen this device says it is.
 *
 * ⛔ Resolution comes from the browser, physical size from the configuration.
 * Null whenever either half is missing, which every caller reads as "no rule" —
 * a device that has not been told which screen it is behaves exactly as a board
 * did before any of this existed.
 */
export function minColumnPixelsForScreen({
  screens, screenId, widthPx, heightPx, furniture = [],
}) {
  const screen = screenById(screens, screenId);
  // ⛔ The width comes from the furniture under the screen now (#203), with the
  // screen's own legacy value as the fallback. The arithmetic below is
  // untouched: this changes where the number is kept, never what it does.
  const inches = positionInchesForScreen({ screen, furniture });
  if (!screen || !inches) {
    return null;
  }
  return minColumnPixels({
    widthPx,
    heightPx,
    diagonalInches: screen.diagonal_inches,
    minColumnInches: inches,
  });
}

/** One line for the view panel, saying what the choice actually means here. */
export function describeScreenChoice({
  screens, screenId, widthPx, heightPx, furniture = [],
}) {
  const screen = screenById(screens, screenId);
  if (!screen) {
    return 'No minimum column width on this screen.';
  }
  const px = minColumnPixelsForScreen({
    screens, screenId, widthPx, heightPx, furniture,
  });
  if (!px) {
    return `${screen.name}: ${screen.diagonal_inches}in, nothing underneath it.`;
  }
  // ⭐ Names the furniture where there is some, because "a 3.9in column" does
  // not tell anybody *why* 3.9 — and the reason is the thing on the table.
  const under = furnitureById(furniture, screen.furniture_id);
  const inches = positionInchesForScreen({ screen, furniture });
  const because = under ? ` (${under.name})` : '';
  return `${screen.name}: a ${inches}in position${because} is ${px}px here, so the board will not go narrower.`;
}
