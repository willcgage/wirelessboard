/**
 * The board clears the status bar (#300).
 *
 * ⛔⛔ The old guard asserted the clearance rules' TEXT, and the text was right
 * the whole time: `body.statusbar-top #container { padding-top: ... }` was in
 * the stylesheet, correct, and inert, because `.fullHeight` -- a class the same
 * element carries -- said `padding: 0 !important`, and `!important` beats any
 * specificity. A test reading one rule cannot see another rule beating it.
 *
 * So this one asks the question the cascade asks: of every rule that can land
 * on `#container`, does any force its vertical padding?
 *
 * ⚠️ Comments are stripped first: the stylesheet explains the very rule this
 * forbids, and would otherwise match its own explanation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

const css = fs
  .readFileSync(path.join(ROOT, 'css', 'style.scss'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const markup = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');

// The container's own classes, read from the markup rather than typed here, so
// a class added to it later is checked too.
const containerTag = markup.match(/<div[^>]*id="container"[^>]*>/);
const containerClasses = containerTag
  ? (containerTag[0].match(/class="([^"]*)"/) || ['', ''])[1].split(/\s+/).filter(Boolean)
  : [];

// Every flat `selector { declarations }` pair. Nesting is flattened crudely --
// the innermost selector is kept -- which is enough: a rule that reaches the
// container has to name it in its own last compound.
const rules = [];
for (const match of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
  rules.push({ selector: match[1].trim(), body: match[2] });
}

const hitsContainer = (selector) => selector.split(',').some((part) => {
  const last = part.trim().split(/\s+|>/).filter(Boolean).pop() || '';
  if (last.includes('#container')) return true;
  return containerClasses.some((cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(last));
});

test('the container is found, with the class that broke it', () => {
  assert.ok(containerTag, 'demo.html has no #container');
  assert.ok(containerClasses.includes('fullHeight'), 'the container lost .fullHeight -- recheck this guard');
});

test('⛔⛔ nothing forces the container\'s vertical padding', () => {
  const offenders = rules
    .filter((rule) => hitsContainer(rule.selector))
    .filter((rule) => /(^|[;\s])padding(-top|-bottom)?\s*:[^;]*!important/.test(rule.body))
    .map((rule) => rule.selector);
  assert.deepEqual(
    offenders,
    [],
    'these rules beat the status bar clearance with !important',
  );
});

test('both clearance rules exist and read the bar\'s height', () => {
  for (const edge of ['top', 'bottom']) {
    const rule = rules.find((r) => r.selector === `body.statusbar-${edge} #container`);
    assert.ok(rule, `no rule clears a status bar at the ${edge}`);
    assert.match(rule.body, new RegExp(`padding-${edge}:\\s*var\\(--statusbar-height\\)`));
  }
});

test('⛔ the board does not book the bar a second time when both bars are on top', () => {
  // The container clears the status bar now. The pair rule reserving it again
  // was the workaround for that never applying; left in, it clips the last row.
  const pair = rules.find((r) => r.selector === 'body.statusbar-top.live-strip-top .wirelessboard-board');
  assert.ok(pair, 'the pair rule is still spelled this way');
  assert.doesNotMatch(pair.body, /--statusbar-height/);
});

test('the container keeps the clearance inside its height', () => {
  const rule = rules.find((r) => r.selector === '.fullHeight');
  assert.ok(rule);
  assert.match(rule.body, /box-sizing:\s*border-box/);
});
