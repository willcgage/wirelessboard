import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SECTIONS, allItems, offeredActions, sectionsFor, refusedCount, refusedSummary, stateLine,
  UNGUARDED_ITEMS,
  IN_PAGE_ITEMS, shouldFillSection, shouldReleaseSection,
  DOOR_DETAIL, DOOR_SCOPE,
  registerAdminRoute, runAdminRoute, resetAdminRoutes, unroutedItems, adminRouteIds,
} from './admin-page.mjs';
import { GUARDED_ACTIONS } from './viewer-lock.mjs';

// ---------------------------------------------------------------------------
// ⭐⭐ The page and the lock are the same set, and that is the whole design
//
// #188's argument for the move is that the administration page is exactly the
// display-only lock's scope. If that is true it is checkable, and if it is
// checkable it must be checked -- otherwise the argument decays into a claim
// while the two sets drift.
// ---------------------------------------------------------------------------

test('⭐⭐ every guarded action has a route on the page', () => {
  // A guarded action missing from here is a setting that became unreachable
  // once the menu bar went away -- the exact fault #188 exists to fix.
  const guarded = Object.keys(GUARDED_ACTIONS).sort();
  assert.deepEqual(offeredActions(), guarded);
});

test('⛔ nothing on the page is outside the lock\'s scope', () => {
  // The other direction, and the sharper one: an item here that the lock does
  // not guard is a global setting a locked wall tablet could still change.
  //
  // ⚠️ `UNGUARDED_ITEMS` is the allowlist. Help carries no action on purpose --
  // it has to be readable on a locked board (#187) -- and naming the exceptions
  // is what stops a *second* one arriving without anybody deciding to.
  allItems().forEach((item) => {
    if (item.action === null) {
      assert.ok(
        UNGUARDED_ITEMS.includes(item.id),
        `${item.id} has no guarded action and is not in UNGUARDED_ITEMS`,
      );
      return;
    }
    assert.ok(
      Object.prototype.hasOwnProperty.call(GUARDED_ACTIONS, item.action),
      `${item.id} declares action "${item.action}", which the lock does not guard`,
    );
  });
});

test('⛔⛔ Help is on the page, and the lock does not refuse it', () => {
  // The maintainer asked for Help here (2026-10-14). It only works because the
  // door stopped gating the page: Help is the one screen somebody reads when
  // they do not know how the board works, and a locked wall tablet is exactly
  // the board most likely to be read by somebody lost (#187).
  const about = allItems().find((i) => i.id === 'about');
  assert.ok(about, 'Help must be an item on the page');
  assert.equal(about.action, null, 'Help must carry no guarded action');

  const drawn = sectionsFor({ lockState: 'on' }).flatMap((sec) => sec.items);
  const aboutDrawn = drawn.find((i) => i.id === 'about');
  assert.equal(aboutDrawn.refused, false, 'Help must be readable on a locked board');
});

test('⛔ the door names every section, because a half-list reads as the whole list', () => {
  // It listed five of nine -- "Receivers, screens, slots, backgrounds, Planning
  // Center" -- while logs, demo mode, this group and help were also behind it.
  // Somebody reading that concludes the others live somewhere else, which is
  // the confusion #188 exists to end.
  const labels = SECTIONS.flatMap((s) => s.items).map((i) => i.label);
  assert.ok(labels.length >= 9, `expected the full rail, got ${labels.length}`);

  // ⭐ Refined by #179, which split Planning Center into five sections: an item
  // is named on the door, **or the group it belongs to is**. Listing all five
  // put thirteen labels on a line whose job is to help somebody decide whether
  // to open it, and dropped the words "Planning Center" -- the thing they would
  // actually be looking for. One word standing for a group of its own items is
  // not a half-list; five sub-parts of an unnamed whole would be.
  const door = DOOR_DETAIL.toLowerCase();
  for (const section of SECTIONS) {
    const groupNamed = door.includes(section.title.toLowerCase());
    for (const item of section.items) {
      assert.ok(
        door.includes(item.label.toLowerCase()) || groupNamed,
        `the door mentions neither "${item.label}" nor its group "${section.title}"`,
      );
    }
  }

  // ⚠️ And nothing it mentions is gone. A list that keeps a retired section is
  // the same fault pointing the other way.
  const mentioned = DOOR_DETAIL.split(', ').map((s) => s.trim().toLowerCase());
  const known = new Set([
    ...labels.map((l) => l.toLowerCase()),
    ...SECTIONS.map((s) => s.title.toLowerCase()),
  ]);
  for (const name of mentioned) {
    assert.ok(known.has(name), `the door mentions "${name}", which is not a section or a group`);
  }
});

