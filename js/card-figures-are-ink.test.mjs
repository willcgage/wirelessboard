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
