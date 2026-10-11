import test from 'node:test';
import assert from 'node:assert/strict';

// --------------------------------------------------------------------------
// The wiring: strings are no use unless both panes actually say them
// --------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import {
  viewerCount, presenceLabel, globalChangeWarning, scopeNote,
} from './viewer-scope.mjs';

test('the viewer count comes off the payload, or is unknown', () => {
  assert.equal(viewerCount({ viewers: 3 }), 3);
  assert.equal(viewerCount({ viewers: '3' }), 3);
  assert.equal(viewerCount({ viewers: 0 }), 0);

  // ⚠️ Unknown is not zero. An older server does not send this at all, and
  // printing "0 boards connected" on a board that is plainly connected would
  // be worse than saying nothing.
  assert.equal(viewerCount({}), null);
  assert.equal(viewerCount(null), null);
  assert.equal(viewerCount({ viewers: 'lots' }), null);
  assert.equal(viewerCount({ viewers: -2 }), null);
});

test('presence says boards, because that is what it counts', () => {
  // Two tabs on one laptop are two boards; calling them two people is a guess.
  assert.equal(presenceLabel(3), '3 boards connected');
  assert.equal(presenceLabel(1), 'This board only');
  assert.equal(presenceLabel(0), 'This board only');
  assert.equal(presenceLabel(null), null);
});

test('⭐ nobody is asked to confirm when nobody else is watching', () => {
  // A prompt that always appears is a prompt everyone dismisses unread, and
  // most boards have one operator.
  assert.equal(globalChangeWarning(1), null);
  assert.equal(globalChangeWarning(0), null);
  assert.equal(globalChangeWarning(null), null);
});

test('⛔ the confirmation names the cost rather than asking vaguely', () => {
  // The cost is real: reconfig drops every receiver socket for ~2 seconds, so
  // a save from a phone can blank the wall mid-service.
  assert.equal(
    globalChangeWarning(3, { receivers: true }),
    'This will reload 2 other boards and briefly disconnect the receivers. Continue?',
  );
  assert.equal(
    globalChangeWarning(2, { receivers: true }),
    'This will reload 1 other board and briefly disconnect the receivers. Continue?',
  );
});

test('a change with no receiver cost says only what it costs', () => {
  assert.equal(
    globalChangeWarning(2),
    'This will change what 1 other board is showing. Continue?',
  );
  assert.equal(
    globalChangeWarning(4),
    'This will change what 3 other boards are showing. Continue?',
  );
});

test('each pane says which side of the line it is on', () => {
  assert.equal(scopeNote('device'), 'These settings change this device only.');
  assert.equal(
    scopeNote('global', 3),
    'Changes here affect every connected board. 3 boards connected.',
  );
  // With nobody else connected, the warning is dropped but the fact is not.
  assert.equal(scopeNote('global', 1), 'Changes here affect every connected board.');
  assert.equal(scopeNote('global', null), 'Changes here affect every connected board.');
});

const ROOT = path.join(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

test('both sides of the line say which side they are on', () => {
  assert.match(read('demo.html'), /id="config-scope-note"/, 'the config pane needs a scope note');
  assert.match(read('js', 'config.js'), /scopeNote\('global'/, 'and it should say "every board"');
  assert.match(read('js', 'view-panel.js'), /scopeNote\('device'\)/, 'the panel should say "this device"');
});

test('⛔ a save that reaches other boards asks first', () => {
  const config = read('js', 'config.js');
  const guard = config.split("const url = 'api/config';")[0];
  assert.match(
    guard,
    /globalChangeWarning\(micboard\.viewers, \{ receivers: true \}\)/,
    'the confirmation has to be raised before the save goes out, not after',
  );
  assert.match(guard, /window\.confirm\(warning\)/, 'and it has to actually block on the answer');
});

test('⚠️ the note follows the count rather than printing one stale sentence', () => {
  // The config view renders before the first payload lands, so the count is
  // unknown on the first pass -- which is exactly what happened when this was
  // first wired, and the note sat there saying nothing about who else was on.
  assert.match(read('js', 'data.js'), /wirelessboard:viewers/, 'data.js should announce changes');
  assert.match(read('js', 'config.js'), /addEventListener\('wirelessboard:viewers'/, 'and the note should follow them');
});
