import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCK_KINDS, isDockKind, dockKind, normalizeDocks, dockById,
  positionInchesForScreen, dockChoices,
  screenDocks, dockPositionsForScreen, describeScreenDocks, screenNamesDock,
} from './docks.mjs';
import {
  dockProblem, docksHaveProblems, toPayload, mergeSaved, saveSummary,
  uniqueDockId, screensUsing,
} from './dock-editor.mjs';
import {
  minColumnPixelsForScreen, describeScreenChoice, normalizeScreens,
} from './display-geometry.mjs';

const DOCK = {
  id: 'main-dock', name: 'Main dock', kind: 'charging', position_inches: 3.9, positions: 2,
};
// A dock that charges nothing -- what used to be stored as a `pad`. The id is
// left as it was so the legacy-reading tests below exercise a realistic row.
const PAD = {
  id: 'stage-table', name: 'Stage left table', kind: 'noncharging', position_inches: 5,
};

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

test('⛔ everything underneath a screen is a dock, and the board treats them alike', () => {
  assert.deepEqual(DOCK_KINDS, ['charging', 'networked', 'noncharging']);
  assert.ok(isDockKind('charging') && isDockKind('networked') && isDockKind('noncharging'));
  assert.ok(!isDockKind('shelf'));

  // ⛔ The split this replaced is gone: "pad" named the absence of charging as
  // a different kind of object. These are no longer kinds this version writes.
  assert.ok(!isDockKind('dock'));
  assert.ok(!isDockKind('pad'));

  // ⛔ The kind is descriptive. Nothing in the layout branches on it — every
  // entry is a row of positions with a width and imposes the same floor — so
  // docks of the same width must produce the same answer whatever they do.
  const screens = [{ id: 'wall', diagonal_inches: 55, dock_id: 'a' }];
  const forKind = (kind) => minColumnPixelsForScreen({
    screens,
    screenId: 'wall',
    widthPx: 1920,
    heightPx: 1080,
    docks: [{
      id: 'a', name: 'A', kind, position_inches: 4,
    }],
  });
  assert.equal(forKind('charging'), forKind('noncharging'));
  assert.equal(forKind('charging'), forKind('networked'));
});

test('⛔ the two kinds this replaced are read, and never confused with each other', () => {
  // A stored `dock` was LABELLED "Charging dock"; a stored `pad` was a place
  // where nothing charges. Collapsing both one way would tell an operator
  // their dock charges when it does not, or the reverse — and since nothing
  // branches on the kind, that label is the only record of it.
  assert.equal(dockKind('dock'), 'charging');
  assert.equal(dockKind('pad'), 'noncharging');

  // Current values pass through, and junk defaults the way the old code did.
  assert.equal(dockKind('networked'), 'networked');
  assert.equal(dockKind('noncharging'), 'noncharging');
  assert.equal(dockKind('shelf'), 'charging');
  assert.equal(dockKind(''), 'charging');
  assert.equal(dockKind(undefined), 'charging');
  assert.equal(dockKind(null), 'charging');
  assert.equal(dockKind(7), 'charging');

  // ⛔ A board that described its docks before this change keeps them, with
  // the same meaning, through a normalise — which is what runs on every save.
  const migrated = normalizeDocks([
    {
      id: 'a', name: 'Rack', kind: 'dock', position_inches: 3.9,
    },
    {
      id: 'b', name: 'Table', kind: 'pad', position_inches: 5,
    },
  ]);
  assert.deepEqual(migrated.map((d) => d.kind), ['charging', 'noncharging']);
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

test('an unrecognised kind becomes a charging dock rather than losing the measurement', () => {
  const [only] = normalizeDocks([{ ...DOCK, kind: 'trolley' }]);
  assert.equal(only.kind, 'charging');
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
    positionInchesForScreen({ screen: { ...screen, dock_id: 'stage-table' }, docks: [DOCK, PAD] }),
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
      name: 'Main dock', kind: 'charging', position_inches: 3.9, positions: 2,
    },
    { name: 'Half-typed' },
  ];
  const payload = toPayload(rows);
  assert.equal(payload.length, 1);
  assert.deepEqual(payload[0], {
    id: 'main-dock', name: 'Main dock', kind: 'charging', position_inches: 3.9, positions: 2,
  });
  assert.match(saveSummary(rows), /1 dock saved/);
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
  assert.deepEqual(screensUsing('stage-table', screens), []);
  assert.deepEqual(screensUsing('', screens), []);
});

test('the picker says what each choice means, and offers "nothing underneath"', () => {
  const choices = dockChoices([DOCK, PAD]);
  assert.equal(choices[0].value, '');
  assert.match(choices[0].label, /Nothing underneath/);
  assert.match(choices[1].label, /Charging dock/);
  assert.match(choices[1].label, /3\.9in/);
  assert.match(choices[2].label, /Non-charging dock/);
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
  assert.deepEqual(screen.dock_ids, ['main-dock'], 'the link survives the rename');

  assert.equal(
    positionInchesForScreen({ screen, docks: [DOCK] }),
    3.9,
    'and still resolves to the dock it names',
  );
});