test('⛔ and that door check still fails when something really is missing', () => {
  // Planted: a rail whose group name does not cover its own item. Two of this
  // project's guards passed on everything before anybody tried this.
  const planted = [{ title: 'Setup', items: [{ label: 'Receivers' }, { label: 'Screens & docks' }] }];
  const doorText = 'receivers';
  const missing = planted[0].items.filter(
    (i) => !doorText.includes(i.label.toLowerCase()) && !doorText.includes(planted[0].title.toLowerCase()),
  );
  assert.equal(missing.length, 1, 'the check would have missed a dropped item');
});

test('every item declares an id and a label, and no id twice', () => {
  const ids = allItems().map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'a duplicate id would make one route unreachable');
  allItems().forEach((item) => {
    assert.ok(item.id && typeof item.id === 'string');
    assert.ok(item.label && typeof item.label === 'string');
  });
});

test('the sections are the three the design named, in order', () => {
  assert.deepEqual(SECTIONS.map((s) => s.title), ['Setup', 'Planning Center', 'Diagnostics']);
});

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

test('⛔ display only refuses every guarded item, and still lists them', () => {
  const drawn = sectionsFor({ lockState: 'on' });
  const items = drawn.flatMap((s) => s.items);
  assert.ok(items.length > 0);
  items.forEach((item) => {
    const expected = item.action !== null;
    assert.equal(item.refused, expected, `${item.id} refused should be ${expected}`);
  });
  // Listed, not omitted: a board missing features reads as broken, and
  // somebody goes looking for the fault mid-service.
  assert.equal(items.length, allItems().length);
});

test('an unlocked, connected board refuses nothing', () => {
  // ⚠️ `pco` matters now: the weekly plan is refused without a Planning Center
  // connection, which is a second reason an item can be refused and has
  // nothing to do with the lock. A connected board is the case this asserts.
  sectionsFor({ lockState: 'off', pco: { auth: { has_credentials: true } } })
    .flatMap((s) => s.items)
    .forEach((item) => assert.equal(item.refused, false, `${item.id} was refused`));
});

test('⛔⛔ the weekly plan is refused until the board is connected', () => {
  // It opens the weekly panel, whose plan picker, Preview Sync and Sync Now
  // all read lists that live in the Planning Center account. With no
  // connection it opens onto controls that cannot do anything, while the five
  // sections beside it correctly say "Needs a connection".
  const weekly = (pco) => sectionsFor({ lockState: 'off', pco })
    .flatMap((s) => s.items).find((i) => i.id === 'pco');

  const unconnected = weekly(undefined);
  assert.equal(unconnected.refused, true);
  assert.equal(unconnected.refusedNote, 'Needs a connection');

  // ⛔ Refused, never hidden — a rail that drops an item reads as a board
  // missing features.
  assert.ok(
    sectionsFor({ lockState: 'off' }).flatMap((s) => s.items).some((i) => i.id === 'pco'),
    'it is still listed',
  );

  assert.equal(weekly({ auth: { has_credentials: true } }).refused, false);
});

test('⚠️ the lock’s wording wins when a board is both locked and unconnected', () => {
  // ⛔ Being locked to display only is the bigger fact, and it is the one with
  // an undo. "Needs a connection" would send somebody to Planning Center when
  // the answer is on this board.
  const item = sectionsFor({ lockState: 'on', pco: {} })
    .flatMap((s) => s.items).find((i) => i.id === 'pco');

  assert.equal(item.refused, true);
  assert.equal(item.refusedNote, null, 'the renderer falls back to the lock note');
});

test('⛔ the count of what a locked board refuses, and the line that says so', () => {
  // ⛔⛔ This replaced `pageRefused`, which gated the door. The door opens now;
  // the lock refuses items, and the page says so once at the top.
  const guarded = allItems().filter((i) => i.action !== null).length;
  assert.equal(refusedCount('on'), guarded);
  assert.equal(refusedCount('off'), 0);
  // ⚠️ An unset lock is not a locked lock. A board whose preference failed to
  // read must not be mistaken for one deliberately locked down.
  assert.equal(refusedCount(undefined), 0);

  assert.equal(refusedSummary('off'), null, 'nothing to say when nothing is refused');
  const note = refusedSummary('on');
  assert.match(note, /display only/i);
  assert.match(note, /gear/i, 'and it must say where to undo it');
});

test('the door states the boundary on itself', () => {
  // #116 came out of this split being invisible. It is said three times on
  // purpose; this is the one on the control.
  assert.match(DOOR_SCOPE, /every board/);
  assert.match(DOOR_DETAIL, /Planning Center/);
});

// ---------------------------------------------------------------------------
// The rail's state lines
//
// ⛔ null means "not known", and the caller leaves the line out. Printing
// `0 found` before the first payload states a fact the board does not have.
// ---------------------------------------------------------------------------

test('⛔ a board that has been told nothing shows no state lines', () => {
  allItems().forEach((item) => {
    assert.equal(stateLine(item.id, {}), null, `${item.id} must not invent a figure`);
  });
});

