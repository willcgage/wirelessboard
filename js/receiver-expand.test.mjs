import test from 'node:test';
import assert from 'node:assert/strict';

import {
  channelCount,
  receiverKey,
  configuredChannels,
  channelsToAdd,
  addLabel,
  allChannelsToAdd,
} from './receiver-expand.mjs';

const QUAD = {
  ip: '192.168.1.50', type: 'axtd', channel: 1, channels: 4, name_raw: 'AD4Q RACK 1',
};
const SINGLE = {
  ip: '192.168.1.51', type: 'ulxd', channel: 1, channels: 1,
};

test('⭐ the channel count comes from discovery, which already knew it', () => {
  // `py/discover.py` resolves the model to a count and puts it on the entry.
  // The browser simply never read it, so a discovered quad arrived as one row.
  assert.equal(channelCount(QUAD), 4);
});

test('⚠️ an unknown count is one channel, not none', () => {
  // An unknown receiver still has at least the channel it announced itself on,
  // and adding nothing would look like a failure.
  assert.equal(channelCount({ ip: '10.0.0.1' }), 1);
  assert.equal(channelCount({ channels: 0 }), 1);
  assert.equal(channelCount({ channels: 'four' }), 1);
  assert.equal(channelCount(null), 1);
});

test('an absurd count is capped rather than trusted', () => {
  assert.equal(channelCount({ channels: 9999 }), 16);
});

test('a receiver is identified by its address', () => {
  assert.equal(receiverKey(QUAD), '192.168.1.50');
  assert.equal(receiverKey({ ip: '  10.0.0.1 ' }), '10.0.0.1');
  assert.equal(receiverKey({}), '');
});

test('⛔ a quad expands to four rows', () => {
  const rows = channelsToAdd(QUAD, []);

  assert.deepEqual(rows.map((r) => r.channel), [1, 2, 3, 4]);
  rows.forEach((r) => {
    assert.equal(r.ip, '192.168.1.50');
    assert.equal(r.type, 'axtd');
  });
});

test('⛔ the rows carry no slot number', () => {
  // Numbers are assigned when the rows land in the editor. A second source of
  // truth for the one value that decides which group a channel is in (#147) is
  // exactly what not to build.
  channelsToAdd(QUAD, []).forEach((row) => {
    assert.equal('slot' in row, false);
  });
});

test('only the announced channel carries the discovered name', () => {
  // Discovery does not report the other channels' labels, and inventing them
  // would put a wrong device name in front of an operator.
  const rows = channelsToAdd(QUAD, []);

  assert.equal(rows[0].device_name, 'AD4Q RACK 1');
  assert.deepEqual(rows.slice(1).map((r) => r.device_name), ['', '', '']);
});

test('⚠️ channels already configured are not added again', () => {
  const slots = [
    { ip: '192.168.1.50', channel: 1 },
    { ip: '192.168.1.50', channel: 3 },
  ];

  assert.deepEqual(channelsToAdd(QUAD, slots).map((r) => r.channel), [2, 4]);
});

test('a receiver that is fully configured adds nothing', () => {
  const slots = [1, 2, 3, 4].map((channel) => ({ ip: '192.168.1.50', channel }));

  assert.deepEqual(channelsToAdd(QUAD, slots), []);
});

test('another receiver at a different address does not count', () => {
  const slots = [{ ip: '192.168.1.99', channel: 1 }];

  assert.equal(channelsToAdd(QUAD, slots).length, 4);
});

test('a receiver with no address adds nothing rather than a broken row', () => {
  assert.deepEqual(channelsToAdd({ channels: 4 }, []), []);
});

test('configured channels are read per address', () => {
  const slots = [
    { ip: '192.168.1.50', channel: 2 },
    { ip: '192.168.1.51', channel: 1 },
    { ip: '192.168.1.50', channel: 'x' },
  ];

  assert.deepEqual(configuredChannels(QUAD, slots), [2]);
});

test('⭐ the button names how many rows it is about to add', () => {
  // "Add" on a quad adding four rows is a surprise worth not having.
  assert.equal(addLabel(QUAD, []), 'Add 4 channels');
  assert.equal(addLabel(SINGLE, []), 'Add');
});

test('a partly configured receiver offers only the rest', () => {
  assert.equal(addLabel(QUAD, [{ ip: '192.168.1.50', channel: 1 }]), 'Add 3 more');
});

test('a fully configured receiver says so rather than offering nothing', () => {
  const slots = [1, 2, 3, 4].map((channel) => ({ ip: '192.168.1.50', channel }));

  assert.equal(addLabel(QUAD, slots), 'Already added');
});

test('adding everything expands every receiver', () => {
  const rows = allChannelsToAdd([QUAD, SINGLE], []);

  assert.equal(rows.length, 5);
  assert.deepEqual(rows.filter((r) => r.ip === '192.168.1.50').map((r) => r.channel), [1, 2, 3, 4]);
});

test('⚠️ a receiver listed twice does not produce its channels twice', () => {
  const rows = allChannelsToAdd([QUAD, { ...QUAD }], []);

  assert.equal(rows.length, 4);
});

test('adding everything respects what is already configured', () => {
  const rows = allChannelsToAdd([QUAD, SINGLE], [{ ip: '192.168.1.51', channel: 1 }]);

  assert.deepEqual(rows.map((r) => `${r.ip}:${r.channel}`), [
    '192.168.1.50:1', '192.168.1.50:2', '192.168.1.50:3', '192.168.1.50:4',
  ]);
});

test('rubbish in does not throw', () => {
  assert.deepEqual(allChannelsToAdd(null, null), []);
  assert.deepEqual(configuredChannels(null, null), []);
});
