import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCK_KINDS, isDockKind, normalizeDocks, dockById,
  positionInchesForScreen, dockChoices,
} from './docks.mjs';
import {
  dockProblem, docksHaveProblems, toPayload, mergeSaved, saveSummary,
  uniqueDockId, screensUsing,
} from './dock-editor.mjs';
import {
  minColumnPixelsForScreen, describeScreenChoice, normalizeScreens,
} from './display-geometry.mjs';

const DOCK = {
  id: 'main-dock', name: 'Main dock', kind: 'dock', position_inches: 3.9, positions: 2,
};
const PAD = {
  id: 'stage-pad', name: 'Stage left pad', kind: 'pad', position_inches: 5,
};

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

test('a dock is a bay or a pad, and the board treats them alike', () => {
  assert.deepEqual(DOCK_KINDS, ['dock', 'pad']);
  assert.ok(isDockKind('dock') && isDockKind('pad'));
  assert.ok(!isDockKind('shelf'));

  // ⛔ The kind is descriptive. Nothing in the layout branches on it — both are
  // rows of positions with a width and impose the same floor — so a pad and a
  // dock of the same width must produce the same answer.
  const screens = [{ id: 'wall', diagonal_inches: 55, dock_id: 'a' }];
  const asDock = minColumnPixelsForScreen({
    screens,
    screenId: 'wall',
    widthPx: 1920,
    heightPx: 1080,
    docks: [{
      id: 'a', name: 'A', kind: 'dock', position_inches: 4,
    }],
  });
  const asPad = minColumnPixelsForScreen({
    screens,
    screenId: 'wall',
    widthPx: 1920,
    heightPx: 1080,
    docks: [{
      id: 'a', name: 'A', kind: 'pad', position_inches: 4,
    }],
  });
  assert.equal(asDock, asPad);
});

test('⛔ an entry with no position width is dropped, not kept half-made', () => {
  // It could be chosen from a list and would then silently impose nothing,
  // which is the same trap the screen list avoids.
  const cleaned = normalizeDocks([
    DOCK,
    { id: 'no-width', name: 'Shelf' },
    { id: '', position_inches: 4 },
    { name: 'No id', position_inches: 4 },
    'not an object',
  ]);
  assert.deepEqual(cleaned.map((f) => f.id), ['main-dock']);
});

test('an unrecognised kind becomes a dock rather than losing the measurement', () => {
  const [only] = normalizeDocks([{ ...DOCK, kind: 'trolley' }]);
  assert.equal(only.kind, 'dock');
  assert.equal(only.position_inches, 3.9, 'the width is the part that matters');
});

test('the first entry wins when two share an id', () => {
  const cleaned = normalizeDocks([DOCK, { ...DOCK, name: 'Impostor' }]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].name, 'Main dock');
  assert.equal(dockById(cleaned, 'main-dock').name, 'Main dock');
});

// ---------------------------------------------------------------------------
// Resolving a screen's minimum
// ---------------------------------------------------------------------------

test('⭐ a screen takes its position width from the dock it names', () => {
  const screen = { id: 'wall', diagonal_inches: 55, dock_id: 'main-dock' };
  assert.equal(positionInchesForScreen({ screen, docks: [DOCK, PAD] }), 3.9);
  assert.equal(
    positionInchesForScreen({ screen: { ...screen, dock_id: 'stage-pad' }, docks: [DOCK, PAD] }),
    5,
  );
});

test('⛔ a board configured before #203 keeps its floor', () => {
  // The legacy branch is not dead code. Dropping it would silently widen that
  // board's columns past the dock they were measured against — and since #201
  // the number decides the column count, so it would change what the wall
  // shows, not merely how it looks.
  const legacy = { id: 'wall', diagonal_inches: 55, min_column_inches: 4.5 };
  assert.equal(positionInchesForScreen({ screen: legacy, docks: [] }), 4.5);

  assert.equal(
    minColumnPixelsForScreen({
      screens: [legacy], screenId: 'wall', widthPx: 1920, heightPx: 1080, docks: [],
    }),
    minColumnPixelsForScreen({
      screens: [legacy], screenId: 'wall', widthPx: 1920, heightPx: 1080,
    }),
    'and behaves identically whether or not a dock list is passed at all',
  );
});

test('⚠️ naming dock wins over a leftover legacy value', () => {
  // So a migrated board is never pulled back by a field nobody cleared.
  const both = {
    id: 'wall', diagonal_inches: 55, dock_id: 'main-dock', min_column_inches: 9,
  };
  assert.equal(positionInchesForScreen({ screen: both, docks: [DOCK] }), 3.9);
});