test('⛔ but a LOADED configuration with no Planning Center block says so', () => {
  // Two different silences, and only one of them is "not connected". `{}` is
  // "the first payload has not arrived", where announcing it would be a lie by
  // timing. A config that IS loaded and simply has no `pco` block is a board
  // nobody has connected -- and there, saying nothing reads as missing
  // information rather than as the answer.
  assert.equal(stateLine('pco-connection', { config: {} }), 'Not connected');
  assert.equal(stateLine('pco-matching', { config: {} }), 'Needs a connection');
  assert.equal(stateLine('pco-connection', {}), null);
});

test('receivers count the receivers this board has, not the scan', () => {
  // ⭐ A receiver is an address. Four slots on one box is one receiver.
  const config = {
    slots: [
      { ip: '10.0.0.61', type: 'qlxd' },
      { ip: '10.0.0.61', type: 'qlxd' },
      { ip: '10.0.0.62', type: 'ulxd' },
    ],
  };
  assert.equal(stateLine('receivers', { config, discovered: [] }), '2 receivers, 3 channels');
  assert.equal(
    stateLine('receivers', { config: { slots: [{ ip: '10.0.0.61', type: 'qlxd' }] }, discovered: [] }),
    '1 receiver, 1 channel',
  );
});

test('⛔ a working board never reads "0 found" because the scan was empty', () => {
  // The venue photographed "Receivers -- 0 found" on a board monitoring twelve
  // live channels. Discovery is multicast and does not reach every network;
  // the receivers were configured by address and working the whole time.
  const facts = {
    config: { slots: [{ ip: '10.100.50.61', type: 'ulxd' }, { ip: '10.100.50.62', type: 'ulxd' }] },
    discovered: [],
  };
  const line = stateLine('receivers', facts);
  assert.equal(line, '2 receivers, 2 channels');
  assert.ok(!line.includes('0'), 'nothing here is zero');
});

test('slots with no receiver behind them are not receivers', () => {
  // `offline` slots carry no address, and 1.16.0 saved receiver slots with no
  // IP at all -- neither is a box this board talks to.
  const config = {
    slots: [
      { ip: '10.0.0.61', type: 'qlxd' },
      { type: 'offline' },
      { type: 'slxd' },
      { ip: '', type: 'ulxd' },
    ],
  };
  assert.equal(stateLine('receivers', { config, discovered: [] }), '1 receiver, 1 channel');
});

test('with nothing configured, the scan is what is worth saying', () => {
  const empty = { slots: [] };
  assert.equal(stateLine('receivers', { config: empty, discovered: [{}, {}] }), '2 found, none added yet');
  assert.equal(stateLine('receivers', { config: empty, discovered: [] }), 'None configured');
});

test('a board that has not been told anything yet says nothing', () => {
  // ⛔ Printing a count before the first /data.json states a fact the board
  // does not have, on the screen an administrator uses to judge whether
  // something is wrong.
  assert.equal(stateLine('receivers', {}), null);
  assert.equal(stateLine('receivers', { discovered: [] }), null);
});

test('groups report how many, and what is in none of them', () => {
  // ⭐ The count alone is the boring half. A channel in no group is invisible
  // to anyone viewing groups rather than the combined board, and nothing else
  // on the board says so — it is the question the Groups panel exists to
  // answer, so the rail answers it too.
  const groups = [{ group: 1, slots: [1] }];
  const slots = [{ slot: 1 }, { slot: 2 }, { slot: 3 }];

  assert.equal(stateLine('groups', { config: { groups, slots } }), '1 group, 2 channels in none');
  assert.equal(
    stateLine('groups', { config: { groups, slots: [{ slot: 1 }, { slot: 2 }] } }),
    '1 group, 1 channel in none',
  );
  assert.equal(
    stateLine('groups', { config: { groups, slots: [{ slot: 1 }] } }),
    '1 group',
  );
  assert.equal(
    stateLine('groups', {
      config: { groups: [{ group: 1, slots: [1] }, { group: 2, slots: [2] }], slots },
    }),
    '2 groups, 1 channel in none',
  );
});

test('a board with no groups is not reported as having every channel loose', () => {
  // ⚠️ True and useless: with no groups, channels still show on All channels,
  // which is the ordinary state of a board nobody has grouped.
  assert.equal(
    stateLine('groups', { config: { groups: [], slots: [{ slot: 1 }, { slot: 2 }] } }),
    'None yet',
  );
});

test('⛔ a null in a group\'s stored list cannot claim a channel', () => {
  // `Number(null)` is 0 — finite, and it passes every obvious guard. The slot
  // list is read through the same helper that was hardened for #243, so junk
  // is discarded rather than claiming a phantom channel and hiding an orphan.
  const config = { groups: [{ group: 1, slots: [null, '', 1] }], slots: [{ slot: 1 }, { slot: 2 }] };
  assert.equal(stateLine('groups', { config }), '1 group, 1 channel in none');

  // A group saved without a membership at all claims nothing.
  assert.equal(
    stateLine('groups', { config: { groups: [{ group: 1 }], slots: [{ slot: 1 }] } }),
    '1 group, 1 channel in none',
  );
});

