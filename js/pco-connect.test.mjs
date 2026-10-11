import test from 'node:test';
import assert from 'node:assert/strict';

import {
  connectBlocker,
  connectSummary,
  isConnected,
  storedCredentialsNote,
} from './pco-connect.mjs';

test('both fields empty asks for both', () => {
  assert.match(connectBlocker('', ''), /Token and its secret/);
});

test('each missing field is named on its own', () => {
  assert.match(connectBlocker('', 'sec'), /Access Token/);
  assert.match(connectBlocker('tok', ''), /Access Secret/);
});

test('whitespace is not a credential', () => {
  assert.notEqual(connectBlocker('   ', '   '), null);
});

test('nothing blocks once both are filled in', () => {
  assert.equal(connectBlocker('tok', 'sec'), null);
});

test('a successful connect names the account when it can', () => {
  assert.deepEqual(connectSummary({ ok: true, who: 'Will Gage', service_types: 2 }), {
    level: 'ok',
    text: 'Connected as Will Gage.',
  });
});

test('⛔ connecting on a disabled board says what is left, and does not do it', () => {
  // Enable PCO is the admin's switch. Connecting is not consent to flip it --
  // a board may be deliberately out of service. Pointing at the next step keeps
  // that honest without leaving anyone guessing why nothing loads.
  const summary = connectSummary({ ok: true, who: 'Will Gage' }, { enabled: false });

  assert.equal(summary.level, 'warn');
  assert.match(summary.text, /Connected as Will Gage\./);
  assert.match(summary.text, /Tick Enable PCO and save/);
});

test('an enabled board just says connected', () => {
  assert.equal(
    connectSummary({ ok: true, who: 'Will Gage' }, { enabled: true }).text,
    'Connected as Will Gage.',
  );
});

test('⚠️ no name is still a clean success, not a degraded one', () => {
  // A Services-only token is refused by the People API, so the display name is
  // often simply unavailable for credentials that work perfectly.
  assert.deepEqual(connectSummary({ ok: true, service_types: 2 }), {
    level: 'ok',
    text: 'Connected.',
  });
  assert.deepEqual(connectSummary({ ok: true, who: '   ' }), {
    level: 'ok',
    text: 'Connected.',
  });
});

test('⛔ authenticated with nothing to read is a warning, not a success', () => {
  // Every later step comes back empty, and without this it looks like a bug in
  // the board rather than a permission on the token.
  const summary = connectSummary({
    ok: true,
    who: 'Will Gage',
    service_types: 0,
    warning: 'Connected, but this account can see no service types in Services.',
  });

  assert.equal(summary.level, 'warn');
  assert.match(summary.text, /no service types/);
});

test('a refusal is reported in the server’s own words', () => {
  const summary = connectSummary({ ok: false, error: 'Planning Center rejected these credentials (401)' });

  assert.equal(summary.level, 'error');
  assert.match(summary.text, /401/);
});

test('a failure with no reason still says something', () => {
  assert.equal(connectSummary({ ok: false }).level, 'error');
  assert.match(connectSummary({ ok: false }).text, /Could not connect/);
  assert.match(connectSummary(null).text, /No answer/);
});

test('stored credentials count as connected when the panel reopens', () => {
  // ⚠️ Otherwise a board that was set up months ago looks like one that never
  // was, and the operator re-enters a token they do not have to hand.
  assert.equal(isConnected({ hasStoredCredentials: true }), true);
});

test('a connect made in this session counts too', () => {
  assert.equal(isConnected({ hasStoredCredentials: false, lastConnect: { ok: true } }), true);
});

test('a failed connect does not count', () => {
  assert.equal(isConnected({ hasStoredCredentials: false, lastConnect: { ok: false } }), false);
  assert.equal(isConnected({}), false);
  assert.equal(isConnected(), false);
});

test('the opening note says whether anything is stored', () => {
  assert.match(storedCredentialsNote(true), /stored on this computer/);
  assert.equal(storedCredentialsNote(false), 'Not connected yet.');
});
