/**
 * The pre-release update channel.
 *
 * ⛔ The thing this exists to prevent is a board in a service being offered a
 * beta. Almost every test below is about that not happening — the channel being
 * useful to a tester is the easy half.
 *
 * ⭐ And the thing it exists to fix: a board running 2.0.0-beta.2 could not be
 * told about anything. `/releases/latest` ignores pre-releases, so it answered
 * "1.16.2", which is *older* than what the board was running — no update, ever,
 * including the stable 2.0.0 that would have ended the beta.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const updateCheck = require('./update-check');
const updateSettings = require('./update-settings');

const release = (tag, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/willcgage/wirelessboard/releases/tag/${tag}`,
  prerelease: /-/.test(tag),
  draft: false,
  ...extra,
});

/** What the repository actually looked like when this was written. */
const LISTING = [
  release('v2.0.0-beta.2'),
  release('v2.0.0-beta.1'),
  release('v1.16.2'),
  release('v1.16.1'),
];

function checker(payload) {
  const seen = [];
  return {
    seen,
    getJson: async (url) => {
      seen.push(url);
      return typeof payload === 'function' ? payload(url) : payload;
    },
  };
}

test('⛔ a stable board is not offered a beta', async () => {
  // The default, and the one that must never break.
  const { getJson, seen } = checker(release('v1.16.2'));
  const result = await updateCheck.checkForUpdate({
    currentVersion: '1.16.2', getJson, includePrereleases: false,
  });

  assert.equal(result.updateAvailable, false);
  assert.ok(seen[0].endsWith('/releases/latest'), 'the stable channel uses the stable endpoint');
});

test('⭐ a board on a beta is told about the next beta', async () => {
  // The whole point. Without the channel this board hears nothing at all.
  const { getJson, seen } = checker(LISTING);
  const result = await updateCheck.checkForUpdate({
    currentVersion: '2.0.0-beta.1', getJson, includePrereleases: true,
  });

  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, '2.0.0-beta.2');
  assert.equal(result.prerelease, true, 'and is told it is a beta');
  assert.ok(seen[0].includes('/releases?'), 'the beta channel has to use the list endpoint');
});

test('⛔ and the same board without the channel is told nothing, which is the bug', async () => {
  // `/releases/latest` answers 1.16.2 to a board running 2.0.0-beta.1. That is
  // older, so there is no update — and never will be, including 2.0.0 itself.
  const { getJson } = checker(release('v1.16.2'));
  const result = await updateCheck.checkForUpdate({
    currentVersion: '2.0.0-beta.1', getJson, includePrereleases: false,
  });

  assert.equal(result.updateAvailable, false);
});

test('⛔ a stable release still wins when it is newer than the newest beta', async () => {
  // Leaving the beta behind is the point of the beta. A tester on 2.0.0-beta.2
  // must be offered 2.0.0 when it lands, not kept on betas forever.
  const listing = [release('v2.0.0'), ...LISTING];
  const { getJson } = checker(listing);
  const result = await updateCheck.checkForUpdate({
    currentVersion: '2.0.0-beta.2', getJson, includePrereleases: true,
  });

  assert.equal(result.latestVersion, '2.0.0');
  assert.equal(result.updateAvailable, true);
  assert.equal(result.prerelease, false);
});

test('⛔ a draft is never announced, on either channel', async () => {
  // The pipeline publishes to a draft a human promotes later. Announcing one
  // sends an operator to a release they cannot download.
  const listing = [release('v2.0.0-beta.3', { draft: true }), ...LISTING];
  const { getJson } = checker(listing);
  const result = await updateCheck.checkForUpdate({
    currentVersion: '2.0.0-beta.1', getJson, includePrereleases: true,
  });

  assert.equal(result.latestVersion, '2.0.0-beta.2', 'the draft must not win');
});

test('⚠️ the newest version wins, not the most recently published', async () => {
  // The listing comes back in publication order. A 1.16.3 patch cut after 2.0.0
  // would otherwise beat it.
  const listing = [release('v1.16.3'), release('v2.0.0'), release('v1.16.2')];

  assert.equal(updateCheck.newestRelease(listing).tag_name, 'v2.0.0');
});

test('an empty or unusable listing is "cannot tell", not "no update"', async () => {
  for (const payload of [[], [{ draft: true, tag_name: 'v9.9.9' }], [{ tag_name: 'nonsense' }], null]) {
    const { getJson } = checker(payload);
    const result = await updateCheck.checkForUpdate({
      currentVersion: '2.0.0-beta.1', getJson, includePrereleases: true,
    });
    assert.equal(result.ok, false, `expected "cannot tell" for ${JSON.stringify(payload)}`);
  }
});

test('a network failure stays quiet on the beta channel too', async () => {
  const getJson = async () => { throw new Error('offline'); };
  const result = await updateCheck.checkForUpdate({
    currentVersion: '2.0.0-beta.1', getJson, includePrereleases: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
});


test('⛔ the channel is off for a stable board that has never chosen', () => {
  assert.equal(
    updateSettings.shouldIncludePrereleases({ settings: {}, currentIsPrerelease: false }),
    false,
  );
  assert.equal(updateSettings.shouldIncludePrereleases(), false, 'and with no arguments at all');
});

test('⭐ but on for a board already running one', () => {
  // Not a policy decision — somebody installed a beta by hand, and the build
  // they are running is the evidence. Without this they hear nothing.
  assert.equal(
    updateSettings.shouldIncludePrereleases({ settings: {}, currentIsPrerelease: true }),
    true,
  );
});

test('⚠️ an explicit choice wins in both directions', () => {
  // A tester leaving the beta channel, and a stable board opting in.
  assert.equal(
    updateSettings.shouldIncludePrereleases({
      settings: { includePrereleases: false }, currentIsPrerelease: true,
    }),
    false,
    'a beta board can opt out',
  );
  assert.equal(
    updateSettings.shouldIncludePrereleases({
      settings: { includePrereleases: true }, currentIsPrerelease: false,
    }),
    true,
    'a stable board can opt in',
  );
});

test('⛔ "never chosen" is not the same as "chosen false"', () => {
  // The distinction the whole setting rests on. Stored as a boolean default it
  // would collapse, and a beta board would be stranded again.
  assert.equal(updateSettings.normalizeSettings({}).includePrereleases, null);
  assert.equal(updateSettings.normalizeSettings({ includePrereleases: false }).includePrereleases, false);
  assert.equal(updateSettings.normalizeSettings({ includePrereleases: 'yes' }).includePrereleases, null,
    'junk is "never chosen", not true');
});

test('choosing a channel does not disturb the other settings', () => {
  // The merge rule this file was built around: one key must never reset another.
  const merged = updateSettings.mergeSettings(
    { automaticChecks: false, dismissedVersion: '1.16.2' },
    { includePrereleases: true },
  );

  assert.equal(merged.automaticChecks, false);
  assert.equal(merged.dismissedVersion, '1.16.2');
  assert.equal(merged.includePrereleases, true);
});

test('isPrerelease reads the running version the way the channel default needs', () => {
  assert.equal(updateCheck.isPrerelease('2.0.0-beta.2'), true);
  assert.equal(updateCheck.isPrerelease('v2.0.0-beta.2'), true);
  assert.equal(updateCheck.isPrerelease('2.0.0'), false);
  assert.equal(updateCheck.isPrerelease('nonsense'), false, 'unparseable is not a beta');
});
