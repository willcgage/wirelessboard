/**
 * Tests for the update check. Run with `npm run test:js`.
 *
 * Uses node:test, which ships with Node 22 -- the same version CI now runs --
 * so the repository gains JavaScript tests without gaining a dependency.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  parseVersion,
  compareVersions,
  isUpdateAvailable,
  checkForUpdate,
  RELEASES_PAGE,
} = require('./update-check');

test('parseVersion tolerates the leading v that git tags carry', () => {
  assert.deepStrictEqual(parseVersion('v1.5.1'), parseVersion('1.5.1'));
});

test('parseVersion returns null for anything it cannot read', () => {
  for (const bad of ['', 'latest', null, undefined, 42, 'v1.5']) {
    assert.strictEqual(parseVersion(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('compareVersions orders by major, then minor, then patch', () => {
  assert.strictEqual(compareVersions('2.0.0', '1.9.9'), 1);
  assert.strictEqual(compareVersions('1.6.0', '1.5.9'), 1);
  assert.strictEqual(compareVersions('1.5.2', '1.5.1'), 1);
  assert.strictEqual(compareVersions('1.5.1', '1.5.1'), 0);
  assert.strictEqual(compareVersions('1.5.1', '1.5.2'), -1);
});

test('compareVersions does not compare version parts as strings', () => {
  // "10" < "9" lexically, which is the classic way this goes wrong.
  assert.strictEqual(compareVersions('1.10.0', '1.9.0'), 1);
  assert.strictEqual(compareVersions('10.0.0', '9.0.0'), 1);
});

test('a prerelease sorts below the same version without one', () => {
  assert.strictEqual(compareVersions('1.6.0-beta.1', '1.6.0'), -1);
  assert.strictEqual(compareVersions('1.6.0', '1.6.0-beta.1'), 1);
});

test('an unreadable version compares as equal rather than guessing', () => {
  assert.strictEqual(compareVersions('nonsense', '1.5.1'), 0);
  assert.strictEqual(compareVersions('1.5.1', 'nonsense'), 0);
});

test('isUpdateAvailable is false for the running version and for older ones', () => {
  assert.strictEqual(isUpdateAvailable('1.5.1', '1.5.1'), false);
  assert.strictEqual(isUpdateAvailable('1.5.1', '1.5.0'), false);
  assert.strictEqual(isUpdateAvailable('1.5.1', 'v1.6.0'), true);
});

const release = (tag, url) => ({ tag_name: tag, html_url: url });

test('checkForUpdate reports a newer release', async () => {
  const result = await checkForUpdate({
    currentVersion: '1.5.1',
    getJson: async () => release('v1.6.0', 'https://example.test/v1.6.0'),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updateAvailable, true);
  assert.strictEqual(result.latestVersion, '1.6.0');
  assert.strictEqual(result.url, 'https://example.test/v1.6.0');
});

test('checkForUpdate reports no update when running the newest', async () => {
  const result = await checkForUpdate({
    currentVersion: '1.5.1',
    getJson: async () => release('v1.5.1'),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updateAvailable, false);
});

test('checkForUpdate does not announce a downgrade', async () => {
  // A published release can be older than a locally built one.
  const result = await checkForUpdate({
    currentVersion: '1.6.0',
    getJson: async () => release('v1.5.1'),
  });

  assert.strictEqual(result.updateAvailable, false);
});

test('a network failure is reported, not thrown', async () => {
  const result = await checkForUpdate({
    currentVersion: '1.5.1',
    getJson: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'unreachable');
  assert.match(result.error, /ENOTFOUND/);
});

test('a response with no usable version is reported, not thrown', async () => {
  for (const payload of [{}, null, { tag_name: 'nightly' }]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await checkForUpdate({ currentVersion: '1.5.1', getJson: async () => payload });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'unparseable');
  }
});

test('falls back to the releases page when the payload has no url', async () => {
  const result = await checkForUpdate({
    currentVersion: '1.5.1',
    getJson: async () => ({ tag_name: 'v1.6.0' }),
  });

  assert.strictEqual(result.url, RELEASES_PAGE);
});

test('name is accepted when tag_name is absent', async () => {
  const result = await checkForUpdate({
    currentVersion: '1.5.1',
    getJson: async () => ({ name: '1.6.0' }),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updateAvailable, true);
});
