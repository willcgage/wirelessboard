/**
 * The Help panel has to be readable (#187).
 *
 * ⛔ It carried `opacity: 0.85`, which fades the whole subtree — the text, not
 * just the surface — so the board read straight through the guide. Photographed
 * on the venue wall with card photographs, names and slot labels showing inside
 * the sentences. This is the one screen somebody reads when they do not yet
 * know how the board works, and it was the hardest screen on the board to read.
 *
 * ⚠️ The guard computes contrast from the stylesheet rather than matching a
 * string, because the thing that must stay true is "legible", not "this hex".
 * Measured on the rendered panel when this was fixed:
 *
 *     body 10.5:1 · headings 5.5:1 · link 5.9:1 · key chips 10.5:1
 *
 * ⭐ The link needed its own colour. Bootstrap's blue is **3.13:1** on this
 * panel's ground and the board's own `--color-blue` is **4.49** — failing by a
 * hair, which is still failing. Both are tuned for the near-black board behind
 * them; a light surface needs a darker step, the same finding the icon work
 * reached for a light browser tab.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

/** ⚠️ Comments stripped first — this stylesheet documents the hexes it rejects. */
const strip = (text) => text
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const css = strip(fs.readFileSync(path.join(ROOT, 'css', 'style.scss'), 'utf8'));
const colors = strip(fs.readFileSync(path.join(ROOT, 'css', 'colors.scss'), 'utf8'));

/** The text of one rule block, from its selector to the first closing brace. */
function block(selector) {
  const at = css.indexOf(selector);
  assert.ok(at > -1, `${selector} should still exist`);
  return css.slice(at + selector.length).split('}')[0];
}

function variable(name) {
  const match = colors.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(match, `${name} should be defined in colors.scss`);
  return match[1];
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const channel = (i) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('⛔ the Help panel is opaque, so the board cannot read through it', () => {
  assert.doesNotMatch(
    block('#hud {'),
    /opacity\s*:/,
    'opacity on #hud fades the text as well as the surface',
  );
});

test('⛔ the Help panel link clears 4.5:1 against the panel', () => {
  const surface = variable('--color-white');
  const link = block('#hud .hud-card a {').match(/color:\s*(#[0-9a-fA-F]{3,8})/);

  assert.ok(link, 'the link must set its own colour — the inherited blue fails here');

  const ratio = contrast(link[1], surface);
  assert.ok(
    ratio >= 4.5,
    `${link[1]} on ${surface} is ${ratio.toFixed(2)}:1, under the 4.5:1 body-text floor`,
  );
});

test('⚠️ the board palette is checked against this surface, not assumed', () => {
  // Recorded so the next person does not reach for --color-blue and find out
  // the hard way. It is a good colour on the board and not on this panel.
  const surface = variable('--color-white');

  assert.ok(
    contrast(variable('--color-blue'), surface) < 4.5,
    'if --color-blue now clears 4.5:1 here, the palette changed and this panel can use it',
  );
});
