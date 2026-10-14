import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FURNITURE_KINDS, isFurnitureKind, normalizeFurniture, furnitureById,
  positionInchesForScreen, furnitureChoices,
} from './furniture.mjs';
import {
  furnitureProblem, furnitureHasProblems, toPayload, mergeSaved, saveSummary,
  uniqueFurnitureId, screensUsing,
} from './furniture-editor.mjs';
import { minColumnPixelsForScreen, describeScreenChoice } from './display-geometry.mjs';

const DOCK = {
  id: 'main-dock', name: 'Main dock', kind: 'dock', position_inches: 3.9, positions: 2,
};
const PAD = {
  id: 'stage-pad', name: 'Stage left pad', kind: 'pad', position_inches: 5,
};

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

test('a room has two kinds of furniture, and the board treats them alike', () => {
  assert.deepEqual(FURNITURE_KINDS, ['dock', 'pad']);
  assert.ok(isFurnitureKind('dock') && isFurnitureKind('pad'));
  assert.ok(!isFurnitureKind('shelf'));

  // ⛔ The kind is descriptive. Nothing in the layout branches on it — both are
  // rows of positions with a width and impose the same floor — so a pad and a
  // dock of the same width must produce the same answer.
  const screens = [{ id: 'wall', diagonal_inches: 55, furniture_id: 'a' }];
  const asDock = minColumnPixelsForScreen({
    screens,
    screenId: 'wall',
    widthPx: 1920,
    heightPx: 1080,
    furniture: [{
      id: 'a', name: 'A', kind: 'dock', position_inches: 4,
    }],
  });
  const asPad = minColumnPixelsForScreen({
    screens,
    screenId: 'wall',
    widthPx: 1920,
    heightPx: 1080,
    furniture: [{
      id: 'a', name: 'A', kind: 'pad', position_inches: 4,
    }],
  });
  assert.equal(asDock, asPad);
});

test('⛔ an entry with no position width is dropped, not kept half-made', () => {
  // It could be chosen from a list and would then silently impose nothing,
  // which is the same trap the screen list avoids.
  const cleaned = normalizeFurniture([
    DOCK,
    { id: 'no-width', name: 'Shelf' },
    { id: '', position_inches: 4 },
    { name: 'No id', position_inches: 4 },
    'not an object',
  ]);
  assert.deepEqual(cleaned.map((f) => f.id), ['main-dock']);
});

test('an unrecognised kind becomes a dock rather than losing the measurement', () => {
  const [only] = normalizeFurniture([{ ...DOCK, kind: 'trolley' }]);
  assert.equal(only.kind, 'dock');
  assert.equal(only.position_inches, 3.9, 'the width is the part that matters');
});

test('the first entry wins when two share an id', () => {
  const cleaned = normalizeFurniture([DOCK, { ...DOCK, name: 'Impostor' }]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].name, 'Main dock');
  assert.equal(furnitureById(cleaned, 'main-dock').name, 'Main dock');
});

// ---------------------------------------------------------------------------
// Resolving a screen's minimum
// ---------------------------------------------------------------------------

test('⭐ a screen takes its position width from the furniture it names', () => {
  const screen = { id: 'wall', diagonal_inches: 55, furniture_id: 'main-dock' };
  assert.equal(positionInchesForScreen({ screen, furniture: [DOCK, PAD] }), 3.9);
  assert.equal(
    positionInchesForScreen({ screen: { ...screen, furniture_id: 'stage-pad' }, furniture: [DOCK, PAD] }),
    5,
  );
});

test('⛔ a board configured before #203 keeps its floor', () => {
  // The legacy branch is not dead code. Dropping it would silently widen that
  // board's columns past the dock they were measured against — and since #201
  // the number decides the column count, so it would change what the wall
  // shows, not merely how it looks.
  const legacy = { id: 'wall', diagonal_inches: 55, min_column_inches: 4.5 };
  assert.equal(positionInchesForScreen({ screen: legacy, furniture: [] }), 4.5);

  assert.equal(
    minColumnPixelsForScreen({
      screens: [legacy], screenId: 'wall', widthPx: 1920, heightPx: 1080, furniture: [],
    }),
    minColumnPixelsForScreen({
      screens: [legacy], screenId: 'wall', widthPx: 1920, heightPx: 1080,
    }),
    'and behaves identically whether or not a furniture list is passed at all',
  );
});

