import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SWEEP_CONTROLS, combinations, checkContainment, checkWash,
  compareArrangements, checkBoard, formatReport,
} from './board-sweep.mjs';

/**
 * ⛔⛔ A harness that cannot fail is worse than no harness: it converts "we did
 * not look" into "we checked". Every test here plants the fault it is meant to
 * catch and asserts the check reports it — the faults being the two real ones
 * from the wall, #273 (drawn outside the card) and #274 (the status colour
 * painted twice).
 */

const box = (top, bottom, left = 0, right = 100) => ({
  top, bottom, left, right, width: right - left, height: bottom - top,
});

const card = (parts, painted = ['band'], slot = 1) => ({
  slot,
  box: box(0, 500),
  parts,
  statusPainted: painted,
});

test('the matrix is every combination of every control', () => {
  const expected = Object.values(SWEEP_CONTROLS).reduce((n, v) => n * v.length, 1);
  assert.equal(combinations().length, expected);
  assert.ok(expected > 500, `a real sweep, not a token one (${expected})`);
});

test('⭐ a narrowed sweep asks one question quickly', () => {
  // #274 is entirely "what happens under rail", and that is seconds rather
  // than an hour. A harness nobody can aim is a harness nobody runs.
  const only = combinations({ wash: ['rail'] });
  assert.ok(only.every((c) => c.wash === 'rail'));
  assert.equal(only.length, combinations().length / SWEEP_CONTROLS.wash.length);
});

test('⛔⛔ #273: a part drawn past the card\'s bottom is reported', () => {
  const clipped = card({ figures: box(480, 530) }); // 30px below a 500px card
  const found = checkContainment(clipped);
  assert.equal(found.length, 1);
  assert.equal(found[0].part, 'figures');
  assert.match(found[0].detail, /bottom by 30px/);
});

test('a part inside the card is not reported, and sub-pixel is not noise', () => {
  assert.deepEqual(checkContainment(card({ figures: box(450, 499) })), []);
  // ⚠️ Layout rounds. A harness that reports every half pixel reports nothing
  // anybody reads.
  assert.deepEqual(checkContainment(card({ figures: box(0, 500.4) })), []);
});

test('a zero-height part is skipped rather than reported', () => {
  // An element the card is not showing has no geometry worth checking, and
  // flagging it would bury the parts that are genuinely outside.
  assert.deepEqual(checkContainment(card({ role: box(0, 0) })), []);
});

test('⛔⛔ #274: the status colour painted twice is reported', () => {
  const twice = card({}, ['rail', 'card']);
  const found = checkWash(twice, 'rail');
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /\[card, rail\]/);
  assert.match(found[0].detail, /expected only \[rail\]/);
});

test('each wash has exactly one place the colour belongs', () => {
  assert.deepEqual(checkWash(card({}, ['band']), 'band'), []);
  assert.deepEqual(checkWash(card({}, ['card']), 'full'), []);
  assert.deepEqual(checkWash(card({}, ['rail']), 'rail'), []);
  // The colour in the wrong single place is still wrong.
  assert.equal(checkWash(card({}, ['band']), 'rail').length, 1);
  // And nowhere at all is a failure, not a pass.
  assert.match(checkWash(card({}, []), 'band')[0].detail, /nowhere/);
});

test('⛔ #276: two arrangements drawing different cards for the same board', () => {
  const results = [
    {
      config: { arrangement: 'fit', cardShape: 'auto', wash: 'band' }, columns: 6, rows: 2, cards: [card({})],
    },
    {
      config: { arrangement: 'grid', cardShape: 'auto', wash: 'band' },
      columns: 6,
      rows: 2,
      cards: [{ ...card({}), box: box(0, 400) }],
    },
  ];
  const found = compareArrangements(results);
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /fit: 100x500/);
  assert.match(found[0].detail, /grid: 100x400/);
});

test('⚠️ but choosing a different column count is allowed, not a fault', () => {
  // That is what an arrangement is *for*. Only disagreeing about the card at
  // the same count is an inconsistency.
  const results = [
    {
      config: { arrangement: 'fit', cardShape: 'auto', wash: 'band' }, columns: 6, rows: 2, cards: [card({})],
    },
    {
      config: { arrangement: 'row', cardShape: 'auto', wash: 'band' },
      columns: 12,
      rows: 1,
      cards: [{ ...card({}), box: box(0, 1040) }],
    },
  ];
  assert.deepEqual(compareArrangements(results), []);
});

test('⛔⛔ a board that drew nothing is a failure, not a pass', () => {
  // The quietest way for a harness to lie: a step that rendered no cards has
  // no card to find fault with, and would otherwise report clean.
  const empty = {
    config: { wash: 'band' }, columns: 0, rows: 0, cards: [],
  };
  const found = checkBoard(empty);
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /drew no cards/);
});

test('the report names the configuration, and collapses one fault across cards', () => {
  const cards = [1, 2, 3].map((slot) => card({ figures: box(480, 530) }, ['band'], slot));
  const report = formatReport([
    {
      config: { arrangement: 'row', wash: 'band' }, columns: 12, rows: 1, cards,
    },
  ]);
  assert.match(report, /1 of 1 configurations failed/);
  assert.match(report, /arrangement=row wash=band/);
  // ⚠️ Three cards clipped the same way is one fault. Printing it three times
  // buries the next one.
  assert.equal((report.match(/containment/g) || []).length, 1);
  assert.match(report, /\[3 cards\]/);
});

test('a clean sweep says so plainly', () => {
  const report = formatReport([
    {
      config: { arrangement: 'grid', wash: 'band' }, columns: 6, rows: 2, cards: [card({ figures: box(10, 20) })],
    },
  ]);
  assert.equal(report, 'all 1 configurations passed');
});

test('⛔⛔ a card with no distinguishable status colour is skipped, not guessed at', () => {
  // The first real run of this sweep reported the status colour in three
  // places at once — which read as a dramatic confirmation of #274 and was
  // entirely the detector matching neutral against neutral. `TX_COM_ERROR` and
  // `UNASSIGNED` resolve `--status` to the neutral card ground itself, and
  // `PREV_REPLACE` is a striped gradient with no flat colour. The driver
  // reports `null` for those, meaning "cannot tell".
  const cannotTell = {
    slot: 4, box: box(0, 500), parts: {}, statusPainted: null,
  };
  assert.deepEqual(checkWash(cannotTell, 'rail'), []);
  assert.deepEqual(checkWash(cannotTell, 'band'), []);
  assert.deepEqual(checkBoard({ config: { wash: 'rail' }, cards: [cannotTell] }), []);
});

test('⚠️ but an empty list still means "nowhere", which is a real answer', () => {
  // `null` is "cannot tell"; `[]` is "looked, found nothing". Collapsing the
  // two would silently stop the sweep ever reporting a missing wash.
  const lookedAndFoundNothing = {
    slot: 5, box: box(0, 500), parts: {}, statusPainted: [],
  };
  assert.equal(checkWash(lookedAndFoundNothing, 'band').length, 1);
  assert.match(checkWash(lookedAndFoundNothing, 'band')[0].detail, /nowhere/);
});
