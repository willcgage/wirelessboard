import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLEAR_ASSIGNMENT,
  parseSelection,
  assignedSlots,
  clearUpdates,
  clearAllConfirmation,
  clearedSummary,
} from './clear-assignments.mjs';

// The three states a row can be in. Before #135 there were two values for
// three meanings, which is why a slot could never be emptied from here.
test('a blank select leaves the slot alone', () => {
  assert.deepEqual(parseSelection(''), { action: 'skip' });
});

test('a name assigns it', () => {
  assert.deepEqual(parseSelection(encodeURIComponent('Fatai')), {
    action: 'assign',
    name: 'Fatai',
  });
});

test('the sentinel clears it', () => {
  assert.deepEqual(parseSelection(CLEAR_ASSIGNMENT), { action: 'clear' });
});

test('the sentinel is not the empty string', () => {
  // ⛔ If these ever collide, "take the person off slot 4" and "I have not got
  // to slot 4 yet" become the same instruction and every unanswered row clears.
  assert.notEqual(CLEAR_ASSIGNMENT, '');
  assert.notEqual(parseSelection(CLEAR_ASSIGNMENT).action, parseSelection('').action);
});

test('names with spaces and punctuation survive the round trip', () => {
  const name = 'José O’Brien-Smith';
  assert.equal(parseSelection(encodeURIComponent(name)).name, name);
});

test('a malformed value is treated as a name, not thrown', () => {
  // A stray % would make decodeURIComponent throw and take the whole Apply
  // down with it, losing the eleven rows the operator did fill in.
  assert.deepEqual(parseSelection('100%'), { action: 'assign', name: '100%' });
});

test('a whitespace-only name is nothing, not a person called space', () => {
  assert.deepEqual(parseSelection('%20%20'), { action: 'skip' });
});

test('only slots with somebody on them are counted', () => {
  const slots = [
    { slot: 1, extended_name: 'Fatai' },
    { slot: 2 },
    { slot: 3, extended_name: '' },
    { slot: 4, extended_name: '   ' },
    { slot: 5, extended_name: 'Dave' },
  ];

  assert.deepEqual(assignedSlots(slots), [1, 5]);
});

test('a slot with no number is skipped rather than sent as NaN', () => {
  assert.deepEqual(assignedSlots([{ extended_name: 'Ghost' }, null]), []);
});

test('a missing slot list is empty, not a crash', () => {
  assert.deepEqual(assignedSlots(undefined), []);
});

test('the payload sends an empty name per slot', () => {
  // The server clears on key-present-and-empty, so the key has to be there.
  assert.deepEqual(clearUpdates([2, 7]), [
    { slot: 2, extended_name: '' },
    { slot: 7, extended_name: '' },
  ]);
});

test('the payload never carries extended_id', () => {
  // ⚠️ Clearing the person must not clear the position: it is what the next
  // sync matches on. Absent from the payload means untouched on the server.
  clearUpdates([1]).forEach((update) => {
    assert.deepEqual(Object.keys(update).sort(), ['extended_name', 'slot']);
  });
});

test('clearing nothing sends nothing', () => {
  assert.deepEqual(clearUpdates([]), []);
  assert.deepEqual(clearUpdates(null), []);
});

test('the confirmation names the count', () => {
  assert.match(clearAllConfirmation(12), /12 slots/);
});

test('the confirmation says the slot IDs survive', () => {
  // The whole reason an operator would hesitate. Saying it is what makes the
  // button usable rather than frightening.
  assert.match(clearAllConfirmation(3), /IDs are kept/);
});

test('one slot reads as one slot', () => {
  assert.match(clearAllConfirmation(1), /off 1 slot\?/);
});

test('there is nothing to confirm when nothing is assigned', () => {
  assert.equal(clearAllConfirmation(0), null);
  assert.equal(clearAllConfirmation(-1), null);
  assert.equal(clearAllConfirmation(undefined), null);
});

test('the summary distinguishes "cleared none" from "nothing to clear"', () => {
  assert.equal(clearedSummary(0), 'No slots have anyone on them.');
  assert.equal(clearedSummary(1), 'Cleared 1 slot.');
  assert.equal(clearedSummary(4), 'Cleared 4 slots.');
});
