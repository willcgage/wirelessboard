import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The `Carries` field on the Receivers pane (#260).
 *
 * ⛔ The hardware never says this. A QLX-D serves a handheld or a bodypack, and
 * a bodypack is a headset on somebody's face or a pack on a guitar — the
 * receiver reports the same thing either way. So the board asks, and the
 * answer decides whether one person holding two radios is possible: a person
 * has one voice, so two voice channels is impossible while a headset plus an
 * instrument is ordinary.
 *
 * ⚠️ Markup-level on purpose. The select lives in a template that nothing else
 * tests, and a field that quietly stops being rendered takes the rule with it —
 * the board would fall back to guessing from the receiver's label and nobody
 * would be told.
 */

const ROOT = path.join(import.meta.dirname, '..');

const markup = fs
  .readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  .replace(/\r\n/g, '\n');

const template = markup
  .split('<template id="config-slot-template">')[1]
  .split('</template>')[0];

/**
 * Just the Carries select.
 *
 * ⛔ Not the whole row template. The Type select beside it also carries an
 * `<option value="">`, so a guard written against the template matched that
 * one instead and passed with the Carries blank deleted — a guard that could
 * not fail, caught by planting the deletion.
 */
const carriesSelect = template
  .split('<select class="form-control cfg-carries">')[1]
  .split('</select>')[0];

const view = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');

test('⭐ the receiver row asks what the channel carries', () => {
  assert.match(template, /class="form-control cfg-carries"/, 'the row needs the field');
  assert.match(template, />Carries</, 'and a label an operator recognises');
});

test('⛔ the four values are the four, and blank keeps the old guess', () => {
  // The stored values must not drift from `config.CARRIES_VALUES`; the labels
  // are what somebody reads, and "bodypack" alone would not distinguish the
  // two jobs a bodypack does.
  for (const value of ['handheld', 'headset', 'instrument', 'iem']) {
    assert.ok(
      carriesSelect.includes(`value="${value}"`),
      `the row should offer ${value}`,
    );
  }
  // ⚠️ Blank is a real choice and has to stay: it means "work it out from the
  // label", which is what every board did before this field existed. Without
  // it an upgrade would silently change behaviour on every slot.
  assert.match(carriesSelect, /<option value="">/, 'blank must remain an option');
});

test('⛔ a headset and an instrument are offered separately', () => {
  // The whole point. If these collapse into one "bodypack" option, the board
  // is back to being unable to tell two headsets from a headset and a guitar.
  assert.match(carriesSelect, /value="headset"[^>]*>[^<]*Headset/i);
  assert.match(carriesSelect, /value="instrument"[^>]*>[^<]*Instrument/i);
});

test('⚠️ the value is sent only when the field is on the page', () => {
  // Same rule as `extended_id` beside it: config_mix keeps what is stored when
  // the key is absent, so a surface without the field cannot blank it.
  assert.match(
    view,
    /const carriesField = [^\n]*\.cfg-carries[^\n]*\n\s*if \(carriesField\) \{/,
    'the payload should guard on the field being present',
  );
});

test('⚠️ and the editor shows what is stored', () => {
  assert.match(view, /carriesEl\.value = slot\.carries \|\| ''/);
});
