/**
 * The shape every list-editor in the configuration shares (#180, #203).
 *
 * ⛔ Extracted rather than copied. This is the logic #180 was about: a save
 * sends only the complete rows, so the server's response cannot contain the one
 * somebody is still filling in — and replacing the form with that response
 * deleted their work while telling them it had not been saved. That cost a
 * venue session, and it is exactly the kind of subtlety that goes wrong the
 * second time somebody writes it out.
 *
 * So there is one implementation and the editors supply only what differs:
 * what counts as a problem, and what a good row is sent as.
 *
 * Pure, like the editors that use it.
 */

/**
 * Every row paired with the entry it will be sent as, or `null` where it has a
 * problem and is held back.
 *
 * ⭐ The pairing is the point. The response only carries what was stored, so
 * without it there is no way to tell which row produced which saved entry —
 * which is how the row somebody was typing into used to be thrown away.
 */
export function pairRows(rows, { problem, entry }) {
  const ids = [];
  return (rows || []).map((row) => {
    if (problem(row)) return { row, entry: null };
    const made = entry(row, ids);
    if (made && made.id) ids.push(made.id);
    return { row, entry: made };
  });
}

/**
 * The rows as the server wants them.
 *
 * ⛔ Rows with problems are left out rather than sent half-made: the server
 * would drop them anyway, and sending them would make the saved list disagree
 * with the form in a way nobody could see.
 */
export function toPayload(rows, spec) {
  return pairRows(rows, spec).map((pair) => pair.entry).filter(Boolean);
}

/**
 * The form after a save.
 *
 * A saved row takes the server's canonical values; a row the server never saw
 * stays exactly as it was typed, still editable, still flagged.
 */
export function mergeSaved(rows, saved, spec) {
  const byId = new Map();
  (saved || []).forEach((item) => {
    if (item && item.id) byId.set(String(item.id), { ...item });
  });

  const taken = new Set();
  const merged = pairRows(rows, spec).map(({ row, entry }) => {
    const key = entry && String(entry.id);
    // ⚠️ A complete row the server did not store comes back as it was typed
    // rather than vanishing, for the same reason an incomplete one does.
    if (key && byId.has(key)) {
      taken.add(key);
      return byId.get(key);
    }
    return { ...row };
  });

  // Something in the response that no row produced. Should not happen while one
  // board holds the form, but showing it beats dropping something the server
  // says it is storing.
  (saved || []).forEach((item) => {
    if (item && item.id && !taken.has(String(item.id))) merged.push({ ...item });
  });

  return merged;
}

/**
 * What the Save button should say happened.
 *
 * ⚠️ It says how many rows were held back rather than hiding it: a row silently
 * not saved is the kind of thing somebody discovers weeks later when a board
 * behaves oddly. And it says the row is **still here**, because until #180 it
 * was not — the sentence and the deletion together were the fault.
 */
export function saveSummary(rows, spec, { noun, nothing }) {
  const payload = toPayload(rows, spec);
  const dropped = (rows || []).length - payload.length;
  if (!payload.length && !dropped) {
    return nothing;
  }
  const kept = `${payload.length} ${noun(payload.length)} saved`;
  if (!dropped) return `${kept}.`;
  const rowWord = dropped === 1 ? 'row is' : 'rows are';
  return `${kept}. ${dropped} incomplete ${rowWord} still here to finish.`;
}
