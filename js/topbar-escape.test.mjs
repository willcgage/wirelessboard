/**
 * The board may hide its chrome, but never every way back (#110).
 *
 * `H` hides the navbar, and the navbar is the only pointer route to anything.
 * On a board with no keyboard that left nothing on screen to press, and because
 * the preference is stored per device it survived a reload -- the only remedies
 * were editing the URL hash or clearing local storage.
 *
 * ⛔ The failure was pure CSS, so the guard has to be too: a test that only
 * checked the markup would have passed on the broken board. These assertions
 * are about which rules exist, which is the thing that went wrong.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { TOP_BAR_STATES, TOP_BAR_SHOWN } from './board-layout.mjs';

const ROOT = path.join(import.meta.dirname, '..');

const markup = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
const appjs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

// ⚠️ Comments first. A negative assertion over a stylesheet that documents the
// very rule it must not contain will match its own explanation -- this suite
// has been caught by that before.
const css = fs
  .readFileSync(path.join(ROOT, 'css', 'style.scss'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the restore control is in the markup, as a labelled button', () => {
  assert.match(markup, /id="topbar-restore"/, 'no escape control on the board');

  const tag = markup.match(/<button[^>]*id="topbar-restore"[^>]*>/);
  assert.ok(tag, 'the escape control must be a <button>, not a div someone has to guess at');
  assert.match(tag[0], /type="button"/, 'a button inside a form area needs an explicit type');
  assert.match(tag[0], /aria-label="[^"]+"/, 'the control is an icon, so it needs a label');
});

test('something listens to it', () => {
  // The dead-ids suite proves an id exists somewhere; this proves this one is
  // wired. An escape hatch that does nothing is the same dead end with a button.
  assert.match(appjs, /topbar-restore/, 'nothing in app.js binds the escape control');
  assert.match(appjs, /showTopBar\(\)/, 'the handler must restore the bar');
});

test('hiding the bar does not hide the way back', () => {
  const hidesIt = /[^}]*topbar-hidden[^{]*\.topbar-restore[^{]*\{[^}]*display:\s*none/i;
  assert.ok(
    !hidesIt.test(css),
    'a rule hides the escape control while the bar is hidden -- that is the bug',
  );
});

test('the control appears exactly when the bar is hidden', () => {
  assert.match(
    css,
    /\.topbar-restore\s*\{[^}]*display:\s*none/i,
    'the control should stay out of the way while the bar is visible',
  );
  assert.match(
    css,
    /body\.topbar-hidden\s+\.topbar-restore\s*\{[^}]*display:\s*(?!none)[a-z-]+/i,
    'nothing makes the control visible when the bar is hidden',
  );
});

test('it is reachable by keyboard as well as by touch', () => {
  assert.match(
    css,
    /\.topbar-restore:focus-visible\s*\{[^}]*outline/i,
    'the escape control needs a visible focus state',
  );
});

test('the state that restores the bar is named, not spelled out', () => {
  // A literal 'shown' in display.js would survive a rename of the states and
  // quietly stop restoring anything.
  assert.ok(TOP_BAR_STATES.includes(TOP_BAR_SHOWN));
  assert.strictEqual(TOP_BAR_SHOWN, TOP_BAR_STATES[0], 'shown is the default state');
  assert.notStrictEqual(TOP_BAR_SHOWN, 'hidden');
});
