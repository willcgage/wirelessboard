import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * On the card, colour means STATE. A figure is a fact, so it wears ink.
 *
 * ⛔ The frequency was painted `--color-red` and the offset `--color-green` --
 * the very tokens `.CRITICAL` and `.GOOD` paint the band with, a few hundred
 * pixels away on the same card. A channel in perfect health showed a red
 * number; a channel in trouble still showed a green one. Reported from the
 * venue as "why is the frequency red", and the honest answer was that it had
 * always been red and meant nothing by it.
 *
 * ⚠️ `--color-purple` is deliberately not in the list below. It paints no
 * status, so it tells no lie -- the rule is about colours that already mean
 * something, not about colour as such.
 */

const ROOT = path.join(import.meta.dirname, '..');

const css = fs
  .readFileSync(path.join(ROOT, 'css', 'style.scss'), 'utf8')
  // ⚠️ Line endings first. The working tree on Windows carries CRLF, so any
  // pattern written across two lines silently matches nothing.
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The tokens that already carry a meaning on this card. */
const STATUS_TOKENS = ['--color-red', '--color-green', '--color-yellow', '--color-blue'];

/**
 * Every `selector { ... }` rule whose selector mentions `needle`.
 *
 * ⛔ Not `css.split(selector)[1].split('}')[0]`. That is the shape used
 * elsewhere in these tests and it stops at the FIRST closing brace, which is
 * the wrong one as soon as a rule sits inside a media or container query --
 * the trap already written down once. This counts braces instead.
 */
function rulesMentioning(needle) {
  const found = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open === -1) break;

    const selector = css.slice(css.lastIndexOf('}', open) + 1, open)
      .replace(/^[\s\S]*?;/, '')
      .trim();

    let depth = 1;
    let i = open + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    const body = css.slice(open + 1, i - 1);

    // Only leaf rules: a block that itself contains a block is a wrapper.
    if (selector.includes(needle) && !body.includes('{')) {
      found.push({ selector, body });
    }
    at = open + 1;
  }
  return found;
}

test('the extractor finds a real rule and its body', () => {
  // ⛔ Check the tool before trusting what it reports. A guard built on an
  // extractor that silently returns nothing passes on everything.
  const rules = rulesMentioning('.drawer-figures .frequency');
  assert.equal(rules.length, 1, 'exactly one rule paints the frequency');
  assert.match(rules[0].body, /color:/, 'and the body is the declarations');
});

test('⛔ no figure on the card wears a status colour', () => {
  const offenders = [];

  rulesMentioning('.drawer-figures').forEach(({ selector, body }) => {
    STATUS_TOKENS.forEach((token) => {
      // `--color-red` is a prefix of `--color-red-dark`, which is not a status
      // fill but a stripe in `.PREV_REPLACE`. Match the token's end.
      const used = new RegExp(`var\\(\\s*${token}(?![\\w-])`).test(body);
      if (used) offenders.push(`${selector.trim()} uses ${token}`);
    });
  });

  assert.deepEqual(offenders, [], `figures must not borrow a status colour: ${offenders}`);
});

test('⭐ the status colours still mean what they meant', () => {
  // The other half of the rule: this is not "stop using colour", it is
  // "colour is spoken for". If these stop being painted, the card has lost
  // the thing the figures were borrowing from.
  const good = rulesMentioning('.GOOD');
  const critical = rulesMentioning('.CRITICAL');

  assert.ok(good.some((r) => r.body.includes('--color-green')), '.GOOD is green');
  assert.ok(critical.some((r) => r.body.includes('--color-red')), '.CRITICAL is red');
});

test('the frequency and the offset are told apart without hue', () => {
  // Removing the colours must not make two adjacent mono figures identical.
  const offset = rulesMentioning('.drawer-figures .offset');
  assert.equal(offset.length, 1);
  assert.match(offset[0].body, /font-style:\s*italic/, 'the offset keeps its own form');
});