test('⛔ a loaded config with no groups key is not the same silence', () => {
  // The case was written and the rail still read blank on a real board: the
  // dev configuration has no 197609 key at all, and treating that like
  // "not told anything yet" meant the one state worth reporting -- a board
  // nobody has grouped -- was the one that said nothing. Found by looking at
  // the running rail, not by this suite.
  assert.equal(stateLine('groups', { config: {} }), 'None yet');
  assert.equal(stateLine('groups', { config: { slots: [{ slot: 1 }] } }), 'None yet');

  // Before the first payload there is still nothing honest to say.
  assert.equal(stateLine('groups', {}), null);
});

test('⛔ every Setup item reports itself — none sits blank', () => {
  // The general shape of the gap: Groups was the one rail item with no state
  // line at all, so it sat blank while every neighbour reported itself. Found
  // in a venue photograph rather than by anything in this suite.
  //
  // ⚠️ Scoped to Setup on purpose. Diagnostics items are doors, not settings —
  // Logs and Demo mode have no state to report and saying nothing is correct.
  const facts = {
    config: {
      screens: [{ diagonal: 55 }],
      slots: [{ slot: 1, extended_name: 'Someone' }],
      groups: [{ group: 1, slots: [1] }],
      pco: {},
    },
    discovered: [{ channels: 4 }],
    images: ['a.jpg'],
    videos: [],
  };

  const setup = SECTIONS.find((s) => /setup/i.test(s.title));
  assert.ok(setup, 'there is a Setup section');

  const blank = setup.items
    .filter((item) => stateLine(item.id, facts) === null)
    .map((item) => item.label);

  assert.deepEqual(blank, [], `these Setup items report nothing: ${blank}`);
});

test('⛔ Screens reports itself on a board that has never described one', () => {
  // The state every board is in out of the box: a loaded configuration with no
  // `screens` key at all. Neither `democonfig.json` nor the minimal fallback
  // carries one, and requiring it meant this item sat blank exactly when it
  // had something to say.
  //
  // ⭐ And it is the item that can least afford to. Describing a screen is
  // step one of the dock -> column-floor chain, which has never once worked on
  // hardware; the rail is where an operator would see the step is still undone.
  assert.equal(stateLine('screens', { config: { slots: [], groups: [] } }), 'None described');

  // ⚠️ Docks without screens is a real state and already had wording. It must
  // survive the key being absent rather than empty.
  assert.equal(
    stateLine('screens', { config: { docks: [{}, {}] } }),
    'No screens, 2 docks',
  );

  // Before the first payload there is still nothing honest to say.
  assert.equal(stateLine('screens', {}), null);
});

test('⛔ the fixture this was got wrong with', () => {
  // I first reported this as three broken items -- Receivers and Slots as well
  // -- having measured against `config: {}`, an object that never occurs. Both
  // ship `slots: []` and report correctly, so the defect was one item, not
  // three. The fixture is pinned here so the claim stays checkable.
  const shipped = { port: 8058, groups: [], slots: [] };
  assert.equal(stateLine('receivers', { config: shipped, discovered: [] }), 'None configured');
  assert.equal(stateLine('slots', { config: shipped }), 'None configured');
  assert.equal(stateLine('groups', { config: shipped }), 'None yet');
  assert.equal(stateLine('screens', { config: shipped }), 'None described');
});

test('screens and slots report what is described and what is named', () => {
  assert.equal(stateLine('screens', { config: { screens: [{}, {}, {}] } }), '3 screens described');
  assert.equal(stateLine('screens', { config: { screens: [{}] } }), '1 screen described');
  assert.equal(stateLine('screens', { config: { screens: [] } }), 'None described');

  const slots = [
    { slot: 1, extended_name: 'Dave' },
    { slot: 2, extended_name: '   ' },
    { slot: 3 },
  ];
  assert.equal(stateLine('slots', { config: { slots } }), '3, 1 named');
  assert.equal(stateLine('slots', { config: { slots: [] } }), 'None configured');
});

