import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SECTIONS, allItems, offeredActions, sectionsFor, refusedCount, refusedSummary, stateLine,
  UNGUARDED_ITEMS,
  IN_PAGE_ITEMS,
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

  for (const label of labels) {
    assert.ok(
      DOOR_DETAIL.toLowerCase().includes(label.toLowerCase()),
      `the door does not mention "${label}"`,
    );
  }

  // ⚠️ And nothing it mentions is gone. A list that keeps a retired section is
  // the same fault pointing the other way.
  const mentioned = DOOR_DETAIL.split(', ').map((s) => s.trim().toLowerCase());
  const known = new Set(labels.map((l) => l.toLowerCase()));
  for (const name of mentioned) {
    assert.ok(known.has(name), `the door mentions "${name}", which is not a section`);
  }
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

test('an unlocked board refuses nothing', () => {
  sectionsFor({ lockState: 'off' }).flatMap((s) => s.items)
    .forEach((item) => assert.equal(item.refused, false));
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

  // Absent config is still "I do not know", not "none".
  assert.equal(stateLine('screens', { config: {} }), null);
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
    .map((tag) => (/id="([^"]+)"/.exec(tag) || [, '(no id)'])[1]);
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
  const ids = SECTIONS.flatMap((s) => s.items).map((i) => i.id);
  const unknown = ids.filter((id) => !IN_PAGE_ITEMS.includes(id));
  assert.ok(unknown.length >= 8, 'most sections still hand over to an editor');

  // ⚠️ And the two lists are kept apart on purpose: the lock's list is about
  // what may be READ on a locked board, this one about what is DRAWN here.
  // #222 grows this one section at a time, and conflating them would unguard
  // each section as it moved.
  assert.notEqual(IN_PAGE_ITEMS, UNGUARDED_ITEMS);
});
