import test from 'node:test';
import assert from 'node:assert/strict';

import { summariseGroups, unassignedSlots, slotLabel } from './group-summary.mjs';

const SLOTS = [
  { slot: 1, chan_name_raw: 'HH-1', extended_name: 'Dave R.' },
  { slot: 2, chan_name_raw: 'HH-2', extended_name: 'Marcy L.' },
  { slot: 3, chan_name_raw: 'HH-3' },
  { slot: 4, chan_name_raw: 'BP-9', extended_name: '   ' },
  { slot: 5 },
];

const GROUPS = {
  1: { title: 'Worship', slots: [2, 3], hide_charts: false },
  2: { title: 'Teaching', slots: [1], hide_charts: true },
};

test('a slot is named the way the card names it', () => {
  // Person, then the device's own name, then the bare number (#69).
  assert.equal(slotLabel(SLOTS[0]), 'Dave R.');
  assert.equal(slotLabel(SLOTS[2]), 'HH-3');
  assert.equal(slotLabel(SLOTS[4]), 'Slot 5');
  // Whitespace is not a name.
  assert.equal(slotLabel(SLOTS[3]), 'BP-9');
  assert.equal(slotLabel(null), '');
});

test('each group reports its own membership, in group order', () => {
  const rows = summariseGroups(GROUPS, SLOTS);

  assert.deepEqual(rows.map((r) => r.group), [1, 2]);
  assert.equal(rows[0].title, 'Worship');
  assert.equal(rows[0].count, 2);
  assert.deepEqual(rows[0].slots.map(slotLabel), ['Marcy L.', 'HH-3']);
  assert.equal(rows[1].hideCharts, true);
});

test('a group with no title still has something to show', () => {
  const rows = summariseGroups({ 3: { slots: [1] } }, SLOTS);
  assert.equal(rows[0].title, 'Group 3');
});

test('⚠️ a group pointing at a slot that no longer exists says so', () => {
  // Deleting a slot does not visit every group, so stale numbers accumulate.
  // Dropping them quietly would hide the only evidence the group is stale.
  const rows = summariseGroups({ 1: { title: 'Old', slots: [2, 99] } }, SLOTS);

  assert.equal(rows[0].count, 1);
  assert.deepEqual(rows[0].missing, [99]);
});

test('⭐ the channels in no group are the point of this', () => {
  const loose = unassignedSlots(GROUPS, SLOTS);

  // 1, 2 and 3 are claimed; 4 and 5 are not.
  assert.deepEqual(loose.map((s) => s.slot), [4, 5]);
});

test('with no groups at all, everything is unassigned', () => {
  assert.equal(unassignedSlots({}, SLOTS).length, SLOTS.length);
  assert.equal(unassignedSlots(undefined, SLOTS).length, SLOTS.length);
});

test('with every slot claimed, the list is empty', () => {
  const all = { 1: { slots: [1, 2, 3, 4, 5] } };
  assert.deepEqual(unassignedSlots(all, SLOTS), []);
});

test('a slot claimed by two groups is not unassigned', () => {
  // Overlapping groups are legal -- a spare mic can be in two services.
  const overlapping = { 1: { slots: [1] }, 2: { slots: [1] } };
  assert.ok(!unassignedSlots(overlapping, SLOTS).some((s) => s.slot === 1));
});

test('rubbish in the stored config does not throw', () => {
  // These come off disk and have been hand-edited before now.
  assert.deepEqual(summariseGroups(null, null), []);
  assert.deepEqual(unassignedSlots(null, null), []);
  assert.deepEqual(summariseGroups({ 1: { slots: ['x', null, 2] } }, SLOTS)[0].slots.map((s) => s.slot), [2]);
  assert.deepEqual(summariseGroups({ notanumber: { slots: [] } }, SLOTS), []);
});