test('⭐ the screens line counts what is underneath, because the item owns it', () => {
  const screens = [{}, {}, {}];

  // ⛔ The state the whole column-floor chain depends on, and the one no board
  // has ever actually been in on hardware: screens described, nothing below
  // them. #170/#201 has shipped three times and engaged zero times.
  assert.equal(stateLine('screens', { config: { screens } }), '3 screens described');
  assert.equal(
    stateLine('screens', { config: { screens, docks: [] } }),
    '3 screens described',
  );

  assert.equal(
    stateLine('screens', {
      config: { screens, docks: [{ kind: 'charging' }, { kind: 'charging' }] },
    }),
    '3 screens, 2 docks',
  );
  assert.equal(
    stateLine('screens', { config: { screens, docks: [{ kind: 'charging' }] } }),
    '3 screens, 1 dock',
  );

  // ⛔ One noun, whatever the kinds are: **everything underneath a screen is a
  // dock**. Whether it charges, and whether it can be talked to, is a fact
  // about a dock rather than a reason to count it apart -- so a room with one
  // of each still reads "3 docks" and never "1 dock and 2 somethings".
  assert.equal(
    stateLine('screens', {
      config: {
        screens,
        docks: [{ kind: 'charging' }, { kind: 'networked' }, { kind: 'noncharging' }],
      },
    }),
    '3 screens, 3 docks',
  );

  // A dock can exist before any screen is described -- #189 is why that order
  // happens at all, and the line must not read "None described" when the list
  // below it is not empty.
  assert.equal(
    stateLine('screens', { config: { screens: [], docks: [{ kind: 'charging' }] } }),
    'No screens, 1 dock',
  );
  assert.equal(stateLine('screens', { config: { screens: [], docks: [] } }), 'None described');

  // ⛔ An ABSENT config is still "I do not know", not "none" -- and `{config: {}}`
  // is not absent. That conflation is what this assertion used to encode, and
  // the comment above it said "absent config" about a config that is plainly
  // present and merely empty. A loaded configuration with no `screens` key is
  // every board out of the box, and it has something to say.
  assert.equal(stateLine('screens', {}), null, 'no config at all: say nothing');
  assert.equal(stateLine('screens', { config: {} }), 'None described');
});

test('backgrounds count pictures and videos separately', () => {
  assert.equal(stateLine('backgrounds', { images: ['a', 'b'], videos: ['c'] }), '2 pictures, 1 video');
  assert.equal(stateLine('backgrounds', { images: ['a'], videos: [] }), '1 picture');
  assert.equal(stateLine('backgrounds', { images: [], videos: [] }), 'None in the folder');
});

test('⚠️ Planning Center separates "no credentials" from "switched off"', () => {
  // Conflating them is how somebody concludes a sync is broken when it was
  // never turned on -- and the switch is the administrator's to flip, not
  // ours ([[admin-switches-are-the-admins]]).
  // ⭐ On the Connection section now: #179 split the one item into five, and
  // this is the one that reports the connection itself.
  assert.equal(stateLine('pco-connection', { config: { pco: { auth: {} } } }), 'Not connected');
  assert.equal(
    stateLine('pco-connection', { config: { pco: { auth: { has_credentials: true }, enabled: false } } }),
    'Connected, switched off',
  );
  assert.equal(
    stateLine('pco-connection', { config: { pco: { auth: { has_credentials: true }, enabled: true } } }),
    'Connected',
  );
  // ⛔ And the four below it say they need one, rather than reading as empty.
  ['pco-matching', 'pco-rulesets', 'pco-calendar', 'pco-live'].forEach((id) => {
    assert.equal(stateLine(id, { config: { pco: { auth: {} } } }), 'Needs a connection');
  });
});

