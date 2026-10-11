import test from 'node:test';
import assert from 'node:assert/strict';

import { deviceLabel, deviceHeading } from './device-label.mjs';

test('a real channel label is shown as-is', () => {
  assert.equal(deviceLabel('MIC1 Bob Device'), 'MIC1 Bob Device');
});

test('the SLOT placeholder is blanked, not printed as a device name', () => {
  // py/channel.py seeds chan_name_raw as `SLOT <n>` until the receiver reports.
  assert.equal(deviceLabel('SLOT 5'), '');
  assert.equal(deviceLabel('SLOT 12'), '');
  assert.equal(deviceLabel('  SLOT 5  '), '');
});

test('a real device whose name merely starts with SLOT is kept', () => {
  // The server's re-patch check asks `'SLOT' not in name`; borrowing that here
  // would blank a legitimate label.
  assert.equal(deviceLabel('SLOT MACHINE'), 'SLOT MACHINE');
  assert.equal(deviceLabel('SLOTH 2'), 'SLOTH 2');
  assert.equal(deviceLabel('SLOT 5 SPARE'), 'SLOT 5 SPARE');
});

test('missing or empty input yields a blank line, never a fallback', () => {
  assert.equal(deviceLabel(undefined), '');
  assert.equal(deviceLabel(null), '');
  assert.equal(deviceLabel(''), '');
  assert.equal(deviceLabel('   '), '');
});

test('the person is never substituted for a missing device name', () => {
  // Guards the mistake this line exists to avoid: name is the person.
  assert.equal(deviceLabel({ name: 'Jane Smith', name_raw: 'MIC1' }), '');
});

// --------------------------------------------------------------------------
// The column heading (#130): which handheld or bodypack to pick up
// --------------------------------------------------------------------------

test('the heading names the equipment, not the person on it', () => {
  // ⛔ The case that prompted this: receivers are labelled "HH-1 Dave", so the
  // raw label carries both, and the board printed the person twice -- once in
  // the heading and once on the card -- while the thing somebody walking up to
  // the rack needs was buried in the middle of it.
  assert.equal(deviceHeading('HH-1', 3), 'HH-1');
  assert.equal(deviceHeading('BP-9', 9), 'BP-9');
  assert.equal(deviceHeading('IEM 1', 4), 'IEM 1');
});

test('with nothing reported, the heading falls back to the slot', () => {
  // A column with no heading at all is worse than one saying "Slot 7": the
  // slot number is on the board, and it is still true before a receiver has
  // said what its channel is called.
  assert.equal(deviceHeading('', 7), 'Slot 7');
  assert.equal(deviceHeading(null, 7), 'Slot 7');
  assert.equal(deviceHeading('SLOT 7', 7), 'Slot 7');
  assert.equal(deviceHeading(undefined, 12), 'Slot 12');
});

test('⛔ the heading never falls back to a person', () => {
  // The conflation #57 was about. There is no input to deviceHeading that can
  // produce a name, because it is never given one -- but a future edit that
  // passed `name` in should be as useless as passing nothing.
  assert.equal(deviceHeading('', null), '');
  assert.equal(deviceHeading('', 0), '');
});
