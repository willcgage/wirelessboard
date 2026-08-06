/**
 * "No devices found" has three different causes and one of them is fixable here.
 *
 * These are the distinctions the panel has to get right. Getting them wrong is
 * worse than the blank space it replaces: telling someone a scan found nothing
 * when it never ran, or when it had nowhere to look, sends them to the network
 * when the answer was in this panel.
 */

import test from 'node:test';
import assert from 'node:assert';

import { discoveryHint } from './discovery-hint.mjs';

const scanned = (networks, platform = 'linux') => ({
  has_scanned: true, networks, platform, found: 0, last_scan_at: 1,
});

test('nothing is said when receivers were found', () => {
  assert.equal(discoveryHint({
    scan: scanned(['10.0.0.0/24']), config: { auto: true, subnets: [] }, deviceCount: 3,
  }), null);
});

test('before the first scan it does not claim to have found nothing', () => {
  // Every board is in this state for its first few seconds, every start.
  const hint = discoveryHint({
    scan: { has_scanned: false, networks: [] }, config: { auto: true, subnets: [] }, deviceCount: 0,
  });

  assert.equal(hint.title, 'Looking for receivers…');
  assert.equal(hint.showManualHint, false);
});

test('a missing scan status is treated as not yet scanned', () => {
  const hint = discoveryHint({ scan: null, config: null, deviceCount: 0 });

  assert.equal(hint.title, 'Looking for receivers…');
});

test('scanning nowhere is its own message, not "found nothing"', () => {
  // The one an operator can fix outright. Reporting it as a failed scan would
  // send them to look at the network instead of at this panel.
  const hint = discoveryHint({
    scan: scanned([]), config: { auto: true, subnets: [] }, deviceCount: 0,
  });

  assert.equal(hint.title, 'Nothing to scan');
  assert.equal(hint.showManualHint, true);
  assert.match(hint.body.join(' '), /no manual CIDR ranges are set/);
});

test('with automatic subnets off, the message says that is why', () => {
  const hint = discoveryHint({
    scan: scanned([]), config: { auto: false, subnets: [] }, deviceCount: 0,
  });

  assert.match(hint.body.join(' '), /Automatic subnets is off/);
});

test('a completed empty scan names the networks it swept', () => {
  // The most useful thing it can say: an operator whose receivers are on
  // 10.100.50.x can see at a glance that nobody looked there.
  const hint = discoveryHint({
    scan: scanned(['192.168.1.0/24', '192.168.2.0/24']),
    config: { auto: true, subnets: [] },
    deviceCount: 0,
  });

  assert.equal(hint.title, 'No receivers found');
  assert.match(hint.body[0], /192\.168\.1\.0\/24, 192\.168\.2\.0\/24/);
  assert.match(hint.body[0], /2202/);
});

test('with no manual ranges set it explains what adding one buys', () => {
  const hint = discoveryHint({
    scan: scanned(['192.168.1.0/24']), config: { auto: true, subnets: [] }, deviceCount: 0,
  });

  assert.match(hint.body.join(' '), /add it as a manual CIDR range/);
  assert.match(hint.body.join(' '), /VLAN|blocked/);
});

test('with manual ranges already set it does not repeat the pitch', () => {
  // They have already found the feature. Telling them about it again reads as
  // not having noticed.
  const hint = discoveryHint({
    scan: scanned(['10.0.0.0/24']), config: { auto: false, subnets: ['10.0.0.0/24'] }, deviceCount: 0,
  });

  const text = hint.body.join(' ');
  assert.match(text, /Check that the ranges above cover/);
  assert.doesNotMatch(text, /add it as a manual CIDR range/);
});

test('macOS gets the Local Network note, and it is not the headline', () => {
  const hint = discoveryHint({
    scan: scanned(['10.0.0.0/24'], 'darwin'), config: { auto: true, subnets: [] }, deviceCount: 0,
  });

  assert.match(hint.body.join(' '), /Local\s*\n?\s*Network/);
  // Last, not first: having scanned the wrong range is at least as likely, and
  // leading with the permission sends people into System Settings first.
  assert.match(hint.body[hint.body.length - 1], /macOS/);
  assert.doesNotMatch(hint.body[0], /macOS/);
});

test('other platforms are not told about a macOS permission', () => {
  const hint = discoveryHint({
    scan: scanned(['10.0.0.0/24'], 'win32'), config: { auto: true, subnets: [] }, deviceCount: 0,
  });

  assert.doesNotMatch(hint.body.join(' '), /macOS/);
});

test('the platform reported by the server wins, not the browser', () => {
  // A Windows laptop looking at a macOS board must still see the macOS note --
  // the permission belongs to the machine running the service.
  const hint = discoveryHint({
    scan: scanned(['10.0.0.0/24'], 'darwin'), config: { auto: true, subnets: [] }, deviceCount: 0,
  });

  assert.match(hint.body.join(' '), /macOS/);
});
