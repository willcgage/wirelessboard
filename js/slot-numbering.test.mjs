import test from 'node:test';
import assert from 'node:assert/strict';

import {
  numberOf,
  takenNumbers,
  nextNumber,
  assignNumbers,
  renumbersAnything,
} from './slot-numbering.mjs';

test('a row id carries its number', () => {
  assert.equal(numberOf('slot-3'), 3);
  assert.equal(numberOf('slot-12'), 12);
});

test('a row that has never had a number says so', () => {
  assert.equal(numberOf(null), null);
  assert.equal(numberOf(''), null);
  assert.equal(numberOf('slot-'), null);
  assert.equal(numberOf('mic_cont_3'), null);
});

test('⛔ the next number is one past the highest, never a reused one', () => {
  // Reusing a deleted channel's number hands a brand-new channel that
  // channel's identity, and any group still pointing at it adopts the new one.
  // That is this same bug in miniature.
  assert.equal(nextNumber([1, 3, 4]), 5);
  assert.equal(nextNumber([]), 1);
});

test('⛔⛔ deleting a channel does not renumber the survivors', () => {
  // The bug, reproduced on a real board: four channels, Vocals = [1,2] =
  // Alice and Bob, Band = [3,4] = Carol and Dave. Delete Bob and the old code
  // renumbered to 1,2,3 while the groups still said [1,2] and [3,4] — putting
  // Carol in Vocals. Nothing looked broken.
  const afterDeletingSlotTwo = ['slot-1', 'slot-3', 'slot-4'];

  assert.deepEqual(assignNumbers(afterDeletingSlotTwo), [1, 3, 4]);
  assert.equal(renumbersAnything(afterDeletingSlotTwo), false);
});

test('⚠️ gaps are the honest outcome and are left alone', () => {
  // The alternative is renumbering and rewriting every group and stored field
  // to match — getting a remap exactly right in the file whose corruption once
  // left a server that could not start.
  assert.deepEqual(assignNumbers(['slot-2', 'slot-7']), [2, 7]);
});

test('a new row takes the next free number', () => {
  assert.deepEqual(assignNumbers(['slot-1', 'slot-2', null]), [1, 2, 3]);
});

test('a new row after a deletion does not fill the gap', () => {
  // Slot 2 was deleted; the new row is 5, not 2.
  assert.deepEqual(assignNumbers(['slot-1', 'slot-3', 'slot-4', null]), [1, 3, 4, 5]);
});

test('several new rows at once each get their own number', () => {
  assert.deepEqual(assignNumbers(['slot-1', null, null, null]), [1, 2, 3, 4]);
});

test('an empty board numbers from one', () => {
  assert.deepEqual(assignNumbers([null, null, null, null]), [1, 2, 3, 4]);
  assert.deepEqual(assignNumbers([]), []);
});

test('⚠️ document order does not decide the number', () => {
  // Rows can be reordered — by a group edit, or by discovery appending — and
  // the channel each row describes must not change underneath it.
  assert.deepEqual(assignNumbers(['slot-4', 'slot-1', 'slot-3']), [4, 1, 3]);
  assert.equal(renumbersAnything(['slot-4', 'slot-1', 'slot-3']), false);
});

test('a new row among existing ones still goes past the highest', () => {
  assert.deepEqual(assignNumbers(['slot-4', null, 'slot-1']), [4, 5, 1]);
});

test('taken numbers ignore rows that have none', () => {
  assert.deepEqual(takenNumbers(['slot-1', null, 'slot-9']).sort((a, b) => a - b), [1, 9]);
  assert.deepEqual(takenNumbers(null), []);
});

test('rubbish in does not throw', () => {
  assert.deepEqual(assignNumbers(null), []);
  assert.equal(renumbersAnything(null), false);
  assert.equal(nextNumber(null), 1);
  assert.equal(nextNumber(['two', null]), 1);
});

test('⛔ the promise, stated directly: no configured channel ever changes number', () => {
  const cases = [
    ['slot-1', 'slot-2', 'slot-3'],
    ['slot-1', 'slot-3', 'slot-4'],
    ['slot-1', null, 'slot-5'],
    ['slot-9'],
    [null],
    ['slot-4', 'slot-2'],
  ];

  cases.forEach((rows) => {
    assert.equal(renumbersAnything(rows), false, `${rows.join(',')} must keep its numbers`);
  });
});
