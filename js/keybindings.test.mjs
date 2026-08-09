import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hudRows, findBinding, bindingKeys, undocumentedKeys, keyCap,
} from './keybindings.mjs';

const table = [
  { keys: ['Escape'], hud: 'Return to the main board.', beforeGuards: true },
  { keys: ['1', '2', '3'], label: ['1-9'], hud: 'Jump to saved groups.' },
  { keys: ['t'], hud: 'Switch between desk and TV display modes.' },
  { keys: ['n'], hud: 'Toggle slot editing.' },
  { keys: ['N'], label: ['Shift+N'], hud: 'Toggle slot editing and show the paste box.' },
  { keys: ['x'] }, // bound, no description
];

test('every described binding becomes a row, in table order', () => {
  const rows = hudRows(table);
  assert.deepEqual(rows.map((r) => r.description[0]), ['R', 'J', 'S', 'T', 'T']);
  assert.equal(rows.length, 5);
});

test('label overrides the raw keys where they would read badly', () => {
  const rows = hudRows(table);
  // Ten group keys are one idea, not ten.
  assert.deepEqual(rows[1].keys, ['1-9']);
  // N is typed as Shift+N.
  assert.deepEqual(rows[4].keys, ['Shift+N']);
});

test('a binding with no description is left out rather than listed blank', () => {
  const rows = hudRows(table);
  assert.equal(rows.some((r) => r.keys.includes('x')), false);
});

test('bindingKeys falls back to the keys themselves, as printed on the cap', () => {
  assert.deepEqual(bindingKeys({ keys: ['t'] }), ['T']);
  assert.deepEqual(bindingKeys({ keys: ['N'], label: ['Shift+N'] }), ['Shift+N']);
  assert.deepEqual(bindingKeys({}), []);
  assert.deepEqual(bindingKeys(null), []);
});

test('keyCap uppercases single letters and leaves everything else alone', () => {
  assert.equal(keyCap('t'), 'T');
  assert.equal(keyCap('?'), '?');
  assert.equal(keyCap('0'), '0');
  // Would otherwise read "ESCAPE".
  assert.equal(keyCap('Escape'), 'Escape');
  assert.equal(keyCap(undefined), undefined);
});

test('findBinding is case sensitive', () => {
  // The board tells "edit slots" from "edit slots and open the paste box" by
  // case alone, so a case-insensitive lookup would merge two bindings.
  assert.equal(findBinding(table, 'n').hud, 'Toggle slot editing.');
  assert.equal(findBinding(table, 'N').hud, 'Toggle slot editing and show the paste box.');
});

test('findBinding matches any key in a multi-key binding', () => {
  assert.equal(findBinding(table, '2').hud, 'Jump to saved groups.');
});

test('findBinding returns null rather than throwing on a miss', () => {
  assert.equal(findBinding(table, 'z'), null);
  assert.equal(findBinding(table, undefined), null);
  assert.equal(findBinding(null, 't'), null);
});

test('undocumentedKeys names exactly the bindings the overlay would omit', () => {
  // The check that would have caught T and D being bound but unlisted.
  assert.deepEqual(undocumentedKeys(table), ['x']);
  assert.deepEqual(undocumentedKeys(table.filter((b) => b.hud)), []);
});

test('the helpers tolerate a malformed table instead of throwing', () => {
  assert.deepEqual(hudRows(null), []);
  assert.deepEqual(hudRows([null, {}, { hud: '' }]), []);
  assert.deepEqual(undocumentedKeys(null), []);
});
