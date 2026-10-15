/**
 * The administration overlay (#188).
 *
 * ⛔ An overlay rather than a full-screen view, decided by the maintainer
 * 2026-10-14: administration happens mid-service, and the board staying visible
 * behind it is the point. The design canvas drew it full-screen; this is the
 * alternative it flagged.
 *
 * ⚠️ **What this is in its first form.** The overlay carries the banner, the
 * rail and the state lines -- an administrator reads the whole installation's
 * state from one screen without opening anything. Choosing a section still
 * opens the *existing* pane, which is full-screen today, so the board is only
 * visible while reading, not yet while editing. Moving those panes inside the
 * overlay is follow-on work and deliberately not bundled here: the menu bar is
 * still present as a fallback until the page has been used on a wall.
 *
 * ⛔ The routes are not reimplemented. Each rail item runs the registered route,
 * which is the same function the menu item runs -- including the lock refusal
 * each handler already performs. Two ways to open the config editor would
 * eventually be two different behaviours, and the second one would be the one
 * nobody tested.
 */

import {
  sectionsFor, stateLine, runAdminRoute, unroutedItems, pageRefused,
  DOOR_LABEL, DOOR_DETAIL, DOOR_SCOPE,
} from './admin-page.mjs';
import { scopeNote, presenceLabel } from './viewer-scope.mjs';
import { refusalNote } from './viewer-lock.mjs';

const PAGE_ID = 'admin-page';

let deps = null;
let lastFocus = null;

export function isAdminPageOpen() {
  const el = document.getElementById(PAGE_ID);
  return !!el && el.classList.contains('is-open');
}

function facts() {
  return (deps && typeof deps.getFacts === 'function' && deps.getFacts()) || {};
}

function lockState() {
  return deps && typeof deps.getLockState === 'function' ? deps.getLockState() : 'off';
}

function viewers() {
  const n = deps && typeof deps.getViewers === 'function' ? deps.getViewers() : null;
  return Number.isFinite(Number(n)) ? Number(n) : null;
}

/**
 * The banner.
 *
 * ⭐ `scopeNote` and `presenceLabel` already say this, and are already tested
 * (#116). A second phrasing here would be a second thing to keep true -- and
 * ⚠️ it counts **boards, not people**: one person may have two open.
 */
function renderBanner() {
  const banner = document.getElementById('admin-page-banner');
  if (!banner) {
    return;
  }
  // ⛔ Two parts, not one sentence. `scopeNote('global', count)` already folds
  // the count in when more than one board is connected, so concatenating
  // `presenceLabel` after it produced "Changes here affect every connected
  // board. This board only." -- a sentence that contradicts itself. Passing no
  // count keeps `scopeNote` to the rule, and the tally is its own quieter line.
  banner.textContent = '';
  const rule = document.createElement('span');
  rule.className = 'admin-banner__rule';
  rule.textContent = scopeNote('global');
  banner.appendChild(rule);

  // ⚠️ Boards, not people: one person may have two open. Left out entirely
  // when the server has not said, rather than printing "0 boards".
  const presence = presenceLabel(viewers());
  if (presence) {
    const tally = document.createElement('span');
    tally.className = 'admin-banner__tally';
    tally.textContent = presence;
    banner.appendChild(tally);
  }
}

function renderItem(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-item';
  button.dataset.adminItem = item.id;

  const label = document.createElement('span');
  label.className = 'admin-item__label';
  label.textContent = item.label;
  button.appendChild(label);

  // ⛔ Refused, not hidden. A locked board missing half its rail reads as a
  // board missing features, and somebody goes looking for the fault during a
  // service; the note says what was refused and where to undo it.
  if (item.refused) {
    button.disabled = true;
    button.classList.add('is-refused');
    const note = document.createElement('span');
    note.className = 'admin-item__state is-refused';
    note.textContent = refusalNote(item.action) || 'Locked to display only.';
    button.appendChild(note);
    return button;
  }

  const line = stateLine(item.id, facts());
  if (line) {
    const state = document.createElement('span');
    state.className = 'admin-item__state';
    state.textContent = line;
    button.appendChild(state);
  }

  button.addEventListener('click', () => {
    // ⚠️ Closed first. The routes open panes that take the screen today, and an
    // overlay left on top of one is a dead layer over a live editor.
    closeAdminPage();
    runAdminRoute(item.id);
  });
  return button;
}

