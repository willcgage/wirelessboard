/**
 * The controls that moved off the keyboard (#160).
 *
 * ⛔ The bit maths is the part worth testing. `infoDrawerMode` is a two-bit
 * code behind a four-state cycle, and getting a bit the wrong way round swaps
 * two things that look similar on a card.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRAWER_MODES, BACKGROUND_MODES, BOARD_CONTROLS,
  isDrawerMode, drawerBits, drawerModeFrom, drawerModeWith, groupChoices,
} from './panel-controls.mjs';
import { isSwitch, optionLabel } from './view-controls.mjs';

test('⛔ the bits are the right way round', () => {
  // From the stylesheet, which is the only place this was ever written down:
  // .elinfo01 shows the stripe and hides the drawer; .elinfo10 the reverse.
  assert.deepEqual(drawerBits('elinfo00'), { drawer: 'off', stripe: 'off' });
  assert.deepEqual(drawerBits('elinfo01'), { drawer: 'off', stripe: 'on' });
  assert.deepEqual(drawerBits('elinfo10'), { drawer: 'on', stripe: 'off' });
  assert.deepEqual(drawerBits('elinfo11'), { drawer: 'on', stripe: 'on' });
});

test('and they survive a round trip through every state', () => {
  DRAWER_MODES.forEach((mode) => {
    assert.equal(drawerModeFrom(drawerBits(mode)), mode);
  });
});

test('moving one switch leaves the other alone', () => {
  assert.equal(drawerModeWith('elinfo11', 'stripe', 'off'), 'elinfo10');
  assert.equal(drawerModeWith('elinfo11', 'drawer', 'off'), 'elinfo01');
  assert.equal(drawerModeWith('elinfo00', 'drawer', 'on'), 'elinfo10');
  assert.equal(
    drawerModeWith('elinfo01', 'stripe', 'on'),
    'elinfo01',
    'setting what is already set changes nothing',
  );
});

test('an unrecognised mode reads as the default rather than as nothing', () => {
  // ⚠️ A board whose stored mode is junk should show everything, not hide
  // everything -- hiding is the state that looks like a fault.
  assert.deepEqual(drawerBits('elinfo22'), { drawer: 'on', stripe: 'on' });
  assert.deepEqual(drawerBits(undefined), { drawer: 'on', stripe: 'on' });
  assert.ok(!isDrawerMode('elinfo22'));
});

test('⭐ backgrounds are one control, not the two keys they used to be', () => {
  const background = BOARD_CONTROLS.find((c) => c.id === 'background');
  assert.deepEqual(background.options, BACKGROUND_MODES);
  assert.equal(optionLabel(background, 'NONE'), 'Off');
  assert.equal(optionLabel(background, 'IMG'), 'Photos');
  assert.equal(optionLabel(background, 'MP4'), 'Video');
  assert.ok(!isSwitch(background), 'three states is not a switch');
});

test('the two-state controls are switches, and every value has a label', () => {
  BOARD_CONTROLS.filter((c) => c.options.length === 2).forEach((control) => {
    assert.ok(isSwitch(control), `${control.id} should be a switch`);
    control.options.forEach((value) => {
      assert.ok(optionLabel(control, value), `${control.id} has no label for ${value}`);
    });
  });
});

test('⛔ every board control names a group the panel already shows', () => {
  // Otherwise the row renders into a section nobody scrolls to.
  BOARD_CONTROLS.forEach((control) => {
    assert.ok(
      ['Layout', 'Card', 'On screen'].includes(control.group),
      `${control.id}: ${control.group}`,
    );
  });
});

test('the group picker offers all channels first, then the groups in order', () => {
  const choices = groupChoices({
    3: { title: 'Band' }, 1: { title: 'Vocals' }, 2: { title: '' },
  });
  assert.deepEqual(choices, [
    { value: 0, label: 'All channels' },
    { value: 1, label: 'Vocals' },
    { value: 2, label: 'Group 2' },
    { value: 3, label: 'Band' },
  ]);
});

test('⛔ a board with no groups still offers the combined view', () => {
  // It is what `0` did, and `0` is going away.
  assert.deepEqual(groupChoices({}), [{ value: 0, label: 'All channels' }]);
  assert.deepEqual(groupChoices(null), [{ value: 0, label: 'All channels' }]);
});
