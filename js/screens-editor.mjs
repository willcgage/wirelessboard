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
 * Every row paired with the entry it will be sent as, or `null` where it has a
 * problem and is held back.
 *
 * ⭐ Exists so a save can find its way back: the response only carries what was
 * stored, and without the pairing there is no way to tell which row produced
 * which saved screen — which is how the row somebody was typing into used to be
 * thrown away (#180).
 */
export function pairRows(rows) {
  const ids = [];
  return (rows || []).map((row) => {
    if (screenProblem(row)) return { row, entry: null };
    const name = String(row.name).trim();
    const id = row.id || uniqueScreenId(name, ids);
    ids.push(id);
    return {
      row,
      entry: {
        id,
        name,
        diagonal_inches: positive(row.diagonal_inches),
        min_column_inches: positive(row.min_column_inches),
      },
    };
  });
}

/**
 * The rows as the server wants them.
 *
 * ⛔ Rows with problems are left out rather than sent half-made: the server
 * would drop them anyway, and sending them would make the saved list disagree
 * with the form in a way nobody could see.
 */
export function toPayload(rows) {
  return pairRows(rows).map((pair) => pair.entry).filter(Boolean);
}

/**
 * The form after a save.
 *
 * ⛔ The whole point of #180. A save sends only the complete rows, so the
 * response cannot contain the one somebody is still filling in — and replacing
 * the form with that response deleted their work while telling them it had not
 * been saved. A saved row takes the server's canonical values; a row the server
 * never saw stays exactly as it was typed, still editable, still flagged.
 */
export function mergeSaved(rows, saved) {
  const byId = new Map();
  (saved || []).forEach((screen) => {
    if (screen && screen.id) byId.set(String(screen.id), { ...screen });
  });

  const taken = new Set();
  const merged = pairRows(rows).map(({ row, entry }) => {
    const key = entry && String(entry.id);
    // ⚠️ A complete row the server did not store comes back as it was typed
    // rather than vanishing, for the same reason an incomplete one does.
    if (key && byId.has(key)) {
      taken.add(key);
      return byId.get(key);
    }
    return { ...row };
  });

  // A screen in the response that no row produced. Should not happen while one
  // board holds the form, but showing it beats dropping something the server
  // says it is storing.
  (saved || []).forEach((screen) => {
    if (screen && screen.id && !taken.has(String(screen.id))) merged.push({ ...screen });
  });

  return merged;
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
  // thing somebody discovers weeks later when a board behaves oddly. And it
  // says the row is still there, because until #180 it was not — the sentence
  // and the deletion together were the fault.
  const rowWord = dropped === 1 ? 'row is' : 'rows are';
  return `${kept}. ${dropped} incomplete ${rowWord} still here to finish.`;
}
