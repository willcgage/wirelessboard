/**
 * The panel and the keyboard describe the same controls, or they drift.
 *
 * ⛔ The drift guard is the point of this file. `kbd.js` has one table because
 * a second, hand-written list of the shortcuts had already fallen behind by the
 * time anyone noticed (T and D were bound and undocumented). A panel with its
 * own hand-written list would be that same mistake a third time, so the two are
 * checked against each other here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  VIEW_CONTROLS, controlGroups, controlFor, optionsInOrder, optionLabel,
  isSwitch, isValidValue,
} from './view-controls.mjs';
import {
  ARRANGEMENTS, CARD_SHAPES, TEXT_POSITIONS, TYPE_SIZES, TOP_BAR_STATES,
  COLUMN_CHOICES, WASH_STYLES,
} from './board-layout.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const kbd = fs.readFileSync(path.join(ROOT, 'js', 'kbd.js'), 'utf8').replace(/\r\n/g, '\n');

test('every control names a vocabulary the board actually has', () => {
  const vocabularies = {
    arrangement: ARRANGEMENTS,
    cardShape: CARD_SHAPES,
    textPosition: TEXT_POSITIONS,
    typeSize: TYPE_SIZES,
    topBar: TOP_BAR_STATES,
    columns: COLUMN_CHOICES,
    wash: WASH_STYLES,
  };

  VIEW_CONTROLS.forEach((control) => {
    assert.deepEqual(
      control.options,
      vocabularies[control.id],
      `${control.id} should offer exactly the stored vocabulary`,
    );
    assert.ok(control.storageKey, `${control.id} needs the key it is stored under`);
  });
});

test('⛔ every control is also a key, and every state key is also a control', () => {
  // Parsed from the source rather than imported: kbd.js pulls in bootstrap and
  // the app modules, which a unit test has no business booting.
  VIEW_CONTROLS.forEach((control) => {
    assert.ok(
      kbd.includes(`keys: ['${control.key}']`),
      `${control.id} claims ${control.key}, which kbd.js does not bind`,
    );
  });

  // The other direction: a cycling binding with no row in the panel is a
  // control someone can only reach with a keyboard, which is the whole
  // complaint this work exists to answer.
  const cycles = [...kbd.matchAll(/keys: \['(\w)'\],\n\s*hud:[^\n]*\n\s*run: \(\) => cycle(\w+)\(\)/g)];
  assert.ok(cycles.length >= VIEW_CONTROLS.length - 1, 'expected to find the cycling bindings');
  cycles.forEach(([, key, fn]) => {
    const control = VIEW_CONTROLS.find((c) => c.key === key);
    assert.ok(control, `kbd.js cycles ${fn} on ${key} with no control to show it`);
  });
});

test('every value a key can cycle to has a label somebody can read', () => {
  VIEW_CONTROLS.forEach((control) => {
    control.options.forEach((value) => {
      const label = optionLabel(control, value);
      assert.ok(
        label && label !== String(value) ? true : label.length > 0,
        `${control.id} has no label for ${value}`,
      );
    });
  });
});

test('⭐ the arrangements are named for what they do, not for the grid axis', () => {
  // #115: `row` fills the screen with columns, which is why the stored word
  // reads backwards out loud. The labels say the outcome; the values do not
  // change, because boards and links carry them.
  const arrangement = controlFor('arrangement');
  assert.equal(optionLabel(arrangement, 'row'), 'Side by side');
  assert.equal(optionLabel(arrangement, 'column'), 'Stacked');
  assert.deepEqual(arrangement.options, ['fit', 'row', 'column', 'grid']);
});

test('reading order may differ from cycling order, and loses nothing', () => {
  const typeSize = controlFor('typeSize');
  assert.deepEqual(optionsInOrder(typeSize), ['small', 'medium', 'large']);
  assert.deepEqual(typeSize.options, ['medium', 'small', 'large'], 'the cycle still starts at the default');

  // A value missing from the display order still has to be reachable.
  const patched = { options: ['a', 'b', 'c'], order: ['c', 'a'] };
  assert.deepEqual(optionsInOrder(patched), ['c', 'a', 'b']);
});

test('a two-state control with an on value is a switch', () => {
  assert.ok(isSwitch(controlFor('topBar')));
  assert.ok(!isSwitch(controlFor('wash')), 'two states alone do not make a switch');
  assert.ok(!isSwitch(controlFor('arrangement')));
});

test('the panel refuses a value the board would not store', () => {
  const wash = controlFor('wash');
  assert.ok(isValidValue(wash, 'band'));
  assert.ok(!isValidValue(wash, 'tint'));
  assert.ok(!isValidValue(null, 'band'));
});

test('controls are grouped, in a stable order', () => {
  const groups = controlGroups();
  assert.deepEqual(groups.map((g) => g.name), ['Layout', 'Card', 'On screen']);
  assert.ok(groups.every((g) => g.controls.length > 0));
  assert.equal(
    groups.reduce((n, g) => n + g.controls.length, 0),
    VIEW_CONTROLS.length,
    'every control belongs to exactly one group',
  );
});
