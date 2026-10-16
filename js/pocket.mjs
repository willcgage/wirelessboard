/**
 * Pocket — worst first (#233).
 *
 * ⭐⭐ **Order is the whole feature.** The reader is holding a phone, standing
 * up, already walking towards a pack. They are not scanning twelve channels;
 * they want the one that needs them at the top, and they want to be able to
 * stop reading after it. Everything else exists so the list is not a lie about
 * how many channels there are.
 *
 * ⛔ A divider, not a filter. The channels that are fine stay on the list, in
 * slot order, under a line — because "which channel is Dave on" is still a
 * question somebody asks with a phone in their hand, and a list that answered
 * only one question would send them back to the wall for the other.
 *
 * Pure, so the ordering can be checked without a DOM or a board.
 */

/**
 * How bad each status is, worst first.
 *
 * ⛔ The numbers are ranks, not scores — nothing adds them up. They exist so a
 * reader of this file can see the whole order at once, which is the thing that
 * has to be agreed; everything else here is mechanism.
 *
 * ⚠️ `RX_COM_ERROR` outranks a flat battery deliberately. A receiver that has
 * stopped answering is not telling us *anything* about that channel, including
 * whether it is about to fail — an unknown is worse than a known bad, because
 * somebody can act on a known bad.
 */
export const SEVERITY = [
  'RX_COM_ERROR',
  'TX_COM_ERROR',
  'CRITICAL',
  'PREV_CRITICAL',
  'REPLACE',
  'PREV_REPLACE',
  'WARNING',
  'GOOD',
  'PREV_GOOD',
  'UNASSIGNED',
];

/** Statuses that put a channel above the divider. */
export const NEEDS_ATTENTION = new Set([
  'RX_COM_ERROR',
  'TX_COM_ERROR',
  'CRITICAL',
  'PREV_CRITICAL',
  'REPLACE',
  'PREV_REPLACE',
]);

/**
 * ⚠️ An unknown status sorts as the LEAST urgent, not the most.
 *
 * It is tempting to treat "I do not recognise this" as alarming, and it is the
 * wrong way round here: a new status string from a vendor adapter would push
 * every channel on the board to the top of the list and make the ordering
 * useless exactly when somebody is relying on it. A status nobody has taught
 * this file about is not evidence of trouble.
 */
export function severityOf(status) {
  const at = SEVERITY.indexOf(String(status || '').trim());
  return at < 0 ? SEVERITY.length : at;
}

export function needsAttention(status) {
  return NEEDS_ATTENTION.has(String(status || '').trim());
}

/**
 * Split a display list into what needs somebody and what does not.
 *
 * @param {Array<number>} slots the display list, in slot order
 * @param {object} transmitters keyed by slot
 * @returns {{ urgent: number[], rest: number[] }}
 *
 * ⛔ `rest` keeps SLOT ORDER, untouched. Sorting the calm channels by anything
 * would mean the bottom of the list reshuffled itself every time a battery
 * ticked down — and that half of the list is the half somebody reads by
 * position, looking for a particular person.
 *
 * ⚠️ The urgent half is sorted by severity and then by slot, so two channels
 * in the same state keep a stable order between renders. Without the tiebreak
 * the list jitters on every poll, which on a phone reads as the board being
 * unsure.
 */
export function pocketOrder(slots, transmitters = {}) {
  const list = Array.isArray(slots) ? slots.filter((s) => s !== 0) : [];
  const statusOf = (slot) => {
    const tx = transmitters && transmitters[slot];
    return (tx && tx.status) || '';
  };

  const urgent = list
    .filter((slot) => needsAttention(statusOf(slot)))
    .sort((a, b) => {
      const d = severityOf(statusOf(a)) - severityOf(statusOf(b));
      return d !== 0 ? d : a - b;
    });

  const urgentSet = new Set(urgent);
  const rest = list.filter((slot) => !urgentSet.has(slot));

  return { urgent, rest };
}

/**
 * What the footer says: how many channels there are, and whether that is all.
 *
 * ⛔ The count is of the list being shown, not of the board. A phone showing
 * one group must not claim the board has four channels — the same mistake the
 * paging bar made (#215), where the count came from `config.groups` whatever
 * the board was actually displaying.
 */
export function pocketFooter({ shown = 0, total = 0 } = {}) {
  const n = Math.max(0, Number(shown) || 0);
  const all = Math.max(0, Number(total) || 0);
  const channels = `${n} ${n === 1 ? 'channel' : 'channels'}`;
  if (!all || n >= all) {
    return `${channels} · all shown`;
  }
  return `${channels} of ${all}`;
}
