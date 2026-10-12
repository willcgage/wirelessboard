import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACEMENTS,
  DEFAULT_PLACEMENT,
  placement,
  isVisible,
  claimsCell,
  cellsForChannels,
  placementCost,
  headline,
  upNext,
  timerText,
  isOver,
  stripClass,
} from './live-strip.mjs';

const RUNNING = {
  state: 'running',
  current: { title: 'Worship', length: 900 },
  next: { title: 'Welcome' },
  timer: {
    seconds: 300, over: false, mode: 'full_item_length', known: true,
  },
  clock: '5:00',
};
const NOT_RUNNING = { state: 'not_running', label: 'Live not running' };
const OFF = { state: 'off' };

test('placement falls back rather than breaking on nonsense', () => {
  assert.equal(placement('card'), 'card');
  assert.equal(placement('  TOP '), 'top');
  assert.equal(placement('sideways'), DEFAULT_PLACEMENT);
  assert.equal(placement(undefined), DEFAULT_PLACEMENT);
});

test('every placement is one we declared', () => {
  PLACEMENTS.forEach((p) => assert.equal(placement(p), p));
});

test('⚠️ hidden-here and not-enabled-at-all both draw nothing', () => {
  // Different facts: one is this screen, one is the whole account. Only the
  // first is worth a setting, and both end in an empty board.
  assert.equal(isVisible(RUNNING, 'off'), false);
  assert.equal(isVisible(OFF, 'bottom'), false);
});

test('a strip with something to say is visible, including "not running"', () => {
  // ⛔ "Live not running" is the message most of the time here. A strip that
  // only appeared when Live was running would never be seen at all.
  assert.equal(isVisible(RUNNING, 'bottom'), true);
  assert.equal(isVisible(NOT_RUNNING, 'bottom'), true);
});

test('only the card placement takes a cell', () => {
  assert.equal(claimsCell(RUNNING, 'card'), true);
  assert.equal(claimsCell(RUNNING, 'bottom'), false);
  assert.equal(claimsCell(RUNNING, 'top'), false);
});

test('⛔ a hidden strip does not hold a cell', () => {
  assert.equal(claimsCell(RUNNING, 'off'), false);
  assert.equal(claimsCell(OFF, 'card'), false);
});

test('the card takes exactly one cell from the channels', () => {
  assert.equal(cellsForChannels(12, RUNNING, 'card'), 11);
  assert.equal(cellsForChannels(12, RUNNING, 'bottom'), 12);
});

test('⚠️ it never leaves the board with no cells for channels', () => {
  // A board configured to one cell with the card placed would otherwise show
  // no channels at all — worse than ignoring the placement.
  assert.equal(cellsForChannels(1, RUNNING, 'card'), 1);
});

test('a board with no cells stays at none', () => {
  assert.equal(cellsForChannels(0, RUNNING, 'card'), 0);
  assert.equal(cellsForChannels('many', RUNNING, 'card'), 0);
});

test('⭐ the cost of the card is said when the choice is made', () => {
  // Picking it on a full board drops a channel off the end, and a channel
  // missing from a wall is exactly what this board exists to prevent.
  assert.match(placementCost('card', { cells: 12, channels: 12 }), /1 channel will not fit/);
  assert.match(placementCost('card', { cells: 12, channels: 14 }), /3 channels will not fit/);
});

test('no warning when there is a spare cell', () => {
  assert.equal(placementCost('card', { cells: 12, channels: 10 }), null);
  assert.equal(placementCost('card', { cells: 12, channels: 11 }), null);
});

test('the other placements cost nothing', () => {
  assert.equal(placementCost('bottom', { cells: 12, channels: 12 }), null);
  assert.equal(placementCost('top', { cells: 12, channels: 12 }), null);
});

test('an unknown board size produces no claim either way', () => {
  assert.equal(placementCost('card', {}), null);
  assert.equal(placementCost('card', { cells: 12 }), null);
});

test('the headline is the item while running', () => {
  assert.equal(headline(RUNNING), 'Worship');
});

test('an item with no title still gets a headline', () => {
  assert.equal(headline({ ...RUNNING, current: { title: '' } }), 'Untitled item');
});

test('⛔ when nothing is running the headline is why', () => {
  assert.equal(headline(NOT_RUNNING), 'Live not running');
  assert.equal(
    headline({ state: 'error', label: 'Cannot reach Planning Center' }),
    'Cannot reach Planning Center',
  );
});

test('a stale position still shows the item it is stale about', () => {
  // The operator needs to know what the board thinks is happening before the
  // staleness means anything.
  assert.equal(headline({ ...RUNNING, state: 'stale' }), 'Worship');
});

test('⚠️ "next" only appears while something is actually running', () => {
  // "Next: Welcome" on a board where Live was never started describes a plan,
  // not a service, and reads as though the service were under way.
  assert.equal(upNext(RUNNING), 'Welcome');
  assert.equal(upNext({ ...RUNNING, state: 'stale' }), null);
  assert.equal(upNext(NOT_RUNNING), null);
});

test('a running item with nothing after it has no next', () => {
  assert.equal(upNext({ ...RUNNING, next: null }), null);
  assert.equal(upNext({ ...RUNNING, next: { title: '' } }), null);
});

test('the timer shows while running', () => {
  assert.equal(timerText(RUNNING), '5:00');
});

test('⛔ a mode that cannot be computed shows no timer, not a zero', () => {
  // "0:00" is a statement about the service. Showing it for "we cannot tell"
  // would be a false one.
  const unknown = { ...RUNNING, timer: { known: false, seconds: null }, clock: '--:--' };

  assert.equal(timerText(unknown), null);
});

test('no timer when nothing is running', () => {
  assert.equal(timerText(NOT_RUNNING), null);
  assert.equal(timerText({ ...RUNNING, state: 'stale' }), null);
});

test('running over is flagged, the way Live flags it', () => {
  assert.equal(isOver(RUNNING), false);
  assert.equal(isOver({ ...RUNNING, timer: { ...RUNNING.timer, over: true } }), true);
});

test('only a running item can be over', () => {
  assert.equal(isOver({ ...RUNNING, state: 'stale', timer: { over: true } }), false);
  assert.equal(isOver(NOT_RUNNING), false);
  assert.equal(isOver(null), false);
});

test('the class names the state so the stylesheet decides the look', () => {
  assert.equal(stripClass(RUNNING), 'live-strip live-running');
  assert.equal(stripClass(NOT_RUNNING), 'live-strip live-not_running');
  assert.equal(stripClass(null), 'live-strip live-off');
});

test('an overrunning item gets its own class as well as its state', () => {
  assert.equal(
    stripClass({ ...RUNNING, timer: { ...RUNNING.timer, over: true } }),
    'live-strip live-running live-over',
  );
});
