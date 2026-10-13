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
  screenId, uniqueScreenId, screenProblem, screensHaveProblems, toPayload, saveSummary,
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

test('⚠️ saving says when a row was not saved', () => {
  // A row silently dropped is discovered weeks later, when a board behaves oddly.
  assert.equal(saveSummary([WALL]), '1 screen saved.');
  assert.equal(saveSummary([WALL, { name: 'Broken' }]), '1 screen saved. 1 incomplete row not saved.');
  assert.match(saveSummary([WALL, {}, {}]), /2 incomplete rows not saved/);
});

test('an empty list says what that means rather than nothing', () => {
  assert.match(saveSummary([]), /No screens\. Boards will have no minimum/);
});

test('screensHaveProblems is the form-level answer', () => {
  assert.equal(screensHaveProblems([WALL]), false);
  assert.equal(screensHaveProblems([WALL, { name: 'Broken' }]), true);
  assert.equal(screensHaveProblems([]), false);
});
