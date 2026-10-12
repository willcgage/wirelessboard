/**
 * Which number a configuration row carries (#147).
 *
 * ⛔ A slot number is a channel's **identity**, not its position in a list.
 * Groups store slot numbers, Planning Center assignments resolve through them,
 * and `config_mix` merges the stored name and ID onto whichever channel holds
 * the number. So renumbering rows by their order — which is what the
 * configuration page used to do on every delete — hands all of that to a
 * different channel.
 *
 * On a real board: four channels, Vocals = [1, 2] = Alice and Bob, Band =
 * [3, 4] = Carol and Dave. Delete Bob, save, and the slots renumber to 1, 2, 3
 * while the groups still say [1, 2] and [3, 4] — so **Carol is now in Vocals**
 * and Band holds Dave plus a channel that does not exist. Nothing looks broken.
 * Every group has the right shape and every name is a real name; the wrong
 * person is simply on the wrong microphone.
 *
 * ⚠️ The consequence of fixing it this way is **gaps**. Delete slot 2 of four
 * and the board keeps 1, 3, 4. That is the honest result of treating the number
 * as an identity, and the alternative — renumbering and rewriting every group
 * and stored field to match — means getting a remap exactly right in the file
 * whose corruption once left a server that could not start.
 */

/** The number a row carries, or null for a row that has never had one. */
export function numberOf(rowId) {
  const match = /^slot-(\d+)$/.exec(String(rowId || '').trim());
  return match ? Number.parseInt(match[1], 10) : null;
}

/** Every number currently spoken for, in no particular order. */
export function takenNumbers(rowIds) {
  if (!Array.isArray(rowIds)) {
    return [];
  }
  return rowIds.map(numberOf).filter((n) => Number.isFinite(n));
}

/**
 * The number to give the next new row.
 *
 * ⛔ One past the highest, never the lowest unused. Reusing the number of a
 * deleted channel would hand a brand-new channel that channel's identity — and
 * any group still pointing at it would silently adopt the new one. That is the
 * same bug this module exists to fix, in miniature.
 */
export function nextNumber(taken) {
  const numbers = (taken || []).filter((n) => Number.isFinite(n));
  if (!numbers.length) {
    return 1;
  }
  return Math.max(...numbers) + 1;
}

/**
 * Work out the number for every row, keeping the ones that already have one.
 *
 * `rowIds` is the current id of each row in document order; a row added from
 * the template has none. Returns a number per row, in the same order.
 */
export function assignNumbers(rowIds) {
  if (!Array.isArray(rowIds)) {
    return [];
  }

  const assigned = [];
  const taken = takenNumbers(rowIds);

  rowIds.forEach((id) => {
    const existing = numberOf(id);
    if (existing !== null) {
      assigned.push(existing);
      return;
    }
    const fresh = nextNumber(taken);
    taken.push(fresh);
    assigned.push(fresh);
  });

  return assigned;
}

/**
 * Whether a set of rows would change any existing channel's number.
 *
 * ⚠️ Exists so the behaviour can be asserted directly rather than inferred
 * from the output: "no configured channel ever changes number" is the whole
 * promise, and a test that re-derives it from `assignNumbers` would pass for
 * the same reason the bug did.
 */
export function renumbersAnything(rowIds) {
  const assigned = assignNumbers(rowIds);
  return (rowIds || []).some((id, index) => {
    const existing = numberOf(id);
    return existing !== null && existing !== assigned[index];
  });
}