test('⚠️ naming furniture wins over a leftover legacy value', () => {
  // So a migrated board is never pulled back by a field nobody cleared.
  const both = {
    id: 'wall', diagonal_inches: 55, furniture_id: 'main-dock', min_column_inches: 9,
  };
  assert.equal(positionInchesForScreen({ screen: both, furniture: [DOCK] }), 3.9);
});

test('a screen with nothing underneath takes no minimum from anywhere', () => {
  const bare = { id: 'foh', diagonal_inches: 15 };
  assert.equal(positionInchesForScreen({ screen: bare, furniture: [DOCK] }), null);
  assert.equal(positionInchesForScreen({ screen: null, furniture: [DOCK] }), null);
});

test('⭐ the description names the furniture, because the number alone does not say why', () => {
  const screens = [{ id: 'wall', diagonal_inches: 55, furniture_id: 'main-dock' }];
  const line = describeScreenChoice({
    screens, screenId: 'wall', widthPx: 1920, heightPx: 1080, furniture: [DOCK],
  });
  assert.match(line, /Main dock/);
  assert.match(line, /3\.9in position/);
});

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

test('a row needs a name and a position width', () => {
  assert.match(furnitureProblem({ position_inches: 3.9 }), /name/i);
  assert.match(furnitureProblem({ name: 'Main dock' }), /how wide/i);
  assert.equal(furnitureProblem({ name: 'Main dock', position_inches: 3.9 }), null);
  assert.ok(furnitureHasProblems([{ name: 'Main dock' }]));
  assert.ok(!furnitureHasProblems([{ name: 'Main dock', position_inches: 3.9 }]));
});

test('⛔ the width is required here even though it was optional on a screen', () => {
  // A screen with nothing underneath it is a normal thing to describe. A dock
  // with no position width is not a dock — it is an empty entry somebody could
  // choose, which would silently impose nothing.
  for (const empty of ['', null, undefined]) {
    assert.match(furnitureProblem({ name: 'Dock', position_inches: empty }), /how wide/i);
  }
});

test('a count of positions is optional, but junk in it is not', () => {
  assert.equal(furnitureProblem({ name: 'D', position_inches: 3.9, positions: '' }), null);
  assert.match(furnitureProblem({ name: 'D', position_inches: 3.9, positions: 'two' }), /how many/i);
});

test('incomplete rows are held back, and the summary says they are still there', () => {
  const rows = [
    {
      name: 'Main dock', kind: 'dock', position_inches: 3.9, positions: 2,
    },
    { name: 'Half-typed' },
  ];
  const payload = toPayload(rows);
  assert.equal(payload.length, 1);
  assert.deepEqual(payload[0], {
    id: 'main-dock', name: 'Main dock', kind: 'dock', position_inches: 3.9, positions: 2,
  });
  assert.match(saveSummary(rows), /1 dock or pad saved/);
  assert.match(saveSummary(rows), /still here to finish/);
  assert.match(saveSummary([]), /Nothing described/);
});

test('⛔ a save never deletes the row somebody is typing into (#180)', () => {
  const typing = { name: 'Lobby', position_inches: '' };
  const rows = [{ name: 'Main dock', position_inches: 3.9 }, typing];
  const merged = mergeSaved(rows, [{ id: 'main-dock', name: 'Main dock', position_inches: 3.9 }]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[1], typing, 'the half-typed row comes back exactly as it was');
});

test('two things named the same both survive', () => {
  assert.equal(uniqueFurnitureId('Main dock', []), 'main-dock');
  assert.equal(uniqueFurnitureId('Main dock', ['main-dock']), 'main-dock-2');
});

test('⛔ removing furniture a screen uses is not silent', () => {
  // Since #201 the position width decides the column count, so losing it
  // changes what the wall shows. A board that changed shape with no
  // explanation is the thing this project keeps paying for.
  const screens = [
    { id: 'wall', name: 'Auditorium wall', furniture_id: 'main-dock' },
    { id: 'foh', name: 'FOH laptop' },
  ];
  assert.deepEqual(screensUsing('main-dock', screens), ['Auditorium wall']);
  assert.deepEqual(screensUsing('stage-pad', screens), []);
  assert.deepEqual(screensUsing('', screens), []);
});

test('the picker says what each choice means, and offers "nothing underneath"', () => {
  const choices = furnitureChoices([DOCK, PAD]);
  assert.equal(choices[0].value, '');
  assert.match(choices[0].label, /Nothing underneath/);
  assert.match(choices[1].label, /Charging dock/);
  assert.match(choices[1].label, /3\.9in/);
  assert.match(choices[2].label, /Pickup pad/);
});
