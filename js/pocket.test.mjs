import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEVERITY, severityOf, needsAttention, pocketOrder, pocketFooter,
} from './pocket.mjs';

const tx = (pairs) => Object.fromEntries(
  Object.entries(pairs).map(([slot, status]) => [Number(slot), { slot: Number(slot), status }]),
);

test('⭐⭐ the worst channel is first, because that is the whole feature', () => {
  const slots = [1, 2, 3, 4];
  const { urgent, rest } = pocketOrder(slots, tx({
    1: 'GOOD', 2: 'REPLACE', 3: 'CRITICAL', 4: 'GOOD',
  }));

  assert.deepEqual(urgent, [3, 2], 'critical before replace-soon');
  assert.deepEqual(rest, [1, 4], 'and the calm ones keep slot order');
});

test('⛔ the calm half keeps SLOT order and is never re-sorted', () => {
  // Sorting it by anything would mean the bottom of the list reshuffled every
  // time a battery ticked down -- and that half is read by position, by
  // somebody looking for one person.
  const slots = [5, 1, 9, 3];
  const { rest } = pocketOrder(slots, tx({
    5: 'GOOD', 1: 'GOOD', 9: 'GOOD', 3: 'GOOD',
  }));
  assert.deepEqual(rest, [5, 1, 9, 3], 'the list order it was given, untouched');
});

test('⚠️ two channels in the same state keep a stable order', () => {
  // Without the slot tiebreak the urgent half jitters on every poll, which on
  // a phone reads as the board being unsure of itself.
  const slots = [7, 2, 4];
  const all = tx({ 7: 'CRITICAL', 2: 'CRITICAL', 4: 'CRITICAL' });
  assert.deepEqual(pocketOrder(slots, all).urgent, [2, 4, 7]);
  assert.deepEqual(pocketOrder([2, 4, 7], all).urgent, [2, 4, 7], 'same answer either way round');
});

test('⛔ a receiver that has stopped answering outranks a flat battery', () => {
  // An unknown is worse than a known bad: nobody can act on "I cannot tell
  // you". A critical battery at least says what to do about it.
  const { urgent } = pocketOrder([1, 2], tx({ 1: 'CRITICAL', 2: 'RX_COM_ERROR' }));
  assert.deepEqual(urgent, [2, 1]);
  assert.ok(severityOf('RX_COM_ERROR') < severityOf('CRITICAL'));
});

test('⚠️ an unknown status is the LEAST urgent, not the most', () => {
  // The tempting mistake. A new status string from a vendor adapter would
  // otherwise push every channel on the board to the top and make the ordering
  // useless exactly when somebody is relying on it.
  assert.equal(severityOf('SOMETHING_NEW'), SEVERITY.length);
  assert.ok(severityOf('SOMETHING_NEW') > severityOf('GOOD'));
  assert.equal(needsAttention('SOMETHING_NEW'), false);

  const { urgent, rest } = pocketOrder([1, 2], tx({ 1: 'SOMETHING_NEW', 2: 'CRITICAL' }));
  assert.deepEqual(urgent, [2], 'only the one we understand to be bad');
  assert.deepEqual(rest, [1]);
});

test('⛔ nothing is filtered out — the calm channels stay on the list', () => {
  // A divider, not a filter. "Which channel is Dave on" is still a question
  // somebody asks with a phone in their hand.
  const slots = [1, 2, 3, 4, 5];
  const { urgent, rest } = pocketOrder(slots, tx({ 2: 'CRITICAL' }));
  assert.equal(urgent.length + rest.length, slots.length);
  assert.deepEqual([...urgent, ...rest].sort((a, b) => a - b), slots);
});

test('a board with nothing wrong has an empty urgent half, not an empty list', () => {
  const { urgent, rest } = pocketOrder([1, 2, 3], tx({ 1: 'GOOD', 2: 'GOOD', 3: 'GOOD' }));
  assert.deepEqual(urgent, []);
  assert.deepEqual(rest, [1, 2, 3]);
});

test('⚠️ blank slots and an absent transmitter do not throw', () => {
  // `0` is the blank the display list uses for an empty grid position, and a
  // slot can be in the list before its first payload arrives.
  const { urgent, rest } = pocketOrder([0, 1, 0, 2], tx({ 1: 'CRITICAL' }));
  assert.deepEqual(urgent, [1]);
  assert.deepEqual(rest, [2], 'the blanks are gone, the unknown stays');
  assert.doesNotThrow(() => pocketOrder([1], {}));
  assert.doesNotThrow(() => pocketOrder(null));
});

test('⛔ the footer counts what is SHOWN, never what the board has', () => {
  // #215's mistake, pointed the other way: the paging bar counted
  // `config.groups` whatever the board was actually displaying.
  assert.equal(pocketFooter({ shown: 12, total: 12 }), '12 channels · all shown');
  assert.equal(pocketFooter({ shown: 4, total: 12 }), '4 channels of 12');
  assert.equal(pocketFooter({ shown: 1, total: 12 }), '1 channel of 12');
  assert.equal(pocketFooter({ shown: 1, total: 1 }), '1 channel · all shown');
  assert.equal(pocketFooter({}), '0 channels · all shown');
});
