/**
 * The screen list editor (#170).
 *
 * ⛔ The rule worth protecting here: a half-filled row is never saved as though
 * it were complete. A screen in the list can be picked by a board, and one with
 * no size would impose no minimum while looking like it does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  screenId, uniqueScreenId, screenProblem, screensHaveProblems, toPayload, saveCounts,
  pairRows, mergeSaved,
} from './screens-editor.mjs';

const WALL = { name: 'Auditorium wall', diagonal_inches: 55, min_column_inches: 4.5 };

test('an id comes from the name, and is safe to put in a list', () => {
  assert.equal(screenId('Auditorium wall'), 'auditorium-wall');
  assert.equal(screenId('  Youth Room (TV) '), 'youth-room-tv');
  assert.equal(screenId(''), '');
});

test('two screens named the same still both exist', () => {
  assert.equal(uniqueScreenId('Wall', []), 'wall');
  assert.equal(uniqueScreenId('Wall', ['wall']), 'wall-2');
  assert.equal(uniqueScreenId('Wall', ['wall', 'wall-2']), 'wall-3');
  assert.equal(uniqueScreenId('', []), 'screen', 'a nameless row still gets an id');
});

test('a complete screen has nothing wrong with it', () => {
  assert.equal(screenProblem(WALL), null);
});

test('⛔ a screen with no size is refused', () => {
  // It could be picked from the list and would then silently impose nothing.
  assert.match(screenProblem({ name: 'Wall' }), /How big is it/);
  assert.match(screenProblem({ name: 'Wall', diagonal_inches: 0 }), /How big/);
  assert.match(screenProblem({ name: 'Wall', diagonal_inches: 'big' }), /How big/);
});

test('a screen with no name is refused', () => {
  assert.match(screenProblem({ diagonal_inches: 55 }), /Give the screen a name/);
  assert.match(screenProblem({ name: '   ', diagonal_inches: 55 }), /name/);
});

test('⭐ the dock width is optional, because some screens have no dock', () => {
  // The laptop at front of house is a real screen with nothing underneath it.
  for (const empty of ['', null, undefined]) {
    assert.equal(screenProblem({ name: 'FOH', diagonal_inches: 15, min_column_inches: empty }), null);
  }
});

test('⚠️ but junk in it is not, because that reads as a measurement', () => {
  assert.match(
    screenProblem({ name: 'Wall', diagonal_inches: 55, min_column_inches: 'wide' }),
    /has to be a measurement, or empty/,
  );
});

test('the payload keeps the complete rows and drops the rest', () => {
  const payload = toPayload([WALL, { name: 'Broken' }, { name: 'FOH', diagonal_inches: 15 }]);

  assert.deepEqual(payload.map((s) => s.id), ['auditorium-wall', 'foh']);
  assert.equal(payload[0].min_column_inches, 4.5);
  assert.equal(payload[1].min_column_inches, null, 'no dock, no minimum');
});

test('an existing id is kept, so a board does not lose which screen it is', () => {
  // ⛔ The id is what a device stored. Regenerating it from a renamed screen
  // would quietly unset every board that had picked it.
  const payload = toPayload([{ ...WALL, id: 'wall', name: 'Main auditorium wall' }]);

  assert.equal(payload[0].id, 'wall');
  assert.equal(payload[0].name, 'Main auditorium wall');
});

test('numbers arriving as text from a form are numbers in the payload', () => {
  const payload = toPayload([{ name: 'Wall', diagonal_inches: '55', min_column_inches: '4.5' }]);

  assert.equal(payload[0].diagonal_inches, 55);
  assert.equal(payload[0].min_column_inches, 4.5);
});

test('⚠️ saving counts what went and what was held back', () => {
  // A row silently dropped is discovered weeks later, when a board behaves
  // oddly. ⛔ Counts rather than a sentence now: the screens and the docks are
  // saved in ONE request, so the sentence has to be built from both lists --
  // see `pairedSaveSummary`. This used to summarise the screens alone.
  assert.deepEqual(saveCounts([WALL]), { saved: 1, incomplete: 0 });
  assert.deepEqual(saveCounts([WALL, { name: 'Broken' }]), { saved: 1, incomplete: 1 });
  assert.deepEqual(saveCounts([WALL, {}, {}]), { saved: 1, incomplete: 2 });
  assert.deepEqual(saveCounts([]), { saved: 0, incomplete: 0 });
});

test('screensHaveProblems is the form-level answer', () => {
  assert.equal(screensHaveProblems([WALL]), false);
  assert.equal(screensHaveProblems([WALL, { name: 'Broken' }]), true);
  assert.equal(screensHaveProblems([]), false);
});

test('pairRows keeps every row, and says which ones are being sent', () => {
  const pairs = pairRows([WALL, { name: 'Half done' }]);

  assert.equal(pairs.length, 2, 'a held-back row is still a row');
  assert.equal(pairs[0].entry.id, 'auditorium-wall');
  assert.equal(pairs[1].entry, null);
  assert.equal(pairs[1].row.name, 'Half done', 'and it still carries what was typed');
});

/**
 * ⛔ #180. Found on the venue wall: the status line said "1 incomplete row not
 * saved" and the row it referred to had been deleted from the form, so there
 * was nothing left to finish. No screen could be described, so no board had a
 * minimum column width, so #170 never engaged at all.
 */
