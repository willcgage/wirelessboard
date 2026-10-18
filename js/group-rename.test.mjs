import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ⛔⛔ A renamed group came back with its old name.
 *
 * Reported from the wall as "Groups won't allow for saving names". The name was
 * accepted and written to disk -- the endpoint was verified against a real
 * board -- and then the next render put the old one back.
 *
 * `renderGroupSummary` reads `micboard.groups`, which `groupTableBuilder`
 * builds **once** inside `initialMap` and nothing ever rebuilds. The rename
 * updated the row object it had in hand and the server, and left that table
 * holding the previous title. Reopening the Groups section re-renders from it.
 */

const ROOT = path.join(import.meta.dirname, '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function renameHandler() {
  const at = CONFIG.indexOf("title.addEventListener('change'");
  assert.notEqual(at, -1, 'the rename handler is still here');
  return CONFIG.slice(at, CONFIG.indexOf('head.appendChild(title)', at));
}

test('⛔⛔ a rename updates the table the renderer actually reads', () => {
  const body = renameHandler();
  assert.match(body, /micboard\.groups/, 'the rename must touch micboard.groups');
  assert.match(body, /entry\.title = next/, 'and set the new title on it');
});

test('⚠️ the local update happens only once the server has accepted it', () => {
  // Writing it optimistically would show a name that is not stored anywhere
  // after a failed post -- worse than the bug, because it looks saved.
  const body = renameHandler();
  const cb = body.indexOf('postJSON(');
  const write = body.indexOf('entry.title = next');
  assert.ok(cb > -1 && write > cb, 'the write is inside the post callback');
  assert.match(
    body,
    /postJSON\('api\/group',[^)]*\{[^}]*title: next[^}]*\},\s*\(\)\s*=>/,
    'postJSON is given a callback rather than fired and forgotten',
  );
});

test('⛔ the renderer still reads the table this fixes, not the config', () => {
  // If this ever changes to `micboard.config.groups`, the fix above is
  // pointless and should go rather than linger as cargo.
  const at = CONFIG.indexOf('function renderGroupSummary()');
  const body = CONFIG.slice(at, CONFIG.indexOf('rows.forEach', at));
  assert.match(body, /const groups = micboard\.groups/, 'renderGroupSummary reads micboard.groups');
});

test('⚠️ and that table really is built only once', () => {
  // The whole reason the rename has to maintain it by hand.
  const builds = APP.match(/micboard\.groups = groupTableBuilder/g) || [];
  assert.equal(builds.length, 1, 'exactly one place builds it');
  const at = APP.indexOf('micboard.groups = groupTableBuilder');
  const before = APP.slice(0, at);
  assert.ok(before.includes('function initialMap'), 'and it is inside initialMap');
});
