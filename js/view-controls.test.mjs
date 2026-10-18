/**
 * The controls the panel generates itself from.
 *
 * ⛔ This file used to guard the panel against `kbd.js` in both directions,
 * because a hand-written list of shortcuts had already fallen behind once (T
 * and D were bound and undocumented). #160 retired the bindings, so the guard
 * flipped: what has to hold now is that **nothing is bound to a key** except
 * Escape — every one of these is reachable only from the panel.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  VIEW_CONTROLS, controlGroups, controlFor, optionsInOrder, optionLabel,
  isSwitch, isValidValue, notInForce,
} from './view-controls.mjs';
import {
  ARRANGEMENTS, CARD_SHAPES, TYPE_SIZES,
  COLUMN_CHOICES, WASH_STYLES,
} from './board-layout.mjs';
import { PLACEMENTS } from './live-strip.mjs';
import { ROTATION_STATES } from './rotation-states.mjs';
import { LOCK_STATES } from './viewer-lock.mjs';
import { STATUS_BAR_PLACEMENTS } from './view-prefs.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const kbd = fs.readFileSync(path.join(ROOT, 'js', 'kbd.js'), 'utf8').replace(/\r\n/g, '\n');

test('every control names a vocabulary the board actually has', () => {
  const vocabularies = {
    arrangement: ARRANGEMENTS,
    cardShape: CARD_SHAPES,
    typeSize: TYPE_SIZES,
    columns: COLUMN_CHOICES,
    wash: WASH_STYLES,
    // ⚠️ The only vocabulary not from board-layout: where the service strip
    // sits is a property of the strip, not of the grid (#121).
    livePlacement: PLACEMENTS,
    rotation: ROTATION_STATES,
    viewerLock: LOCK_STATES,
    // ⭐ Where the status bar sits (#188) — a property of the screen, not the grid.
    statusBar: STATUS_BAR_PLACEMENTS,
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

test('⛔⛔ nothing is bound to a key except Escape (#160)', () => {
  // Parsed from the source rather than imported: kbd.js pulls in the app
  // modules, which a unit test has no business booting.
  //
  // ⚠️ This is the guard that holds the direction. Adding one convenient
  // shortcut is how a board ends up with twenty again, and every one of them
  // is something a wall tablet cannot do.
  const compared = [...kbd.matchAll(/e\.key\s*[!=]==\s*'([^']+)'/g)].map(([, key]) => key);
  assert.deepEqual(
    [...new Set(compared)],
    ['Escape'],
    'kbd.js compares the pressed key against something other than Escape',
  );
  assert.ok(
    !kbd.includes('keys: ['),
    'the binding table is back; that is a keyboard-only board again',
  );
});

test('⛔ no control carries a key any more', () => {
  VIEW_CONTROLS.forEach((control) => {
    assert.ok(!control.key, `${control.id} still names a key`);
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
  // ⚠️ Was `topBar`, which #188 retired with the bar it hid. `viewerLock` is
  // the remaining two-state control that declares `switchOn`.
  assert.ok(isSwitch(controlFor('viewerLock')));
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

/**
 * ⭐ #276: Fit means auto rows and auto columns.
 *
 * The sweep found that `fit` drew 4x3 at every column setting — auto, 4, 6, 8
 * and 12 alike. That is settled behaviour and not a bug: Fit picks the grid
 * that fills the screen, which is what the arrangement is *for*. What was
 * wrong is that the column control sat there looking live and said nothing,
 * which is indistinguishable from the count being ignored by mistake — and is
 * exactly how it was first reported from the wall.
 *
 * ⛔ The control keeps the operator's value. Rewriting their stored ceiling to
 * "auto" would be the "never flip a persisted flag as a side effect" mistake,
 * and would leave a board later switched back to Grid with a ceiling it never
 * chose.
 */

test('⭐ #276: the column ceiling stands down while Fit is chosen', () => {
  const note = notInForce('columns', { arrangement: 'fit' });
  assert.ok(note, 'Fit must say the ceiling is not in force');
  assert.match(note, /not in force/i);
  // ⚠️ And it must say the stored value survives, or the reasonable reading is
  // that switching arrangement has thrown the setting away.
  assert.match(note, /kept/i);
});

test('⚠️ and it is in force for every other arrangement', () => {
  for (const arrangement of ARRANGEMENTS.filter((a) => a !== 'fit')) {
    assert.equal(
      notInForce('columns', { arrangement }),
      null,
      `${arrangement} honours the column ceiling, so nothing may claim otherwise`,
    );
  }
});

test('⛔ no other control is stood down by Fit', () => {
  // Fit still obeys the card shape — the sweep measured 420x560 under
  // `fit` + `tall`. Only the column count is the arrangement's own business.
  for (const control of VIEW_CONTROLS) {
    if (control.id === 'columns') continue;
    assert.equal(
      notInForce(control.id, { arrangement: 'fit' }),
      null,
      `\`${control.id}\` still applies under Fit`,
    );
  }
});
