/**
 * The wall-tablet lock (#116).
 *
 * ⛔ The test that matters here is the last one. The lock works by naming the
 * actions it refuses, so an editor somebody wires up later is reachable on a
 * locked board unless they remember the guard. That test reads `kbd.js` and
 * fails if they did not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  LOCK_STATES, LOCK_LABELS, GUARDED_ACTIONS, GUARDED_CALLS,
  isLocked, allows, refusalNote, lockedMenuNote, lockDescription,
} from './viewer-lock.mjs';
import { VIEW_CONTROLS, controlFor, isSwitch } from './view-controls.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('two states, off by default in the sense that off comes first', () => {
  assert.deepEqual(LOCK_STATES, ['off', 'on']);
  assert.ok(isLocked('on'));
  assert.ok(!isLocked('off'));
  // Anything unrecognised is unlocked. A board that read a corrupt storage
  // value as "locked" would hide its own way out.
  assert.ok(!isLocked(undefined));
  assert.ok(!isLocked('yes'));
});

test('an unlocked device allows everything', () => {
  Object.keys(GUARDED_ACTIONS).forEach((action) => {
    assert.ok(allows('off', action), `${action} should be allowed when unlocked`);
  });
});

test('⛔ a locked device refuses every editor and the config view', () => {
  ['config', 'group-edit', 'slot-edit', 'background-library', 'pco'].forEach((action) => {
    assert.ok(!allows('on', action), `${action} must be refused when locked`);
  });
});

test('⭐ and still applies its own view preferences', () => {
  // The whole point: the volunteer with the phone can still change the layout,
  // the card shape and the text size, because none of that leaves the browser.
  VIEW_CONTROLS.forEach((control) => {
    assert.ok(allows('on', control.id), `${control.id} is per device and must survive the lock`);
  });
  assert.ok(allows('on', 'fullscreen'));
  assert.ok(allows('on', 'group-jump'));
});

test('demo mode is refused too, though it is local', () => {
  // ⚠️ Local but not harmless: it replaces every reading with invented data,
  // and a wall showing invented battery levels mid-service is worse than a
  // wall showing nothing.
  assert.ok(!allows('on', 'demo'));
});

test('a refusal says what was refused and how to undo it', () => {
  const note = refusalNote('config');
  assert.match(note, /locked/i);
  assert.match(note, /configuration editor/);
  assert.match(note, /view settings/i);
  assert.equal(refusalNote('fullscreen'), null, 'nothing to say about an action that is allowed');
});

test('the menu says why its items are missing', () => {
  assert.match(lockedMenuNote(), /display only/i);
  assert.match(lockedMenuNote(), /unlock/i);
});

test('⚠️ the switch describes an accident guard, never a security control', () => {
  const off = lockDescription('off');
  const on = lockDescription('on');
  assert.notEqual(off, on);
  assert.match(on, /view settings still work/i);
  [off, on].forEach((text) => {
    assert.ok(
      !/secur|password|protect|authoris|authoriz/i.test(text),
      `the lock must not claim to be a security control: "${text}"`,
    );
  });
});

test('it is a switch in the panel, with a key, in a group that exists', () => {
  const control = controlFor('viewerLock');
  assert.ok(control, 'the lock has to be reachable without a keyboard -- that is who it is for');
  assert.ok(isSwitch(control));
  assert.equal(control.switchOn, 'on');
  assert.deepEqual(control.options, LOCK_STATES);
  assert.ok(LOCK_LABELS.on && LOCK_LABELS.off);
});

test('⛔ it has no hash parameter, so a link cannot switch it off', () => {
  const app = read('js/app.js');
  assert.ok(
    !/getUrlParameter\('lock'\)|url\.lock/.test(app),
    'a lock a URL can turn off is not even an accident guard',
  );
  assert.ok(app.includes('VIEWER_LOCK_KEY'), 'but it is still remembered per device');
});

test('⛔ the unlock is a 44px touch target, because that is who it is for', () => {
  // The panel exists because the view settings were keyboard-only and a wall
  // tablet has no keyboard (#111). Every control in it was 22px tall, and on a
  // locked device a near miss on the switch is a near miss on the way out.
  const css = read('css/style.scss');
  const switchHeight = /\.vp-switch \{[^}]*height: (\d+)px/.exec(css);
  const segHeight = /\.vp-seg \{[^}]*min-height: (\d+)px/.exec(css);
  assert.ok(switchHeight, 'expected .vp-switch to set a height');
  assert.ok(segHeight, 'expected .vp-seg to set a min-height');
  assert.ok(
    Number(switchHeight[1]) >= 44,
    `the switch is ${switchHeight[1]}px; a touch target is 44`,
  );
  assert.ok(
    Number(segHeight[1]) >= 44,
    `the segmented options are ${segHeight[1]}px; a touch target is 44`,
  );
});

test('⛔ a locked panel opens on the way out of being locked', () => {
  // Nobody is ever stuck -- the panel scrolls -- but the lock is its last row
  // and on a phone that row starts below the fold. The control that hides all
  // the others has to be the one in view when it is on.
  const panel = read('js/view-panel.js');
  assert.match(panel, /viewerLock/, 'the panel has to know the board is locked');
  assert.match(panel, /scrollIntoView/, 'and scroll that row into view');
});

test('⛔⛔ no binding reaches an editor without passing the guard', () => {
  // This is the drift guard. `allows()` refuses a named list, so an editor
  // wired up later is reachable on a locked board unless the author remembers.
  // Parsed from source rather than imported: kbd.js boots bootstrap and the
  // app modules, which a unit test has no business doing.
  const kbd = read('js/kbd.js');
  const bindings = kbd.split(/\n {4}\{\n/).slice(1);
  assert.ok(bindings.length > 10, 'expected to have found the binding table');

  bindings.forEach((binding) => {
    const reaches = GUARDED_CALLS.filter((fn) => binding.includes(`${fn}(`));
    if (!reaches.length && !/url\.demo/.test(binding)) {
      return;
    }
    const keys = (binding.match(/keys: \[([^\]]*)\]/) || ['', '?'])[1];
    assert.ok(
      /locked\(\)|allows\(/.test(binding),
      `the binding on ${keys} reaches ${reaches.join(', ') || 'demo mode'} `
      + 'without checking the lock -- a locked wall tablet can still open it',
    );
  });
});

test('and nor does a menu item', () => {
  // The pointer route. Every click handler that opens one of these has to ask
  // too, or the lock only holds against a keyboard nobody has.
  const app = read('js/app.js');
  const handlers = app.split('addEventListener(\'click\'');
  const reaching = handlers.filter((chunk, i) => i > 0
    && GUARDED_CALLS.some((fn) => chunk.slice(0, 400).includes(`${fn}(`)));
  assert.ok(reaching.length >= 3, 'expected the menu handlers for config, groups and slot names');
  reaching.forEach((chunk) => {
    assert.ok(
      /locked\(\)|allows\(|refuseWhenLocked/.test(chunk.slice(0, 400)),
      `a click handler opens an editor without checking the lock: ${chunk.slice(0, 120)}`,
    );
  });
});
