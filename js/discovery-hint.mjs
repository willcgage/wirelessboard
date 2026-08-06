/**
 * What to say when the Discovered Devices list is empty.
 *
 * It used to say nothing at all -- the renderer returned early on an empty list,
 * so a board that found no receivers showed blank space under a heading. The
 * operator's next move was a third-party discovery tool, because nothing here
 * suggested a better one (#51, split out of #21).
 *
 * No DOM and no imports, so the wording rules can be tested directly. Same
 * reason as slot-rules.mjs beside it.
 */

/**
 * @param {object} scan   discovery_scan from the server: has_scanned, networks,
 *                        platform
 * @param {object} config the discovery settings in force: auto, subnets
 * @returns {{title: string, body: string[], showManualHint: boolean}|null}
 *          null when there is nothing to say -- i.e. devices were found.
 */
export function discoveryHint({ scan, config, deviceCount }) {
  if (deviceCount > 0) return null;

  const hasScanned = Boolean(scan && scan.has_scanned);
  const networks = (scan && Array.isArray(scan.networks)) ? scan.networks : [];
  const manual = (config && Array.isArray(config.subnets)) ? config.subnets : [];
  const auto = Boolean(config && config.auto);

  // Not yet looked. Saying "found nothing" here would be a claim about a scan
  // that has not happened -- a board is in this state for its first few seconds
  // every single start.
  if (!hasScanned) {
    return {
      title: 'Looking for receivers…',
      body: ['The first scan has not finished yet.'],
      showManualHint: false,
    };
  }

  // Scanned nowhere. The distinction matters: this is the one an operator can
  // fix outright, and telling them the scan "found nothing" would send them
  // looking at the network instead of at this panel.
  if (networks.length === 0) {
    return {
      title: 'Nothing to scan',
      body: auto
        ? ['Automatic subnets did not produce a usable network, and no manual '
           + 'CIDR ranges are set. Add the network your receivers are on below.']
        : ['Automatic subnets is off and no manual CIDR ranges are set, so '
           + 'discovery has nowhere to look. Add the network your receivers '
           + 'are on below.'],
      showManualHint: true,
    };
  }

  const body = [
    `Scanned ${networks.join(', ')} — probing TCP port 2202 on each address — `
    + 'and no receivers answered.',
  ];

  // The most useful thing this can tell someone: it looked somewhere else.
  // Naming the ranges lets them see at a glance that their receivers are on a
  // network nobody swept.
  if (manual.length === 0) {
    body.push('If your receivers are on a different network, add it as a manual '
      + 'CIDR range below. Active scanning reaches networks where multicast '
      + 'discovery does not — across a VLAN, or where it is blocked.');
  } else {
    body.push('Check that the ranges above cover the network your receivers are '
      + 'actually on.');
  }

  // Deliberately not presented as the likely cause, and never as the only one.
  // On macOS the permission is a real and silent possibility, but so is simply
  // having scanned the wrong range, and leading with the permission would send
  // people into System Settings first.
  if (scan && scan.platform === 'darwin') {
    body.push('On macOS, also check System Settings → Privacy & Security → Local '
      + 'Network. Wirelessboard is denied silently if it is off, and an existing '
      + 'install is not asked again — toggle it off and back on.');
  }

  return { title: 'No receivers found', body, showManualHint: true };
}
