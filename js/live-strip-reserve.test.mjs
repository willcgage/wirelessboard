import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';

import { reservedStripHeight, PLACEMENTS } from './live-strip.mjs';

/**
 * ⛔⛔ The fault this pins, reported from the wall:
 *
 *   "when the service bar is on the bottom, it overlaps the information
 *    on the cards"
 *
 * `.live-strip.live-at-bottom` is `position: fixed; bottom: 0` at z-index 1020.
 * The only thing making room for it was `padding-bottom: 2.25rem` on the board,
 * which `tv-layout.js` never subtracted — so the rows were computed for the
 * full screen height and the last one ran on under the strip.
 */

test('⛔ top and bottom take height off the board', () => {
  assert.equal(reservedStripHeight('bottom', 44), 44);
  assert.equal(reservedStripHeight('top', 44), 44);
});

test('⛔⛔ `card` takes NO height — it claims a grid cell instead', () => {
  // Reserving height as well would take the space twice: `cellsForChannels`
  // already gives the strip a cell when the placement is `card`.
  assert.equal(reservedStripHeight('card', 44), 0);
});

test('`off` reserves nothing', () => {
  assert.equal(reservedStripHeight('off', 44), 0);
});

test('⚠️ an unmeasurable strip reserves nothing rather than NaN', () => {
  // `offsetHeight` is 0 for a hidden strip and the element may not exist at
  // all. Either way the board keeps its full height; a NaN here would poison
  // `availableHeight` and collapse the layout.
  for (const bad of [0, -5, NaN, null, undefined, '', 'tall', Infinity]) {
    const out = reservedStripHeight('bottom', bad);
    assert.ok(Number.isFinite(out) && out >= 0, `${bad} gave ${out}`);
    assert.equal(out, 0);
  }
});

test('every placement in the vocabulary is answered', () => {
  // A new placement must decide whether it costs height, rather than silently
  // defaulting to one of the answers.
  for (const spot of PLACEMENTS) {
    const out = reservedStripHeight(spot, 44);
    assert.ok(out === 0 || out === 44, `${spot} gave ${out}`);
  }
  // An unknown value falls back to the default placement, which is `bottom`.
  assert.equal(reservedStripHeight('nonsense', 44), 44);
});

test('⛔⛔ the id tv-layout measures is the id live-strip-view creates', () => {
  // The two files name the strip independently: one creates it, the other
  // looks it up to reserve its height. If they drift, `getElementById` returns
  // null, the reserve silently becomes 0, and the overlap comes back with
  // nothing failing — the quietest possible regression.
  const root = path.join(import.meta.dirname, '..');
  const view = fs.readFileSync(path.join(root, 'js', 'live-strip-view.js'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'js', 'tv-layout.js'), 'utf8');

  const created = view.match(/const STRIP_ID = '([^']+)'/);
  assert.ok(created, 'live-strip-view.js still declares STRIP_ID');
  assert.ok(
    layout.includes(`getElementById('${created[1]}')`),
    `tv-layout.js must look up '${created[1]}', the id live-strip-view creates`,
  );
});

/**
 * ⛔⛔ The strip and the rotation bar are both `position: fixed` and both can be
 * put at either edge, so for each edge SOMETHING has to offset one of them.
 *
 * The bottom pair had that rule. The top pair did not, and nothing failed:
 * every test here measures `reservedStripHeight`, which is about the BOARD's
 * height and knows nothing about the bar. Reported from the wall: "when you
 * move the channel bar to the top, the planning center status bar hides the
 * channel bar." Measured on the venue board with both set to Top — bar 0->28,
 * strip 0->37, `elementFromPoint` at the bar's centre returning the strip.
 *
 * ⚠️ Read off the stylesheet, because that is where the fault was. A unit test
 * of the placement helpers passed throughout.
 */
function declarationsFor(css, selector) {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return null;
  const end = css.indexOf('}', at);
  return css.slice(at + selector.length + 2, end);
}

test('⛔⛔ neither edge leaves the rotation bar pinned under the service strip', () => {
  const root = path.join(import.meta.dirname, '..');
  const css = fs.readFileSync(path.join(root, 'css', 'style.scss'), 'utf8');

  // Each entry: the body state, the edge the bar is pushed off, and the
  // selector that has to do it.
  const pairs = [
    { edge: 'bottom', selector: 'body.live-strip-bottom .rotation-bar' },
    { edge: 'top', selector: 'body.statusbar-top.live-strip-top .rotation-bar' },
  ];

  for (const { edge, selector } of pairs) {
    const block = declarationsFor(css, selector);
    assert.ok(block, `${selector} must exist, or the bar sits under the strip at the ${edge}`);
    assert.ok(
      block.includes(`${edge}:`),
      `${selector} must move the bar's own ${edge} edge`,
    );
    // ⚠️ The MEASURED height, never a constant: the strip's type scales with
    // the board, so on a television it is taller than anything hard-coded and
    // the bar lands inside it again.
    assert.ok(
      block.includes('--live-strip-height'),
      `${selector} must offset by the measured strip height, not a constant`,
    );
  }
});

test('⚠️ the top-pair rule outranks the plain statusbar-top placement', () => {
  // ⛔ `body.statusbar-top .rotation-bar` sets `top` for every top bar. The
  // pair rule has to win, and it does so by carrying one more class — not by
  // sitting later in the file, which a reorder would quietly undo.
  const root = path.join(import.meta.dirname, '..');
  const css = fs.readFileSync(path.join(root, 'css', 'style.scss'), 'utf8');

  const pair = 'body.statusbar-top.live-strip-top .rotation-bar';
  assert.ok(css.includes(`${pair} {`), 'the pair rule is still spelled this way');

  const classes = (selector) => selector.split('.').length - 1;
  assert.ok(
    classes(pair) > classes('body.statusbar-top .rotation-bar'),
    'the pair rule must carry more classes than the rule it overrides',
  );
});

test('⛔⛔ the top pair agrees on the fallback, for the board that has no measurement', () => {
  // ⛔ The first cut of this fix did not. The bar fell back to 2.5rem and the
  // board to 2.25rem, so on a client where `--live-strip-height` is never set
  // -- which is the venue board as measured -- the bar landed 4px over the
  // first row. A fix whose two halves disagree is the same shape as the bug.
  const root = path.join(import.meta.dirname, '..');
  const css = fs.readFileSync(path.join(root, 'css', 'style.scss'), 'utf8');

  const fallback = (selector) => {
    const block = declarationsFor(css, selector);
    assert.ok(block, `${selector} must exist`);
    const at = block.indexOf('--live-strip-height,');
    assert.notEqual(at, -1, `${selector} must read the measured height with a fallback`);
    return block.slice(at + '--live-strip-height,'.length, block.indexOf(')', at)).trim();
  };

  assert.equal(
    fallback('body.statusbar-top.live-strip-top .rotation-bar'),
    fallback('body.statusbar-top.live-strip-top .wirelessboard-board'),
    'the bar and the board must reserve the same height when nothing measured it',
  );
});
