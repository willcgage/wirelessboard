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
  isLocked, allows, refusalNote, lockedMenuNote, lockDescription, lockedJustNowNote,
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

test('⚠️ a key that locks the board says it did', () => {
  // `K` sits among keys people press on purpose. Locking is the surprising
  // direction of the toggle -- the menu empties and the editors vanish -- so
  // the one thing it must not do is happen silently.
  const note = lockedJustNowNote();
  assert.match(note, /locked/i);
  assert.match(note, /gear/i, 'and name the way back, which is not the keyboard');
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

test('⛔⛔ the keyboard cannot reach an editor at all', () => {
  // This guard used to walk the binding table checking each one asked the
  // lock first. #160 took the bindings away, so the stronger statement is
  // available: `kbd.js` does not reach the editors, full stop.
  //
  // ⚠️ If a binding table ever comes back, this fails the moment one of them
  // opens an editor -- which is the case that mattered.
  const kbd = read('js/kbd.js');
  GUARDED_CALLS.forEach((fn) => {
    assert.ok(
      !kbd.includes(`${fn}(`),
      `kbd.js reaches ${fn} -- a locked wall tablet can be opened with a keyboard`,
    );
  });
  assert.ok(!/url\.demo/.test(kbd), 'and nor does it reach demo mode');
});

/**
 * Every function body in a file, by brace matching.
 *
 * ⛔ Brace matching rather than splitting on a delimiter. The previous version
 * of the guard below split `app.js` on `addEventListener('click'` and read the
 * next 400 characters, which worked only while every route *was* a click
 * handler. #188 moved the routes into named functions so the menu and the
 * administration page could share one implementation, and the guard quietly
 * stopped finding any of them -- it would have passed while looking at the
 * wrong shape, which is exactly what [[guards-that-cannot-fail]] is about.
 */
function functionBodies(source) {
  const bodies = [];
  const re = /function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/g;
  let match = re.exec(source);
  while (match) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    bodies.push({ name: match[1], body: source.slice(match.index, i) });
    match = re.exec(source);
  }
  return bodies;
}

const LOCK_CHECK = /refuseWhenLocked|isLocked\(|allows\(/;

test('and nor does any pointer route', () => {
  // Whatever opens one of these -- a menu item, the administration page's route
  // registry (#188), anything added later -- has to ask the lock, or it only
  // holds against a keyboard nobody has.
  const app = read('js/app.js');
  const reaching = functionBodies(app).filter(({ body }) => {
    const inner = body.slice(body.indexOf('{'));
    return GUARDED_CALLS.some((fn) => inner.includes(`${fn}(`));
  });

  assert.ok(
    reaching.length >= 3,
    `expected the routes for config, groups and slot names; found ${reaching.length}`,
  );

  reaching.forEach(({ name, body }) => {
    assert.ok(LOCK_CHECK.test(body), `${name}() opens an editor without checking the lock`);
  });
});

test('⭐ and the demo switch, which no call list can see', () => {
  // ⚠️ `demo` is not one of `GUARDED_CALLS` -- it is a flag flip and a reload --
  // so the guard above cannot see it. It is the one guarded action that could
  // be re-added without a check and leave no trace in the call list.
  //
  // ⚠️ Matches the *flip* (`url.demo = micboard.url.demo === ...`), not every
  // assignment: `readURLParameters` sets the same field from the hash, and the
  // lock has never guarded the URL. So this covers a pointer route that toggles
  // demo mode, which is what the administration page adds, and not a new route
  // that sets it outright -- `admin-page.test.mjs` is what requires `demo` to be
  // in the lock's set at all.
  const app = read('js/app.js');
  const toggles = functionBodies(app)
    .filter(({ body }) => /url\.demo\s*=\s*micboard\.url\.demo/.test(body.slice(body.indexOf('{'))));
  assert.ok(toggles.length >= 1, 'expected a function that toggles demo mode');
  toggles.forEach(({ name, body }) => {
    assert.ok(LOCK_CHECK.test(body), `${name}() toggles demo mode without checking the lock`);
  });
});
