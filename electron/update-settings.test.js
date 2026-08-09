/**
 * Tests for the update-state.json rules. Run with `npm run test:js`.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeSettings, mergeSettings, shouldCheck, DEFAULTS,
} = require('./update-settings');

test('automatic checks are on by default', () => {
  // A board that quietly stopped looking for updates is worse than one that asks.
  assert.strictEqual(DEFAULTS.automaticChecks, true);
  assert.strictEqual(normalizeSettings(undefined).automaticChecks, true);
  assert.strictEqual(normalizeSettings({}).automaticChecks, true);
});

test('an explicit false is honoured', () => {
  assert.strictEqual(normalizeSettings({ automaticChecks: false }).automaticChecks, false);
});

test('a malformed value falls back to on rather than off', () => {
  // Guessing "on" costs one prompt; guessing "off" costs every future security
  // update going unmentioned.
  ['no', 0, null, [], {}].forEach((value) => {
    assert.strictEqual(
      normalizeSettings({ automaticChecks: value }).automaticChecks,
      true,
      `expected ${JSON.stringify(value)} to fall back to on`,
    );
  });
});

test('a non-object file does not throw', () => {
  assert.strictEqual(normalizeSettings(null).automaticChecks, true);
  assert.strictEqual(normalizeSettings('nonsense').automaticChecks, true);
  assert.strictEqual(normalizeSettings([1, 2]).automaticChecks, true);
});

test('merging keeps the keys it is not changing', () => {
  // The bug this exists to prevent: writing a dismissal used to replace the
  // whole object, so it would have switched automatic checks back on.
  const existing = { dismissedVersion: '1.9.1', automaticChecks: false };
  const merged = mergeSettings(existing, { dismissedVersion: '1.10.0' });
  assert.strictEqual(merged.automaticChecks, false);
  assert.strictEqual(merged.dismissedVersion, '1.10.0');
});

test('merging preserves keys this build has never heard of', () => {
  // An older build downgrading a newer build's settings file would be a bad
  // way to discover the format had moved on.
  const merged = mergeSettings({ somethingNewer: 42 }, { automaticChecks: false });
  assert.strictEqual(merged.somethingNewer, 42);
  assert.strictEqual(merged.automaticChecks, false);
});

test('merging tolerates rubbish on either side', () => {
  assert.deepStrictEqual(mergeSettings(null, { automaticChecks: false }), { automaticChecks: false });
  assert.deepStrictEqual(mergeSettings({ a: 1 }, null), { a: 1 });
  assert.deepStrictEqual(mergeSettings(undefined, undefined), {});
});

test('a scheduled check is skipped when automatic checks are off', () => {
  assert.strictEqual(shouldCheck({ settings: { automaticChecks: false } }), false);
  assert.strictEqual(shouldCheck({ settings: { automaticChecks: true } }), true);
  assert.strictEqual(shouldCheck({ settings: {} }), true);
});

test('a check the operator asked for always goes ahead', () => {
  // Off means "stop doing this on your own", not "refuse when I ask".
  assert.strictEqual(shouldCheck({ settings: { automaticChecks: false }, manual: true }), true);
});

test('shouldCheck with no arguments does not throw', () => {
  assert.strictEqual(shouldCheck(), true);
});
