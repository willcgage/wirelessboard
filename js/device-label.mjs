/**
 * What the board prints on a slot's device line.
 *
 * ⛔ This is `name_raw` — the transmitter's own channel label — and nothing
 * else. `name` is the person and `id` is the position; conflating the three is
 * what put a microphone's label where an operator expected a name and sent
 * photo lookups to the device instead of the person (#57). If you are reaching
 * for a fallback here, the answer is a blank line.
 *
 * The one thing worth suppressing is the placeholder. `py/channel.py` seeds
 * `chan_name_raw` as `SLOT <n>` and only replaces it once the receiver reports
 * its real channel name, so a board with an offline slot would otherwise print
 * "SLOT 5" on the line that is supposed to name the hardware. A blank line says
 * "nothing has reported" more honestly than a fake name does.
 */

// Deliberately anchored and exact, matching the string channel.py generates.
// The server's own re-patch check asks the looser `'SLOT' not in name`, but it
// is answering a different question -- whether an assignment has gone stale --
// and borrowing its looseness here would blank the line for a real device
// someone happened to label "SLOT MACHINE".
const PLACEHOLDER = /^SLOT\s+\d+$/;

export function deviceLabel(nameRaw) {
  if (typeof nameRaw !== 'string') {
    return '';
  }
  const trimmed = nameRaw.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * The column heading: which handheld or bodypack this is (#130).
 *
 * ⭐ Someone walking up to the rack needs to know which piece of equipment to
 * pick up, and that is the only job of this line. It takes `device_id` — the
 * hardware's own identifier, parsed from the channel label by the server, with
 * any person's name already stripped off. ⛔ Not `name_raw`: receivers are
 * conventionally labelled "HH-1 Dave", so the raw label carries the person too,
 * and printing it put their name on the board twice.
 *
 * The fallback is the slot's own number, because a column with no heading at
 * all is worse than one that says "Slot 7" — the slot number is on the board,
 * and it is still true when a receiver has not reported its channel name yet.
 * It never falls back to the person: that is the conflation #57 was about.
 */
export function deviceHeading(deviceId, slot) {
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (id && !PLACEHOLDER.test(id)) {
    return id;
  }
  const number = Number(slot);
  return Number.isFinite(number) && number > 0 ? `Slot ${number}` : '';
}

export default deviceLabel;
