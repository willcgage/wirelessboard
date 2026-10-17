/**
 * The Slots table.
 *
 * ⛔ The cases here are the ones that would otherwise be found on a board in
 * use: a paste that clears the last name, a save that overwrites another
 * board's work, and a slot with no receiver behind it reading as a fault.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STATUS_WORDS, STATUS_TONES, slotRows, deviceLabel, reportLine,
  namesFromPaste, applyNames, slotPayload, saveSummary, tableSummary,
  positionCount,
} from './slots-table.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  slots: [
    {
      slot: 1,
      type: 'ulxd4q',
      channel: 1,
      extended_id: 'Welcome',
      extended_name: 'Christian Nuckels',
      extended_position: 'Vocal 1',
    },
    {
      slot: 2, type: 'ulxd4q', channel: 2, extended_name: 'Brandon Lee',
    },
    { slot: 3, type: 'ulxd4q', channel: 3 },
    { slot: 4, type: 'offline' },
  ],
};

const TX = [];
TX[1] = {
  slot: 1, type: 'ulxd4q', channel: 1, device_id: 'HH-1', name_raw: 'HH-1 Christian', status: 'GOOD',
};
TX[2] = {
  slot: 2, type: 'ulxd4q', channel: 2, device_id: 'HH-2', name_raw: 'HH-2 Brandon', status: 'REPLACE',
};
TX[3] = {
  slot: 3, type: 'ulxd4q', channel: 3, device_id: 'HH-3', name_raw: 'HH-3', status: 'RX_COM_ERROR',
};
TX[4] = {
  slot: 4, type: 'offline', device_id: '', name_raw: '', status: 'UNASSIGNED',
};

test('a row per configured slot, in slot order', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  assert.deepEqual(rows.map((r) => r.slot), [1, 2, 3, 4]);
  assert.equal(rows[0].person, 'Christian Nuckels');
  // ⛔ A role, not an equipment id. The fixture used to say `HH-1` here,
  // which is what the mislabelled column taught everyone to expect (#267).
  assert.equal(rows[0].role, 'Welcome');
  assert.equal(rows[2].person, '');
});

test('⛔ out-of-order slots still come out in slot order', () => {
  const rows = slotRows({
    config: { slots: [{ slot: 9 }, { slot: 2 }, { slot: 11 }] },
    transmitters: [],
  });
  assert.deepEqual(rows.map((r) => r.slot), [2, 9, 11]);
});

test('⛔ a slot with no receiver behind it is named as such, not left blank', () => {
  // #186: `type: 'offline'` is what py/offline.py emits for a config slot with
  // no receiver. A blank column reads as missing data, which is the reading
  // that got it filed as a rendering bug.
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  const offline = rows.find((r) => r.slot === 4);
  assert.equal(offline.offline, true);
  assert.equal(offline.reports, '');
  assert.equal(offline.status, 'UNASSIGNED');
});

test('⛔ the reports column never prints the person', () => {
  // name_raw carries the person; device_id is the same label with the person
  // stripped. Printing name_raw would put the name next to the box it is typed
  // into -- #206 in a different place.
  assert.equal(deviceLabel({ device_id: 'HH-2', name_raw: 'HH-2 Brandon' }), 'HH-2');
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows.forEach((row) => {
    assert.ok(!row.reports.includes('Brandon'), `row ${row.slot}: ${row.reports}`);
    assert.ok(!row.reports.includes('Christian'), `row ${row.slot}: ${row.reports}`);
  });
});

test('deviceLabel falls back to name_raw only when there is no device id', () => {
  assert.equal(deviceLabel({ name_raw: 'HH-9' }), 'HH-9');
  assert.equal(deviceLabel({}), '');
  assert.equal(deviceLabel(null), '');
});

test('the report line reads type, channel, device', () => {
  assert.equal(reportLine({ type: 'ulxd4q', channel: 2, device: 'HH-2' }), 'ULXD4Q · CH 2 · HH-2');
  assert.equal(reportLine({ type: 'offline', channel: 0, device: '' }), '');
  assert.equal(reportLine({ type: 'ulxd4q', channel: null, device: 'HH-2' }), 'ULXD4Q · HH-2');
});

test('⚠️ transmitters are read whether they arrive as a sparse array or a list', () => {
  // config.js writes micboard.transmitters[slotNum]; the payload it is built
  // from is a list whose entries carry their own slot. Reading one shape only
  // is how the table comes out empty on a board that is working.
  const asList = [{ slot: 2, device_id: 'HH-2', status: 'GOOD' }];
  const rows = slotRows({ config: { slots: [{ slot: 2 }] }, transmitters: asList });
  assert.equal(rows[0].device, 'HH-2');
  assert.equal(rows[0].status, 'GOOD');
});

test('a slot with no transmitter at all is still a row', () => {
  const rows = slotRows({ config: { slots: [{ slot: 7, extended_name: 'Sam Ford' }] }, transmitters: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].person, 'Sam Ford');
  assert.equal(rows[0].status, 'UNASSIGNED');
});

test('nothing configured is not an error', () => {
  assert.deepEqual(slotRows({}), []);
  assert.deepEqual(slotRows({ config: {} }), []);
  assert.deepEqual(slotRows({ config: { slots: 'nope' } }), []);
});

// ---------------------------------------------------------------------------
// The paste box
// ---------------------------------------------------------------------------

test('⛔⛔ a pasted list ending in a newline does not clear the last name', () => {
  // The fault this exists to stop: an empty value CLEARS a name in
  // config.update_slot, and a list copied out of any document ends with \n.
  assert.deepEqual(namesFromPaste('Ada\nGrace\n'), ['Ada', 'Grace']);
  assert.deepEqual(namesFromPaste('Ada\nGrace\n\n\n'), ['Ada', 'Grace']);

  const rows = slotRows({ config: CONFIG, transmitters: TX });
  const filled = applyNames(rows, 'Ada\nGrace\n');
  assert.equal(filled[0].person, 'Ada');
  assert.equal(filled[1].person, 'Grace');
  // ⛔ Unchanged, not cleared.
  assert.equal(filled[2].person, rows[2].person);
  assert.equal(filled[3].person, rows[3].person);
});

test('a blank line in the middle is kept, because a slot can have nobody on it', () => {
  assert.deepEqual(namesFromPaste('Ada\n\nGrace\n'), ['Ada', '', 'Grace']);
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  const filled = applyNames(rows, 'Ada\n\nGrace');
  assert.equal(filled[1].person, '');
});

test('a short list leaves the rest of the rows alone', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  const filled = applyNames(rows, 'Ada');
  assert.equal(filled[0].person, 'Ada');
  assert.equal(filled[1].person, 'Brandon Lee');
});

test('pasting nothing changes nothing', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  assert.deepEqual(applyNames(rows, ''), rows);
  assert.deepEqual(applyNames(rows, '\n\n'), rows);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test('⛔⛔ a save sends only what changed', () => {
  // config.update_slot reads an absent key as "not editing this". Sending every
  // row would mean a table filled a minute ago overwrites whatever another
  // board saved since -- and this page deliberately does not refill a section
  // while somebody is typing in it (#180), so stale is the normal case.
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  assert.deepEqual(slotPayload(rows), []);

  rows[1].person = 'Brandon Lee Jr';
  assert.deepEqual(slotPayload(rows), [{ slot: 2, extended_name: 'Brandon Lee Jr' }]);
});

test('⛔ only the edited field is sent, not both', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows[0].role = 'Welcome Host';
  const payload = slotPayload(rows);
  assert.deepEqual(payload, [{ slot: 1, extended_id: 'Welcome Host' }]);
  assert.ok(!('extended_name' in payload[0]));
});

test('⭐ clearing a name sends an empty string, which is the deliberate clear', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows[0].person = '';
  assert.deepEqual(slotPayload(rows), [{ slot: 1, extended_name: '' }]);
});

test('whitespace alone is not a change', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows[0].person = '  Christian Nuckels  ';
  assert.deepEqual(slotPayload(rows), []);
});

test('a row without a usable slot number is never sent', () => {
  assert.deepEqual(slotPayload([{ slot: 0, person: 'x', wasPerson: '' }]), []);
  assert.deepEqual(slotPayload([{ slot: null, person: 'x', wasPerson: '' }]), []);
  assert.deepEqual(slotPayload(null), []);
});

test('the summaries say what happened', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  assert.equal(saveSummary(rows), 'Nothing changed.');
  rows[0].person = 'Ada';
  assert.equal(saveSummary(rows), 'Saved 1 slot.');
  rows[1].person = 'Grace';
  assert.equal(saveSummary(rows), 'Saved 2 slots.');

  // Still 2: both edits replaced a name that was already there.
  assert.equal(tableSummary(rows), '4 slots, 2 named.');
  rows[2].person = 'Sam Ford';
  assert.equal(tableSummary(rows), '4 slots, 3 named.');
  assert.equal(tableSummary([]), 'No slots configured. Add receivers first.');
});

// ---------------------------------------------------------------------------
// One vocabulary, not two
// ---------------------------------------------------------------------------

test('⛔ the State column uses the card\'s own words', () => {
  // The words a card puts in its status chip. If channelview renames one, this
  // fails -- which is the point: an operator should not have to learn two
  // vocabularies for one fact.
  const source = readFileSync(join(HERE, 'channelview.js'), 'utf8');

  const chip = source.slice(source.indexOf('const STATUS_CHIP'), source.indexOf('function updateStatusChip'));
  assert.ok(chip.includes('STATUS_CHIP'), 'found the chip map to read back');

  // ⚠️ Plain strings, never a template literal built into a RegExp: the escapes
  // are eaten before the pattern is compiled, and a guard that matches
  // everything passes on everything ([[guards-that-cannot-fail]]).
  const shared = ['REPLACE', 'CRITICAL', 'RX_COM_ERROR', 'TX_COM_ERROR'];
  shared.forEach((status) => {
    const word = STATUS_WORDS[status];
    assert.ok(
      chip.includes(`word: '${word}'`),
      `channelview's chip no longer says "${word}" for ${status} — the two vocabularies have drifted`,
    );
  });
});

test('⛔ the guard above can actually fail', () => {
  // Planted violation: the same check against a chip map that says something
  // else must NOT pass. Two of this project's doesNotMatch guards passed on
  // everything before anybody tried this.
  const planted = "const STATUS_CHIP = { REPLACE: { glyph: '▲', word: 'Swap it' } };";
  assert.ok(!planted.includes("word: 'Replace'"), 'the check would have missed a renamed word');
});

test('every status the board can sort by has a word and a tone', () => {
  // SEVERITY in pocket.mjs is the full list the board orders channels with; a
  // status with no word would show an empty State cell.
  const severity = readFileSync(join(HERE, 'pocket.mjs'), 'utf8');
  const block = severity.slice(severity.indexOf('export const SEVERITY'), severity.indexOf('/** Statuses that put'));
  const statuses = Array.from(block.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1]);
  assert.ok(statuses.length >= 10, `read the severity list, got ${statuses.length}`);
  statuses.forEach((status) => {
    assert.ok(STATUS_WORDS[status], `no State word for ${status}`);
    assert.ok(STATUS_TONES[status], `no tone for ${status}`);
  });
});

// ---------------------------------------------------------------------------
// The position (#238)
// ---------------------------------------------------------------------------

test('a row carries the stored position', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  assert.equal(rows[0].position, 'Vocal 1');
  assert.equal(rows[1].position, '', 'a slot with no position is empty, not undefined');
  assert.equal(positionCount(rows), 1);
});

test('⛔ editing the position sends only that key', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows[1].position = 'Vocal 2';
  const payload = slotPayload(rows);
  assert.deepEqual(payload, [{ slot: 2, extended_position: 'Vocal 2' }]);
  assert.ok(!('extended_name' in payload[0]), 'the person was not edited');
});

test('⭐ clearing a position sends an empty string, which is the deliberate clear', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows[0].position = '';
  assert.deepEqual(slotPayload(rows), [{ slot: 1, extended_position: '' }]);
});

test('the person and the position are independent edits', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows[0].person = 'Ada';
  rows[0].position = 'Speaker';
  assert.deepEqual(slotPayload(rows), [
    { slot: 1, extended_name: 'Ada', extended_position: 'Speaker' },
  ]);
});

test('whitespace alone is not a position change either', () => {
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  rows[0].position = '  Vocal 1  ';
  assert.deepEqual(slotPayload(rows), []);
});

test('⛔ a pasted list of names never touches the positions', () => {
  // The paste box fills people. A list of names landing in the position column
  // would put somebody's name where a role belongs -- and the next sync would
  // match on it.
  const rows = slotRows({ config: CONFIG, transmitters: TX });
  const filled = applyNames(rows, 'Ada\nGrace');
  assert.equal(filled[0].position, 'Vocal 1');
  assert.equal(filled[0].person, 'Ada');
  assert.deepEqual(slotPayload(filled).map((u) => Object.keys(u).sort()), [
    ['extended_name', 'slot'], ['extended_name', 'slot'],
  ]);
});

test('⛔ the headings are the agreed vocabulary, in the agreed order', () => {
  // The order the mockup settled: what the receiver reports, the override, the
  // person, their position, then the state.
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');
  const table = html.slice(html.indexOf('<table class="slots-table">'), html.indexOf('</thead>'));
  // ⚠️ `<th[ >]`, not `<th`: `<thead>` matches the loose form and contributes an
  // empty first column. This project has hit that one twice.
  const heads = Array.from(table.matchAll(/<th[ >][^>]*>([^<]*)</g)).map((m) => m[1].trim());
  // ⛔⛔ `Role`, not `Device id` (#267). That heading sat over `extended_id`
  // while the real `device_id` was in Receiver reports beside it, and
  // `Plan position` is the Planning Center field it used to collide with.
  assert.deepEqual(
    heads,
    ['Slot', 'Receiver reports', 'Role', 'Person', 'Plan position', 'State', 'Clear'],
  );
});

test('⛔⛔ the position is NOT drawn on the card', () => {
  // #206 removed a `Vocal 1` line that had been invented from a CSS grid area
  // named `position`, which holds the device id. Storing the real thing must
  // not quietly put that line back -- whether a card ever shows it is a
  // separate decision, and this is the guard that keeps it separate.
  const view = readFileSync(join(HERE, 'channelview.js'), 'utf8');
  assert.ok(
    !view.includes('extended_position'),
    'the card reads extended_position -- #206 all over again',
  );
});

test('⛔ and that guard can fail', () => {
  const planted = "slot.querySelector('.position').innerHTML = data.extended_position;";
  assert.ok(planted.includes('extended_position'), 'the check would have missed it');
});

test('⭐ the ROLE is drawn on the card, under the device heading (#267)', () => {
  // The decision #206's guard was keeping open: "placing under the Device's
  // Name at the top would be best." It is the slot's own role, not the plan
  // field the guard above still excludes.
  const view = readFileSync(join(HERE, 'channelview.js'), 'utf8');
  const markup = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');
  assert.ok(markup.includes('class="card-role"'), 'the card has a role element');
  assert.ok(view.includes('p.card-role'), 'the view writes into it');
  assert.ok(
    markup.indexOf('class="device-name"') < markup.indexOf('class="card-role"'),
    'the role sits under the device heading, not above it',
  );
});

test('⛔ a slot with no role shows nothing, rather than its device id twice', () => {
  // `data.id` falls back to the device's own prefix when no role is set.
  // Measured on the venue board: slots 10 and 12 report id `BP-10` / `BP-12`,
  // identical to their device_id, and would otherwise print it twice.
  const view = readFileSync(join(HERE, 'channelview.js'), 'utf8');
  assert.match(
    view,
    /role\s*&&\s*role\s*!==\s*device/,
    'the role is only drawn when it says something the heading does not',
  );
});

test('⛔⛔ the role is UNDER the device heading, not beside it', () => {
  // It shipped beside it: `.chan-label` is a flex container and was left at the
  // default `row`, so both lines reported `top: 0` in a browser. The comment in
  // the markup said "under" and the CSS did not.
  const css = readFileSync(join(HERE, '..', 'css', 'style.scss'), 'utf8');
  const block = css.slice(css.indexOf('.chan-label {'));
  const rule = block.slice(0, block.indexOf('}'));
  assert.match(rule, /flex-direction:\s*column/, '.chan-label must stack its two lines');
  assert.match(rule, /align-items:\s*center/, 'and centre them across the card');
});
