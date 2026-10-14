import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SAMPLES, pushSample, sparklinePoints, levelText,
} from './sparkline.mjs';

const markup = readFileSync(
  fileURLToPath(new URL('../demo.html', import.meta.url)),
  'utf8',
);

// ⚠️ From the column heading, not from `.mic_name`. The device name lives in
// `.chan-label` *above* the band (#206), so a slice starting at the band misses
// it — and a duplicate-check that cannot see half the card is worth nothing.
const card = markup
  .split('<div class="chan-label">')[1]
  .split('</template>')[0];

// ---------------------------------------------------------------------------
// The buffer
// ---------------------------------------------------------------------------

test('a buffer keeps the newest samples and drops the oldest', () => {
  let values = [];
  for (let i = 1; i <= 5; i += 1) {
    values = pushSample(values, i, 3);
  }
  assert.deepEqual(values, [3, 4, 5]);
});

test('⛔ a sample that is not a number never enters the buffer', () => {
  // One bad payload would otherwise put NaN in the middle of the points list,
  // which makes the whole polyline unparseable — the line would blank until the
  // buffer rolled over, which looks exactly like a channel going off air.
  let values = pushSample([], 40);
  for (const junk of [undefined, null, 'loud', NaN, {}]) {
    values = pushSample(values, junk);
  }
  assert.deepEqual(values, [40]);
});

