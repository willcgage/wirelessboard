/**
 * The Slots table — who is on each channel.
 *
 * ⛔⛔ **This replaces an editor that took the board.** The old one rendered
 * every channel as a card with two text boxes inside it, and to do that it
 * switched the group to all channels, turned the backgrounds off and forced a
 * television into desk mode — a trip #216 had to patch twice, because it never
 * switched back and a board came back from a power cut as a desk.
 *
 * ⭐ A table needs none of that. The board is never touched, so there is
 * nothing to remember and nothing to restore, and the wall keeps showing the
 * service while somebody types.
 *
 * ⚠️ **What it gives up, stated plainly:** no photograph beside the name box.
 * Settled 2026-10-15 — *"no pictures needed in the slots because that is not
 * where it belongs"* — so this is a cost the design accepts, not an open
 * question, and a thumbnail is not to be offered again.
 *
 * ⛔ **Position is not here yet.** Planning Center writes a position as well as
 * a person ("Bob Roberts — Vocal 1") but `pco.py` reads the team position only
 * to decide *which* slot somebody belongs to and then writes just the name, so
 * nothing stores it. The column needs a field on the slot first.
 */

/**
 * What the State column says, in the card's words rather than the protocol's.
 *
 * ⛔ The same words `channelview.js` puts on a card — `Replace`, `Low`,
 * `RX error`, `No TX` — because an operator should not have to learn two
 * vocabularies for one fact. `slots-table.test.mjs` reads them back out of
 * `channelview.js` so the two cannot drift apart silently.
 *
 * ⚠️ The two this adds are the ones a card deliberately leaves blank: a card
 * says nothing when all is well, but a column headed State has to say
 * something in every row or the blank reads as missing data.
 */
export const STATUS_WORDS = {
  GOOD: 'Good',
  PREV_GOOD: 'Good',
  WARNING: 'Warning',
  REPLACE: 'Replace',
  PREV_REPLACE: 'Replace',
  CRITICAL: 'Low',
  PREV_CRITICAL: 'Low',
  AUDIO_PEAK: 'Peak',
  RX_COM_ERROR: 'RX error',
  TX_COM_ERROR: 'No TX',
  UNASSIGNED: 'Unassigned',
};

/**
 * How each state should read, for the one place colour is allowed to help.
 *
 * ⛔ Never colour alone — the word is always present. This only tints it.
 */
export const STATUS_TONES = {
  GOOD: 'ok',
  PREV_GOOD: 'ok',
  WARNING: 'warn',
  REPLACE: 'warn',
  PREV_REPLACE: 'warn',
  CRITICAL: 'bad',
  PREV_CRITICAL: 'bad',
  AUDIO_PEAK: 'warn',
  RX_COM_ERROR: 'bad',
  TX_COM_ERROR: 'warn',
  UNASSIGNED: 'idle',
};

