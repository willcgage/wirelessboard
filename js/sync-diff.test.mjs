/**
 * Reading the sync diff (#120).
 *
 * ⛔ The headline is the part that matters most. An operator who reads one line
 * and presses Sync Now has to have read the truth in that line.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_LABELS, CHANGING,
  changedRows, unchangedRows, isNoop, diffHeadline, counts,
  nameCell, describeRow, rowClass, shouldFoldUnchanged, foldedLabel,
} from './sync-diff.mjs';

const row = (action, extra = {}) => ({
  slot: 1, from: '', to: '', action, matched_via: 'position', claimants: [], ...extra,
});

test('every action a sync can produce has a label', () => {
  // The vocabulary is the server's; a row the panel cannot name renders blank.
  ['skipped', 'change', 'assign', 'clear', 'unchanged'].forEach((action) => {
    assert.ok(ACTION_LABELS[action], `no label for ${action}`);
  });
  assert.ok(!CHANGING.includes('unchanged'));
});

test('⭐ a board that already matches says so, rather than "0 updates"', () => {
  // "0 updates" beside a table of twelve rows reads like a failure.
  const changes = [row('unchanged'), row('unchanged', { slot: 2 })];

  assert.ok(isNoop(changes));
  assert.equal(diffHeadline(changes), 'Nothing to change — 2 slots already match the plan.');
});

test('nothing matched at all is a different sentence', () => {
  // ⚠️ Not the same as "already correct": one means the board is right, the
  // other means the plan found nothing, and they want opposite reactions.
  assert.equal(diffHeadline([]), 'Nothing matched — no slot would be touched.');
  assert.equal(diffHeadline(null), 'Nothing matched — no slot would be touched.');
});

test('the headline counts each kind of change by name', () => {
  const changes = [
    row('change', { slot: 1 }), row('assign', { slot: 2 }),
    row('assign', { slot: 3 }), row('clear', { slot: 4 }),
  ];

  assert.equal(
    diffHeadline(changes),
    '4 slots would change — 1 replaced, 2 newly assigned, 1 cleared.',
  );
});

test('a real sync says it in the past tense', () => {
  const changes = [row('assign')];

  assert.match(diffHeadline(changes, { dryRun: false }), /^1 slot changed/);
});

test('⛔ a contested slot is not counted among the changes', () => {
  // It is the sync declining to guess. Folding it into "3 slots would change"
  // would tell an operator something was handled when nothing was.
  const changes = [
    row('assign', { slot: 1 }),
    row('skipped', { slot: 2, claimants: ['Amy', 'Zoe'] }),
  ];

  const headline = diffHeadline(changes);
  assert.match(headline, /^1 slot would change/);
  assert.match(headline, /1 slot left alone \(claimed by two people\)/);
});

test('and the already-correct ones are mentioned without crowding the front', () => {
  const changes = [row('assign', { slot: 1 }), row('unchanged', { slot: 2 })];

  const headline = diffHeadline(changes);
  assert.ok(headline.indexOf('would change') < headline.indexOf('already correct'));
});

test('counts name every action even at zero', () => {
  const tally = counts([row('assign')]);

  assert.equal(tally.assign, 1);
  assert.equal(tally.clear, 0);
  assert.deepEqual(Object.keys(tally).sort(), ['assign', 'change', 'clear', 'skipped', 'unchanged']);
});

test('an empty name is a word, not an empty cell', () => {
  // A blank "now" column reads as a rendering fault rather than as an empty
  // slot, which is exactly the row an operator should notice.
  assert.equal(nameCell(''), '—');
  assert.equal(nameCell('   '), '—');
  assert.equal(nameCell(null), '—');
  assert.equal(nameCell(' Dave '), 'Dave');
});

test('⚠️ a contested row explains itself by naming who is fighting over it', () => {
  // "Matched by team position" is true and useless here: both of them were.
  assert.equal(
    describeRow(row('skipped', { claimants: ['Amy', 'Zoe'] })),
    'Amy and Zoe both claim it',
  );
  assert.equal(describeRow(row('skipped', { claimants: [] })), 'claimed by two people');
});

test('a cleared row says why it is being cleared', () => {
  assert.equal(describeRow(row('clear', { matched_via: '' })), 'nobody on this plan matches it');
});

test('an ordinary row names the position and how it matched', () => {
  assert.equal(
    describeRow(row('assign', { position: 'Electric Guitar 3', matched_via: 'position' })),
    'Electric Guitar 3 — matched by team position',
  );
  assert.equal(describeRow(row('assign', { position: '', matched_via: 'note' })), 'matched by note category');
  assert.equal(describeRow(row('assign', { position: 'Vox 1', matched_via: '' })), 'Vox 1');
  assert.equal(describeRow(null), '');
});

test('each action gets its own row class, and unchanged is the quiet one', () => {
  assert.equal(rowClass('skipped'), 'sync-row-skipped');
  assert.equal(rowClass('clear'), 'sync-row-clear');
  assert.equal(rowClass('unchanged'), 'sync-row-unchanged');
  assert.equal(rowClass('anything else'), 'sync-row-unchanged');
});

test('⭐ the already-correct rows fold away only when there is something else to see', () => {
  const mixed = [row('assign', { slot: 1 }), row('unchanged', { slot: 2 })];
  const allSame = [row('unchanged'), row('unchanged', { slot: 2 })];

  assert.ok(shouldFoldUnchanged(mixed), 'two quiet rows should not bury the one that matters');
  assert.ok(
    !shouldFoldUnchanged(allSame),
    'folding everything would leave a panel that looks like it did nothing',
  );
  assert.ok(!shouldFoldUnchanged([row('assign')]));
});

test('the fold says how many it is hiding', () => {
  assert.equal(foldedLabel([row('unchanged')]), 'Show 1 slot that already matches');
  assert.equal(
    foldedLabel([row('unchanged'), row('unchanged', { slot: 2 })]),
    'Show 2 slots that already match',
  );
});

test('changed and unchanged split the rows between them', () => {
  const changes = [row('assign'), row('unchanged', { slot: 2 }), row('skipped', { slot: 3 })];

  assert.equal(changedRows(changes).length, 2);
  assert.equal(unchangedRows(changes).length, 1);
  assert.equal(changedRows(changes).length + unchangedRows(changes).length, changes.length);
});

test('⛔⛔ #260: a slot held by one person in two positions says so, not "claimed by two people"', () => {
  // The two skips are different problems and need different sentences. This
  // one is one person on several positions; the operator has to decide which
  // radio that person carries, not which of two people wins. Phrasing it as a
  // contest sends them looking for a second person who does not exist.
  assert.equal(
    describeRow(row('skipped', {
      skip_reason: 'multi-position',
      claimants: [],
      held_by: { name: 'Christian Nuckels', positions: ['Welcome', 'Vocal 1'] },
    })),
    'Christian Nuckels is on Welcome and Vocal 1',
  );
});

test('⚠️ and it still names the positions when only one is known', () => {
  assert.equal(
    describeRow(row('skipped', {
      skip_reason: 'multi-position',
      claimants: [],
      held_by: { name: 'Bob Berryman', positions: [] },
    })),
    'Bob Berryman holds more than one position',
  );
});

test('⛔ a contested row is unaffected by the multi-position branch', () => {
  // Both kinds arrive on the same `skipped` action, so the contested case has
  // to keep working unchanged.
  assert.equal(
    describeRow(row('skipped', { skip_reason: 'contested', claimants: ['Amy', 'Zoe'] })),
    'Amy and Zoe both claim it',
  );
});
