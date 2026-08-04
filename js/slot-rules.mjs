/**
 * Decisions about which slots get saved, and where.
 *
 * These read no DOM and import nothing, which is the point: the faults they
 * encode were all silent data loss, and every one of them was found by hand in
 * a browser rather than by a test. Kept apart from the modules that call them so
 * they can be exercised directly -- the same reason the update check lives in
 * `electron/update-check.js` with its network call injected.
 *
 * `.mjs` rather than `.js` because the package is CommonJS by default, so Node
 * would otherwise refuse the `export` here. webpack resolves `.mjs` first.
 */

/**
 * Put back the slots the board could not draw.
 *
 * A group's slot list is read back off the board, and the board only draws slots
 * that have a transmitter -- so a slot whose transmitter had not arrived yet was
 * missing from the reading, and saving wrote it out of the group for good. Its
 * own entry in `slots` survived, so nothing looked wrong; only its membership of
 * the group quietly disappeared.
 *
 * Having no transmitter is exactly what separates "never shown" from
 * "deliberately removed": to be dragged out of the group a slot had to be drawn,
 * and to be drawn it needed a transmitter. So a slot the operator actually
 * removed is not resurrected by this.
 *
 * @param {number[]} ordered      slot numbers read off the board, 0 for a blank
 * @param {number[]} storedSlots  the group's slots as last saved
 * @param {(slot: number) => boolean} hasTransmitter
 * @returns {number[]}
 */
export function mergeUnrenderedSlots(ordered, storedSlots, hasTransmitter) {
  if (!Array.isArray(ordered)) {
    return [];
  }
  if (!Array.isArray(storedSlots)) {
    return ordered.slice();
  }

  const merged = ordered.slice();

  storedSlots.forEach((slot, index) => {
    // 0 is a blank spacer -- positional, not a slot -- and the board is already
    // the authority on where those sit.
    if (slot === 0 || merged.indexOf(slot) !== -1 || hasTransmitter(slot)) {
      return;
    }
    merged.splice(Math.min(index, merged.length), 0, slot);
  });

  return merged;
}

/**
 * Read a group's slot order from what the board is showing.
 *
 * @param {{id: string, blank: boolean}[]} entries in document order
 * @returns {number[]}
 */
export function readSlotOrder(entries) {
  const slots = [];

  (entries || []).forEach((entry) => {
    const slot = parseInt(String(entry.id || '').replace(/[^\d.]/g, ''), 10);
    if (slot && slots.indexOf(slot) === -1) {
      slots.push(slot);
    } else if (entry.blank) {
      slots.push(0);
    }
  });

  return slots;
}

/**
 * Decide what a configuration row should be saved as.
 *
 * A row with no resolvable type cannot be written -- there is nothing useful to
 * store -- but skipping it silently meant the save reported success and reloaded
 * the page, so a row the operator had typed an address into simply vanished
 * behind a green "saved". The distinction that matters is whether anything was
 * typed at all: an untouched row from *Add Row* is theirs to ignore, a row with
 * content in it is data about to go missing.
 *
 * @param {{type?: string, ip?: string, name?: string, id?: string}} row
 * @returns {{type: string|null, incomplete: boolean}}
 */
export function resolveSlotType(row) {
  const type = String((row && row.type) || '').trim();
  const ip = String((row && row.ip) || '').trim();
  const name = String((row && row.name) || '').trim();
  const id = String((row && row.id) || '').trim();

  if (type) {
    return { type, incomplete: false };
  }

  // A name and no address is something that only ever existed in the
  // configuration, so it is saved as an offline slot rather than rejected.
  if (name && !ip) {
    return { type: 'offline', incomplete: false };
  }

  // Anything else without a type is unsaveable. Report it only if the operator
  // put something there to lose.
  return { type: null, incomplete: Boolean(ip || name || id) };
}
