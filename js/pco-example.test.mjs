/**
 * The worked example, and the copy that describes consequences (#179).
 *
 * ⛔ The cases here are the ones that would otherwise be found by an
 * administrator trusting a screen: an example that reads as "nothing matches"
 * when it was really never run, a count measured against the wrong total, and
 * a sync that would take a name off a slot without saying so.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  workedExample, headline, filledRows, unmatchedRows, warnings, viaLabel, NOT_RUN_YET,
} from './pco-example.mjs';
import {
  STRATEGIES, DEFAULT_STRATEGY, strategyById, CONSEQUENCES, CONSEQUENCE_KEYS,
} from './pco-strategies.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const PREVIEW = {
  ok: true,
  dry_run: true,
  plan_id: '77',
  strategy: 'position_or_note',
  profile: { id: 'p1', name: 'Sunday Morning' },
  people: 9,
  slots_matched: 11,
  assignment_details: [
    {
      id: 'HH-1', name: 'Jane Smith', team: 'Vocals', position: 'Vocal 1', matched_via: 'position', slots: [1, 7],
    },
    {
      id: 'HH-2', name: 'Bob Roberts', team: 'Vocals', position: 'Vocal 2', matched_via: 'position_number', slots: [2],
    },
    {
      id: '', name: 'Nobody Placed', team: 'Band', position: 'Guitar', matched_via: 'note', slots: [],
    },
  ],
  unmatched: [
    { name: 'Pat Speaker', position: '' },
    { name: 'Sam Ford', position: 'Vocal 9' },
  ],
  skipped: [{ slot: 4, claimants: ['Dave', 'Fatai'] }],
  clearable: [{ slot: 12, name: 'Visiting Speaker' }],
  profile_conflicts: [],
};

// ---------------------------------------------------------------------------
// The headline
// ---------------------------------------------------------------------------

test('the headline counts against the configured slots, not the people on the plan', () => {
  // "will my board be full on Sunday" -- four of four people is a very
  // different answer from four of twelve slots.
  assert.equal(headline({ slotsMatched: 11, slotCount: 12 }), '11 of 12 slots would be filled.');
  assert.equal(headline({ slotsMatched: 12, slotCount: 12 }), 'Every slot would be filled — 12 of 12.');
});

test('⛔ nothing matching says so plainly, and so does nothing configured', () => {
  assert.match(headline({ slotsMatched: 0, slotCount: 12 }), /Nothing would be filled/);
  assert.match(headline({ slotsMatched: 0, slotCount: 0 }), /No slots are configured/);
  // A board with slots but a plan that fills none is NOT the same as a board
  // with no slots, and the two sentences must not be interchangeable.
  assert.notEqual(headline({ slotsMatched: 0, slotCount: 12 }), headline({ slotsMatched: 0, slotCount: 0 }));
});

test('a nonsense count never produces a nonsense sentence', () => {
  assert.match(headline({ slotsMatched: -3, slotCount: 12 }), /Nothing would be filled/);
  assert.match(headline({}), /No slots are configured/);
});

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

test('⭐ a position that fills two slots shows both', () => {
  // The mic channel and its matching IEM. pco_mapping.py states the rule, and
  // this is the row that shows it working.
  const rows = filledRows(PREVIEW);
  assert.equal(rows[0].position, 'Vocal 1');
  assert.equal(rows[0].person, 'Jane Smith');
  assert.deepEqual(rows[0].slots, [1, 7]);
});

test('⛔ a person who matched nothing is not drawn as a filled row', () => {
  // `assignment_details` carries everyone the matcher considered, including
  // entries that resolved to no slot at all. Drawing those as matches would
  // make the example claim slots it would not fill.
  const rows = filledRows(PREVIEW);
  assert.equal(rows.length, 2);
  assert.ok(!rows.some((r) => r.person === 'Nobody Placed'));
});

test('the row says WHY it matched, not just that it did', () => {
  const rows = filledRows(PREVIEW);
  assert.equal(rows[0].via, 'position');
  assert.equal(rows[1].via, 'position number');
  assert.equal(viaLabel('brackets'), '[ID] in the name');
  // An unknown reason is shown as itself rather than hidden.
  assert.equal(viaLabel('some_new_rule'), 'some new rule');
  assert.equal(viaLabel(''), '');
});

test('⛔ two different failures are told apart', () => {
  // A person with no position at all, and a position that names no slot. They
  // need different fixes, so they must not read the same.
  const missing = unmatchedRows(PREVIEW);
  assert.deepEqual(missing[0], { person: 'Pat Speaker', position: '', reason: 'no position set' });
  assert.deepEqual(missing[1], { person: 'Sam Ford', position: 'Vocal 9', reason: 'no slot named Vocal 9' });
});

// ---------------------------------------------------------------------------
// What it would take away
// ---------------------------------------------------------------------------

test('⛔⛔ a slot that would lose its name says whose name it is', () => {
  // Removing the wrong name is the one part of a sync that cannot be undone by
  // syncing again. "1 slot cleared" is not consent; naming the person is.
  const list = warnings(PREVIEW);
  const clear = list.find((w) => w.kind === 'clear');
  assert.match(clear.text, /Slot 12/);
  assert.match(clear.text, /Visiting Speaker/);
});

test('a contested slot names both claimants and says it is left alone', () => {
  const clash = warnings(PREVIEW).find((w) => w.kind === 'conflict');
  assert.match(clash.text, /Dave and Fatai/);
  assert.match(clash.text, /left alone/);
});

test('no warnings is an empty list, not a missing key', () => {
  assert.deepEqual(warnings({ ok: true }), []);
  assert.deepEqual(warnings(null), []);
});

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

test('the example says, every time, that nothing has been applied', () => {
  const ex = workedExample(PREVIEW, { slotCount: 12 });
  assert.equal(ex.ok, true);
  assert.match(ex.note, /Nothing has been applied/);
  assert.equal(ex.headline, '11 of 12 slots would be filled.');
  assert.equal(ex.profile, 'Sunday Morning');
  assert.equal(ex.rows.length, 2);
  assert.equal(ex.unmatched.length, 2);
  assert.equal(ex.warnings.length, 2);
});

test('⛔ a failure is an answer, not an empty table', () => {
  // A plan that has rolled off the schedule, or an account that cannot be
  // reached, must not render as "nothing would match" -- the opposite finding.
  const gone = workedExample({ ok: false, error: 'That plan no longer exists' }, { slotCount: 12 });
  assert.equal(gone.ok, false);
  assert.match(gone.error, /no longer exists/);

  const nothing = workedExample(null, { slotCount: 12 });
  assert.equal(nothing.ok, false);
  assert.match(nothing.error, /No answer/);
});

test('⛔ and "not run yet" is not "nothing matched"', () => {
  assert.match(NOT_RUN_YET, /Check this mapping/);
  assert.ok(!/no match/i.test(NOT_RUN_YET));
});

// ---------------------------------------------------------------------------
// Choices that read as consequences
// ---------------------------------------------------------------------------

test('⛔ the three strategy cards are exactly the three the server accepts', () => {
  // A card offering a strategy py/pco.py does not support resolves to nothing;
  // a strategy the server gained with no card is unreachable.
  const src = readFileSync(join(HERE, '..', 'py', 'pco.py'), 'utf8');
  const line = src.slice(src.indexOf('SUPPORTED_STRATEGIES'), src.indexOf('DEFAULT_STRATEGY'));
  const server = Array.from(line.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort();

  assert.deepEqual(STRATEGIES.map((s) => s.id).sort(), server);
  assert.ok(server.includes(DEFAULT_STRATEGY));
  assert.match(src, new RegExp(`DEFAULT_STRATEGY = '${DEFAULT_STRATEGY}'`));
});

test('⛔ and that guard can fail', () => {
  const planted = ['position', 'position_or_note'];
  assert.notDeepEqual(STRATEGIES.map((s) => s.id).sort(), planted.sort());
});

test('every card says what it does AND when to pick it', () => {
  // A card without the third line is just a longer dropdown.
  STRATEGIES.forEach((s) => {
    assert.ok(s.title && s.title.length > 4, `${s.id} has no title`);
    assert.ok(s.does && s.does.length > 30, `${s.id} does not say what it does`);
    assert.ok(s.when && s.when.length > 15, `${s.id} does not say when to pick it`);
  });
  assert.equal(STRATEGIES.filter((s) => s.recommended).length, 1, 'exactly one is the usual choice');
  assert.ok(strategyById('note_or_brackets').legacy, 'the legacy one is marked legacy');
  assert.equal(strategyById('nope'), null);
});

test('⛔⛔ the switch that can take a name off a slot says so in its own label', () => {
  // "Clear unmatched" never said that it removes a name a person put there by
  // hand -- which is the whole reason it is off by default.
  const clear = CONSEQUENCES.clear_unmatched;
  assert.match(clear.consequence, /put on by hand|by hand/);
  assert.equal(clear.severity, 'takes-away');
  assert.ok(!/^clear unmatched$/i.test(clear.label), 'the label is still the field name');
});

test('every consequence is written as an effect on the board', () => {
  CONSEQUENCE_KEYS.forEach((key) => {
    const entry = CONSEQUENCES[key];
    assert.ok(entry.label && entry.label.length > 8, `${key} has no label`);
    assert.ok(entry.consequence && entry.consequence.length > 40, `${key} has no consequence`);
    assert.ok(['adds', 'takes-away'].includes(entry.severity), `${key} has no severity`);
  });
  // The two that can remove something are marked as such, and they are the two
  // an operator needs to recognise at a glance.
  const removes = CONSEQUENCE_KEYS.filter((k) => CONSEQUENCES[k].severity === 'takes-away');
  assert.deepEqual(removes.sort(), ['auto_sync', 'clear_unmatched']);
});

test('⛔ every consequence names a control the markup actually has', () => {
  // Found on the running page: the id was being DERIVED from the config key,
  // and `position_number_fallback` is `pco-number-fallback` in the markup -- so
  // one switch silently kept its field-name label. Counting the notes on screen
  // caught it; nothing in the tests would have.
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');
  CONSEQUENCE_KEYS.forEach((key) => {
    const entry = CONSEQUENCES[key];
    assert.ok(entry.control, `${key} names no control`);
    assert.ok(
      html.includes(`id="${entry.control}"`),
      `${key} points at ${entry.control}, which is not in the markup`,
    );
  });
});

test('⛔ and deriving the id would NOT have worked, which is why it is data', () => {
  const derived = CONSEQUENCE_KEYS.map((k) => `pco-${k.replace(/_/g, '-')}`);
  const declared = CONSEQUENCE_KEYS.map((k) => CONSEQUENCES[k].control);
  assert.notDeepEqual(derived, declared, 'if these ever match, the comment above is stale');
});

test('⛔⛔ the caveats from the original help text were folded in, not dropped', () => {
  // Each switch had a `.form-text` saying the same thing in field-name terms,
  // and the consequence copy now replaces it on screen. Each one carried
  // something the new copy did not -- dropping any of it to tidy the screen
  // would be shedding information.
  assert.match(CONSEQUENCES.position_number_fallback.consequence, /single-team/i);
  assert.match(CONSEQUENCES.position_number_fallback.consequence, /Guitar 1/);

  // ⭐ The reassurance that makes this switch pressable at all.
  assert.match(CONSEQUENCES.clear_unmatched.consequence, /keeps its device id/i);

  assert.match(CONSEQUENCES.auto_sync.consequence, /never guessed at/i);
  assert.match(CONSEQUENCES.auto_sync.consequence, /rule set/i);
});

test('⛔⛔ the headline can never print more filled than exist', () => {
  // Seen on a running board: "Every slot would be filled — 11 of 2." The
  // preview resolves against the stored configuration while the total is
  // counted from what the page holds, so a slot removed in between makes the
  // two disagree. A summary that can print an absurdity is worse than one that
  // is a moment stale.
  assert.equal(headline({ slotsMatched: 11, slotCount: 2 }), 'Every slot would be filled — 2 of 2.');
  assert.ok(!headline({ slotsMatched: 11, slotCount: 2 }).includes('11'));
  assert.equal(headline({ slotsMatched: 99, slotCount: 12 }), 'Every slot would be filled — 12 of 12.');
});

test('⛔⛔ #260: a held slot gets its own sentence, not the contested one', () => {
  // "Claimed by two people" sends an operator looking for a second person who
  // is not there. What they have to settle is which radio one person carries.
  const lines = warnings({
    held: [{
      slot: 7,
      name: 'Christian Nuckels',
      positions: ['Welcome', 'Vocal 1'],
      kept_on: 1,
    }],
  });
  const held = lines.find((l) => l.kind === 'held');

  assert.ok(held, 'a held slot should be reported');
  assert.match(held.text, /Christian Nuckels is on Welcome and Vocal 1/);
  assert.match(held.text, /more radios than one person carries/);
  // ⭐ And where they were kept, so the operator can check that slot rather
  // than hunt for what happened.
  assert.match(held.text, /kept on slot 1/i);
  assert.doesNotMatch(held.text, /claimed by/i);
});

test('⚠️ a held slot with nobody kept says so without inventing a slot', () => {
  const lines = warnings({
    held: [{
      slot: 7, name: 'Amy', positions: ['Welcome', 'Vocal 1'], kept_on: null,
    }],
  });
  const held = lines.find((l) => l.kind === 'held');

  assert.match(held.text, /Amy is on Welcome and Vocal 1/);
  assert.doesNotMatch(held.text, /kept on slot/i);
});