function text(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function toSlot(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Index the transmitters by slot.
 *
 * ⚠️ Tolerates both shapes the board uses: `micboard.transmitters` is a sparse
 * array indexed by slot number (`config.js` writes `transmitters[slotNum]`)
 * while the payload it is built from is a plain list whose entries carry their
 * own `slot`. Reading only one of the two is how a table comes out empty on a
 * board that is working perfectly.
 */
function transmittersBySlot(transmitters) {
  const out = new Map();
  if (!transmitters || typeof transmitters !== 'object') {
    return out;
  }
  const entries = Array.isArray(transmitters)
    ? transmitters.entries()
    : Object.entries(transmitters);
  Array.from(entries).forEach(([key, tx]) => {
    if (!tx || typeof tx !== 'object') {
      return;
    }
    const slot = toSlot(tx.slot) || toSlot(key);
    if (slot) {
      out.set(slot, tx);
    }
  });
  return out;
}

/**
 * The equipment half of what the receiver says about a channel.
 *
 * ⛔ `device_id` first, which is the channel label with the person stripped out
 * of it. Printing `name_raw` would put somebody's name in the Receiver-reports
 * column, next to the box where their name is typed — which is #206's fault in
 * a different place.
 */
export function deviceLabel(tx) {
  if (!tx || typeof tx !== 'object') {
    return '';
  }
  return text(tx.device_id) || text(tx.name_raw);
}

/**
 * One line describing the channel behind a slot, or `''` when nothing is.
 *
 * ⛔ A slot of `type: 'offline'` has **no receiver behind it** — that is what
 * `py/offline.py` emits, and it is why a card can be headed `Slot N` with no
 * device on it (#186). It is never a rendering fault, so the table says so in
 * words instead of leaving the column blank.
 */
export function reportLine({ type, channel, device } = {}) {
  const parts = [];
  const kind = text(type);
  if (kind && kind !== 'offline') {
    parts.push(kind.toUpperCase());
  }
  const ch = toSlot(channel);
  if (ch) {
    parts.push(`CH ${ch}`);
  }
  const label = text(device);
  if (label) {
    parts.push(label);
  }
  return parts.join(' · ');
}

/**
 * Build a row per configured slot, in slot order.
 *
 * ⛔ Driven by `config.slots`, never by the transmitters. A slot the board is
 * not currently rendering — an offline one, or a channel in another group —
 * still has somebody's name on it and still has to be editable; the old editor
 * could only reach what was on screen.
 */
export function slotRows({ config, transmitters } = {}) {
  const entries = config && Array.isArray(config.slots) ? config.slots : [];
  const tx = transmittersBySlot(transmitters);

  const rows = [];
  entries.forEach((entry) => {
    const slot = toSlot(entry && entry.slot);
    if (!slot) {
      return;
    }
    const live = tx.get(slot) || {};
    const type = text(entry.type) || text(live.type);
    const offline = type === 'offline';
    const device = deviceLabel(live);
    const person = text(entry.extended_name);
    const deviceId = text(entry.extended_id);

    rows.push({
      slot,
      offline,
      device,
      reports: offline ? '' : reportLine({
        type,
        channel: entry.channel || live.channel,
        device,
      }),
      deviceId,
      person,
      status: text(live.status) || 'UNASSIGNED',
      // ⛔ What was loaded, kept so a save can send only what changed. See
      // `slotPayload`.
      wasDeviceId: deviceId,
      wasPerson: person,
    });
  });

  rows.sort((a, b) => a.slot - b.slot);
  return rows;
}

/**
 * The names in a pasted list, one per line.
 *
 * ⛔⛔ **Trailing blank lines are dropped.** A list pasted out of a document or
 * a spreadsheet almost always ends with a newline, which splits to a final
 * empty string — and because an empty value *clears* a name in
 * `config.update_slot`, keeping it would have quietly taken the last person off
 * the board every time somebody pasted. Blank lines in the middle are kept,
 * because those line up with a slot nobody is on.
 */
export function namesFromPaste(value) {
  const lines = String(value === null || value === undefined ? '' : value).split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.map((line) => line.trim());
}

/**
 * Put a pasted list into the rows, in slot order.
 *
 * ⚠️ Fills and does **not** save, so a paste can be read back and corrected
 * before it reaches any board. A row past the end of the list is left exactly
 * as it was — a short list names the first few slots, it does not clear the
 * rest.
 */
export function applyNames(rows, value) {
  const names = namesFromPaste(value);
  return (Array.isArray(rows) ? rows : []).map((row, index) => (
    index < names.length ? { ...row, person: names[index] } : row
  ));
}

/**
 * What to send to `api/slot` — **only the rows that changed**.
 *
 * ⛔⛔ This is why it is not simply every row. `config.update_slot` reads an
 * absent key as "not editing this" and an empty one as "clear it", the same
 * partial shape as `update_group` (#114). Sending every row on every save would
 * mean a table filled a minute ago overwrites whatever another board has saved
 * since — and the administration page deliberately does *not* refill a section
 * while somebody is typing in it (#180), so stale is the normal case, not the
 * unlucky one.
 *
 * ⭐ So a save says only what this person actually edited, and an empty string
 * is a deliberate clear rather than a side effect of having been on screen.
 */
export function slotPayload(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || !toSlot(row.slot)) {
      return;
    }
    const update = { slot: row.slot };
    let changed = false;
    if (text(row.deviceId) !== text(row.wasDeviceId)) {
      update.extended_id = text(row.deviceId);
      changed = true;
    }
    if (text(row.person) !== text(row.wasPerson)) {
      update.extended_name = text(row.person);
      changed = true;
    }
    if (changed) {
      out.push(update);
    }
  });
  return out;
}

/** How many rows a save would touch, for the sentence after it. */
export function saveSummary(rows) {
  const n = slotPayload(rows).length;
  if (!n) {
    return 'Nothing changed.';
  }
  return n === 1 ? 'Saved 1 slot.' : `Saved ${n} slots.`;
}

/** The line under the table: what is configured and how much of it is named. */
export function tableSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return 'No slots configured. Add receivers first.';
  }
  const named = list.filter((row) => text(row.person)).length;
  const slots = list.length === 1 ? '1 slot' : `${list.length} slots`;
  return `${slots}, ${named} named.`;
}
