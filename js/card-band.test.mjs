/**
 * The card's text sits in a band, and the band carries the status colour (#130).
 *
 * ⛔ CSS-level on purpose, like the #110 guard. Every failure this card design
 * has had was visual — text over a face, a scrim pointing the wrong way, a
 * photo shrunk to make room — and a test that only read the markup would have
 * passed on every one of them.
 *
 * ⚠️ Comments are stripped before any negative assertion: this stylesheet
 * documents the rules it must not contain, and will otherwise match its own
 * explanation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

const markup = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
const view = fs.readFileSync(path.join(ROOT, 'js', 'channelview.js'), 'utf8');
const css = fs
  .readFileSync(path.join(ROOT, 'css', 'style.scss'), 'utf8')
  // ⚠️ Line endings first. The working tree on Windows carries CRLF, so any
  // pattern written across two lines silently matches nothing.
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const block = (selector) => {
  const after = css.split(selector)[1];
  return after ? after.split('}')[0] : '';
};

// ⚠️ `.mic_name .slot-media.is-active::after` is a substring of the wash-band
// override's own selector, so a plain split finds the override first. Take
// every matching block and let the caller say which one it meant.
const blocks = (selector) => css.split(selector).slice(1).map((chunk) => chunk.split('}')[0]);

// The card markup alone, bounded by a marker that is not inside it, with
// comments stripped — one of them mentions the device name it must not contain.
const cardMarkup = markup
  .split('<div class="mic_name">')[1]
  .split('<div class="electrode">')[0]
  .replace(/<!--[\s\S]*?-->/g, '');

test('the card has a band, and the text lives inside it', () => {
  assert.match(cardMarkup, /class="card-band"/, 'the card needs a band to put text in');
  for (const line of ['class="name"', 'class="mic_id"', 'class="card-runtime"']) {
    assert.ok(cardMarkup.includes(line), `${line} should be inside the card`);
  }
});

test('the band carries the status colour, so the photo does not have to', () => {
  const band = block('&.wash-band .mic_name .card-band {');
  assert.match(band, /background:\s*var\(--status/, 'the band should take the status colour');
  assert.match(band, /color:\s*var\(--status-ink/, 'and an ink colour chosen against it');
});

test('every status publishes a colour the band can use', () => {
  // The band cannot inherit a background, so each status hands its colour over
  // as a custom property. A status that forgets would render a black band and
  // look like a bug in the data rather than in the stylesheet.
  for (const status of ['.GOOD', '.REPLACE', '.CRITICAL, .PREV_CRITICAL', '.RX_COM_ERROR']) {
    assert.match(
      block(`${status} {`) || block(`${status}{`),
      /--status:/,
      `${status} should publish --status`,
    );
  }
});

test('⛔ with the band on, nothing dims the photograph', () => {
  // The scrim exists to make text readable over a picture. Once the text has an
  // opaque band of its own, a scrim would be dimming the photo for no reason —
  // which is the thing this whole redesign is for.
  const scrim = block('&.wash-band .mic_name .slot-media.is-active::after {');
  assert.match(scrim, /opacity:\s*0\b/, 'the band should switch the scrim off');
});

test('the full-card wash keeps the board that exists today', () => {
  // W has to be a real comparison on the wall, which means `full` must not be a
  // half-built version of the old look.
  assert.match(
    block('&.wash-full .mic_name .card-band {'),
    /background:\s*transparent/,
    'the full wash should let the card colour through, not paint a band over it',
  );
  const scrims = blocks('.mic_name .slot-media.is-active::after {');
  assert.ok(
    scrims.some((rule) => /opacity:\s*0\.\d+/.test(rule)),
    'the scrim should still be there for the full wash to use',
  );
});

test('⛔ the band overlays the photo and never shrinks it', () => {
  // 1.14.0 shrank the picture to make room for text and lost about a third of
  // every face. The media layer must stay inset: 0 -- the band is drawn over
  // it, which costs the bottom of the frame and nothing else.
  assert.match(
    block('.mic_name .slot-media {'),
    /inset:\s*0/,
    'the photo should still fill the card',
  );
});

test('⛔ the heading names the equipment, not the person', () => {
  // The board carries the person's name on the card. A heading taken from the
  // raw channel label ("HH-1 Dave") printed it a second time and buried the one
  // thing the heading is for: which handheld or bodypack to pick up.
  assert.match(view, /deviceHeading\(/, 'the heading should use the equipment id');
  assert.ok(
    !/device-name'\)[\s\S]{0,200}deviceLabel\(/.test(view),
    'the heading must not be built from the raw channel label any more',
  );
  assert.match(view, /data\.device_id/, 'and the id has to come from the server, not be re-parsed here');
});

test('the device name became a column header', () => {
  assert.match(markup, /class="chan-label"/, 'the column needs a label row');
  const label = markup.split('<div class="chan-label">')[1].split('</div>')[0];
  assert.match(label, /class="device-name"/, 'the device name belongs in the label row');

  assert.ok(
    !cardMarkup.includes('device-name'),
    'the device name should no longer be repeated inside the card',
  );
});

test('⛔ status is never colour alone', () => {
  assert.match(markup, /class="chip-glyph"/, 'the chip needs a glyph');
  assert.match(markup, /class="chip-word"/, 'the chip needs a word');

  // Every state that is worth crossing a room for carries both.
  for (const status of ['REPLACE', 'CRITICAL', 'RX_COM_ERROR']) {
    const entry = view.split(`${status}:`)[1].split('\n')[0];
    assert.match(entry, /glyph:/, `${status} needs a glyph`);
    assert.match(entry, /word:/, `${status} needs a word`);
  }
});

test('⛔ the chip keeps its corner, whichever edge the band takes', () => {
  // Found by looking at the board, not by reasoning about it: with the band at
  // the top the chip sat on top of it and covered the name.
  const moved = block('&.text-top .mic_name .status-chip {');
  assert.match(moved, /top:\s*auto/, 'the chip must give up the top when the band is there');
  assert.match(moved, /bottom:/, 'and take the other edge');
});

test('⛔ nothing quietly un-positions the chip', () => {
  // The chip is absolute; a later rule of equal specificity made it relative,
  // which dropped it out of the corner and into the grid below the band. The
  // exclusion is what keeps it out.
  assert.match(
    css,
    /\.mic_name > :not\(\.slot-media\):not\(\.status-chip\)/,
    'the blanket child rule has to exclude the chip, or it outranks it on source order',
  );
});

test('a narrow card drops the tags it has no room for', () => {
  // The operator chose how many channels to see (#112); the card works out what
  // fits. Without this a 126px card wrapped "Teaching" into "Teac / hing".
  assert.match(css, /@container \(max-width: 190px\)/, 'there should be a narrow tier');
  assert.match(css, /@container \(max-width: 120px\)/, 'and a narrower one');
  assert.match(
    block('.col-sm {\n    container-type'),
    /inline-size/,
    'the column has to be a container for those queries to ask',
  );

  const tagRules = block('.mic_name .mic_id,\n  .mic_name .card-runtime {');
  assert.match(tagRules, /white-space:\s*nowrap/, 'tags should not wrap mid-word');
  assert.match(tagRules, /text-overflow:\s*ellipsis/, 'they should trail off instead');
});

test('a healthy channel wears no badge', () => {
  // A chip on every card is a row of badges saying nothing, and the quiet state
  // is the one the board is in most of the time.
  const good = view.split('GOOD:')[1].split('\n')[0];
  assert.match(good, /null/, 'a good channel should have no chip');
  assert.match(
    block('.mic_name .status-chip:empty,'),
    /display:\s*none/,
    'an empty chip should take no space',
  );
});
