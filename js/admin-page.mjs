/**
 * The administration surface: one page for everything that is not this screen
 * (#188).
 *
 * ⛔ **Why this exists, and why it is not cosmetic.** The menu bar carried the
 * only pointer route to every global setting, and `body.topbar-hidden .navbar`
 * removes it. #160 then retired the keyboard, so with the bar hidden there was
 * no `S`, no `?`, and no pointer route either: the way to reach any global
 * setting was to first put back a bar you had deliberately hidden. Every one of
 * the first sixteen venue photographs is in exactly that state.
 *
 * ⭐⭐ **The page is the display-only lock's scope, drawn as one page.**
 * `GUARDED_ACTIONS` in `viewer-lock.mjs` already names exactly this set --
 * config, group editing, slot naming, the background library, Planning Center,
 * demo mode. So this is not a new thing to protect; it is the existing guarded
 * set given one front door. That is the strongest argument for the move **and
 * it is the test**: if something belongs behind the lock it belongs here, and if
 * it does not it stays in the view panel. `SECTIONS` is checked against
 * `GUARDED_ACTIONS` both ways, so the two cannot drift apart.
 *
 * ⛔ **Help IS here, and that is why the door is unguarded.** Help was kept out
 * of this page at first, because the page was refused outright when the lock
 * was on and that would have made Help unreachable on a locked wall tablet --
 * Help being the one screen somebody reads when they do not yet know how the
 * board works (#187). The maintainer asked for it here, so **the gating moved
 * rather than the guarantee**: the door opens even when locked, and the eight
 * guarded items refuse themselves one by one (`sectionsFor`, since #221). Help
 * carries no guarded action, so it stays readable.
 *
 * ⚠️ The consequence is the thing to remember: **nothing may be added to this
 * page that must not be seen on a locked board.** The door no longer protects
 * it; only the per-item refusal does, and that is keyed on `action`.
 */

import { GUARDED_ACTIONS, allows } from './viewer-lock.mjs';
import { PCO_SECTIONS, PCO_SECTION_IDS, pcoStateLine } from './pco-sections.mjs';

/**
 * The page, in the order it is read.
 *
 * Each item's `action` is a `GUARDED_ACTIONS` key, which is what makes the lock
 * the single source of what may be opened -- an item cannot be added here
 * without declaring which guarded action it is.
 */
export const SECTIONS = [
  {
    title: 'Setup',
    items: [
      { id: 'receivers', label: 'Receivers', action: 'config' },
      // ⭐ "& docks" because a dock is **not** a property of a screen
      // (`docks.mjs`): one dock sits under several screens, a screen can have
      // none, and #203 moved the width off the screen row onto the dock for
      // exactly that reason. The dock list had no route of its own, so it was
      // reachable only by knowing it was further down the screens pane. Naming
      // it on the rail is the whole fix -- settled with the maintainer
      // 2026-10-15.
      { id: 'screens', label: 'Screens & docks', action: 'config' },
      { id: 'slots', label: 'Slots', action: 'slot-edit' },
      // ⛔ `This group` folded into `Groups` when the configuration page was
      // retired (#222, settled 2026-10-15). Two rail items both saying "group"
      // -- one the list, one the group this screen happens to be showing --
      // could not be told apart from their labels. ⭐ The shown group is now a
      // marked ROW in the list, which costs one more click to edit and buys
      // one door instead of two.
      { id: 'groups', label: 'Groups', action: 'group-edit' },
      { id: 'backgrounds', label: 'Backgrounds', action: 'background-library' },
    ],
  },
  {
    title: 'Planning Center',
    // ⛔ Five items, not one (#179). Connecting is done once ever and was 4 of
    // the 26 controls in the panel, yet it opened it; everything done
    // repeatedly sat below it, down a scroll, behind a `<details>` labelled
    // "rarely changes". ⭐ Each section now owns its own keys and saves itself,
    // so changing one setting no longer rewrites all of them from whatever the
    // page happened to be holding. `pco-sections.mjs` holds the ownership.
    //
    // ⚠️ All five keep `action: 'pco'`, so the lock refuses the whole group on
    // a locked board exactly as the single item did.
    items: PCO_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      action: 'pco',
    })),
  },
  {
    title: 'Diagnostics',
    items: [
      { id: 'logs', label: 'Logs', action: 'config' },
      // ⚠️ Filed under Diagnostics because that is how it is used, though it is
      // a board-wide data switch and an argument exists for Setup. Noted as
      // open on #188 rather than settled quietly.
      { id: 'demo', label: 'Demo mode', action: 'demo' },
      // ⛔⛔ No action, and that is the whole point of it being here.
      //
      // Help lived in the view panel because this page was refused outright
      // when the board was locked, and Help is the one screen somebody reads
      // when they do not yet know how the board works (#187). The maintainer
      // asked for it on this page, so the *gating* moved rather than the
      // guarantee: the door opens even when locked, and the six guarded items
      // refuse themselves. `sectionsFor` has rendered per-item refusals since
      // #221; the all-or-nothing door is what made them unreachable.
      { id: 'about', label: 'Help & about', action: null },
    ],
  },
];

