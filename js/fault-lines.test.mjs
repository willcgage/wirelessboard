/**
 * The three fault lines are spaced by their own line height (#286).
 *
 * ⛔ They were three absolutely positioned lines at hand-kept `bottom:` offsets
 * 20px apart, each with a 24px line box, so every pair overlapped by 4px --
 * the same family as #273 and #282. In flow inside `.errorzone`, the spacing
 * cannot drift from the type, because it IS the type.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs
  .readFileSync(path.join(import.meta.dirname, '..', 'css', 'style.scss'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const rules = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), body: m[2] }));

const LINES = ['errortype', 'ip', 'rxinfo'];
const namesALine = (selector) => LINES.some((cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(selector));

test('⛔ no fault line is placed on its own', () => {
  const placed = rules
    .filter((r) => namesALine(r.selector))
    .filter((r) => /(^|[;\s])(bottom|top)\s*:/.test(r.body) || /position:\s*absolute/.test(r.body))
    .map((r) => r.selector);
  assert.deepEqual(placed, [], 'a line with its own offset can overlap its neighbour again');
});

test('the zone stacks them, in both modes that draw it', () => {
  const zones = rules.filter((r) => r.selector === '.errorzone' && /flex-direction:\s*column/.test(r.body));
  assert.equal(zones.length, 2, 'TV mode and desk mode each lay the zone out');
  for (const zone of zones) {
    assert.match(zone.body, /position:\s*absolute/);
  }
});

test('the lines lose the paragraph margin that would space them unevenly', () => {
  const inFlow = rules.filter((r) => r.selector.includes('.errorzone .errortype'));
  assert.equal(inFlow.length, 2);
  for (const rule of inFlow) {
    assert.match(rule.body, /margin:\s*0/);
    assert.match(rule.body, /position:\s*static/);
  }
});