test('the new name wins where a config somehow carries both', () => {
  // ⛔ ONE dock, not two. `furniture_id` is the old NAME for `dock_id`, so a
  // board carrying both describes one dock under that screen -- reading them
  // as a pair would give it two docks where it has one, and (since A3 sums
  // their positions) a column count twice what the room has places for.
  const [screen] = normalizeScreens([{
    id: 'wall', diagonal_inches: 55, dock_id: 'stage-table', furniture_id: 'main-dock',
  }]);
  assert.deepEqual(screen.dock_ids, ['stage-table']);
});

/**
 * Several docks under one screen (A3).
 *
 * ⛔ A screen named exactly one, which the field test reported as the plain
 * limit it is: "I can only choose 1 dock under a screen right now; however, I
 * have 11 under the Green Room Screen I am testing and using in production
 * now." Eleven units in a row is the ordinary case.
 */

const RUN = {
  id: 'green-room',
  name: 'Green Room run',
  kind: 'charging',
  position_inches: 3.9,
  positions: 11,
};
const TABLE = {
  id: 'side-table',
  name: 'Side table',
  kind: 'noncharging',
  position_inches: 2,
  positions: 3,
};
const UNCOUNTED = {
  id: 'unknown', name: 'Unknown run', kind: 'charging', position_inches: 3.9,
};
const ALL = [RUN, TABLE, UNCOUNTED];

test('⛔ a screen can have several docks underneath', () => {
  const under = screenDocks({ screen: { dock_ids: ['green-room', 'side-table'] }, docks: ALL });
  assert.deepEqual(under.map((d) => d.id), ['green-room', 'side-table']);
});

test('the order the screen names them in is kept', () => {
  // Left to right on the table.
  const under = screenDocks({ screen: { dock_ids: ['side-table', 'green-room'] }, docks: ALL });
  assert.deepEqual(under.map((d) => d.id), ['side-table', 'green-room']);
});

test('a dock named twice is counted once', () => {
  // ⚠️ Summing a repeat would hand the board more columns than the room has
  // places.
  const under = screenDocks({ screen: { dock_ids: ['green-room', 'green-room'] }, docks: ALL });
  assert.equal(under.length, 1);
});

test('a dock that is not described is not underneath anything', () => {
  assert.deepEqual(screenDocks({ screen: { dock_ids: ['ghost'] }, docks: ALL }), []);
});

test('the single-dock shape still resolves', () => {
  const under = screenDocks({ screen: { dock_id: 'green-room' }, docks: ALL });
  assert.deepEqual(under.map((d) => d.id), ['green-room']);
});

test('⭐ the floor is the WIDEST position underneath', () => {
  // A minimum, not an alignment guarantee: a column narrower than any position
  // below it stops pointing at that position, so the widest has to fit. Mixed
  // widths cannot all line up in a uniform grid and this does not pretend so.
  assert.equal(
    positionInchesForScreen({ screen: { dock_ids: ['side-table', 'green-room'] }, docks: ALL }),
    3.9,
  );
});

test('⭐ the places under a screen are all its docks added up', () => {
  assert.equal(dockPositionsForScreen({ screen: { dock_ids: ['green-room'] }, docks: ALL }), 11);
  assert.equal(dockPositionsForScreen({ screen: { dock_ids: ['green-room', 'side-table'] }, docks: ALL }), 14);
});

test('⛔ no count at all unless every dock underneath says', () => {
  // `positions` was optional and read by nothing until A3, so almost no board
  // declares it. A count built from half the furniture is worse than none,
  // because nothing on screen would say which half.
  assert.equal(
    dockPositionsForScreen({ screen: { dock_ids: ['green-room', 'unknown'] }, docks: ALL }),
    null,
  );
  assert.equal(dockPositionsForScreen({ screen: {}, docks: ALL }), null);
});

test('the reading says what the board will take from the row', () => {
  const say = (screen) => describeScreenDocks(screen, ALL);

  assert.match(say({ dock_ids: ['green-room'] }), /11 places/);
  assert.match(say({ dock_ids: ['green-room'] }), /at least 3\.9in/);
  assert.match(say({ dock_ids: ['green-room', 'side-table'] }), /2 docks/);

  // ⚠️ Names the dock that did not say, rather than quietly summing the rest.
  const partial = say({ dock_ids: ['green-room', 'unknown'] });
  assert.match(partial, /Unknown run/);
  assert.doesNotMatch(partial, /11 places/);

  assert.match(say({}), /no minimum/);
  assert.match(say({ min_column_inches: 4.5 }), /4\.5in from before/);
});

test('screenNamesDock answers for a dock that is being removed', () => {
  // ⚠️ The editor asks while a dock is going away, so it may already be gone
  // from the list — `screenDocks` would drop it and the screen would look
  // innocent.
  assert.equal(screenNamesDock({ dock_ids: ['green-room'] }, 'green-room'), true);
  assert.equal(screenNamesDock({ dock_id: 'green-room' }, 'green-room'), true);
  assert.equal(screenNamesDock({ furniture_id: 'green-room' }, 'green-room'), true);
  assert.equal(screenNamesDock({ dock_ids: ['other'] }, 'green-room'), false);
  assert.equal(screenNamesDock(null, 'green-room'), false);
  assert.equal(screenNamesDock({ dock_ids: ['green-room'] }, ''), false);
});