/**
 * Items that carry no guarded action, listed on purpose.
 *
 * ⛔ An allowlist, not a rule. "Anything may be unguarded" is how a global
 * setting ends up reachable on a locked wall tablet; naming the exceptions
 * means a new one cannot arrive by accident, and `admin-page.test.mjs` fails if
 * an item outside this list has no action.
 */
export const UNGUARDED_ITEMS = ['about'];

/** Every item, flattened, in reading order. */
export function allItems() {
  return SECTIONS.flatMap((section) => section.items);
}

/**
 * The guarded actions this page offers a route to.
 *
 * ⭐ Compared against `GUARDED_ACTIONS` in both directions by the tests: a
 * guarded action missing from here is a setting that became unreachable, and an
 * action here that the lock does not guard is a setting the lock would let a
 * wall tablet change.
 *
 * ⚠️ Items with no action are skipped, and only the ones named in
 * `UNGUARDED_ITEMS` are allowed to have none.
 */
export function offeredActions() {
  return [...new Set(allItems().map((item) => item.action).filter(Boolean))].sort();
}

/**
 * The page as it should be drawn for a given lock state.
 *
 * ⚠️ Refused items are still listed. A locked board that simply omits them
 * reads as a board missing features, and somebody will go looking for the
 * fault; the refusal says what it is and where to undo it (`refusalNote`).
 */
export function sectionsFor({ lockState } = {}) {
  return SECTIONS.map((section) => ({
    title: section.title,
    items: section.items.map((item) => ({
      ...item,
      refused: !allows(lockState, item.action),
    })),
  }));
}

/**
 * How many of the page's items a locked board refuses.
 *
 * ⛔⛔ This replaced `pageRefused`, which gated the **door**. That was the
 * all-or-nothing version: locked meant the door would not open, so the per-item
 * refusals below were effectively unreachable, and Help could not live on this
 * page at all without becoming unreachable with them (#187).
 *
 * The door now always opens. What the lock refuses, it refuses on the item, and
 * `refusedCount` is what the page uses to say so once at the top instead of
 * leaving somebody to discover it a tap at a time.
 */
export function refusedCount(lockState) {
  return allItems().filter((item) => !allows(lockState, item.action)).length;
}

/**
 * The line the page shows when some of it is refused.
 *
 * ⚠️ Says where to undo it. A refusal that does not is a dead end with an
 * explanation.
 */
