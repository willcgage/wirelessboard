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
 * The rows as the server wants them.
 *
 * ⛔ Rows with problems are left out rather than sent half-made: the server
 * would drop them anyway, and sending them would make the saved list disagree
 * with the form in a way nobody could see.
 */
export function toPayload(rows) {
  const out = [];
  const ids = [];
  (rows || []).forEach((row) => {
    if (screenProblem(row)) return;
    const name = String(row.name).trim();
    const id = row.id || uniqueScreenId(name, ids);
    ids.push(id);
    out.push({
      id,
      name,
      diagonal_inches: positive(row.diagonal_inches),
      min_column_inches: positive(row.min_column_inches),
    });
  });
  return out;
}

/** What the Save button should say happened. */
export function saveSummary(rows) {
  const payload = toPayload(rows);
  const dropped = (rows || []).length - payload.length;
  if (!payload.length && !dropped) {
    return 'No screens. Boards will have no minimum column width.';
  }
  const kept = `${payload.length} screen${payload.length === 1 ? '' : 's'} saved`;
  if (!dropped) return `${kept}.`;
  // ⚠️ Says it rather than hiding it: a row silently not saved is the kind of
  // thing somebody discovers weeks later when a board behaves oddly.
  return `${kept}. ${dropped} incomplete row${dropped === 1 ? '' : 's'} not saved.`;
}
