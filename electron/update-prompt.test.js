/**
 * The prompt has to be persistent without becoming noise.
 *
 * Those pull in opposite directions: it stays up until it is acted on, and it
 * is shown again every six hours, so getting dismissal wrong turns a message
 * that matters into one that gets clicked away unread. The rule is per version,
 * and these are the cases that rule exists for.
 */

const test = require('node:test');
const assert = require('node:assert');

const { shouldPrompt, normalizeVersion, formatProgress, trayLabel } = require('./update-prompt');

test('an available update prompts when nothing has been dismissed', () => {
  assert.equal(shouldPrompt({
    currentVersion: '1.7.0', latestVersion: '1.8.0', dismissedVersion: null,
  }), true);
});

test('no prompt when already on the latest version', () => {
  assert.equal(shouldPrompt({
    currentVersion: '1.8.0', latestVersion: '1.8.0', dismissedVersion: null,
  }), false);
});

test('no prompt when running something newer than the release', () => {
  assert.equal(shouldPrompt({
    currentVersion: '1.9.0', latestVersion: '1.8.0', dismissedVersion: null,
  }), false);
});

test('a dismissed version stops asking about that version', () => {
  assert.equal(shouldPrompt({
    currentVersion: '1.7.0', latestVersion: '1.8.0', dismissedVersion: '1.8.0',
  }), false);
});

test('a NEWER release asks again after an earlier one was dismissed', () => {
  // The whole point of remembering per version rather than per launch: saying
  // "not now" to 1.8.0 must not silence 1.9.0 forever.
  assert.equal(shouldPrompt({
    currentVersion: '1.7.0', latestVersion: '1.9.0', dismissedVersion: '1.8.0',
  }), true);
});

test('an older release than the dismissed one does not resurface', () => {
  assert.equal(shouldPrompt({
    currentVersion: '1.6.0', latestVersion: '1.7.0', dismissedVersion: '1.8.0',
  }), false);
});

test('a leading v does not make a version look different', () => {
  assert.equal(shouldPrompt({
    currentVersion: '1.7.0', latestVersion: 'v1.8.0', dismissedVersion: 'v1.8.0',
  }), false);
});

test('normalizeVersion strips the tag prefix and rejects nonsense', () => {
  assert.equal(normalizeVersion('v1.8.0'), '1.8.0');
  assert.equal(normalizeVersion('1.8.0'), '1.8.0');
  assert.equal(normalizeVersion('  v1.8.0  '), '1.8.0');
  assert.equal(normalizeVersion(null), null);
  assert.equal(normalizeVersion(''), null);
});

test('progress before any bytes arrive does not read as 0% of nothing', () => {
  assert.deepEqual(formatProgress(null), { percent: 0, label: 'Starting download…' });
  assert.deepEqual(formatProgress({}), { percent: 0, label: 'Starting download…' });
});

test('progress is rounded and bounded', () => {
  const p = formatProgress({ percent: 41.66667, transferred: 81 * 1024 * 1024, total: 194 * 1024 * 1024 });
  assert.equal(p.percent, 42);
  assert.equal(p.label, 'Downloading… 42% (81 of 194 MB)');
});

test('a percent outside 0-100 is clamped rather than shown', () => {
  assert.equal(formatProgress({ percent: 140, total: 0 }).percent, 100);
  assert.equal(formatProgress({ percent: -5, total: 0 }).percent, 0);
});

test('progress without a known total still reports a percentage', () => {
  assert.equal(formatProgress({ percent: 50, transferred: 1, total: 0 }).label, 'Downloading… 50%');
});

test('the tray keeps reporting an update after the prompt is dismissed', () => {
  // Dismissing means "stop interrupting me", not "forget this exists" -- the
  // tray is the only always-visible surface a menu-bar app has.
  assert.equal(
    trayLabel({ state: 'available', currentVersion: '1.7.0', latestVersion: '1.8.0' }),
    'Update available: 1.8.0',
  );
});

test('the tray distinguishes every stage of the install', () => {
  assert.equal(trayLabel({ state: 'checking' }), 'Checking for updates…');
  assert.equal(trayLabel({ state: 'downloading', latestVersion: '1.8.0' }), 'Downloading update 1.8.0…');
  assert.equal(trayLabel({ state: 'ready', latestVersion: '1.8.0' }), 'Update 1.8.0 ready — restart to install');
  assert.equal(trayLabel({ state: 'error' }), 'Update check failed');
  assert.equal(trayLabel({ state: 'current', currentVersion: '1.8.0' }), 'Up to date (1.8.0)');
});

test('a dev build says why updates are unavailable rather than checking forever', () => {
  // electron-updater refuses to run unpackaged. Without this the tray would sit
  // on "Checking for updates…" for the life of the process.
  assert.equal(trayLabel({ state: 'unsupported' }), 'Updates unavailable in a dev build');
});
