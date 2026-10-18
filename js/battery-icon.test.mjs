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

test('⭐ the icon sits beside the signal rows, not in the band', () => {
  // ⚠️ It was in the band under the person's name until the maintainer asked
  // for it here, pointing at the gap: the sparklines are a fixed width, so
  // everything right of them was empty card. This test changed with that
  // decision rather than drifting -- if it ever fails, the question is whether
  // the battery moved on purpose.
  const chartzone = markup.split('<div class="chartzone">')[1].split('<div class="errorzone">')[0];
  assert.match(chartzone, /class="batt-icon"/, 'the battery belongs beside the signal rows');
  assert.match(chartzone, /class="runtime-text"/, 'and the time it is a measure of goes with it');

  const band = markup.split('<div class="card-band">')[1].split('</div>')[0];
  assert.ok(
    !band.includes('class="batt-icon"'),
    'and it is not left behind in the band as well -- the board does not say a thing twice',
  );
});

test('⛔⛔ the battery has a space of its own and cannot cover the rows', () => {
  // The standing rule after #273 and #282: nothing on the card may be drawn
  // over anything else. Both of those were a part with no space of its own,
  // laid over a part that had one -- so a part arriving in the drawer has to
  // bring its own track, not be positioned into a gap by eye.
  assert.match(
    css,
    /\.chartzone\s*\{[^}]*grid-template-areas:[^;]*battery/,
    'the chartzone names a battery area',
  );
  assert.match(
    css,
    /\.chartzone \.card-runtime\s*\{[^}]*grid-area:\s*battery/,
    'and the battery is placed in it',
  );
  // ⚠️ `minmax(0, 1fr)`, never a bare `1fr`: a grid column's default minimum
  // is its content, so a wide sparkline or a long frequency would push the
  // battery off the card instead of staying inside its own track.
  assert.match(
    css,
    /\.chartzone\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    'the signal column must be allowed to shrink',
  );
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

/**
 * ⭐⭐ The battery changes colour as it empties (asked for 2026-10-18).
 *
 * ⛔ On the board's own thresholds, which live in `py/mic.py` and nowhere
 * else: 4–5 bars is GOOD, 3 is REPLACE, 0–2 is CRITICAL. The icon reads
 * `data.status`, so there is exactly one answer to "how low is low". A second
 * set of boundaries in the front end is how a board ends up amber on the card
 * and green on the icon, which is worse than no colour at all.
 */

test('⭐ the icon takes the server\'s status rather than its own thresholds', () => {
  // ⚠️ The guard that matters: the front end may not compare a battery level
  // to a threshold of its own. The boundaries live in `py/mic.py` and arrive
  // as `data.status`; a number here means a second answer has been written.
  //
  // ⚠️ Levels 0–5 only. `battery === 255` is allowed and is not a threshold:
  // 255 is the "nothing reported" sentinel, and telling it apart from a real
  // level is the front end's own business (it is why the icon has an outline
  // state at all). `[0-5]\b` cannot match the 2 in 255 — a digit follows it,
  // so there is no word boundary.
  assert.ok(
    !/battery\s*(?:<=?|>=?|={2,3})\s*[0-5]\b/.test(view),
    'the front end compares a battery level to a threshold of its own',
  );
  assert.match(view, /batt-replace[^;]*REPLACE/, 'replace follows the REPLACE status');
  assert.match(view, /batt-critical[^;]*CRITICAL/, 'critical follows the CRITICAL status');
});

test('⚠️ a PREV_ state keeps the same colour as the state it remembers', () => {
  // `PREV_REPLACE` is the same battery reading after the transmitter stopped
  // reporting — not a different level, the last level we were told. A board
  // that dropped the colour there would look as though the battery recovered.
  assert.match(view, /\(PREV_\)\?REPLACE/, 'PREV_REPLACE is still a replace');
  assert.match(view, /\(PREV_\)\?CRITICAL/, 'PREV_CRITICAL is still a critical');
});

test('⛔ only the icon takes the colour; the time stays in band ink', () => {
  // The rule that took red off the frequency: colour means STATE, and a figure
  // is a fact. A battery level is a state, so the icon may wear it — `6:42` is
  // a figure and may not.
  // ⚠️ Plain string matching, not `new RegExp` with a template literal. A
  // template literal eats the backslash before it ever reaches the RegExp, so
  // `\.` becomes `.` and `\s` becomes `s` — the guard then matches nothing and
  // fails on correct CSS. (Regex *literals* elsewhere in this file are fine;
  // it is only the template-literal form that loses them.)
  for (const state of ['batt-replace', 'batt-critical']) {
    assert.ok(
      css.includes(`.card-runtime.${state} .batt-icon {`),
      `${state} should colour the icon`,
    );
    assert.ok(
      !css.includes(`.card-runtime.${state} {`),
      `${state} must not colour the whole row, which includes the time`,
    );
  }
});

test('⛔ the flash is opt-out: no motion for anyone who asked for less', () => {
  const block = css.split('@media (prefers-reduced-motion: no-preference)')
    .find((chunk, i) => i > 0 && chunk.includes('batt-critical'));
  assert.ok(block, 'the flash sits inside a no-preference query');
  assert.match(block, /animation:\s*batt-critical-flash/);
  // ⚠️ The fill flashes, not the shell: the outline has to stay legible as a
  // battery through the swing, or at the bottom there is nothing to recognise.
  assert.match(block, /\.batt-fill\s*\{/);
  assert.ok(
    !/\.batt-shell[^}]*animation/.test(css),
    'the outline must not blink with the fill',
  );
});
