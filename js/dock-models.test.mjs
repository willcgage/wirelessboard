import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DOCK_MODELS, MAX_POSITION_INCHES, MIN_POSITION_INCHES, OTHER_MODEL,
  dockModel, dockModelChoices, dockModelLabel, applyDockModel, positionWidthProblem,
} from './dock-models.mjs';
import { dockProblem, toPayload } from './dock-editor.mjs';

/**
 * Picking a charger instead of measuring one.
 *
 * ⛔⛔ The venue board that prompted this had one dock typed as `39` instead
 * of `3.9`. The column floor is the widest position underneath, so every
 * column had to be 39 inches on a 55-inch screen — **one column**, and a wall
 * that paged through twelve channels one at a time. Nothing in the product
 * questioned it.
 *
 * ⭐ The same configuration also had Positions running 1, 2, 3 … 12 — the
 * dock's *number*, not how many places it has — summing to 78 places under a
 * screen with twelve channels. The field invited that reading and nothing
 * contradicted it.
 */

const ROOT = path.join(import.meta.dirname, '..');

test('⛔ a width no dock could have is refused, and the typo is named', () => {
  // The venue's exact value. Saying only "too wide" leaves somebody hunting
  // for which of twelve rows they fumbled.
  const said = positionWidthProblem(39);
  assert.match(said, /cannot be 39in/);
  assert.match(said, /Did you mean 3\.9in\?/);
});

test('the real widths all pass', () => {
  DOCK_MODELS.forEach((m) => {
    assert.equal(
      positionWidthProblem(m.position_inches),
      null,
      `${m.model} at ${m.position_inches}in must be accepted`,
    );
  });
});

test('the ceiling is comfortably above the widest real dock', () => {
  // ⚠️ A guard against someone "tidying" the limit down onto real data.
  const widest = Math.max(...DOCK_MODELS.map((m) => m.position_inches));
  assert.ok(
    widest < MAX_POSITION_INCHES,
    `the widest dock (${widest}in) must fit under the ${MAX_POSITION_INCHES}in ceiling`,
  );
  assert.equal(positionWidthProblem(MAX_POSITION_INCHES), null, 'the ceiling itself is allowed');
  assert.ok(positionWidthProblem(MAX_POSITION_INCHES + 0.1));
});

test('nonsense and absence are told apart', () => {
  assert.match(positionWidthProblem(''), /How wide is one position/);
  assert.match(positionWidthProblem(undefined), /How wide is one position/);
  assert.match(positionWidthProblem('abc'), /has to be a measurement/);
  assert.match(positionWidthProblem(0), /has to be a measurement/);
  assert.match(positionWidthProblem(-3), /has to be a measurement/);
  assert.match(positionWidthProblem(0.2), /narrower than any dock/);
  assert.ok(positionWidthProblem(MIN_POSITION_INCHES) === null);
});

test('⭐ picking a model fills in the width, the places AND the kind', () => {
  // The kind is the one fact nobody can tell by looking at a dock: whether it
  // can be asked what is in it.
  const fixed = applyDockModel({ name: 'VOX 5', position_inches: 39, positions: 5 }, 'sbc200');

  assert.equal(fixed.position_inches, 3.9);
  assert.equal(fixed.positions, 1, 'an SBC200 is ONE place — two bays, front and back');
  assert.equal(fixed.kind, 'charging', 'and the SBC200 is not networked');
  assert.equal(fixed.name, 'VOX 5', 'the name is the operator\'s and is left alone');
});

test('a networked model says so', () => {
  assert.equal(applyDockModel({}, 'sbc450').kind, 'networked');
  assert.equal(applyDockModel({}, 'sbc850').positions, 4);
});

test('⭐ Other is a first-class answer, not a failure', () => {
  // A shelf is a place a microphone lives and has no model number.
  const shelf = applyDockModel({ name: 'Side table', position_inches: 2.5 }, OTHER_MODEL);
  assert.equal(shelf.model, OTHER_MODEL);
  assert.equal(shelf.position_inches, 2.5, 'what was measured by hand is kept');
  assert.ok(dockModelChoices().some((c) => c.value === OTHER_MODEL));
  assert.equal(dockModelChoices().at(-1).value, OTHER_MODEL, 'and it comes last');
});

test('an unknown model id reads as Other rather than throwing', () => {
  assert.equal(dockModel('sbc999'), null);
  assert.equal(applyDockModel({ position_inches: 3 }, 'sbc999').model, OTHER_MODEL);
  assert.equal(applyDockModel({ position_inches: 3 }, 'sbc999').position_inches, 3);
});

test('⛔ models with no trustworthy data are absent, not guessed', () => {
  // SBC250, SBRC and SBC240 returned nothing usable. Battery chargers are out
  // of scope entirely: loose batteries are on nobody's channel, so their bays
  // belong to no slot and can never be attributed.
  const ids = DOCK_MODELS.map((m) => m.id);
  ['sbc250', 'sbrc', 'sbc240', 'sbc840', 'sbc800', 'sbc210'].forEach((absent) => {
    assert.ok(!ids.includes(absent), `${absent} must not be guessed at`);
  });
});

test('a label says enough to pick from across a room', () => {
  assert.equal(dockModelLabel(dockModel('sbc200')), 'Shure SBC200 — 2 bays, 1 position, 3.9in');
  assert.equal(dockModelLabel(dockModel('sbc450')), 'Shure SBC450 — 4 bays, 2 positions, 4.42in');
});

test('⛔ the row validator refuses what the width check refuses', () => {
  // One rule, not two that can drift.
  assert.match(dockProblem({ name: 'VOX 5', position_inches: 39 }), /Did you mean 3\.9in\?/);
  assert.equal(dockProblem({ name: 'VOX 5', position_inches: 3.9, positions: 1 }), null);
});

test('the chosen model is stored, so reopening shows what was picked', () => {
  const [entry] = toPayload([{
    name: 'VOX 1', kind: 'charging', position_inches: 3.9, positions: 1, model: 'sbc200',
  }]);
  assert.equal(entry.model, 'sbc200');

  const [byHand] = toPayload([{ name: 'Side table', position_inches: 2.5 }]);
  assert.equal(byHand.model, OTHER_MODEL);
});

test('⛔⛔ the ceiling is the same number in Python and JavaScript', () => {
  // Two guards on one rule, and a board can be configured from either side.
  // If they drift, one of them stops refusing what the other does.
  const py = fs.readFileSync(path.join(ROOT, 'py', 'config.py'), 'utf8');
  const found = py.match(/^MAX_POSITION_INCHES\s*=\s*(\d+(?:\.\d+)?)/m);
  assert.ok(found, 'py/config.py defines MAX_POSITION_INCHES');
  assert.equal(Number(found[1]), MAX_POSITION_INCHES);
});
