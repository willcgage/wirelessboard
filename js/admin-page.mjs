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
 * ⛔ **Help is deliberately NOT here.** The design folded Help and the
 * scannable URL into an "About & help" section of this page -- but the page is
 * refused when the lock is on, which would make Help unreachable on a locked
 * wall tablet. Help is the one screen somebody reads when they do not yet know
 * how the board works (#187), and it is not in the guarded set. It stays in the
 * view panel, where the lock does not reach it.
 */

import { GUARDED_ACTIONS, allows } from './viewer-lock.mjs';

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
      { id: 'screens', label: 'Screens', action: 'config' },
      { id: 'slots', label: 'Slots', action: 'slot-edit' },
      { id: 'group', label: 'This group', action: 'group-edit' },
      { id: 'backgrounds', label: 'Backgrounds', action: 'background-library' },
    ],
  },
  {
    title: 'Planning Center',
    items: [
      { id: 'pco', label: 'Planning Center', action: 'pco' },
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      { id: 'logs', label: 'Logs', action: 'config' },
      // ⚠️ Filed under Diagnostics because that is how it is used, though it is
      // a board-wide data switch and an argument exists for Setup. Noted as
      // open on #188 rather than settled quietly.
      { id: 'demo', label: 'Demo mode', action: 'demo' },
    ],
  },
];

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
 */
export function offeredActions() {
  return [...new Set(allItems().map((item) => item.action))].sort();
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

/** Whether the whole page is refused -- which is every item at once. */
export function pageRefused(lockState) {
  return allItems().every((item) => !allows(lockState, item.action));
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
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
      if (!Array.isArray(facts.discovered)) {
        return null;
      }
      const found = facts.discovered.length;
      // ⭐ `discovered[i].channels` already carries the receiver's channel
      // count and the config UI ignores it (#144). Summing it here is the
      // honest total: a four-channel receiver is four channels whether or not
      // anybody has configured them.
      const channels = facts.discovered.reduce((sum, rx) => {
        const n = Number(rx && rx.channels);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0);
      const foundText = plural(found, 'found', 'found');
      return channels > 0
        ? `${found} found, ${plural(channels, 'channel', 'channels')}`
        : foundText;
    }

    case 'screens': {
      if (!config || !Array.isArray(config.screens)) {
        return null;
      }
      const n = config.screens.length;
      return n === 0 ? 'None described' : `${plural(n, 'screen', 'screens')} described`;
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

    case 'pco': {
      if (!config || !config.pco || typeof config.pco !== 'object') {
        return null;
      }
      const { pco } = config;
      const hasCredentials = !!(pco.auth && pco.auth.has_credentials);
      if (!hasCredentials) {
        return 'Not connected';
      }
      // ⚠️ Credentials stored and the integration switched off are different
      // states, and conflating them is how somebody concludes a sync is broken
      // when it was simply never turned on ([[admin-switches-are-the-admins]]).
      return pco.enabled ? 'Connected' : 'Connected, switched off';
    }

    default:
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
export const DOOR_DETAIL = 'Receivers, screens, slots, backgrounds, Planning Center';
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
export function unroutedItems() {
  const have = new Set(routes.keys());
  return allItems().filter((item) => !have.has(item.id)).map((item) => item.id);
}

/** Every guarded action, for the drift guard. */
export { GUARDED_ACTIONS };
