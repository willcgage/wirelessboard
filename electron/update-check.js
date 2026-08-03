/**
 * Checking whether a newer Wirelessboard has been released.
 *
 * Deliberately notify-only. This application runs during live services, so it
 * does not download or install anything on its own -- it reports what is
 * available and leaves the decision to the operator.
 *
 * No electron import and no network client of its own: the caller injects
 * `getJson`, so the comparison logic can be exercised without a network or a
 * running app. That is the whole reason this is a separate file.
 */

const RELEASES_API = 'https://api.github.com/repos/willcgage/wirelessboard/releases/latest';
const RELEASES_PAGE = 'https://github.com/willcgage/wirelessboard/releases/latest';

/**
 * Split a version into comparable parts. Accepts a leading "v" because git tags
 * carry one and package.json does not.
 *
 * Returns null for anything unparseable, which callers treat as "cannot tell"
 * rather than "no update" -- guessing in either direction would be worse.
 */
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    // A prerelease sorts *below* the same numbers without one, per semver.
    prerelease: match[4] || null,
  };
}

/** -1 if a < b, 0 if equal, 1 if a > b. Null for either side is 0. */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }

  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

function isUpdateAvailable(currentVersion, latestVersion) {
  return compareVersions(latestVersion, currentVersion) > 0;
}

/**
 * Ask GitHub what the newest release is and say whether it beats what is
 * running.
 *
 * /releases/latest excludes drafts and prereleases, which matters here: this
 * project publishes through electron-builder, which uploads to a *draft*
 * release that a human promotes later. A check that saw drafts would announce
 * versions nobody can download yet.
 *
 * Never throws. A failed check is not worth interrupting anyone over, so
 * network and parse failures come back as { ok: false } and the caller stays
 * quiet.
 */
async function checkForUpdate({ currentVersion, getJson }) {
  let payload;
  try {
    payload = await getJson(RELEASES_API);
  } catch (error) {
    return { ok: false, reason: 'unreachable', error: String(error && error.message ? error.message : error) };
  }

  const latestVersion = payload && (payload.tag_name || payload.name);
  if (!parseVersion(latestVersion)) {
    return { ok: false, reason: 'unparseable', latestVersion: latestVersion || null };
  }

  return {
    ok: true,
    currentVersion,
    latestVersion: String(latestVersion).replace(/^v/i, ''),
    updateAvailable: isUpdateAvailable(currentVersion, latestVersion),
    url: (payload && payload.html_url) || RELEASES_PAGE,
  };
}

module.exports = {
  RELEASES_API,
  RELEASES_PAGE,
  parseVersion,
  compareVersions,
  isUpdateAvailable,
  checkForUpdate,
};
