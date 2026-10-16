/**
 * Putting a channel into a group, and taking it out again (#243).
 *
 * ⛔ Until this existed there was **no way to do it at all**. `js/dnd.js` was
 * the only writer of a group's `slots`, and #223 retired the menu-bar button
 * that was its only caller -- so a group could be created and named and would
 * always be empty. The field test found it: *"Can't assign channels to a group
 * from this section as you should."*
 *
 * The decision was to put the control in the **Groups section**, rather than
 * restore the board's drag editor: an administrator is already standing here,
 * and the board editor forces a television out of Board mode to draw itself --
 * the same trip the Slots table was rebuilt to stop making.
 *
 * Pure, because every rule below is one that got broken somewhere else first.
 */

/**
 * A stored value read as a slot number, or `null` if it is not one.
 *
 * ⛔ Not `Number(value)`. `Number(null)`, `Number('')` and `Number(false)` are
 * all **0** -- a finite number that passes every obvious guard -- so a group
 * whose stored list had a null in it would quietly gain a channel numbered
 * zero, and the next save would write that phantom back to the server. Caught
 * by a test rather than by review, which is the only reason it is not in the
 * config files already.
 */
function asSlotNumber(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

/**
 * The slot numbers a group holds, exactly as stored.
 *
 * ⛔ Not the resolved slots. A group may list a number no slot answers to --
 * deleting a slot does not visit every group -- and those strays are the only
 * evidence a group has gone stale. Rebuilding membership from what resolves
 * would delete them silently, on a save the operator thought was about
 * something else.
 */
export function storedNumbers(entry) {
  const list = entry && Array.isArray(entry.slots) ? entry.slots : [];
  return list.map(asSlotNumber).filter((n) => n !== null);
}

/**
 * Add or remove one channel, and leave everything else exactly where it was.
 *
 * ⭐ **A group's order is the order it is shown in** (#113), so adding a
 * channel appends rather than sorting: re-sorting on every tick would silently
 * rearrange a board somebody had already arranged by hand. Removing closes the
 * gap and changes nothing else.
 *
 * Returns a new array; never mutates.
 */
export function toggleMembership(current, slotNumber, shouldBeIn) {
  const n = asSlotNumber(slotNumber);
  if (n === null) {
    return storedNumbers({ slots: current });
  }

  const next = storedNumbers({ slots: current });

  const at = next.indexOf(n);
  if (shouldBeIn) {
    if (at === -1) next.push(n);
    return next;
  }
  if (at !== -1) next.splice(at, 1);
  return next;
}

/**
 * One row per channel on the board, for the picker in a single group.
 *
 * Every slot is listed, not only the unclaimed ones: a channel can belong to
 * more than one group -- a vocalist in Worship and in Sunday Morning -- and
 * hiding the ones already spoken for would make that impossible to express.
 *
 * `elsewhere` is what the row says instead of hiding it: which *other* groups
 * already hold this channel, so moving one out of the wrong group does not
 * mean opening every other group to find out where it went.
 */
export function membershipRows({
  groupNumber, groups, slots, label,
}) {
  const mine = new Set(storedNumbers((groups || {})[groupNumber] ?? (groups || {})[String(groupNumber)]));
  const naming = typeof label === 'function' ? label : (s) => `Slot ${s && s.slot}`;

  const others = new Map();
  Object.keys(groups || {}).forEach((key) => {
    const number = Number(key);
    if (!Number.isFinite(number) || number === Number(groupNumber)) return;
    const entry = groups[key];
    const title = (entry && entry.title) || `Group ${number}`;
    storedNumbers(entry).forEach((n) => {
      if (!others.has(n)) others.set(n, []);
      others.get(n).push(title);
    });
  });

  return (Array.isArray(slots) ? slots : [])
    .filter((s) => s && asSlotNumber(s.slot) !== null)
    .sort((a, b) => asSlotNumber(a.slot) - asSlotNumber(b.slot))
    .map((slot) => {
      const n = asSlotNumber(slot.slot);
      return {
        slot: n,
        label: naming(slot),
        checked: mine.has(n),
        elsewhere: others.get(n) || [],
      };
    });
}

/**
 * What to send for a membership change.
 *
 * ⛔ `slots` and nothing else. `update_group` edits the fields a payload
 * carries and leaves the rest, so sending a title here would mean this control
 * writing back a name it never showed anybody -- which is exactly the mistake
 * that emptied groups before the partial contract existed. The group number
 * identifies the row; it is not an edit.
 *
 * ⭐ An empty list is sent as an empty list, not omitted: `slots: []` is
 * present and says "empty this group", which is a thing an operator may
 * genuinely want.
 */
export function membershipPayload(groupNumber, numbers) {
  return {
    group: Number(groupNumber),
    slots: storedNumbers({ slots: numbers }),
  };
}

/**
 * What the row under a group says about its membership.
 *
 * Kept here rather than built in the DOM so the empty case is one that can be
 * tested: "No channels in this group" is the state #243 made permanent, and it
 * must read as a thing to fix rather than as a fact.
 */
export function membershipSummary(rows) {
  const chosen = (Array.isArray(rows) ? rows : []).filter((r) => r && r.checked);
  if (!chosen.length) {
    return 'No channels yet — choose some below.';
  }
  return chosen.map((r) => r.label).join(', ');
}