test('a late-filled micboard does not throw', () => {
  // `config` is absent until the first /data.json, and the panel can be opened
  // before then.
  [null, undefined, 'nonsense', 42, []].forEach((config) => {
    allItems().forEach((item) => {
      assert.doesNotThrow(() => stateLine(item.id, { config }));
    });
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test('⛔ a rail item with no route is reported, not left to be clicked', () => {
  // #188's criterion is that no route disappears. An item that draws but does
  // nothing is the same failure as a missing item and harder to notice.
  resetAdminRoutes();
  // ⚠️ Every item EXCEPT the ones the page draws itself. Those never register
  // a route by design, and reporting them put a red "no route registered"
  // warning under the rail on every open of a page that was working correctly.
  const needRoutes = allItems()
    .map((i) => i.id)
    .filter((id) => !IN_PAGE_ITEMS.includes(id));
  assert.deepEqual(unroutedItems().sort(), needRoutes.sort());
  assert.ok(needRoutes.length > 0, 'the check still covers something');

  allItems().forEach((item) => registerAdminRoute(item.id, () => {}));
  assert.deepEqual(unroutedItems(), []);
  assert.deepEqual(adminRouteIds(), allItems().map((i) => i.id).sort());
});

test('a route runs once, and an unknown route says so rather than throwing', () => {
  resetAdminRoutes();
  let ran = 0;
  registerAdminRoute('receivers', () => { ran += 1; });
  assert.equal(runAdminRoute('receivers'), true);
  assert.equal(ran, 1);
  assert.equal(runAdminRoute('nothing-here'), false);
  assert.equal(ran, 1);
});

test('junk registrations are ignored rather than stored', () => {
  resetAdminRoutes();
  registerAdminRoute('x', null);
  registerAdminRoute(null, () => {});
  registerAdminRoute(undefined, undefined);
  assert.deepEqual(adminRouteIds(), []);
});

// ---------------------------------------------------------------------------
// ⛔⛔ No route disappears when the top bar is hidden
//
// This is #188's first acceptance criterion and the fault it exists to fix.
// `body.topbar-hidden .navbar { display: none }` removed the only pointer route
// to every global setting, and #160 had already retired the keyboard -- so the
// way to reach a global setting was to put back a bar you had deliberately
// hidden. Every one of the first sixteen beta.4 venue photographs is in that
// state.
//
// Structural, not behavioural: the route must not *live* inside the thing that
// gets hidden, and nothing may hide it under that class.
// ---------------------------------------------------------------------------

const ROOT = path.join(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('⛔⛔ there is no bar for the door to be trapped inside', () => {
  const html = read('demo.html');
  // #221 put the door in the view panel while the menu bar was still there, and
  // this guard checked the door was not inside the bar. #188's second half
  // retired the bar outright, so the stronger statement is available.
  //
  // ⛔⛔ No `\b` in these patterns, on purpose. Written through a shell
  // heredoc once, the `\b` arrived as a literal backspace (0x08) and
  // `/class="[^"]*\bnavbar\b/` became a pattern matching nothing -- it would
  // have passed with the menu bar back in the markup. Fourth time an escape has
  // been eaten before the regex saw it here; character classes cannot be eaten.
  //
  // ⚠️ And `<nav` alone is no longer the right proxy anyway: #188's
  // full-screen administration page (2026-10-15) gives its section rail a
  // `<nav>`, which is what a rail is. So this is a CENSUS -- it says which navs
  // are allowed, so a new one has to be justified here rather than slipping in
  // behind a passing test.
  const navIds = (html.match(/<nav[^>]*>/g) || [])
    .map((tag) => {
      const found = /id="([^"]+)"/.exec(tag);
      return found ? found[1] : '(no id)';
    });
  assert.deepEqual(
    navIds,
    ['admin-page-rail'],
    'the only <nav> in the document is the administration rail',
  );
  assert.ok(
    !/class="[^"]*navbar[\s"]/.test(html),
    'the menu bar is back in the markup',
  );
  assert.ok(
    !/id="nav-menu-button"/.test(html),
    'the Menu dropdown is back in the markup',
  );

  // The door is where the gear can reach it: inside the view panel.
  const panelAt = html.indexOf('<div id="view-panel"');
  const doorAt = html.indexOf('id="admin-door"');
  // ⚠️ Was `<div id="hud"`, the Help overlay that followed the panel in the
  // markup. #225 retired it, so the next element is the administration overlay.
  const hudAt = html.indexOf('<div id="admin-page"');
  assert.ok(panelAt > 0 && doorAt > panelAt, 'the door belongs inside the view panel');
  assert.ok(doorAt < hudAt, 'and before the panel ends');
});

test('⛔ and the door is not hidden by the locked-menu rule', () => {
  // ⛔⛔ The bug this exists for: #221 gave the door `data-wb-global`, which
  // `body.viewer-locked [data-wb-global] { display: none }` hides outright --
  // when the whole design is that it is drawn *refused*, with the reason and
  // where to undo it. A door that vanishes teaches nobody that the lock is on.
  const html = read('demo.html');
  const doorTag = html.match(/<button[^>]*id="admin-door"[^>]*>/);
  assert.ok(doorTag, 'expected the door button in the markup');
  assert.ok(
    !/data-wb-global/.test(doorTag[0]),
    'the door carries data-wb-global, so a locked board hides it instead of refusing it',
  );
});

test('⛔ nothing hides the route when the bar is hidden', () => {
  const css = read('css/style.scss');
  // Every selector that `body.topbar-hidden` hides, with its declarations.
  const rules = [...css.matchAll(/body\.topbar-hidden([^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 1, 'expected at least one topbar-hidden rule');

  const forbidden = ['.view-panel', '.admin-door', '.admin-page', '.topbar-restore'];
  rules.forEach(([, selector, body]) => {
    if (!/display\s*:\s*none|visibility\s*:\s*hidden/.test(body)) {
      return;
    }
    forbidden.forEach((needle) => {
      assert.ok(
        !selector.includes(needle),
        `body.topbar-hidden hides ${needle}, which is a route to a global setting`,
      );
    });
  });
});

test('⭐ and the door is reached from the gear, which the bar never carried', () => {
  // The gear is the one control a board can always reach (#110). The door being
  // in the panel it opens is what makes "pointer only, bar hidden" true.
  const app = read('js/app.js');
  assert.match(app, /openAdmin:\s*openAdminPage/, 'the panel must be given the page to open');
  assert.match(app, /initAdminPage\(/, 'and the page has to be initialised');
});

test('⛔ a section the page draws itself is not reported as broken', () => {
  // The full-screen page renders Help in the content pane instead of handing
  // over to an editor, so it never registers a route -- and the "no route"
  // warning called that a fault, in red, under the rail, on every open.
  //
  // ⚠️ The warning also told people to "Use the Menu instead", which #188's
  // second half retired. The one sentence shown when something IS broken was
  // pointing at a bar that no longer exists.
  assert.ok(IN_PAGE_ITEMS.includes('about'), 'Help is drawn in the page');
  assert.ok(!unroutedItems().includes('about'), 'and so is not an unrouted item');

  // ⛔ But the check must still have teeth: a section that neither registers a
  // route nor is drawn in the page is exactly the failure #188 names.
  //
  // ⚠️ This used to assert `>= 8 sections still hand over`, which was a
  // snapshot of one afternoon rather than an invariant -- #222's whole job is
  // to make that number fall, so the first section to move broke it.
  //
  // ⛔ What is actually invariant is the mechanism: a section that is NOT drawn
  // in the page is reported when it has no route. Routes are registered by
  // `app.js` at runtime, so a bare test sees none -- which makes this the
  // strongest form available here, and it still fails if the exclusion is ever
  // widened to swallow a section that really is missing.
  resetAdminRoutes();
  const ids = SECTIONS.flatMap((s) => s.items).map((i) => i.id);
  const reported = unroutedItems();
  for (const id of ids) {
    assert.equal(
      reported.includes(id),
      !IN_PAGE_ITEMS.includes(id),
      `"${id}" is reported as unrouted when it should not be, or the reverse`,
    );
  }

  // ⚠️ And the two lists are kept apart on purpose: the lock's list is about
  // what may be READ on a locked board, this one about what is DRAWN here.
  // #222 grows this one section at a time, and conflating them would unguard
  // each section as it moved.
  assert.notEqual(IN_PAGE_ITEMS, UNGUARDED_ITEMS);
});

test('⛔⛔ a moved editor is filled when it opens, never on a redraw (#180)', () => {
  // The first version of this refilled on every render. `renderAdminPage` runs
  // on every `wirelessboard:viewers` event, so a row somebody had just added
  // vanished about a second later -- measured in the browser, not reasoned
  // about. ⛔ A stored configuration never contains a half-typed row, which is
  // the whole of #180 and the reason no screen could be described until #189.
  assert.equal(shouldFillSection({ view: 'screens', shown: null, id: 'screens' }), true);

  // ⛔ The regression itself: the section is open, the page redraws, and the
  // editor must NOT be refilled underneath whoever is typing in it.
  assert.equal(shouldFillSection({ view: 'screens', shown: 'screens', id: 'screens' }), false);

  // Closed sections are never filled, whatever was last shown.
  assert.equal(shouldFillSection({ view: 'rail', shown: null, id: 'screens' }), false);
  assert.equal(shouldFillSection({ view: 'about', shown: 'screens', id: 'screens' }), false);
  assert.equal(shouldFillSection({ view: 'screens', shown: 'screens', id: 'slots' }), false);

  // ⭐ And leaving a section and coming back DOES refill it, which is the part
  // that makes the trade acceptable: the way to see another board's save is to
  // reopen the section.
  assert.equal(shouldFillSection({ view: 'screens', shown: null, id: 'screens' }), true);
});

test('⛔⛔ a section that keeps something running is released when it closes', () => {
  // Logs is why this exists: the viewer follows the file on a timer, and the
  // configuration page only ever stopped it by switching to another tab.
  assert.equal(shouldReleaseSection({ view: 'rail', shown: 'logs', id: 'logs' }), true);
  assert.equal(shouldReleaseSection({ view: 'screens', shown: 'logs', id: 'logs' }), true);

  // ⛔ Not while it is still open. This is the mirror of the #180 fault on the
  // fill side: the page redraws constantly, and a release on every redraw
  // would stop the timer under somebody who is watching the log scroll.
  assert.equal(shouldReleaseSection({ view: 'logs', shown: 'logs', id: 'logs' }), false);

  // ⚠️ And never for a section that was not the one open, so a release never
  // stops something it did not start.
  assert.equal(shouldReleaseSection({ view: 'rail', shown: null, id: 'logs' }), false);
  assert.equal(shouldReleaseSection({ view: 'rail', shown: 'screens', id: 'logs' }), false);

  // ⭐ Fill and release are exact opposites on the same transition, which is
  // what makes "open" and "close" meaningful rather than two loose callbacks.
  const leaving = { view: 'rail', shown: 'logs', id: 'logs' };
  assert.equal(shouldFillSection(leaving), false);
  assert.equal(shouldReleaseSection(leaving), true);
  const entering = { view: 'logs', shown: null, id: 'logs' };
  assert.equal(shouldFillSection(entering), true);
  assert.equal(shouldReleaseSection(entering), false);
});

test('⛔⛔ every id a moved pane is bound through still exists in the markup', () => {
  // The cost of getting this wrong, measured: Logs moved into the
  // administration page and `bindLogViewerHandlers` kept looking up
  // `config-logs-view`. It returned early, so NOTHING in the viewer was bound
  // -- no refresh, no live tail, no filters, no download, no purge -- while
  // the entries still appeared, because the load is called directly. The
  // section looked completely correct and every control was dead.
  //
  // ⚠️ A move is exactly when this breaks, and a screenshot cannot see it.
  const html = read('demo.html');
  const config = read('js/config.js');

  // The roots the viewer binds through, as `config.js` names them.
  const roots = [...config.matchAll(/const (\w*ROOT) = '([^']+)';/g)].map((m) => m[2]);
  assert.ok(roots.includes('admin-section-logs'), 'the log viewer declares its root');

  for (const root of roots) {
    assert.ok(
      html.includes(`id="${root}"`),
      `config.js binds through "${root}", which is not in the markup`,
    );
  }

  // ⛔ And the ids the moved sections own must each appear exactly once --
  // twice means the old pane was copied rather than moved, which is how a
  // board saves from a screen somebody thought was read-only.
  for (const id of ['screen-list', 'dock-list', 'logs-table', 'log-settings-form']) {
    const seen = html.split(`id="${id}"`).length - 1;
    assert.equal(seen, 1, `"${id}" appears ${seen} times; a moved pane was copied`);
  }

  // The panes really left the configuration page.
  assert.ok(!html.includes('id="cfg-screens-col"'), 'the screens column is still in Config');
  assert.ok(!html.includes('id="config-logs-view"'), 'the logs view is still in Config');
});

/**
 * ⛔⛔ Every registered route must be reachable from the rail.
 *
 * The `pco` route existed, was registered, guarded, and tested — and **no rail
 * item pointed at it**. #222 moved the five Planning Center setup sections into
 * `IN_PAGE_ITEMS`, so each renders a pane and none ever reaches the route. The
 * weekly surface behind it — the plan picker, Preview Sync, Sync Now — had no
 * door at all: the board could be configured and could not be synced.
 *
 * Reported from the venue as "You have no preview button, nor do you have a
 * Sync button!" after it had been described, by me, from the source.
 *
 * ⚠️ `unroutedItems` was the mirror of this and could not catch it: it asks
 * "does every item have a route", never "does every route have an item".
 */
test('⛔⛔ a registered route with no rail item is unreachable', () => {
  resetAdminRoutes();
  const reached = new Set(allItems().map((item) => item.id));

  // The routes the application actually registers, named here because this
  // module cannot import `app.js` without booting a board.
  for (const id of ['pco', 'demo']) {
    assert.ok(
      reached.has(id),
      `the "${id}" route has no rail item, so nothing can reach it`,
    );
  }
});

test('⛔⛔ the weekly plan is LAST under Planning Center, after its prerequisites', () => {
  const group = SECTIONS.find((s) => s.title === 'Planning Center');
  assert.ok(group, 'the group exists');

  // ⛔ It used to be first, on the argument that it is the only part most
  // weeks need. True of a board already set up — and wrong for the board in
  // front of somebody setting one up, which is the state this rail is read in.
  // Syncing a plan is the one thing here that cannot be done at all without a
  // connection, so it led a list whose every other item is a prerequisite.
  const last = group.items[group.items.length - 1];
  assert.equal(last.id, 'pco');
  assert.match(last.label, /plan/i);

  // ⭐ The order reads as the job: connect, say how names match, add rules,
  // decide what happens unattended — then run it.
  assert.equal(group.items[0].id, 'pco-connection');
});

test('⛔⛔ EVERY Planning Center item is drawn in the page, the weekly one included', () => {
  // ⛔ This asserted the opposite: `pco` was the one item NOT in the list, so
  // it handed over to a route that hid the board and took the whole screen.
  // One entry in a list of six navigating differently from the other five is
  // what kept its look drifting away from the page around it -- it was
  // restyled twice before anyone asked why it was a page at all.
  const group = SECTIONS.find((s) => s.title === 'Planning Center');
  const inPage = group.items.filter((i) => IN_PAGE_ITEMS.includes(i.id));

  assert.equal(inPage.length, group.items.length, 'no Planning Center item hands over');
  assert.ok(IN_PAGE_ITEMS.includes('pco'), 'the weekly surface is a pane');
});

test('⛔ and nothing on the rail hands over to a route any more except the two that must', () => {
  // ⚠️ `demo` reloads the board and `about` is drawn by the page itself, so
  // neither is a pane in the same sense. Everything else is.
  const handing = SECTIONS.flatMap((s) => s.items)
    .filter((i) => i.action !== null && !IN_PAGE_ITEMS.includes(i.id))
    .map((i) => i.id);

  assert.deepEqual(handing, ['demo'], `these still take the whole screen: ${handing}`);
});
