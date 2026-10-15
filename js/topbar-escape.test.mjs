/**
 * The board has one control it may never lose (#110, #188).
 *
 * It began as the way back from a bar `H` had hidden: the bar was the only
 * pointer route to anything, and on a keyboard-less board hiding it left
 * nothing to press -- a preference stored per device, so it survived a reload,
 * and the only remedies were editing the hash or clearing local storage.
 *
 * ⛔⛔ #188 made this guard matter more, not less. There is no bar any more.
 * This gear is the *only* route to the view panel, to Help, to the scannable
 * URL and to the administration page -- which is to say, to everything the
 * board can be asked. A rule that hides it strands the board completely.
 *
 * ⛔ The original failure was pure CSS, so the guard has to be too: a test that
 * only checked the markup would have passed on the broken board. These
 * assertions are about which rules exist, which is the thing that went wrong.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

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
  // ⭐ It used to restore the bar directly. Since #111 it opens the view panel,
  // which carries the switch for the bar along with every other view
  // preference -- a strictly larger way out of the same dead end.
  assert.match(appjs, /toggleViewPanel\(\)/, 'the handler must open the view panel');
});

test('⛔ nothing hides the way back, under any class', () => {
  // The original bug was one rule: `body.topbar-hidden .topbar-restore`. With
  // the bar retired that class is gone, so the guard widens to the real rule --
  // no selector anywhere may hide this control.
  const rules = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)];
  rules.forEach(([, selector, body]) => {
    if (!/\.topbar-restore/.test(selector)) {
      return;
    }
    assert.ok(
      !/display\s*:\s*none|visibility\s*:\s*hidden/.test(body),
      `a rule hides the only control on the board: ${selector.trim()}`,
    );
  });
});

test('⛔ and the bar it used to restore is really gone', () => {
  // #188. Leaving the markup behind while the route moved would mean two menus,
  // one of them unreachable and both of them maintained.
  assert.ok(!/<nav\b/.test(markup), 'the menu bar is still in the markup');
  assert.ok(
    !/id="nav-menu-button"/.test(markup),
    'the Menu dropdown is still in the markup',
  );
});

test('the control is always on screen', () => {
  // ⛔ Inverted by #111, deliberately. While it only restored the bar it had no
  // business existing when the bar was visible; now it opens the view panel,
  // which is worth reaching whatever the bar is doing -- and a control that is
  // always there cannot be reasoned into disappearing on the one display that
  // needs it.
  assert.match(
    css,
    /\.topbar-restore\s*\{[^}]*position:\s*fixed/i,
    'the control should be pinned to the screen',
  );
  assert.ok(
    !/\.topbar-restore\s*\{[^}]*display:\s*none/i.test(css),
    'the control must not start hidden',
  );
});

test('it is reachable by keyboard as well as by touch', () => {
  assert.match(
    css,
    /\.topbar-restore:focus-visible\s*\{[^}]*outline/i,
    'the escape control needs a visible focus state',
  );
});

test('⭐ and it reaches everything the bar used to hold', () => {
  // ⛔ `TOP_BAR_STATES`/`TOP_BAR_SHOWN` were asserted here, for a preference
  // that restored a bar. #188 retired both. What matters now is that the panel
  // this control opens is where the routes went.
  //
  // ⚠️ `go-hud` and `go-qr` were asserted here too. #225 moved Help and the
  // scannable URL onto the administration page, so the panel carries one route
  // out — the door — and the page carries the rest. The chain this guards is
  // therefore gear → panel → door, and `admin-page.test.mjs` owns what is
  // behind the door.
  assert.match(markup, /id="admin-door"/, 'the door to the administration page');

  // Inside the panel, which is what the gear opens.
  const panelAt = markup.indexOf('<div id="view-panel"');
  assert.ok(panelAt > 0);
  assert.ok(markup.indexOf('id="admin-door"') > panelAt, 'the door must be inside the view panel');

  // ⛔ And the overlay it opens exists, or the chain ends at a button.
  assert.match(markup, /id="admin-page"/, 'the administration overlay must be in the markup');
  assert.match(markup, /id="qr-modal"/, 'and the dialog Help opens for the scannable URL');
});
