import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';

/**
 * ⛔⛔ A class nobody styled renders as the OLD look, beside panes that were
 * restyled for 2.0 — and nothing failed.
 *
 * Reported after beta.20 was installed on the venue board:
 *
 *   "you carried over the old look instead of merging it with what we have now"
 *
 * Exactly that. #298 shipped four classes with **no rules anywhere**:
 * `pco-example__title`, `pco-example__body`, `pco-watch` and `pco-watch__line`.
 * The first was invented — the vocabulary this page already had is
 * `__headline` / `__context` / `__subhead` — and the last two were a new
 * component nobody wrote styles for. The markup was correct, the tests passed,
 * and the pane rendered as unstyled browser defaults.
 *
 * ⚠️ Structural wrappers are allowed to carry no rules, because their children
 * do the drawing. They are listed by name so that allowing one is a decision
 * rather than a hole.
 */

const root = path.join(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'demo.html'), 'utf8');
const scss = fs.readFileSync(path.join(root, 'css', 'style.scss'), 'utf8');
const config = fs.readFileSync(path.join(root, 'js', 'config.js'), 'utf8');

/** Wrappers that deliberately have no rules: their children carry the look. */
const UNSTYLED_WRAPPERS = new Set([
  // The host the worked example draws into; every child is styled (#179).
  'pco-example__body',
  // A layout row built from utilities, with this class only as a JS hook.
  'pco-note-row',
  // A query hook on the assign table's selects. It is always paired with
  // `form-select`, which does the drawing; this class only exists so
  // `querySelector('select.pco-person-select')` can find them.
  'pco-person-select',
]);

/** Our own classes, which the project's stylesheet is responsible for. */
const ours = (name) => name.startsWith('pco-') || name.startsWith('admin-');

function classesIn(markup) {
  const found = new Set();
  const re = /class="([^"]+)"/g;
  let m = re.exec(markup);
  while (m) {
    m[1].split(/\s+/).filter(Boolean).filter(ours).forEach((c) => found.add(c));
    m = re.exec(markup);
  }
  return found;
}

/** Classes assigned from JavaScript, which the markup scan cannot see. */
function classesAssignedInJs(source) {
  const found = new Set();
  const re = /className = '([^']+)'/g;
  let m = re.exec(source);
  while (m) {
    m[1].split(/\s+/).filter(Boolean).filter(ours).forEach((c) => found.add(c));
    m = re.exec(source);
  }
  return found;
}

const hasRule = (cls) => scss.includes(`.${cls}`);

test('⛔⛔ every admin class in the markup is styled, or named as a bare wrapper', () => {
  const unstyled = [...classesIn(html)]
    .filter((c) => !hasRule(c) && !UNSTYLED_WRAPPERS.has(c))
    .sort();

  assert.deepEqual(
    unstyled,
    [],
    'these render as unstyled browser defaults beside restyled panes — '
    + 'add rules, or reuse a class that has them',
  );
});

test('⛔⛔ and every admin class assigned from JavaScript is styled too', () => {
  // ⚠️ The rule-set preview cards are built in `config.js`, not in the markup,
  // so the scan above cannot see them. `pco-example__title` was invented here
  // and reached the venue board.
  const unstyled = [...classesAssignedInJs(config)]
    .filter((c) => !hasRule(c) && !UNSTYLED_WRAPPERS.has(c))
    .sort();

  assert.deepEqual(unstyled, [], 'a class built in JS still has to exist in the stylesheet');
});

test('⚠️ the allowlist does not hide a class that is now styled', () => {
  // ⛔ An allowlist that outlives its reason is how the next one gets waved
  // through. If somebody writes rules for one of these, take it off the list.
  for (const wrapper of UNSTYLED_WRAPPERS) {
    assert.ok(
      !hasRule(wrapper),
      `${wrapper} has rules now — remove it from UNSTYLED_WRAPPERS`,
    );
  }
});

test('⭐ the previews reuse the vocabulary the page already had', () => {
  // ⛔ The specific invention: a `__title`/`__body` pair beside an existing
  // `__headline`/`__context`/`__subhead` set that already did the job.
  assert.ok(!config.includes("'pco-example__title'"), 'pco-example__title is not a real class');
  assert.ok(config.includes("'pco-example__headline'"), 'the card titles use __headline');
});

test('⚠️ the new button rows use the 2.0 row, not Bootstrap utilities', () => {
  // The three rows #298 added. `admin-actions` is what every other pane on
  // this page uses; `d-flex flex-wrap gap-2` is the old look's spacing.
  for (const id of ['pco-matching-preview', 'pco-watch-refresh', 'pco-rulesets-check']) {
    const at = html.indexOf(`id="${id}"`);
    assert.notEqual(at, -1, `${id} is still in the markup`);
    const before = html.slice(Math.max(0, at - 320), at);
    const row = before.lastIndexOf('<div class="');
    assert.ok(row !== -1, `${id} sits in a row`);
    const rowClass = before.slice(row + '<div class="'.length, before.indexOf('"', row + 12));
    assert.ok(
      rowClass.includes('admin-actions'),
      `${id} is in a "${rowClass}" row — the 2.0 page uses admin-actions`,
    );
  }
});
