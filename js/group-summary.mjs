/**
 * What is in each group, and what is in none of them (#114).
 *
 * The board's own editor (`E`) answers "rearrange the group I am looking at",
 * which is the right tool for moving one person and no help at all with the
 * questions that actually come up before a service:
 *
 *   - which channels are in Worship?
 *   - is anything in **no** group, and therefore invisible unless someone is
 *     on the combined view?
 *
 * Pure on purpose: the DOM work in `config.js` is awkward to test, and this is
 * the part with the reasoning in it.
 */

/**
 * The label a person would use for a slot, in the order the card prefers it:
 * the person first, then the device's own name, then the bare number (#69).
 */
export function slotLabel(slot) {
  if (!slot || typeof slot !== 'object') {
    return '';
  }
  const person = typeof slot.extended_name === 'string' ? slot.extended_name.trim() : '';
  const device = typeof slot.chan_name_raw === 'string' ? slot.chan_name_raw.trim() : '';
  if (person) return person;
  if (device) return device;
  return `Slot ${slot.slot}`;
}

function slotNumbersOf(entry) {
  const numbers = entry && Array.isArray(entry.slots) ? entry.slots : [];
  return numbers
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
}

/**
 * One row per group, in group-number order.
 *
 * ⚠️ A group may list a slot that no longer exists -- deleting a slot does not
 * visit every group -- so membership is reported as `present` (the slots that
 * resolve) and `missing` (the numbers that do not). Silently dropping the
 * strays would hide the only evidence of a stale group.
 */
export function summariseGroups(groups, slots) {
  const bySlot = new Map(
    (Array.isArray(slots) ? slots : [])
      .filter((s) => s && Number.isFinite(Number(s.slot)))
      .map((s) => [Number(s.slot), s]),
  );

  return Object.keys(groups || {})
    .map((key) => Number(key))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((number) => {
      const entry = groups[number] || groups[String(number)];
      const numbers = slotNumbersOf(entry);
      const present = numbers.filter((n) => bySlot.has(n)).map((n) => bySlot.get(n));
      const missing = numbers.filter((n) => !bySlot.has(n));

      return {
        group: number,
        title: (entry && entry.title) || `Group ${number}`,
        hideCharts: Boolean(entry && entry.hide_charts),
        slots: present,
        missing,
        count: present.length,
      };
    });
}

/**
 * The channels no group claims.
 *
 * ⭐ The question the board editor cannot answer, and the reason this exists: a
 * channel in no group is invisible to anyone viewing groups rather than the
 * combined board, and nothing on the board says so.
 *
 * `offline` slots count: a slot with no receiver is still a slot someone put
 * on the board, and leaving it out of a group is just as easy to do by
 * accident.
 */
export function unassignedSlots(groups, slots) {
  const claimed = new Set();
  Object.keys(groups || {}).forEach((key) => {
    slotNumbersOf(groups[key]).forEach((n) => claimed.add(n));
  });

  return (Array.isArray(slots) ? slots : [])
    .filter((s) => s && Number.isFinite(Number(s.slot)))
    .filter((s) => !claimed.has(Number(s.slot)))
    .sort((a, b) => Number(a.slot) - Number(b.slot));
}