export function refusedSummary(lockState) {
  const n = refusedCount(lockState);
  if (!n) {
    return null;
  }
  return `${n} of these are locked to display only. Unlock this board in the gear, under On screen.`;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * How many receivers this board is configured to talk to, and how many channels
 * those cover.
 *
 * ⛔ A receiver is an *address*, not a slot: a four-channel receiver is one
 * box carrying four slots, and counting slots would report four receivers.
 * Distinct `ip` is the only thing in the config that identifies the box.
 *
 * ⚠️ A slot of type `offline` has no receiver behind it at all, and a slot
 * saved without an address cannot connect -- 1.16.0's config page allowed
 * exactly that. Neither is a receiver.
 *
 * Returns `null` when the board has not been told its config yet, which the
 * caller turns into no line at all rather than into a zero.
 */
function configuredReceivers(config) {
  if (!config || !Array.isArray(config.slots)) {
    return null;
  }
  const addresses = new Set();
  let channels = 0;
  config.slots.forEach((slot) => {
    if (!slot || typeof slot !== 'object') return;
    if (!slot.ip || slot.type === 'offline') return;
    addresses.add(String(slot.ip));
    channels += 1;
  });
  return { receivers: addresses.size, channels };
}

/**
 * The state line under a rail item, so nothing has to be opened to be read.
 *
 * ⛔ Returns `null` when the board has not been told, and the caller leaves the
 * line out. The alternative -- printing `0 found` before the first payload
 * arrives -- states a fact the board does not have, on the one screen an
 * administrator uses to decide whether anything is wrong.
 *
 * ⚠️ `facts` is read from `micboard`, which is late-filled: `config` is absent
 * until the first `/data.json`, so every branch here has to survive that.
 */
export function stateLine(id, facts = {}) {
  const config = facts.config && typeof facts.config === 'object' ? facts.config : null;

  switch (id) {
    case 'receivers': {
      // ⛔⛔ This line used to count `discovered` and nothing else, so a board
      // happily monitoring twelve channels read "0 found" whenever the
      // discovery scan came back empty -- which it does on any network where
      // multicast does not reach, even though the receivers are configured by
      // address and working. The venue photographed exactly that.
      //
      // ⭐ Discovery is a tool *inside* the Receivers section, not the subject
      // of it. The subject is the receivers this board has.
      const configured = configuredReceivers(config);
      const discovered = Array.isArray(facts.discovered) ? facts.discovered : null;

      if (configured === null && discovered === null) {
        return null;
      }

      if (configured && configured.receivers > 0) {
        return `${plural(configured.receivers, 'receiver', 'receivers')}, `
          + `${plural(configured.channels, 'channel', 'channels')}`;
      }

      // ⭐ Nothing configured yet. *Now* the scan is the interesting fact,
      // because it is the next thing the administrator will act on.
      if (discovered && discovered.length > 0) {
        return `${discovered.length} found, none added yet`;
      }

      return configured === null ? null : 'None configured';
    }

    case 'screens': {
      if (!config || !Array.isArray(config.screens)) {
        return null;
      }
      const n = config.screens.length;
      const screens = n === 0 ? null : `${plural(n, 'screen', 'screens')}`;

      // ⭐ The item owns the dock list too, so the line has to be able to say
      // "screens described, nothing underneath them" -- which is the state the
      // whole column-floor chain depends on and the state no board has ever
      // actually been in on hardware.
      //
      // ⚠️ One noun, because **everything underneath a screen is a dock**
      // (settled 2026-10-15). An earlier version of this line counted "pads"
      // separately so as not to claim charging that was not in the room; the
      // model changed instead, and a charging dock, a networked one and one
      // that charges nothing are now three kinds of the same object. Whether it
      // charges is a fact about a dock, not a reason to count it apart.
      const docks = Array.isArray(config.docks) ? config.docks : [];
      const below = docks.length ? plural(docks.length, 'dock', 'docks') : null;

      if (!screens) {
        return below ? `No screens, ${below}` : 'None described';
      }
      return below ? `${screens}, ${below}` : `${screens} described`;
    }

    case 'slots': {
      if (!config || !Array.isArray(config.slots)) {
        return null;
      }
      const { slots } = config;
      // The person's name, which is `extended_name` in the stored config --
      // `name` on a channel is resolved from it ([[slot-naming-and-media]]).
      const named = slots.filter((s) => String((s && s.extended_name) || '').trim()).length;
      if (!slots.length) {
        return 'None configured';
      }
      return `${slots.length}, ${named} named`;
    }

    case 'backgrounds': {
      if (!Array.isArray(facts.images) && !Array.isArray(facts.videos)) {
        return null;
      }
      const pictures = count(facts.images);
      const videos = count(facts.videos);
      if (!pictures && !videos) {
        return 'None in the folder';
      }
      const parts = [];
      if (pictures) parts.push(plural(pictures, 'picture', 'pictures'));
      if (videos) parts.push(plural(videos, 'video', 'videos'));
      return parts.join(', ');
    }

    default:
      // ⭐ The five Planning Center sections carry their own state lines, so an
      // administrator sees what is set from one screen instead of opening five
      // panes to find out (#179). `pco-sections.mjs` keeps the wording with the
      // ownership it describes.
      if (PCO_SECTION_IDS.includes(id)) {
        // ⛔ Two different silences, and only one of them is "not connected".
        //
        // No `config` at all means the board has not been told anything yet —
        // the page draws before the first payload arrives — and announcing
        // "Not connected" there would be a lie by timing. A config that *is*
        // loaded and simply has no `pco` block is a board nobody has connected,
        // which is exactly when the line matters: saying nothing reads as
        // missing information rather than as the answer.
        if (!config) {
          return null;
        }
        const pco = typeof config.pco === 'object' && config.pco ? config.pco : {};
        return pcoStateLine(id, pco);
      }
      return null;
  }
}

/**
 * The two lines on the door at the foot of the view panel.
 *
 * ⛔ The second line is the boundary, stated on the control itself. #116 exists
 * because the per-device / global split was invisible; putting global settings
 * behind the same gear erases the distinction unless the route re-states it.
 * It is said three times on purpose -- here, above the panel's own settings,
 * and in the page's banner.
 */
export const DOOR_LABEL = 'Administration';

/**
 * ⛔ Every section, not a sample. It listed five of the nine, which is the kind
 * of half-list somebody reads as the whole list and then concludes that logs or
 * demo mode live somewhere else -- the exact confusion #188 exists to end.
 *
 * ⚠️ Derived rather than typed, so a tenth section cannot be added without this
 * following it. The test for that is in `admin-page.test.mjs`.
 *
 * ⚠️ The labels keep their own capitalisation. Lowercasing the list to make it
 * read as prose turned "Planning Center" into "planning center", which is a
 * product's name spelt wrong.
 */
/**
 * What is behind the door, named on the door.
 *
 * ⛔ A group stands in for its items when it has more than two of them. #179
 * split Planning Center into five sections, and listing all five put thirteen
 * labels on a line whose job is to let somebody decide whether to open it —
 * while dropping the words "Planning Center", which is what they would actually
 * be looking for. The group title is both shorter and more findable.
 */
export const DOOR_DETAIL = SECTIONS
  .flatMap((section) => (
    // ⚠️ Only this group. Diagnostics keeps its items listed because one of
    // them is **Help & about**, which is the thing somebody looks for when they
    // do not yet know how the board works (#187) -- collapsing that to
    // "Diagnostics" would hide it behind a word nobody searches for.
    section.title === 'Planning Center'
      ? [section.title]
      : section.items.map((item) => item.label)
  ))
  .join(', ');

export const DOOR_SCOPE = 'Changes there affect every board';

// ---------------------------------------------------------------------------
// Routes
//
// ⭐ A registry rather than the page calling the editors itself. Each route is
// registered beside the menu item that already opens it, so the page and the
// menu run the same code -- including the lock refusal each handler already
// does. That is also what makes retiring the bar a deletion rather than a
// rewrite: the registration stays when the menu item goes.
// ---------------------------------------------------------------------------

const routes = new Map();

export function registerAdminRoute(id, fn) {
  if (typeof id === 'string' && typeof fn === 'function') {
    routes.set(id, fn);
  }
}

export function adminRouteIds() {
  return [...routes.keys()].sort();
}

/** Run a route. Returns false when nothing is registered for it. */
export function runAdminRoute(id) {
  const fn = routes.get(id);
  if (!fn) {
    return false;
  }
  fn();
  return true;
}

/** Only for tests: forget every registration. */
export function resetAdminRoutes() {
  routes.clear();
}

/**
 * Items with no route registered.
 *
 * ⛔ The acceptance criterion of #188 is that no route disappears. A rail item
 * that draws but does nothing is the same failure as a missing item, and harder
 * to notice, so the board reports this rather than waiting to be clicked.
 */
/**
 * Items the page renders itself, so they never register a route.
 *
 * ⛔ Not the same list as `UNGUARDED_ITEMS`, even though it holds the same id
 * today. That one is about the lock -- what may be read on a locked board. This
 * one is about routing -- what is drawn in the content pane instead of handing
 * over to an editor. ⭐ #222 moves the rest of the sections into this list one
 * at a time; conflating it with the lock's list would mean each move silently
 * unguarded a section.
 */
export const IN_PAGE_ITEMS = [
  'about', 'screens', 'slots', 'logs', 'backgrounds', 'receivers', 'groups',
  ...PCO_SECTION_IDS,
];

/**
 * Whether opening `view` should refill the moved section `id`.
 *
 * ⛔⛔ **Only on the transition into it.** The first version of this refilled on
 * every render, argued for because the configuration can change underneath the
 * page -- and it reintroduced #180 exactly. `renderAdminPage` runs on every
 * `wirelessboard:viewers` event, so each one refilled the editor from the
 * stored configuration, and a row somebody had just added vanished about a
 * second later. **A stored configuration never contains a half-typed row**,
 * which is the whole of #180 and the reason no screen could be described at all
 * until #189.
 *
 * ⚠️ The cost is real and accepted: a section left open while another board
 * saves shows the older list until it is reopened. Same trade #180 settled, and
 * the right way round -- losing somebody's typing is worse than showing them a
 * list that is a minute old.
 *
 * Pure, so the rule can be checked without a DOM.
 */
export function shouldFillSection({ view, shown, id }) {
  return view === id && shown !== id;
}

/**
 * Whether leaving `view` should release the moved section `id`.
 *
 * ⛔⛔ Logs is why this exists. The viewer follows the file on a timer, and the
 * configuration page only ever stopped it by switching to another tab. Moved
 * into a page that shows and hides sections, nothing was stopping it -- a wall
 * tablet polling the server about a page nobody is looking at, for as long as
 * the board is up.
 *
 * ⚠️ Released only if it was the one being shown. Calling this for a section
 * that was never opened would stop a timer that was never started, which is
 * harmless today and exactly the kind of "harmless" that stops being so when
 * the next section's release does something real.
 */
export function shouldReleaseSection({ view, shown, id }) {
  return shown === id && view !== id;
}

export function unroutedItems() {
  const have = new Set(routes.keys());
  return allItems()
    .filter((item) => !have.has(item.id) && !IN_PAGE_ITEMS.includes(item.id))
    .map((item) => item.id);
}

/** Every guarded action, for the drift guard. */
export { GUARDED_ACTIONS };