test('pushing never mutates the array it was given', () => {
  // Two slots sharing one array is the kind of fault that only shows up on a
  // board with more than one channel in trouble.
  const original = [1, 2];
  const next = pushSample(original, 3);
  assert.deepEqual(original, [1, 2]);
  assert.deepEqual(next, [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

test('no samples draws nothing at all', () => {
  assert.equal(sparklinePoints([]), '');
  assert.equal(sparklinePoints(undefined), '');
});

test('⭐ one sample draws a flat line, not a dot', () => {
  // A polyline with a single point renders nothing, so a card that had just
  // appeared showed an empty box — which reads as "no signal" rather than "not
  // enough history yet".
  const points = sparklinePoints([50], { width: 92, height: 16 });
  const pairs = points.split(' ');
  assert.equal(pairs.length, 2, 'a flat line is two points');
  assert.equal(pairs[0].split(',')[0], '0');
  assert.equal(pairs[1].split(',')[0], '92');
  assert.equal(pairs[0].split(',')[1], pairs[1].split(',')[1], 'and it is level');
});

test('a full-scale sample sits at the top and an empty one at the bottom', () => {
  const height = 16;
  const top = sparklinePoints([100], { height }).split(',')[1].split(' ')[0];
  const bottom = sparklinePoints([0], { height }).split(',')[1].split(' ')[0];
  assert.ok(Number(top) < Number(bottom), 'SVG y grows downwards, so full scale is the smaller y');
  assert.ok(Number(top) >= 0 && Number(bottom) <= height, 'and both stay inside the box');
});

test('⛔ a line is scaled to the meter, never to its own extremes', () => {
  // Scaling each line to the range it happens to contain would make a dead
  // channel's noise look like a healthy signal, and would make two cards
  // impossible to compare at a glance.
  const quiet = sparklinePoints([10, 11, 10], { height: 16 });
  const loud = sparklinePoints([80, 81, 80], { height: 16 });
  const firstY = (s) => Number(s.split(' ')[0].split(',')[1]);
  assert.ok(firstY(quiet) > firstY(loud), 'a quiet line sits lower than a loud one');
});

test('values outside the meter are clamped into the box', () => {
  const height = 16;
  for (const value of [-40, 160]) {
    const y = Number(sparklinePoints([value], { height }).split(',')[1].split(' ')[0]);
    assert.ok(y >= 0 && y <= height, `${value} produced y=${y}, outside the box`);
  }
});

test('samples are spread across the full width in order', () => {
  const points = sparklinePoints([0, 50, 100], { width: 90, height: 16 });
  const xs = points.split(' ').map((p) => Number(p.split(',')[0]));
  assert.deepEqual(xs, [0, 45, 90]);
});

test('the buffer length is a count of samples, not of seconds', () => {
  assert.ok(Number.isInteger(SAMPLES) && SAMPLES > 1);
  const many = Array.from({ length: SAMPLES * 2 }, (_, i) => i);
  const kept = many.reduce((acc, v) => pushSample(acc, v), []);
  assert.equal(kept.length, SAMPLES);
});

// ---------------------------------------------------------------------------
// The number beside the line
// ---------------------------------------------------------------------------

test('⛔ a level reads as a percentage and never as dB', () => {
  // Both levels arrive as a percentage of full scale, folded there from four
  // different receiver encodings by set_audio_level and set_rf_level — a QLX-D
  // doubles its raw audio, an AXT-D subtracts 20, an SLX-D reports dBFS as
  // 000-120. "dB" beside the result would be wrong in the same way `Hz` was
  // wrong for the frequency (#194), and wrong differently on each receiver.
  assert.equal(levelText(42), '42%');
  assert.equal(levelText(0), '0%');
  assert.equal(levelText(99.6), '100%');
  assert.doesNotMatch(levelText(42), /dB/);
});

test('a missing level says nothing rather than NaN', () => {
  assert.equal(levelText(undefined), '');
  assert.equal(levelText(null), '');
  assert.equal(levelText('quiet'), '');
});

// ---------------------------------------------------------------------------
// ⛔ The rule, not the instance (#195)
// ---------------------------------------------------------------------------

test('⛔ no field is rendered into two places on one card', () => {
  // This is the maintainer's rule — "I don't want to have things on the board
  // that are duplicate data if we can help it" — asserted against the markup
  // rather than against the two instances that prompted it.
  //
  // ⚠️ The runtime was written to the band *and* the drawer by one function,
  // and the battery was an icon in the band *and* five bars in the drawer. Both
  // are gone; this stops either coming back, and stops a third joining them.
  // ⚠️ `mic_id` is deliberately absent: #206 removed the band's copy of the
  // device name, which was the same string the column heading already showed.
  // `device-name` is the one that remains, and it is on this list for the same
  // reason the others are.
  const classesThatMayAppearOnce = [
    'card-runtime', // the runtime, with its battery icon inside it
    'batt-icon',
    'runtime-text',
    'name', // the person
    'device-name', // the equipment, as the column heading
    'frequency',
    'offset',
    'quality',
    'powerlock',
  ];

  for (const cls of classesThatMayAppearOnce) {
    // ⚠️ Whole class tokens. A `\b${cls}\b` regex also matched `name` inside
    // `device-name`, because a hyphen is a word boundary — the guard reported a
    // duplicate that was not there, which is the failure mode that makes a
    // guard worse than useless: it cries wolf and gets relaxed.
    const matches = (card.match(/class="[^"]*"/g) || []).filter(
      (attr) => attr.slice(7, -1).trim().split(/\s+/).includes(cls),
    );
    assert.equal(
      matches.length,
      1,
      `${cls} appears ${matches.length} times on one card; it should appear once`,
    );
  }
});

test('⛔ the drawer carries no battery bars and no second runtime', () => {
  assert.ok(!card.includes('battery-bar'), 'the battery is the band icon, and only that');
  assert.ok(!card.includes('class="runtime"'), 'the runtime is in the band, and only there');
  assert.ok(!card.includes('slotgraph'), 'the framed chart is gone');
});

test('⭐ the drawer holds two signal lines, each with a value beside it', () => {
  const rows = card.match(/class="spark-row[^"]*"/g) || [];
  assert.equal(rows.length, 2, 'two signals: audio and RF, or left and right on an IEM');
  assert.equal((card.match(/<polyline/g) || []).length, 2, 'each one is a trend line');
  assert.equal((card.match(/class="spark-value"/g) || []).length, 2, 'and each has its own number');
  assert.equal((card.match(/class="spark-label"/g) || []).length, 2, 'and its own label');
});

test('⛔ the drawer is in normal flow, not positioned against the card', () => {
  // ⚠️ The whole class of fault #184 came from here: every field in the drawer
  // was `position: absolute` with its own `bottom:` offset measured from the
  // card, so a card of a different height put them wherever they landed. That
  // is how the frequency ended up underneath the name band.
  const css = readFileSync(
    fileURLToPath(new URL('../css/style.scss', import.meta.url)),
    'utf8',
  );
  const block = (selector) => {
    const at = css.indexOf(selector);
    return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
  };

  for (const selector of ['.info-drawer {', '.chartzone {', '.spark-row {', '.drawer-figures {']) {
    assert.doesNotMatch(
      block(selector),
      /position:\s*absolute/,
      `${selector} should be laid out, not positioned`,
    );
  }
});
