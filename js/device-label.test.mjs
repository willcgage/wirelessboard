import test from 'node:test';
import assert from 'node:assert/strict';

import { deviceLabel } from './device-label.mjs';

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
