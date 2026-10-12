/**
 * Reading the configuration page as receivers rather than channels (#144).
 *
 * ⛔ A rack of three AD4Qs and two PSM 1000s is sixteen equal rows, and the
 * operator's own model is five boxes. The rows are right — the stored shape is
 * one entry per channel and everything downstream is keyed on the channel's
 * slot number — but nothing on screen says which four rows are one receiver.
 *
 * ⚠️ This groups **contiguous runs**, not every row with the same address.
 * Reordering rows would be the other way to do it, and it is the dangerous one:
 * the saved slots array is written in document order, and shuffling it changes
 * what the board shows for anyone whose channels are not in groups. Grouping
 * what is already adjacent costs nothing and is honest about the rest — a
 * receiver whose channels have been separated shows up as two headers, which
 * is exactly what the configuration says.
 */

/** The address a row belongs to, trimmed. */
export function rowAddress(row) {
  return String((row && row.ip) || '').trim();
}

/**
 * Split rows into contiguous runs sharing an address.
 *
 * Rows with no address — an offline placeholder, or a row the operator has not
 * filled in yet — each stand alone rather than clumping together under a blank
 * heading.
 */
export function groupRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const groups = [];
  rows.forEach((row, index) => {
    const ip = rowAddress(row);
    const previous = groups[groups.length - 1];
    const joinable = previous && ip && previous.ip === ip;
    if (joinable) {
      previous.rows.push({ ...row, index });
      return;
    }
    groups.push({
      ip,
      type: String((row && row.type) || '').trim(),
      rows: [{ ...row, index }],
    });
  });
  return groups;
}

/**
 * What a receiver's heading says.
 *
 * ⭐ Leads with the address, because that is what an operator reads off the
 * back of the box when something is wrong. The device name is whatever the
 * receiver reported and is often the most recognisable thing on the row, so it
 * comes next; the channel count closes it because it is a check, not a label.
 */
export function groupHeading(group, { typeLabels = {} } = {}) {
  if (!group || !group.ip) {
    return 'Not on the network';
  }
  const parts = [group.ip];
  const name = (group.rows || [])
    .map((row) => String((row && row.device_name) || '').trim())
    .find((n) => n);
  if (name) {
    parts.push(name);
  }
  const label = typeLabels[group.type] || group.type;
  if (label) {
    parts.push(label);
  }
  const count = (group.rows || []).length;
  parts.push(`${count} channel${count === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * Whether a receiver's channels have been split up.
 *
 * ⚠️ Worth saying out loud. Two headings for one address is not wrong, but it
 * is almost never deliberate, and the reason a receiver "looks like two" is not
 * obvious from the rows themselves.
 */
export function splitAddresses(groups) {
  const seen = new Map();
  (groups || []).forEach((group) => {
    if (!group.ip) return;
    seen.set(group.ip, (seen.get(group.ip) || 0) + 1);
  });
  return Array.from(seen.entries())
    .filter(([, count]) => count > 1)
    .map(([ip]) => ip);
}

/**
 * The rows for a receiver added by hand.
 *
 * ⛔ The channel count has to be **asked for**. `py/device_config.py` maps a
 * model string to a count, not a type: `axtd` is both AD4D at two channels and
 * AD4Q at four, and the tables for `slxd`/`slxdplus` are empty because those
 * model strings have never been observed. An address and a type genuinely do
 * not say how many channels a box has, and guessing would quietly configure
 * channels that are not there.
 */
export function manualReceiverRows({ ip, type, channels } = {}) {
  const address = String(ip || '').trim();
  if (!address) {
    return [];
  }
  const count = Number(channels);
  const total = Number.isFinite(count) && count >= 1 ? Math.min(Math.floor(count), 16) : 1;

  const rows = [];
  for (let channel = 1; channel <= total; channel += 1) {
    rows.push({
      ip: address, type: String(type || '').trim(), channel, device_name: '',
    });
  }
  return rows;
}

/** Why a manual receiver cannot be added yet, or null. */
export function manualReceiverBlocker({ ip, type } = {}) {
  if (!String(ip || '').trim()) {
    return 'Enter the receiver’s IP address.';
  }
  if (!String(type || '').trim()) {
    // ⚠️ Without a type the save drops the row rather than flagging it
    // (`slot-rules.mjs`), so an unfinished receiver would vanish on Save with
    // nothing said. Better to refuse here, where it can be explained.
    return 'Choose the receiver model.';
  }
  return null;
}
