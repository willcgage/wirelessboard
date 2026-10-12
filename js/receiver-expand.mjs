/**
 * Turning a discovered receiver into the channels it actually has (#144).
 *
 * ⛔ The configuration page is one row per *channel*, and a channel is not the
 * thing anyone owns. An AD4Q is four rows, each repeating the same IP and type.
 * Worse, "Add All Discovered Devices" added **one** row per receiver — so a
 * discovered quad arrived as a single channel-1 row and the other three had to
 * be typed by hand anyway.
 *
 * ⭐ The count was already on the wire the whole time. `py/discover.py` resolves
 * the receiver's model to a channel count and puts it on each entry as
 * `channels`; the browser simply never read it.
 *
 * ⚠️ It cannot be derived from `type`. `py/device_config.py` maps a **model
 * string** to a count — `axtd` covers both AD4D (2) and AD4Q (4) — and the
 * tables for `slxd`/`slxdplus` are deliberately empty because those model
 * strings have never been observed. So this works from what discovery found,
 * and falls back to one channel rather than guessing.
 */

/** How many channels a discovered receiver has, as far as discovery could tell. */
export function channelCount(device) {
  const raw = device && device.channels;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    // ⚠️ One, not zero. An unknown receiver still has at least the channel it
    // announced itself on, and adding nothing would look like a failure.
    return 1;
  }
  return Math.min(Math.floor(n), 16);
}

/** A stable identity for a receiver: its address. */
export function receiverKey(device) {
  return String((device && device.ip) || '').trim();
}

/**
 * The channels of this receiver that the board already has configured.
 *
 * ⚠️ Matched on address **and** channel number, not address alone. A rack
 * shared with another system, or a board set up one channel at a time, can
 * legitimately have some of a receiver's channels and not others.
 */
export function configuredChannels(device, slots) {
  const ip = receiverKey(device);
  if (!ip || !Array.isArray(slots)) {
    return [];
  }
  return slots
    .filter((slot) => slot && String(slot.ip || '').trim() === ip)
    .map((slot) => Number(slot.channel))
    .filter((n) => Number.isFinite(n));
}

/**
 * The rows to add for this receiver: one per channel it does not already have.
 *
 * ⛔ Carries no slot number. Numbers are assigned by `slot-numbering.mjs` when
 * the rows land in the editor, and inventing them here would be a second
 * source of truth for the one value that decides which group a channel is in
 * (#147).
 */
export function channelsToAdd(device, slots) {
  const ip = receiverKey(device);
  if (!ip) {
    return [];
  }
  const already = new Set(configuredChannels(device, slots));
  const rows = [];
  for (let channel = 1; channel <= channelCount(device); channel += 1) {
    if (already.has(channel)) {
      continue;
    }
    rows.push({
      ip,
      type: String((device && device.type) || '').trim(),
      channel,
      // Only the channel the receiver announced itself on carries a name;
      // discovery does not report the others' labels.
      device_name: channel === (Number(device && device.channel) || 1)
        ? String((device && (device.chan_name_raw || device.name_raw || device.name)) || '').trim()
        : '',
    });
  }
  return rows;
}

/**
 * What to say on the button for one receiver.
 *
 * ⭐ Names the number, because "Add" on a quad adding four rows is a surprise
 * worth not having — and on a receiver that is already configured the honest
 * answer is that there is nothing to add.
 */
export function addLabel(device, slots) {
  const pending = channelsToAdd(device, slots).length;
  if (!pending) {
    return 'Already added';
  }
  const total = channelCount(device);
  if (pending === total) {
    return total === 1 ? 'Add' : `Add ${total} channels`;
  }
  return `Add ${pending} more`;
}

/** Every row to add across all discovered receivers, in listed order. */
export function allChannelsToAdd(devices, slots) {
  if (!Array.isArray(devices)) {
    return [];
  }
  const planned = Array.isArray(slots) ? slots.slice() : [];
  const rows = [];
  devices.forEach((device) => {
    const pending = channelsToAdd(device, planned);
    pending.forEach((row) => {
      rows.push(row);
      // ⚠️ Counted as planned straight away, so the same receiver listed twice
      // by discovery does not produce its channels twice.
      planned.push({ ip: row.ip, channel: row.channel });
    });
  });
  return rows;
}
