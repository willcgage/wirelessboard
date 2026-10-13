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
// ⛔ The list, for the pre-release channel. `/releases/latest` is the *stable*
// endpoint -- it excludes pre-releases by definition, so a board on a beta is
// told the newest release is the last stable one, which is older than what it
// is running. The list is the only way to see a beta at all.
const RELEASES_LIST_API = 'https://api.github.com/repos/willcgage/wirelessboard/releases?per_page=30';
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

/** Whether a version string is a pre-release. Unparseable is not. */
function isPrerelease(value) {
  const parsed = parseVersion(value);
  return Boolean(parsed && parsed.prerelease);
}

/**
 * The newest release in a `/releases` listing, pre-releases included.
 *
 * ⛔ Drafts are refused outright. The release pipeline publishes to a draft
 * that a human promotes later, so a build sitting in a draft is one nobody can
 * download -- announcing it would send an operator to a 404.
 *
 * ⚠️ Picks the highest *version*, not the most recent entry. The list comes
 * back in publication order, and a 2.0.0 published before a 1.16.3 patch would
 * otherwise be beaten by the older one.
 */
function newestRelease(list) {
  if (!Array.isArray(list)) {
    return null;
  }
  let best = null;
  for (const entry of list) {
    if (!entry || entry.draft === true) continue;
    const version = entry.tag_name || entry.name;
    if (!parseVersion(version)) continue;
    if (!best || compareVersions(version, best.tag_name || best.name) > 0) {
      best = entry;
    }
  }
  return best;
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
async function checkForUpdate({ currentVersion, getJson, includePrereleases = false }) {
  let payload;
  try {
    payload = await getJson(includePrereleases ? RELEASES_LIST_API : RELEASES_API);
  } catch (error) {
    return { ok: false, reason: 'unreachable', error: String(error && error.message ? error.message : error) };
  }

  if (includePrereleases) {
    // The list endpoint answers with an array; the stable one with an object.
    payload = newestRelease(payload);
    if (!payload) {
      return { ok: false, reason: 'unparseable', latestVersion: null };
    }
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
    // ⚠️ So the prompt can say which channel this came from. An operator
    // being offered a beta should be told it is one before they install it.
    prerelease: Boolean(payload && payload.prerelease) || isPrerelease(latestVersion),
    url: (payload && payload.html_url) || RELEASES_PAGE,
  };
}

module.exports = {
  RELEASES_API,
  RELEASES_LIST_API,
  RELEASES_PAGE,
  newestRelease,
  isPrerelease,
  parseVersion,
  compareVersions,
  isUpdateAvailable,
  checkForUpdate,
};
