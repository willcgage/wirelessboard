import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rowAddress,
  groupRows,
  groupHeading,
  splitAddresses,
  manualReceiverRows,
  manualReceiverBlocker,
} from './receiver-groups.mjs';

const QUAD = [
  {
    ip: '10.0.0.5', type: 'axtd', channel: 1, device_name: 'AD4Q RACK 1',
  },
  { ip: '10.0.0.5', type: 'axtd', channel: 2 },
  { ip: '10.0.0.5', type: 'axtd', channel: 3 },
  { ip: '10.0.0.5', type: 'axtd', channel: 4 },
];
const IEM = [
  {
    ip: '10.0.0.9', type: 'p10t', channel: 1, device_name: 'PSM1K',
  },
  { ip: '10.0.0.9', type: 'p10t', channel: 2 },
];

test('an address is read trimmed', () => {
  assert.equal(rowAddress({ ip: ' 10.0.0.5 ' }), '10.0.0.5');
  assert.equal(rowAddress({}), '');
  assert.equal(rowAddress(null), '');
});

test('⭐ a rack reads as boxes, not as sixteen equal rows', () => {
  const groups = groupRows([...QUAD, ...IEM]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => [g.ip, g.rows.length]), [['10.0.0.5', 4], ['10.0.0.9', 2]]);
});

test('each row keeps its position in the original list', () => {
  // The index is how a header's actions reach the right rows; losing it would
  // mean matching on address, which is exactly what is not unique.
  const groups = groupRows([...QUAD, ...IEM]);

  assert.deepEqual(groups[1].rows.map((r) => r.index), [4, 5]);
});

test('⚠️ grouping is of contiguous runs, not of every row sharing an address', () => {
  // Reordering rows is the other way to do this and is the dangerous one: the
  // saved slots array is written in document order, so shuffling it changes
  // what the board shows for anyone whose channels are not in groups.
  const interleaved = [QUAD[0], IEM[0], QUAD[1]];

  assert.deepEqual(
    groupRows(interleaved).map((g) => g.ip),
    ['10.0.0.5', '10.0.0.9', '10.0.0.5'],
  );
});

test('a split receiver is reported, because it is almost never deliberate', () => {
  const groups = groupRows([QUAD[0], IEM[0], QUAD[1]]);

  assert.deepEqual(splitAddresses(groups), ['10.0.0.5']);
});

test('an unsplit configuration reports nothing', () => {
  assert.deepEqual(splitAddresses(groupRows([...QUAD, ...IEM])), []);
});

test('rows with no address each stand alone', () => {
  // An offline placeholder or a half-filled row should not clump under a blank
  // heading with unrelated rows.
  const groups = groupRows([{ type: 'offline' }, { type: 'offline' }]);

  assert.equal(groups.length, 2);
});

test('⭐ a heading leads with the address, which is what is on the box', () => {
  const heading = groupHeading(groupRows(QUAD)[0]);

  assert.match(heading, /^10\.0\.0\.5/);
  assert.match(heading, /AD4Q RACK 1/);
  assert.match(heading, /4 channels/);
});

test('the heading uses the human model name when one is known', () => {
  const heading = groupHeading(groupRows(QUAD)[0], {
    typeLabels: { axtd: 'Axient Digital' },
  });

  assert.match(heading, /Axient Digital/);
  assert.doesNotMatch(heading, /axtd/);
});

test('one channel reads as one channel', () => {
  assert.match(groupHeading(groupRows([IEM[0]])[0]), /1 channel$/);
});

test('a receiver that has reported no name still has a heading', () => {
  assert.match(groupHeading(groupRows([QUAD[1]])[0]), /^10\.0\.0\.5/);
});

test('a row with no address says so rather than showing a blank heading', () => {
  assert.equal(groupHeading(groupRows([{ type: 'offline' }])[0]), 'Not on the network');
});

test('⛔ a manual receiver expands to the channel count it was given', () => {
  // The count has to be asked for: `axtd` is both AD4D (2) and AD4Q (4), and
  // the model tables for slxd/slxdplus are empty. An address and a type do not
  // say how many channels a box has.
  const rows = manualReceiverRows({ ip: '10.0.0.7', type: 'axtd', channels: 4 });

  assert.deepEqual(rows.map((r) => r.channel), [1, 2, 3, 4]);
  rows.forEach((r) => assert.equal(r.ip, '10.0.0.7'));
});

test('a manual receiver defaults to one channel rather than none', () => {
  assert.equal(manualReceiverRows({ ip: '10.0.0.7', type: 'ulxd' }).length, 1);
  assert.equal(manualReceiverRows({ ip: '10.0.0.7', type: 'ulxd', channels: 'four' }).length, 1);
});

test('an absurd count is capped', () => {
  assert.equal(manualReceiverRows({ ip: '10.0.0.7', type: 'ulxd', channels: 999 }).length, 16);
});

test('no address means no rows', () => {
  assert.deepEqual(manualReceiverRows({ type: 'ulxd', channels: 4 }), []);
  assert.deepEqual(manualReceiverRows({}), []);
});

test('a manual receiver needs an address and a model', () => {
  assert.match(manualReceiverBlocker({}), /IP address/);
  assert.match(manualReceiverBlocker({ ip: '10.0.0.7' }), /model/);
  assert.equal(manualReceiverBlocker({ ip: '10.0.0.7', type: 'ulxd' }), null);
});

test('⚠️ the model is required because a typeless row vanishes on save', () => {
  // `slot-rules.mjs` drops a row with no type rather than flagging it, so an
  // unfinished receiver would disappear on Save with nothing said.
  assert.notEqual(manualReceiverBlocker({ ip: '10.0.0.7', type: '  ' }), null);
});

test('rubbish in does not throw', () => {
  assert.deepEqual(groupRows(null), []);
  assert.deepEqual(splitAddresses(null), []);
  assert.deepEqual(manualReceiverRows(), []);
  assert.notEqual(manualReceiverBlocker(), null);
});
