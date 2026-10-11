import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { batteryFraction, batteryDescription, BATTERY_UNKNOWN } from './battery-icon.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const markup = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
const view = fs.readFileSync(path.join(ROOT, 'js', 'channelview.js'), 'utf8');
const css = fs
  .readFileSync(path.join(ROOT, 'css', 'style.scss'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the fill follows the bars the board was told', () => {
  assert.equal(batteryFraction(5), 1);
  assert.equal(batteryFraction(4), 0.8);
  assert.equal(batteryFraction(3), 0.6);
  assert.equal(batteryFraction(1), 0.2);
  assert.equal(batteryFraction(0), 0);
});

test('⛔ unknown is not the same as empty', () => {
  // 255 means nothing has reported. An empty fill reads as "about to die",
  // which is the opposite of "no idea" and the more alarming of the two.
  assert.equal(batteryFraction(BATTERY_UNKNOWN), null);
  assert.equal(batteryFraction(undefined), null);
  assert.equal(batteryFraction(null), null);
  assert.equal(batteryFraction('nonsense'), null);
  assert.equal(batteryFraction(-1), null);

  // ...and 0 really is empty.
  assert.notEqual(batteryFraction(0), null);
});

test('a level above the scale does not overflow the icon', () => {
  // No receiver should send this, but one adapter mapping its own scale badly
  // would otherwise draw a fill wider than the battery.
  assert.equal(batteryFraction(9), 1);
});

test('it describes itself in bars, not invented percentages', () => {
  assert.equal(batteryDescription(4, '3:34'), 'Battery 4 of 5, 3:34 remaining');
  assert.equal(batteryDescription(4, ''), 'Battery 4 of 5');
  assert.equal(batteryDescription(BATTERY_UNKNOWN, '1:10'), 'Battery unknown, 1:10 remaining');
  assert.equal(batteryDescription(BATTERY_UNKNOWN, ''), 'Battery unknown');
});

test('the icon is in the card band, beside the time', () => {
  const band = markup.split('<div class="card-band">')[1].split('</div>')[0];
  assert.match(band, /class="batt-icon"/, 'the band needs a battery icon');
  assert.match(band, /class="runtime-text"/, 'and a place to put the time');
});

test('⛔ writing the time does not delete the icon', () => {
  // The icon lives inside the same element as the time. Setting textContent on
  // the parent -- which is what the first version did -- removes it.
  assert.match(
    view,
    /card-runtime \.runtime-text/,
    'the runtime should be written into its own span',
  );
});

test('an unknown battery shows an outline, not an empty cell', () => {
  assert.match(
    css,
    /\.card-runtime\.batt-unknown \.batt-fill\s*\{[^}]*display:\s*none/,
    'the fill should be removed when nothing has reported',
  );
  assert.match(
    css,
    /\.batt-shell,\n\.batt-cap\s*\{[^}]*stroke:\s*currentColor/,
    'the outline should remain, in the band ink',
  );
});

test('the battery takes the band ink rather than a colour of its own', () => {
  // The band already carries the status colour and the chip already carries the
  // word; a third voice saying the same thing is noise, and a red battery on an
  // amber band cannot be read at all.
  const fill = css.split('.batt-fill {')[1].split('}')[0];
  assert.match(fill, /fill:\s*currentColor/);
});