test('a screen with nothing underneath takes no minimum from anywhere', () => {
  const bare = { id: 'foh', diagonal_inches: 15 };
  assert.equal(positionInchesForScreen({ screen: bare, docks: [DOCK] }), null);
  assert.equal(positionInchesForScreen({ screen: null, docks: [DOCK] }), null);
});

test('⭐ the description names the dock, because the number alone does not say why', () => {
  const screens = [{ id: 'wall', diagonal_inches: 55, dock_id: 'main-dock' }];
  const line = describeScreenChoice({
    screens, screenId: 'wall', widthPx: 1920, heightPx: 1080, docks: [DOCK],
  });
  assert.match(line, /Main dock/);
  assert.match(line, /3\.9in position/);
});

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

test('a row needs a name and a position width', () => {
  assert.match(dockProblem({ position_inches: 3.9 }), /name/i);
  assert.match(dockProblem({ name: 'Main dock' }), /how wide/i);
  assert.equal(dockProblem({ name: 'Main dock', position_inches: 3.9 }), null);
  assert.ok(docksHaveProblems([{ name: 'Main dock' }]));
  assert.ok(!docksHaveProblems([{ name: 'Main dock', position_inches: 3.9 }]));
});

test('⛔ the width is required here even though it was optional on a screen', () => {
  // A screen with nothing underneath it is a normal thing to describe. A dock
  // with no position width is not a dock — it is an empty entry somebody could
  // choose, which would silently impose nothing.
  for (const empty of ['', null, undefined]) {
    assert.match(dockProblem({ name: 'Dock', position_inches: empty }), /how wide/i);
  }
});

test('a count of positions is optional, but junk in it is not', () => {
  assert.equal(dockProblem({ name: 'D', position_inches: 3.9, positions: '' }), null);
  assert.match(dockProblem({ name: 'D', position_inches: 3.9, positions: 'two' }), /how many/i);
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
  assert.equal(uniqueDockId('Main dock', []), 'main-dock');
  assert.equal(uniqueDockId('Main dock', ['main-dock']), 'main-dock-2');
});

test('⛔ removing dock a screen uses is not silent', () => {
  // Since #201 the position width decides the column count, so losing it
  // changes what the wall shows. A board that changed shape with no
  // explanation is the thing this project keeps paying for.
  const screens = [
    { id: 'wall', name: 'Auditorium wall', dock_id: 'main-dock' },
    { id: 'foh', name: 'FOH laptop' },
  ];
  assert.deepEqual(screensUsing('main-dock', screens), ['Auditorium wall']);
  assert.deepEqual(screensUsing('stage-pad', screens), []);
  assert.deepEqual(screensUsing('', screens), []);
});

test('the picker says what each choice means, and offers "nothing underneath"', () => {
  const choices = dockChoices([DOCK, PAD]);
  assert.equal(choices[0].value, '');
  assert.match(choices[0].label, /Nothing underneath/);
  assert.match(choices[1].label, /Charging dock/);
  assert.match(choices[1].label, /3\.9in/);
  assert.match(choices[2].label, /Pickup pad/);
});

// ---------------------------------------------------------------------------
// ⚠️ The hour this key was called `furniture`
// ---------------------------------------------------------------------------

test('⚠️ a board written while the key was `furniture` keeps its dock AND its link', () => {
  // `furniture` / `furniture_id` were these names between #203 landing and the
  // maintainer settling on "Dock". Never released, so this exists only so a
  // checkout running `main` in that window does not lose a described dock —
  // and since this width decides the column count (#201), losing one changes
  // what the wall shows.
  //
  // ⛔ Both halves or neither. Reading the list but not the reference leaves a
  // board with its docks and no link to them, which silently drops its floor —
  // a half-migration is worse than none, and that is exactly what the first
  // version of this did.
  const [screen] = normalizeScreens([{
    id: 'wall', name: 'Auditorium wall', diagonal_inches: 55, furniture_id: 'main-dock',
  }]);
  assert.equal(screen.dock_id, 'main-dock', 'the link survives the rename');

  assert.equal(
    positionInchesForScreen({ screen, docks: [DOCK] }),
    3.9,
    'and still resolves to the dock it names',
  );
});

test('the new name wins where a config somehow carries both', () => {
  const [screen] = normalizeScreens([{
    id: 'wall', diagonal_inches: 55, dock_id: 'stage-pad', furniture_id: 'main-dock',
  }]);
  assert.equal(screen.dock_id, 'stage-pad');
});
