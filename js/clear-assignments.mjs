/**
 * Taking people off slots (#135).
 *
 * ⛔ There are three states a row can be in, and before this there were only
 * two values to say them with. "Leave this slot as it is" is what most rows
 * want and is the blank option; "put this person on it" is a name. "Take the
 * person off it" had no value at all, so `applyAssignmentsFromSelects` skipped
 * every blank row and a slot could only be emptied from the Slot Configuration
 * page -- find the row, clear one field, save the whole configuration.
 *
 * ⚠️ Clearing takes the person and leaves `extended_id`. The position is what
 * the *next* sync matches on and is often something the operator set
 * deliberately, so a slot keeps its role when the person leaves it. Throwing
 * the ID away would break matching for every week after.
 *
 * The server needs nothing new for this: `config.update_slot` already pops
 * `extended_name` when the key is present and empty.
 */

/**
 * The select value that means "nobody".
 *
 * Deliberately not `''` -- that is already taken by "leave it alone", and a
 * board with no one scheduled for slot 4 is a different statement from a board
 * whose operator has not got to slot 4 yet.
 */
export const CLEAR_ASSIGNMENT = '__clear__';

/** What a row's select is asking for. */
export function parseSelection(value) {
  if (value === CLEAR_ASSIGNMENT) {
    return { action: 'clear' };
  }
  if (!value) {
    return { action: 'skip' };
  }
  let name = value;
  try {
    name = decodeURIComponent(value);
  } catch (e) {
    // A value the option list did not write. Treat it as text rather than
    // throwing out the whole Apply because one row is malformed.
    name = value;
  }
  if (!name.trim()) {
    return { action: 'skip' };
  }
  return { action: 'assign', name };
}

/** The slots somebody is on right now. */
export function assignedSlots(slots) {
  if (!Array.isArray(slots)) {
    return [];
  }
  return slots
    .filter((slot) => slot && Number.isFinite(slot.slot) && (slot.extended_name || '').trim())
    .map((slot) => slot.slot);
}

/** The `api/slot` payload that empties the given slots. */
export function clearUpdates(slotNumbers) {
  if (!Array.isArray(slotNumbers)) {
    return [];
  }
  return slotNumbers
    .filter((slot) => Number.isFinite(slot))
    .map((slot) => ({ slot, extended_name: '' }));
}

/**
 * What to ask before clearing the whole board, or null when there is nothing
 * to clear.
 *
 * ⭐ Names the count instead of asking "are you sure?". A bare confirmation
 * teaches nobody anything; a number the operator can compare against the board
 * in front of them catches the case where they meant one slot, not twelve. And
 * it says the IDs survive, because that is the fear that would otherwise stop
 * someone using this at all.
 */
export function clearAllConfirmation(count) {
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }
  const plural = count === 1 ? 'slot' : 'slots';
  return `Take everybody off ${count} ${plural}? Slot IDs are kept, so next week’s plan still matches.`;
}

/** The line shown after a clear, or when there was nothing to clear. */
export function clearedSummary(count) {
  if (!Number.isFinite(count) || count <= 0) {
    return 'No slots have anyone on them.';
  }
  return `Cleared ${count} slot${count === 1 ? '' : 's'}.`;
}
