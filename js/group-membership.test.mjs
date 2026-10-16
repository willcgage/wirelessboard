import test from 'node:test';
import assert from 'node:assert/strict';

import {
  storedNumbers,
  toggleMembership,
  membershipRows,
  membershipPayload,
  membershipSummary,
} from './group-membership.mjs';

const SLOTS = [
  { slot: 1, extended_name: 'Christian Nuckels' },
  { slot: 2, extended_name: 'Brandon Risinger' },
  { slot: 3, chan_name_raw: 'HH-3' },
  { slot: 4 },
];

const label = (s) => s.extended_name || s.chan_name_raw || `Slot ${s.slot}`;

test('⛔ a stale slot number survives an unrelated membership edit', () => {
  // A group can list a number no slot answers to -- deleting a slot does not
  // visit every group -- and those strays are the only evidence the group has
  // gone stale. Rebuilding from what resolves would delete them on a save the
  // operator thought was about something else.
  const stored = [1, 99, 3];

  assert.deepEqual(toggleMembership(stored, 2, true), [1, 99, 3, 2]);
  assert.deepEqual(toggleMembership(stored, 1, false), [99, 3]);
});

test('⭐ adding appends, because a group\'s order is the order it is shown in', () => {
  // #113: the list is the board's order. Re-sorting on every tick would
  // rearrange a board somebody had already arranged by hand.
  assert.deepEqual(toggleMembership([3, 1], 2, true), [3, 1, 2]);
  assert.notDeepEqual(toggleMembership([3, 1], 2, true), [1, 2, 3]);
});

test('ticking something already in the group changes nothing', () => {
  assert.deepEqual(toggleMembership([1, 2], 1, true), [1, 2]);
});

test('unticking something absent changes nothing', () => {
  assert.deepEqual(toggleMembership([1, 2], 9, false), [1, 2]);
});

test('removing closes the gap and leaves the rest in order', () => {
  assert.deepEqual(toggleMembership([4, 1, 3, 2], 3, false), [4, 1, 2]);
});

test('never mutates what it was given', () => {
  const before = [1, 2];
  toggleMembership(before, 3, true);
  assert.deepEqual(before, [1, 2], 'the caller\'s array is untouched');
});

test('junk in the stored list does not become junk in the payload', () => {
  assert.deepEqual(storedNumbers({ slots: [1, 'two', null, 3] }), [1, 3]);
  assert.deepEqual(storedNumbers({}), []);
  assert.deepEqual(storedNumbers(null), []);
  assert.deepEqual(toggleMembership([1], 'x', true), [1]);
});

test('⛔ a null in a stored list must not become channel zero', () => {
  // `Number(null)`, `Number('')` and `Number(false)` are all 0 -- a finite
  // number that passes `Number.isFinite`. The first version of this filtered
  // on exactly that and turned a null into a phantom channel 0, which the
  // next save would have written back to the server as real membership.
  [null, undefined, '', '   ', false, true, [], {}, NaN, 1.5, '2.5', 'x']
    .forEach((junk) => {
      assert.deepEqual(
        storedNumbers({ slots: [junk] }),
        [],
        `${JSON.stringify(junk)} is not a slot number`,
      );
      assert.deepEqual(
        toggleMembership([], junk, true),
        [],
        `${JSON.stringify(junk)} must not be addable`,
      );
      assert.deepEqual(
        membershipPayload(1, [junk]).slots,
        [],
        `${JSON.stringify(junk)} must not reach the server`,
      );
    });

  // And the real ones still work, including as the strings JSON often gives.
  assert.deepEqual(storedNumbers({ slots: ['7', 8] }), [7, 8]);
});

test('every channel is offered, not only the unclaimed ones', () => {
  // A channel can belong to more than one group -- a vocalist in Worship and
  // in Sunday Morning -- and hiding the spoken-for ones makes that
  // inexpressible.
  const groups = { 1: { title: 'Worship', slots: [1, 2] }, 2: { title: 'Kids', slots: [2] } };
  const rows = membershipRows({
    groupNumber: 1, groups, slots: SLOTS, label,
  });

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.slot), [1, 2, 3, 4]);
  assert.deepEqual(rows.map((r) => r.checked), [true, true, false, false]);
});

test('⭐ a row says which other groups already hold that channel', () => {
  // So moving one out of the wrong group does not mean opening every other
  // group to find out where it went.
  const groups = {
    1: { title: 'Worship', slots: [2] },
    2: { title: 'Kids', slots: [2] },
    3: { title: 'Students', slots: [2] },
  };
  const rows = membershipRows({
    groupNumber: 1, groups, slots: SLOTS, label,
  });
  const two = rows.find((r) => r.slot === 2);

  assert.deepEqual(two.elsewhere, ['Kids', 'Students']);
  assert.deepEqual(rows.find((r) => r.slot === 1).elsewhere, []);
});

test('a group never reports itself as somewhere else', () => {
  const groups = { 1: { title: 'Worship', slots: [1] } };
  const rows = membershipRows({
    groupNumber: 1, groups, slots: SLOTS, label,
  });
  assert.deepEqual(rows.find((r) => r.slot === 1).elsewhere, []);
});

test('the group key may be a string or a number', () => {
  // `micboard.groups` is keyed by whatever came off the wire.
  const rows = membershipRows({
    groupNumber: 1, groups: { 1: { slots: [3] } }, slots: SLOTS, label,
  });
  assert.equal(rows.find((r) => r.slot === 3).checked, true);
});

test('rows carry the label a person would use', () => {
  const rows = membershipRows({
    groupNumber: 1, groups: {}, slots: SLOTS, label,
  });
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Christian Nuckels', 'Brandon Risinger', 'HH-3', 'Slot 4'],
  );
});

test('⛔ the payload carries slots and the group number, and nothing else', () => {
  // `update_group` edits the fields a payload carries. A title sent from here
  // would mean this control writing back a name it never showed anybody --
  // the mistake the partial contract exists to prevent.
  const payload = membershipPayload(2, [3, 1]);

  assert.deepEqual(Object.keys(payload).sort(), ['group', 'slots']);
  assert.deepEqual(payload, { group: 2, slots: [3, 1] });
});

test('⭐ emptying a group sends an empty list, not an absent one', () => {
  // Absent means "not editing this". Present and empty says "empty it", which
  // is a thing an operator may genuinely want.
  const payload = membershipPayload(2, []);
  assert.ok('slots' in payload, 'omitting it would be a no-op, not an empty group');
  assert.deepEqual(payload.slots, []);
});

test('the payload does not carry the order back to front', () => {
  assert.deepEqual(membershipPayload(1, [4, 2, 1]).slots, [4, 2, 1]);
});

test('an empty group reads as something to fix, not as a fact', () => {
  assert.match(membershipSummary([]), /choose/i);
  assert.equal(
    membershipSummary([{ label: 'Lisa Toews', checked: true }, { label: 'X', checked: false }]),
    'Lisa Toews',
  );
});