test('⛔ the guard can see a violation, including inside a query', () => {
  // Plant it. The brace-counting matters precisely here: the naive extractor
  // stops at the first `}` and would read a nested rule as the whole block.
  const planted = `
@container (min-width: 300px) {
  .drawer-figures .frequency {
    color: var(--color-red);
  }
}
`;
  const offenders = [];
  let at = 0;
  while (at < planted.length) {
    const open = planted.indexOf('{', at);
    if (open === -1) break;
    const selector = planted.slice(planted.lastIndexOf('}', open) + 1, open).trim();
    let depth = 1;
    let i = open + 1;
    while (i < planted.length && depth > 0) {
      if (planted[i] === '{') depth += 1;
      else if (planted[i] === '}') depth -= 1;
      i += 1;
    }
    const body = planted.slice(open + 1, i - 1);
    if (selector.includes('.drawer-figures') && !body.includes('{')
        && /var\(\s*--color-red(?![\w-])/.test(body)) {
      offenders.push(selector);
    }
    at = open + 1;
  }

  assert.equal(offenders.length, 1, 'a status colour inside a container query is still a violation');
});

test('⚠️ --color-red-dark is not mistaken for --color-red', () => {
  // It is a stripe in `.PREV_REPLACE`, not a status fill, and a prefix match
  // would flag it wherever it appeared.
  assert.ok(!/var\(\s*--color-red(?![\w-])/.test('color: var(--color-red-dark);'));
  assert.ok(/var\(\s*--color-red(?![\w-])/.test('color: var(--color-red);'));
});

/**
 * ⛔⛔ #273: the bars must not paint over the figures.
 *
 * `.diversity` is `position: absolute; bottom: 0` inside `.info-drawer`, so it
 * is out of flow and reserves nothing. The drawer's bottom padding was 12px
 * against 25px of bars, so the bars covered the drawer's last row -- the
 * frequency -- on every card, in every configuration, by construction.
 * Measured on the live board as 3.6px of the glyphs underneath them.
 *
 * ⚠️ This was invisible to everything already looking. The containment check
 * compares each part to the *card*, and both were inside it; the clipping check
 * asks for `scrollWidth > clientWidth`, and nothing overflowed horizontally.
 * An out-of-flow sibling painting over a text row is a third thing, so it gets
 * its own guard -- at the level where it can be stated as a rule rather than
 * measured as a pixel.
 *
 * ⭐ The rule: wherever the bars are given a height, the drawer that contains
 * them keeps space for the same named value.
 */

/**
 * The body of the rule whose selector is EXACTLY `needle`.
 *
 * ⛔⛔ Not "the first rule that mentions it". This took the first match, and
 * the moment `.chartzone .drawer-figures { grid-area: figures }` was added
 * earlier in the stylesheet, the line-height guard below started reading that
 * rule -- which sets no line-height -- and failed on a stylesheet that was
 * perfectly correct. A guard that fails for the wrong reason is only one step
 * better than one that passes for the wrong reason: both stop telling you
 * anything.
 */
function ruleBody(needle) {
  const found = rulesMentioning(needle).find((r) => r.selector.trim() === needle);
  return found ? found.body : '';
}

test('⛔⛔ #273: the drawer keeps room for the bars that sit on top of it', () => {
  for (const body of rulesMentioning('.info-drawer').map((r) => r.body)) {
    if (!/--diversity-height\s*:/.test(body)) continue;
    // Every drawer that names a height for the bars must also reserve it --
    // except where the height is zero, which is the two modes that have
    // nothing out of flow to keep room for.
    const zero = /--diversity-height\s*:\s*0(px)?\s*;/.test(body);
    if (zero) continue;
    assert.match(
      body,
      /padding[^;]*var\(\s*--diversity-height/,
      'a drawer that sizes the bars must reserve the same value in its padding',
    );
  }
});

test('⛔ the bars read the drawer\'s named height rather than repeating a number', () => {
  // The two cannot drift apart only while neither restates the figure. A rule
  // that sets `height: 25px` on the bars and leaves the padding alone puts the
  // fault straight back.
  //
  // ⚠️ Scoped to the bars that are OUT OF FLOW, which is the whole mechanism:
  // an absolutely positioned child reserves nothing, so its height has to be
  // kept for it by hand. Rack's meter is a flex item in the drawer's own flow
  // and sizes itself -- it is not this fault and must not be dragged into it.
  const outOfFlow = rulesMentioning('.diversity')
    .filter((r) => /position\s*:\s*absolute/.test(r.body)
      || /height\s*:\s*var\(\s*--diversity-height/.test(r.body));
  assert.ok(outOfFlow.length >= 2, 'the base rule and the board\'s override are both present');
  for (const rule of outOfFlow) {
    const height = rule.body.match(/(?:^|;|\n)\s*height\s*:([^;]*)/);
    if (!height) continue;
    assert.match(
      height[1],
      /var\(\s*--diversity-height/,
      `\`${rule.selector.trim()}\` sets its own height instead of reading --diversity-height`,
    );
  }
});

test('⛔ the figure row\'s line box is taller than its own glyphs', () => {
  // `line-height: 1` puts the ink ~1.1px below the box the row is laid out in,
  // which is half of how the bars reached it. Measured on the live board.
  const body = ruleBody('.drawer-figures');
  const lh = body.match(/line-height\s*:\s*([\d.]+)/);
  assert.ok(lh, 'the figure row sets a line-height');
  assert.ok(
    Number(lh[1]) > 1,
    `line-height is ${lh[1]}; a line box the size of the font clips its own descenders`,
  );
});

/**
 * ⛔⛔ #282: the status stripe must not be laid over the drawer.
 *
 * `.electrode` — the gear panel's **Status stripe** — was `position: absolute`
 * in the same band the drawer occupies, and the drawer has been in ordinary
 * flow since #195. The stripe therefore painted over the AF value, the RF
 * value and the sparkline on every card in every arrangement, leaving only
 * the labels, so the board read `AF` and `RF` with nothing after them.
 *
 * ⚠️ It read as a colour problem and was not. A receiver with no transmitter
 * resolves `--status` to the neutral card ground, so the stripe hid the
 * numbers invisibly; only a live transmitter showed the block that gave it
 * away. That is also why 180 passing sweep configurations never saw it — the
 * wash check skips a card whose status is indistinguishable from the ground.
 */

function elinfo11Electrode() {
  return rulesMentioning('.elinfo11').find((r) => r.selector.includes('.electrode'));
}

test('⛔⛔ #282: the status stripe is in flow when the drawer is on', () => {
  const rule = elinfo11Electrode();
  assert.ok(rule, 'elinfo11 says what the stripe does');
  assert.match(rule.body, /position\s*:\s*static/, 'the stripe must take its place in the flow');
  assert.doesNotMatch(
    rule.body,
    /position\s*:\s*absolute/,
    'absolute is what laid it over the drawer in the first place',
  );
});

test('⛔ and it is a rule, not a block', () => {
  // The base rule is 125px of card. Anything near that is a block again, and a
  // block in the flow pushes the photograph out instead of covering the rows —
  // a different fault, not a fix.
  const rule = elinfo11Electrode();
  const height = rule.body.match(/height:\s*calc\(var\(--tvmode-scale\)\s*\*\s*([\d.]+)px/);
  assert.ok(height, 'the stripe states its own height in this mode');
  assert.ok(
    Number(height[1]) <= 40,
    `the stripe is ${height[1]}px of scale; a rule, not the 125px block it replaces`,
  );
});

test('⛔ the photograph reserves exactly the stripe plus the drawer', () => {
  // ⚠️ This is the drift that caused #282: the reserve said 125 + 90 while the
  // stripe and the drawer were laid out from numbers nothing related. The
  // reserve has to keep naming the parts it is made of.
  const DRAWER = 90;
  const stripe = Number(elinfo11Electrode().body
    .match(/height:\s*calc\(var\(--tvmode-scale\)\s*\*\s*([\d.]+)px/)[1]);
  const photo = rulesMentioning('.elinfo11').find((r) => r.selector.includes('.mic_name'));
  const reserve = Number(photo.body
    .match(/max-height:\s*calc\(100% - \(var\(--tvmode-scale\)\s*\*\s*([\d.]+)px/)[1]);
  assert.equal(
    reserve,
    stripe + DRAWER,
    `the photo reserves ${reserve}px but the parts under it are ${stripe} + ${DRAWER}`,
  );
});
