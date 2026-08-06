/**
 * When to put the update prompt in front of someone, and when to leave them
 * alone.
 *
 * No electron import and no filesystem of its own — the caller passes in what
 * was remembered and writes back what comes out. Same reason as update-check.js:
 * the decisions are the part worth testing, and they can be exercised here
 * without packaging an app or reaching the network.
 */

const { isUpdateAvailable } = require('./update-check');

/**
 * Dismissal is remembered per version, not per launch.
 *
 * Per launch would re-ask every six hours forever for a version already
 * declined, which on a machine left running through a weekend is just noise —
 * and noise is how a prompt that matters gets clicked away without reading.
 * Per version means "not this one", and the next release asks again, which is
 * the thing the operator actually wanted to be told about.
 */
function shouldPrompt({ currentVersion, latestVersion, dismissedVersion }) {
  if (!isUpdateAvailable(currentVersion, latestVersion)) return false;
  if (!dismissedVersion) return true;

  // Compared rather than string-matched so that dismissing 1.8.0 also silences
  // it after a downgrade, and — more usefully — so a *newer* release than the
  // dismissed one still prompts.
  return isUpdateAvailable(dismissedVersion, latestVersion);
}

/**
 * Normalise what electron-updater and the GitHub API each call a version.
 * Tags carry a leading "v"; package.json does not.
 */
function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^v/i, '');
  return trimmed || null;
}

/**
 * Human-readable progress for the prompt window.
 *
 * electron-updater reports bytes and a percent that can arrive as a float with
 * a long tail; neither is worth showing raw.
 */
function formatProgress(progress) {
  if (!progress || typeof progress.percent !== 'number' || Number.isNaN(progress.percent)) {
    return { percent: 0, label: 'Starting download…' };
  }
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const total = Number(progress.total);
  if (!Number.isFinite(total) || total <= 0) {
    return { percent, label: `Downloading… ${percent}%` };
  }
  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(0);
  return {
    percent,
    label: `Downloading… ${percent}% (${mb(progress.transferred)} of ${mb(total)} MB)`,
  };
}

/**
 * What the tray entry says. It is the only always-visible surface this app has,
 * so it keeps reporting the update even after the prompt has been dismissed —
 * dismissing means "stop interrupting me", not "forget this exists".
 */
function trayLabel({ state, currentVersion, latestVersion }) {
  if (state === 'unsupported') return 'Updates unavailable in a dev build';
  if (state === 'checking' || !state) return 'Checking for updates…';
  if (state === 'available') return `Update available: ${latestVersion}`;
  if (state === 'downloading') return `Downloading update ${latestVersion}…`;
  if (state === 'ready') return `Update ${latestVersion} ready — restart to install`;
  if (state === 'error') return 'Update check failed';
  return `Up to date (${currentVersion})`;
}

module.exports = {
  shouldPrompt,
  normalizeVersion,
  formatProgress,
  trayLabel,
};
