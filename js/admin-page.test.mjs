import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SECTIONS, allItems, offeredActions, sectionsFor, pageRefused, stateLine,
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
  allItems().forEach((item) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(GUARDED_ACTIONS, item.action),
      `${item.id} declares action "${item.action}", which the lock does not guard`,
    );
  });
});

test('⛔ Help is not on the page, so a locked board can still reach it', () => {
  // The design folded Help into an "About & help" section here. The page is
  // refused when the lock is on, so that would have made Help unreachable on a
  // locked wall tablet -- the one screen somebody reads when they do not yet
  // know how the board works (#187). Help is not guarded and must not become so.
  const ids = allItems().map((i) => i.id);
  assert.ok(!ids.includes('help'), 'Help belongs in the view panel, not behind the lock');
  assert.ok(!ids.includes('qr'), 'and so does the scannable URL');
  assert.ok(!Object.prototype.hasOwnProperty.call(GUARDED_ACTIONS, 'help'));
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

test('⛔ display only refuses every item, and still lists them', () => {
  const drawn = sectionsFor({ lockState: 'on' });
  const items = drawn.flatMap((s) => s.items);
  assert.ok(items.length > 0);
  items.forEach((item) => assert.equal(item.refused, true, `${item.id} must be refused`));
  // Listed, not omitted: a board missing features reads as broken, and
  // somebody goes looking for the fault mid-service.
  assert.equal(items.length, allItems().length);
});

test('an unlocked board refuses nothing', () => {
  sectionsFor({ lockState: 'off' }).flatMap((s) => s.items)
    .forEach((item) => assert.equal(item.refused, false));
});

test('pageRefused answers for the whole door', () => {
  assert.equal(pageRefused('on'), true);
  assert.equal(pageRefused('off'), false);
  // ⚠️ An unset lock is not a locked lock. A board whose preference failed to
  // read must not be mistaken for one deliberately locked down.
  assert.equal(pageRefused(undefined), false);
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

test('receivers count what was found and the channels behind them', () => {
  const facts = { discovered: [{ channels: 4 }, { channels: 4 }, { channels: 1 }] };
  assert.equal(stateLine('receivers', facts), '3 found, 9 channels');
});

test('a receiver that did not say how many channels it has is not counted as zero', () => {
  // `discovered[i].channels` is absent for models whose channel count has
  // never been observed -- `slxd` is empty on purpose (#144). The receiver is
  // still found.
  assert.equal(stateLine('receivers', { discovered: [{}, {}] }), '2 found');
  assert.equal(stateLine('receivers', { discovered: [] }), '0 found');
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

test('backgrounds count pictures and videos separately', () => {
  assert.equal(stateLine('backgrounds', { images: ['a', 'b'], videos: ['c'] }), '2 pictures, 1 video');
  assert.equal(stateLine('backgrounds', { images: ['a'], videos: [] }), '1 picture');
  assert.equal(stateLine('backgrounds', { images: [], videos: [] }), 'None in the folder');
});

test('⚠️ Planning Center separates "no credentials" from "switched off"', () => {
  // Conflating them is how somebody concludes a sync is broken when it was
  // never turned on -- and the switch is the administrator's to flip, not
  // ours ([[admin-switches-are-the-admins]]).
  assert.equal(stateLine('pco', { config: { pco: { auth: {} } } }), 'Not connected');
  assert.equal(
    stateLine('pco', { config: { pco: { auth: { has_credentials: true }, enabled: false } } }),
    'Connected, switched off',
  );
  assert.equal(
    stateLine('pco', { config: { pco: { auth: { has_credentials: true }, enabled: true } } }),
    'Connected',
  );
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
  assert.deepEqual(unroutedItems().sort(), allItems().map((i) => i.id).sort());

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
  // ⚠️ A substring test, not a regex. The helper this replaces built its pattern
  // with a template literal, which swallows the escape before the regex is
  // compiled, so it matched nothing. It failed loudly only because it asserted
  // how many tags it had found rather than assuming one. The project's notes
  // record the same trap from two earlier guards; the cheapest way not to meet
  // it a fourth time is not to write the regex.
  assert.ok(!html.includes('<nav'), 'the menu bar is back; the door must not be inside it');

  // The door is where the gear can reach it: inside the view panel.
  const panelAt = html.indexOf('<div id="view-panel"');
  const doorAt = html.indexOf('id="admin-door"');
  const hudAt = html.indexOf('<div id="hud"');
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
