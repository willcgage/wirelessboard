/**
 * Tests for the slot save rules. Run with `npm run test:js`.
 *
 * Every case below is a fault that actually shipped and was found by hand in a
 * browser. They are here because all of them lost data silently -- the kind that
 * a regression would put back without anyone noticing until a service.
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  mergeUnrenderedSlots,
  readSlotOrder,
  resolveSlotType,
} from './slot-rules.mjs';

// A slot is drawn only if it has a transmitter, so these two go together.
const withTransmitters = (...slots) => (slot) => slots.includes(slot);

test('a slot with no transmitter yet stays in the group', () => {
  // Reproduces the observed loss: group [1,2,3], slot 3's transmitter had not
  // arrived, so the board drew only 1 and 2 and the save wrote [1,2] to disk.
  assert.deepStrictEqual(
    mergeUnrenderedSlots([1, 2], [1, 2, 3], withTransmitters(1, 2)),
    [1, 2, 3],
  );
});

test('a slot dragged out of the group is still removed', () => {
  // The counter-case. Slot 2 has a transmitter, so it was drawn, so its absence
  // from the board is a deliberate removal rather than missing data. Without
  // this the fix above would make removal impossible.
  assert.deepStrictEqual(
    mergeUnrenderedSlots([1, 3], [1, 2, 3], withTransmitters(1, 2, 3)),
    [1, 3],
  );
});

test('a restored slot goes back where it was, not on the end', () => {
  assert.deepStrictEqual(
    mergeUnrenderedSlots([1, 4], [1, 2, 3, 4], withTransmitters(1, 4)),
    [1, 2, 3, 4],
  );
});

test('blank spacers are left to the board', () => {
  // 0 is a position, not a slot. Re-inserting them would multiply the blanks
  // every time a group was saved.
  assert.deepStrictEqual(
    mergeUnrenderedSlots([1, 0, 2], [1, 0, 0, 2], withTransmitters(1, 2)),
    [1, 0, 2],
  );
});

test('reordering the board is preserved', () => {
  assert.deepStrictEqual(
    mergeUnrenderedSlots([3, 1, 2], [1, 2, 3], withTransmitters(1, 2, 3)),
    [3, 1, 2],
  );
});

test('a group with nothing stored yet passes the board through', () => {
  assert.deepStrictEqual(mergeUnrenderedSlots([1, 2], undefined, () => false), [1, 2]);
  assert.deepStrictEqual(mergeUnrenderedSlots([1, 2], null, () => false), [1, 2]);
});

test('mergeUnrenderedSlots does not mutate what it is given', () => {
  const ordered = [1, 2];
  const stored = [1, 2, 3];
  mergeUnrenderedSlots(ordered, stored, withTransmitters(1, 2));
  assert.deepStrictEqual(ordered, [1, 2]);
  assert.deepStrictEqual(stored, [1, 2, 3]);
});

test('readSlotOrder takes the slot number out of the element id', () => {
  assert.deepStrictEqual(
    readSlotOrder([{ id: 'slot-1' }, { id: 'slot-2' }, { id: 'slot-10' }]),
    [1, 2, 10],
  );
});

test('readSlotOrder records a blank as 0', () => {
  assert.deepStrictEqual(
    readSlotOrder([{ id: 'slot-1' }, { id: '', blank: true }, { id: 'slot-2' }]),
    [1, 0, 2],
  );
});

test('readSlotOrder ignores a slot listed twice', () => {
  assert.deepStrictEqual(
    readSlotOrder([{ id: 'slot-1' }, { id: 'slot-1' }, { id: 'slot-2' }]),
    [1, 2],
  );
});

test('a row with a chosen type is saved as that type', () => {
  assert.deepStrictEqual(
    resolveSlotType({ type: 'ulxd', ip: '10.100.50.51' }),
    { type: 'ulxd', incomplete: false },
  );
});

test('a name with no address is saved as an offline slot', () => {
  assert.deepStrictEqual(
    resolveSlotType({ name: 'Alice' }),
    { type: 'offline', incomplete: false },
  );
});

test('an address with no type blocks the save instead of vanishing', () => {
  // The reported fault: entering an IP and pressing Save before choosing a type
  // dropped the row, and the save still reported success.
  assert.deepStrictEqual(
    resolveSlotType({ ip: '10.100.50.77' }),
    { type: null, incomplete: true },
  );
});

test('a name and an address with no type still blocks', () => {
  assert.deepStrictEqual(
    resolveSlotType({ ip: '10.100.50.77', name: 'Alice' }),
    { type: null, incomplete: true },
  );
});

test('a position alone with no type blocks', () => {
  // extended_id is the newest field on that row, and it is easy to fill in
  // first. It counts as content.
  assert.deepStrictEqual(
    resolveSlotType({ id: 'Vocal 1' }),
    { type: null, incomplete: true },
  );
});

test('an untouched row from Add Row is dropped without complaint', () => {
  // Blocking on these would make the button useless.
  assert.deepStrictEqual(
    resolveSlotType({}),
    { type: null, incomplete: false },
  );
  assert.deepStrictEqual(
    resolveSlotType({
      type: '', ip: '   ', name: '', id: '  ',
    }),
    { type: null, incomplete: false },
  );
});

test('whitespace does not count as a chosen type', () => {
  assert.deepStrictEqual(
    resolveSlotType({ type: '   ', ip: '10.0.0.1' }),
    { type: null, incomplete: true },
  );
});
