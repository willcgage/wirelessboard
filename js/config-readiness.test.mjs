import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boardHasLoaded,
  configuredCount,
  editorState,
  emptyingSaveWarning,
  waitingMessage,
} from './config-readiness.mjs';

const NOT_LOADED = {};
const EMPTY = { config: { slots: [] } };
const CONFIGURED = { config: { slots: [{ slot: 1 }, { slot: 2 }] } };

test('⛔ a board that has not loaded is not a board with no channels', () => {
  // The whole bug in one line. The editor read `config.slots`, found nothing
  // either way, and offered four blank rows — which saved as `slots: []` and
  // wiped a board with two channels on it.
  assert.equal(boardHasLoaded(NOT_LOADED), false);
  assert.equal(boardHasLoaded(EMPTY), true);
});

test('the container is what is checked, not its contents', () => {
  // `micboard.config` is undefined until data.json lands and an object
  // afterwards, even for a board with no channels at all.
  assert.equal(boardHasLoaded({ config: {} }), true);
  assert.equal(boardHasLoaded({ config: null }), false);
  assert.equal(boardHasLoaded(null), false);
  assert.equal(boardHasLoaded(undefined), false);
});

test('an unloaded board has an unknown channel count, not zero', () => {
  assert.equal(configuredCount(NOT_LOADED), null);
  assert.equal(configuredCount(EMPTY), 0);
  assert.equal(configuredCount(CONFIGURED), 2);
});

test('a config with a malformed slots list counts as none, not a crash', () => {
  assert.equal(configuredCount({ config: { slots: 'four' } }), 0);
  assert.equal(configuredCount({ config: {} }), 0);
});

test('⛔ the editor has three states, and "waiting" is the one that was missing', () => {
  assert.equal(editorState(NOT_LOADED), 'waiting');
  assert.equal(editorState(EMPTY), 'empty');
  assert.equal(editorState(CONFIGURED), 'configured');
});

test('⚠️ a save that empties a configured board asks first', () => {
  const warning = emptyingSaveWarning(2, 0);

  assert.match(warning, /all 2 channels/);
  // Says what is lost beyond the channels themselves: the groups are what
  // cannot be put back by typing the rows in again.
  assert.match(warning, /Groups will be left pointing/);
});

test('one channel reads as one channel', () => {
  assert.match(emptyingSaveWarning(1, 0), /all 1 channel from/);
});

test('⭐ it is not a blanket "are you sure?"', () => {
  // Only the some-to-none case, which is the one that cannot be undone by
  // typing the row back in. A prompt that always appears is a prompt everyone
  // learns to dismiss without reading.
  assert.equal(emptyingSaveWarning(4, 3), null);
  assert.equal(emptyingSaveWarning(4, 4), null);
  assert.equal(emptyingSaveWarning(4, 9), null);
});

test('emptying a board that was already empty asks nothing', () => {
  assert.equal(emptyingSaveWarning(0, 0), null);
});

test('an unknown count never produces a prompt', () => {
  // Better to say nothing than to ask about a number we do not have.
  assert.equal(emptyingSaveWarning(null, 0), null);
  assert.equal(emptyingSaveWarning(2, null), null);
  assert.equal(emptyingSaveWarning(undefined, undefined), null);
});

test('the waiting message says what is happening rather than showing nothing', () => {
  assert.match(waitingMessage(), /configuration/);
});
