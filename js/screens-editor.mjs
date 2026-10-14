import {
  pairRows as rowsPairRows,
  toPayload as rowsToPayload,
  mergeSaved as rowsMergeSaved,
  saveSummary as rowsSaveSummary,
} from './editor-rows.mjs';

/**
 * Editing the list of screens an installation has (#170).
 *
 * ⭐ The sizes are global because they describe the building; which screen a
 * device *is* stays on that device. This is the global half — the rules for
 * turning a form into something `POST /api/screens` will accept, and for
 * saying what is wrong before it is sent.
 *
 * Pure, like the other editors beside it, so the rules can be checked without
 * a DOM.
 */

/** A stable id from a name: lowercase, hyphenated, nothing surprising. */
export function screenId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** An id not already taken, so two screens named the same still both exist. */
export function uniqueScreenId(name, existing = []) {
  const base = screenId(name) || 'screen';
  const taken = new Set(existing.filter(Boolean));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

function positive(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What is wrong with one row, or null.
 *
 * ⚠️ Reported per row rather than as one message for the form. "Something is
 * wrong with your screens" is not actionable on a Sunday morning — the same
 * rule the rule-set editor already follows.
 */
export function screenProblem(row) {
  const name = String((row && row.name) || '').trim();
  if (!name) {
    return 'Give the screen a name.';
  }
  if (!positive(row && row.diagonal_inches)) {
    return 'How big is it, measured corner to corner? This is the size it was sold as.';
  }
  // ⛔ The dock width is optional, but junk in it is not. A screen with nothing
  // underneath it should be left empty, not filled with a guess.
  if (row.min_column_inches !== '' && row.min_column_inches !== null
    && row.min_column_inches !== undefined && !positive(row.min_column_inches)) {
    return 'The dock position width has to be a measurement, or empty.';
  }
  return null;
}

export function screensHaveProblems(rows) {
  return (rows || []).some((row) => screenProblem(row) !== null);
}

/**
 * ⭐ The pairing, the merge and the summary are `editor-rows.mjs` now (#203).
 *
 * ⛔ Extracted rather than copied when the dock editor needed the same
 * shape. This is #180's logic — the reason a save cannot delete the row
 * somebody is typing into — and two copies of it is two places for that to go
 * wrong again. The twenty-one tests in `screens-editor.test.mjs` go through
 * these wrappers, so they prove the extraction is faithful as well as the rules.
 */
const SPEC = {
  problem: screenProblem,
  entry: (row, ids) => ({
    id: row.id || uniqueScreenId(String(row.name).trim(), ids),
    name: String(row.name).trim(),
    diagonal_inches: positive(row.diagonal_inches),
    // ⭐ Which dock or pad is underneath (#203). The width itself lives on the
    // dock now; this is the reference to it.
    dock_id: String(row.dock_id || '').trim() || null,
    // ⛔ Carried forward, not dropped. A board configured before #203 has its
    // position width here, and a save that discarded it would silently widen
    // that board's columns past the dock they were measured against. It stops
    // being written once the row names a dock instead.
    min_column_inches: String(row.dock_id || '').trim()
      ? null
      : positive(row.min_column_inches),
  }),
};

export function pairRows(rows) {
  return rowsPairRows(rows, SPEC);
}

export function toPayload(rows) {
  return rowsToPayload(rows, SPEC);
}

export function mergeSaved(rows, saved) {
  return rowsMergeSaved(rows, saved, SPEC);
}

export function saveSummary(rows) {
  return rowsSaveSummary(rows, SPEC, {
    noun: (n) => `screen${n === 1 ? '' : 's'}`,
    nothing: 'No screens. Boards will have no minimum column width.',
  });
}
