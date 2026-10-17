import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The board says it is dark, so the browser draws its own widgets to match (D7).
 *
 * From the beta.6 field test, while adding a receiver:
 *
 *   "the text is hard to read because of Dark Mode on my system. May need to
 *    consider Dark Mode with High Contrast."
 *
 * ⛔ A `<select>`'s popup, a number spinner, a scrollbar and a date picker are
 * drawn by the BROWSER, not by this stylesheet. With no `color-scheme`
 * declared the page is treated as light-only: those render light while the
 * controls around them are styled dark and pass `color: #D7D7D7` down to the
 * `<option>`s inside — pale grey text on a white popup.
 *
 * ⚠️ Declaring it has a second effect that is easy to miss: the user agent's
 * INITIAL text colour becomes white instead of black. Anything relying on that
 * default inverts — which, before this, meant five rows of the Planning Center
 * preview that sit on a light wash. Hence the second test here.
 */

const ROOT = path.join(import.meta.dirname, '..');

const read = (file) => fs
  .readFileSync(path.join(ROOT, 'css', file), 'utf8')
  // ⚠️ Line endings first. The working tree on Windows carries CRLF, so any
  // pattern written across two lines silently matches nothing.
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const COLORS = read('colors.scss');
const STYLE = read('style.scss');

/**
 * Every `selector { ... }` leaf rule, brace-counted.
 *
 * ⛔ Not `split(selector)[1].split('}')[0]`, which stops at the first closing
 * brace — the wrong one as soon as a rule sits inside a media or container
 * query. That trap is already recorded in this project.
 */
function leafRules(css) {
  const found = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open === -1) break;

    // ⚠️ Back to the last `}` picks up an enclosing `@media (...) {` as well,
    // so an offender inside a query was reported with the prelude glued to
    // its name. Everything after the last `{` is the selector itself.
    const before = css.slice(css.lastIndexOf('}', open) + 1, open);
    const selector = before
      .slice(before.lastIndexOf('{') + 1)
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
    if (!body.includes('{')) found.push({ selector, body });
    at = open + 1;
  }
  return found;
}

/** Roughly, is this background light enough to need dark text on it? */
function isLight(value) {
  const v = String(value).trim().toLowerCase();
  if (/^(white|#fff\b|#ffffff\b)/.test(v)) return true;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})\b/);
  if (!hex) return false;
  const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}

function lightRulesWithoutInk(css) {
  return leafRules(css)
    .filter(({ body }) => {
      const bg = body.match(/background(?:-color)?:\s*([^;]+)/);
      return bg && isLight(bg[1]) && !/(^|[;\s])color:/.test(body);
    })
    .map(({ selector }) => selector.replace(/\s+/g, ' '));
}

test('⛔ the board declares that it is dark', () => {
  // Without this the browser renders its own widgets light, which is the whole
  // of D7. It belongs on `:root` because it is a fact about the document.
  assert.match(COLORS, /:root\s*\{[^}]*color-scheme:\s*dark/);
});

test('⛔ html and body state their text colour rather than inheriting it', () => {
  // `color-scheme: dark` flips the user agent's initial colour to white, so
  // anything that never said inverts. Saying it here means nothing depends on
  // that default.
  const body = leafRules(STYLE).find((r) => r.selector.includes('body'));
  assert.ok(body, 'html,body is styled');
  assert.match(body.body, /color:\s*var\(--color-white\)/);
});

test('⛔ no light background is left to the user agent for its text colour', () => {
  // The five Planning Center preview rows this caught. The file already had
  // the reason written beside one of them: "was black text on a dark red
  // wash. Set the colour outright."
  const offenders = lightRulesWithoutInk(STYLE);
  assert.deepEqual(
    offenders,
    [],
    `these sit on a light wash and never say what colour the text is: ${offenders}`,
  );
});

test('the guard can see a violation, including inside a query', () => {
  // ⛔ Plant it. A source guard that has only run against correct code is
  // worth nothing — several in this project passed on the very bug they were
  // written for.
  const planted = `
.fine td { background: #fff; color: #212529; }
@media (min-width: 40em) {
  .planted td {
    background: #d1e7dd;
  }
}
.also-dark { background: #262626; }
`;
  assert.deepEqual(
    lightRulesWithoutInk(planted),
    ['.planted td'],
    'a light wash inside a media query is still a light wash',
  );
});

test('a dark background needs no such promise', () => {
  assert.deepEqual(lightRulesWithoutInk('.a { background: #262626; }'), []);
  assert.deepEqual(lightRulesWithoutInk('.b { background: rgba(255,255,255,0.05); }'), []);
});