test('⛔ a save keeps the row you were still filling in', () => {
  const typing = { name: 'Lobby', diagonal_inches: '', min_column_inches: '' };
  // The server only ever sees the complete one, so that is all it sends back.
  const merged = mergeSaved([WALL, typing], [{ ...WALL, id: 'auditorium-wall' }]);

  assert.equal(merged.length, 2);
  assert.equal(merged[1].name, 'Lobby', 'the half-finished row survives the save');
  assert.match(screenProblem(merged[1]), /How big is it/, 'and is still flagged');
});

test('⛔ what was typed into the kept row is not quietly rewritten', () => {
  const typing = { name: 'Lobby', diagonal_inches: 'about fifty', min_column_inches: '4.5' };
  const merged = mergeSaved([typing], []);

  assert.deepEqual(merged, [typing], 'byte for byte, so the cursor lands where it was');
});

test('a saved row takes the server\'s values, not the form\'s', () => {
  // ⭐ The id matters most: it is what a board stores to say which screen it is.
  const merged = mergeSaved(
    [{ name: 'Auditorium wall', diagonal_inches: '55', min_column_inches: '4.5' }],
    [{
      id: 'auditorium-wall', name: 'Auditorium wall', diagonal_inches: 55, min_column_inches: 4.5,
    }],
  );

  assert.equal(merged[0].id, 'auditorium-wall');
  assert.equal(merged[0].diagonal_inches, 55, 'a number, not the string the form held');
});

test('order is the order the rows were in', () => {
  const merged = mergeSaved(
    [{ name: 'Broken' }, WALL, { diagonal_inches: 15 }],
    [{ ...WALL, id: 'auditorium-wall' }],
  );

  assert.deepEqual(merged.map((s) => s.name), ['Broken', 'Auditorium wall', undefined]);
});

test('⚠️ a complete row the server refused comes back rather than vanishing', () => {
  // Same reason as an incomplete one: a row that disappears takes the only
  // copy of somebody's work with it.
  const merged = mergeSaved([WALL], []);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Auditorium wall');
});

test('a screen in the response that no row produced is shown, not dropped', () => {
  const merged = mergeSaved([], [{ id: 'youth', name: 'Youth room TV', diagonal_inches: 43 }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'youth');
});

test('merging nothing into nothing is an empty form, not a crash', () => {
  assert.deepEqual(mergeSaved([], []), []);
  assert.deepEqual(mergeSaved(null, null), []);
  assert.deepEqual(mergeSaved(undefined, [{ id: 'wall', name: 'Wall', diagonal_inches: 55 }]).length, 1);
});

/**
 * Which docks a screen names (A3).
 *
 * ⛔ The payload's dock reference had NO test at all before these. It was
 * `dock_id`, a single string, and changing it to a list broke nothing in this
 * file — which is how an untested contract behaves right up until it matters.
 */

const A3_WALL = { name: 'Auditorium wall', diagonal_inches: 55 };

test('⛔ a screen can name several docks', () => {
  // The venue has eleven SBC200s under the Green Room screen and could pick
  // one of them.
  const [entry] = toPayload([{ ...A3_WALL, dock_ids: ['green-room', 'side-table'] }]);
  assert.deepEqual(entry.dock_ids, ['green-room', 'side-table']);
});

test('the order a screen names them in is kept', () => {
  // Left to right on the table. A count would not care; anything that later
  // links a position to a slot would.
  const [entry] = toPayload([{ ...A3_WALL, dock_ids: ['side-table', 'green-room'] }]);
  assert.deepEqual(entry.dock_ids, ['side-table', 'green-room']);
});

test('one dock cannot be named twice by one screen', () => {
  const [entry] = toPayload([{ ...A3_WALL, dock_ids: ['green-room', 'green-room'] }]);
  assert.deepEqual(entry.dock_ids, ['green-room']);
});

test('⛔ the single-dock shapes are still read, and never written back', () => {
  // The editor's rows come from a stored configuration that may predate the
  // list. A save that ignored the single key would silently drop a board's
  // only dock, taking its column floor with it.
  const [fromDockId] = toPayload([{ ...A3_WALL, dock_id: 'green-room' }]);
  assert.deepEqual(fromDockId.dock_ids, ['green-room']);
  assert.ok(!('dock_id' in fromDockId), 'one record of the link, so they cannot drift');

  const [fromFurniture] = toPayload([{ ...A3_WALL, furniture_id: 'green-room' }]);
  assert.deepEqual(fromFurniture.dock_ids, ['green-room']);
});

test('⛔ furniture_id is the old name, not a second dock', () => {
  // Reading them as a pair would give a board two docks where it has one —
  // and, since A3 sums their positions, twice the columns the room has places.
  const [entry] = toPayload([
    { ...A3_WALL, dock_id: 'green-room', furniture_id: 'side-table' },
  ]);
  assert.deepEqual(entry.dock_ids, ['green-room']);
});

test('a screen with nothing underneath keeps its legacy width', () => {
  // ⛔ Before #203 the width lived on the screen row. Dropping it on save
  // would widen that board's columns past the dock they were measured
  // against.
  const [entry] = toPayload([{ ...A3_WALL, min_column_inches: 4.5 }]);
  assert.deepEqual(entry.dock_ids, []);
  assert.equal(entry.min_column_inches, 4.5);
});

test('naming a dock retires the legacy width', () => {
  const [entry] = toPayload([
    { ...A3_WALL, dock_ids: ['green-room'], min_column_inches: 4.5 },
  ]);
  assert.equal(entry.min_column_inches, null, 'the dock is the measurement now');
});
