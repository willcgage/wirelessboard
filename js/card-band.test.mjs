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

test('⛔ the chip and the band do not share an edge', () => {
  // This was a special case: with the band at the top the chip sat on it and
  // covered the name, so `.text-top` carried a rule purely to undo a collision
  // the option created. The option is gone (#130) and so is the rule -- the
  // band is at the bottom, the chip is at the top, and nothing has to move.
  assert.ok(!css.includes('text-top'), 'the top variant and its special cases should be gone');
  assert.match(
    block('&.text-bottom .mic_name {'),
    /align-content:\s*end/,
    'the band gathers at the bottom',
  );
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

/**
 * Desk mode's card is the name box with the info drawer beneath it (#181).
 *
 * ⛔ The drawer is full width, so the box above it has to be too. Measured on a
 * board at 1600 and 1920, in all four arrangements, it came out 55-64px short
 * of the card while the drawer matched — the two shared a left edge and
 * disagreed on the right, which is what reads as overlapping rectangles in a
 * photograph of the wall.
 *
 * ⚠️ The drawer's own contents are absolutely positioned against `.col-sm`
 * with `bottom:` offsets, inherited from micboard. That part measured sound and
 * is deliberately not touched here.
 */
test('⛔ the desk-mode card is one box, not two of different widths', () => {
  // ⚠️ `block()` stops at the first `}`, which inside a nested SCSS block is an
  // inner rule rather than the end of `.deskmode`. Slice from `.deskmode {` and
  // take the `.mic_name` rule that follows it.
  const deskStart = css.indexOf('.deskmode {');
  assert.ok(deskStart > -1, 'desk mode should still have a block of its own');

  const afterDesk = css.slice(deskStart);
  const micStart = afterDesk.indexOf('.mic_name {');
  assert.ok(micStart > -1, 'desk mode should still style .mic_name');

  const micName = afterDesk.slice(micStart).split('}')[0];
  assert.match(
    micName,
    /width:\s*100%/,
    'the name box must fill the card, or it disagrees with the drawer below it',
  );
});

/**
 * The info drawer's reserved space has to survive flex layout (#184).
 *
 * ⛔ `.tvmode .mic_name` is `flex: 1 1 auto`. On a flex item `flex-grow` beats
 * `height`, so the `elinfo` reserves were written as `height` and silently did
 * nothing: the band grew to the card's bottom and sat on top of the drawer that
 * lives there — the frequency, the chart and the battery bars are all
 * absolutely positioned against `.col-sm` with `bottom:` offsets.
 *
 * Measured on a simulated 152×1040 card with the real computed metrics
 * (`--tvmode-scale: 0.2289`): the name overlapped the frequency by **32px**.
 * With `max-height` it clears it by 37px and the box lands on its intended
 * 954px. `max-height` constrains a flex item; `height` does not.
 */
test('⛔ the drawer reserve uses max-height, which flex-grow cannot eat', () => {
  ['elinfo01', 'elinfo10', 'elinfo11'].forEach((mode) => {
    const rule = block(`.${mode} .col-sm .mic_name {`);

    assert.ok(rule, `${mode} should still reserve space for its drawer`);
    assert.match(
      rule,
      /max-height:\s*calc\(100% - \(var\(--tvmode-scale\)/,
      `${mode} must reserve with max-height — plain height loses to flex-grow`,
    );
    assert.doesNotMatch(
      rule,
      /(^|[;\s])height:\s*calc/,
      `${mode} must not use plain height, which flex-grow overrides`,
    );
  });
});

test('⚠️ the drawer rules select a class, not an element type', () => {
  // `.elinfo11 .col-sm info-drawer` matched nothing for a long time and worked
  // only because a div defaults to display:block.
  assert.doesNotMatch(
    css,
    /\.col-sm\s+info-drawer/,
    'a missing leading dot makes the rule dead',
  );
});

/**
 * The frequency is in megahertz (#194).
 *
 * ⛔ `py/channel.py` `set_frequency` turns the receiver's `528850` into
 * `528.850`, and `js/demodata.js` generates 474-597 — the UHF band these
 * systems work in. The card printed a bare `Hz`, which is wrong by six orders
 * of magnitude and shipped on every card in every photograph of the wall.
 *
 * ⚠️ Pinned here because a unit is exactly the kind of thing that reads fine in
 * review and is only wrong against the physical world.
 */
test('⛔ the frequency reads MHz, because that is what it is', () => {
  assert.match(
    view,
    /\$\{data\.frequency\} MHz/,
    'the card must state megahertz',
  );
  assert.doesNotMatch(
    view,
    /\$\{data\.frequency\} Hz/,
    'a bare Hz is off by a factor of a million',
  );
});

/**
 * `rail` is a third wash, not a second card (#193).
 *
 * ⛔ The whole argument for this being cheap is that band and rail are the same
 * card differing in one place. If these ever need a second set of layout rules
 * — their own grid, their own tiers — that is the signal to stop: the card has
 * shipped wrong three times, and two layouts triples that exposure.
 */
test('⛔ the edge rail carries the status colour, and the band goes neutral', () => {
  const rail = block('&.wash-rail .mic_name {');
  assert.match(rail, /&::before/, 'the rail is drawn as a pseudo-element on .mic_name');

  // ⛔ Inside .mic_name because that is where `--status` is set — updateStatus
  // writes the status class onto that element, not onto .col-sm.
  assert.match(rail, /background:\s*var\(--status/, 'and it takes its colour from --status');

  const band = block('&.wash-rail .mic_name .card-band {');
  assert.doesNotMatch(band, /var\(--status/, 'the band must not also carry the colour');
  assert.match(band, /padding-left/, 'and must stand clear of the rail');
});

/**
 * ⛔ The shed order, and the never-shed list (#193/#195).
 *
 * As the card narrows:
 *
 *     above 190px   everything shows
 *     190px         the position goes; the runtime takes a full centred row
 *     120px         the runtime digits go; the battery icon stays
 *
 * What never gives way at any width: the photograph, the person's name, the
 * device name, the status chip, and **the battery icon** — the battery is why
 * somebody walks to the rack.
 *
 * ⚠️ An earlier version of this comment, and of #193/#195, said the order was
 * "frequency, then the status word, then the position". That was never true of
 * the code and has been corrected on the issues:
 *
 *   - the **frequency** lives in the info drawer, not the band, so it is
 *     governed by the `elinfo` setting and never sheds by width at all;
 *   - the **status word** has no rule hiding it at any width, and should not —
 *     dropping it would leave colour and a glyph, and the chip exists precisely
 *     because colour alone is not enough.
 *
 * ⚠️ One order for every wash. Defined per-wash they drift apart, which is the
 * specific failure the rail was designed to avoid.
 */
test('⛔ the battery icon survives the narrowest tier; only the digits go', () => {
  const narrowest = block('@container (max-width: 120px) {');

  assert.match(
    narrowest,
    /\.card-runtime \.runtime-text\s*\{[^}]*display:\s*none/,
    'the runtime digits are what give way at this width',
  );
  assert.doesNotMatch(
    narrowest,
    /\.card-runtime\s*\{[^}]*display:\s*none/,
    'hiding .card-runtime takes the battery icon with it — it is on the never-shed list',
  );
});

test('⛔ the device name is not shed at any width', () => {
  // It reads across the row so the headings line up with the rack (#130), and
  // it is the one thing somebody walking to the rack needs.
  for (const tier of ['@container (max-width: 190px) {', '@container (max-width: 120px) {']) {
    assert.doesNotMatch(
      block(tier),
      /device-name\s*\{[^}]*display:\s*none/,
      `${tier} must not hide the device name`,
    );
  }
});

/**
 * ⛔ The status word is not a width casualty.
 *
 * "Status is never colour alone" is the oldest rule on this card — red and
 * amber are the two states that matter most and the two hardest to tell apart
 * over a photograph. A glyph plus a word is how that is kept. Shedding the word
 * at a narrow width would leave colour and a glyph at exactly the size where
 * the glyph is hardest to read.
 *
 * ⚠️ The card mockups for #193 drew a status *dot* at 155px. That was never
 * built, and on this reasoning it should not be.
 */
test('⛔ no width tier hides the status word', () => {
  for (const tier of ['@container (max-width: 190px) {', '@container (max-width: 120px) {']) {
    assert.doesNotMatch(
      block(tier),
      /chip-word\s*\{[^}]*display:\s*none/,
      `${tier} must not drop the status word — colour and a glyph is not enough`,
    );
  }
});