function renderRail() {
  const rail = document.createElement('div');
  rail.className = 'admin-rail';

  sectionsFor({ lockState: lockState() }).forEach((section) => {
    const group = document.createElement('section');
    group.className = 'admin-group';

    const heading = document.createElement('p');
    heading.className = 'admin-group__title';
    heading.textContent = section.title;
    group.appendChild(heading);

    section.items.forEach((item) => group.appendChild(renderItem(item)));
    rail.appendChild(group);
  });

  // ⛔ Says so rather than drawing a button that does nothing. #188's criterion
  // is that no route disappears; a rail item with no route is the same failure
  // as a missing item and harder to notice.
  const missing = unroutedItems();
  if (missing.length) {
    const warn = document.createElement('p');
    warn.className = 'admin-unrouted';
    warn.textContent = `No route registered for: ${missing.join(', ')}. Use the Menu instead.`;
    rail.appendChild(warn);
  }

  return rail;
}

/** Redraw the rail, so the state lines and the refusals follow the board. */
export function renderAdminPage() {
  const page = document.getElementById(PAGE_ID);
  if (!page) {
    return;
  }
  renderBanner();
  const body = document.getElementById('admin-page-body');
  if (body) {
    body.replaceChildren(renderRail());
  }
}

export function openAdminPage() {
  const page = document.getElementById(PAGE_ID);
  if (!page) {
    return;
  }
  lastFocus = document.activeElement;
  renderAdminPage();
  page.classList.add('is-open');
  // So the board behind cannot be scrolled out from under the overlay.
  document.body.classList.add('admin-open');
  const close = document.getElementById('admin-page-close');
  if (close && typeof close.focus === 'function') {
    close.focus();
  }
}

export function closeAdminPage() {
  const page = document.getElementById(PAGE_ID);
  if (page) {
    page.classList.remove('is-open');
  }
  document.body.classList.remove('admin-open');
  if (lastFocus && typeof lastFocus.focus === 'function') {
    try { lastFocus.focus(); } catch (_) { /* the element may be gone */ }
  }
  lastFocus = null;
}

export function initAdminPage(options = {}) {
  deps = options;

  const close = document.getElementById('admin-page-close');
  if (close) {
    close.addEventListener('click', closeAdminPage);
  }
  const backdrop = document.getElementById('admin-page-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeAdminPage);
  }

  // ⛔ Capture and stop, because `kbd.js` binds Escape ahead of its own guards
  // and **reloads the board** with it. Letting this bubble would close the
  // overlay by throwing the whole page away -- the same reason the view panel
  // does this.
  document.addEventListener('keydown', (event) => {
    if (!isAdminPageOpen() || event.key !== 'Escape') {
      return;
    }
    event.stopImmediatePropagation();
    event.preventDefault();
    closeAdminPage();
  }, true);

  // The rail reports how many boards are connected and what each section holds,
  // so it has to follow both.
  try {
    window.addEventListener('wirelessboard:viewers', () => {
      if (isAdminPageOpen()) renderAdminPage();
    });
    window.addEventListener('wirelessboard:config-loaded', () => {
      if (isAdminPageOpen()) renderAdminPage();
    });
    // ⛔ Locked while the page is open: close it. The door is where the
    // refusal is stated, so a page that stays open behind a refused door is a
    // locked board still showing every global setting -- and leaving the items
    // to redraw as refused would be a half-refused page nobody designed.
    window.addEventListener('wirelessboard:view-changed', () => {
      if (!isAdminPageOpen()) {
        return;
      }
      if (pageRefused(lockState())) {
        closeAdminPage();
      } else {
        renderAdminPage();
      }
    });
  } catch (_) { /* a board that cannot listen still opens the page */ }
}

export { DOOR_LABEL, DOOR_DETAIL, DOOR_SCOPE };
