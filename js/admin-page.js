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
  sectionsFor, stateLine, runAdminRoute, unroutedItems, refusedSummary,
  IN_PAGE_ITEMS, shouldFillSection, shouldReleaseSection,
  DOOR_LABEL, DOOR_DETAIL, DOOR_SCOPE,
} from './admin-page.mjs';
import { scopeNote, presenceLabel } from './viewer-scope.mjs';
import { refusalNote } from './viewer-lock.mjs';
import { HELP_SECTIONS } from './help-content.mjs';

const PAGE_ID = 'admin-page';

let deps = null;
let lastFocus = null;
// Which of the overlay's two states is showing: the rail, or one section.
let view = 'rail';

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

/**
 * In-page sections that are static markup rather than built here.
 *
 * ⛔ `about` is NOT one of them: Help is built by `renderHelp` from
 * `help-content.mjs`, so its copy can be tested. These are editors that moved
 * out of the configuration page with their ids intact, so `config.js` still
 * finds its hosts.
 */
const MOVED_SECTIONS = IN_PAGE_ITEMS.filter((id) => id !== 'about');

/**
 * Which moved section is currently filled.
 *
 * ⛔ Not derivable from `view`: the point is to tell "the page redrew while this
 * section was open" from "this section was just opened", and only the second
 * may refill the editor underneath somebody's hands.
 */
let shown = null;

function renderItem(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-item';
  // ⭐ Only meaningful now that the rail survives the choice. An in-page
  // section can be current; the ones that still hand over to an old pane
  // cannot, because choosing them closes this page.
  if (item.id === view) {
    button.classList.add('is-current');
    button.setAttribute('aria-current', 'page');
  }
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
    // ⭐ A section this page draws itself renders in the content pane beside
    // the rail, and the rail stays. That is what #222 wants for all of them;
    // `IN_PAGE_ITEMS` is the list of the ones that have moved.
    if (IN_PAGE_ITEMS.includes(item.id)) {
      view = item.id;
      renderAdminPage();
      return;
    }
    // ⚠️ Everything else still opens a pane that takes the screen, so the
    // page closes first -- a dead layer over a live editor otherwise.
    closeAdminPage();
    runAdminRoute(item.id);
  });
  return button;
}

/**
 * What the content pane says before anything is chosen.
 *
 * ⛔ Not a decoration. Full screen means there is now a large empty area on
 * open, and the honest thing to put in it is the one fact this page exists to
 * state -- that these settings are not this screen's -- plus what is still
 * true of the destinations: most of them hand over to an editor that takes the
 * screen, which is #222 and is the next piece of work.
 */
function renderWelcome() {
  const wrap = document.createElement('div');
  wrap.className = 'admin-welcome';

  const lead = document.createElement('p');
  lead.className = 'admin-welcome__lead';
  lead.textContent = 'Choose a section.';
  wrap.appendChild(lead);

  // ⛔ The boundary, not the section list. The rail is already the list, and
  // printing it twice beside itself says nothing; what the empty pane should
  // carry is the one thing a person needs to know before they touch anything
  // here, which is that none of it is this screen's.
  const scope = document.createElement('p');
  scope.className = 'admin-welcome__note';
  scope.textContent = `${DOOR_SCOPE}, not just this one.`;
  wrap.appendChild(scope);

  return wrap;
}

function renderRail() {
  const rail = document.createElement('div');
  rail.className = 'admin-rail';

  // ⭐ Said once, at the top, rather than left to be discovered a tap at a time.
  // The door no longer refuses the whole page (Help is on it, and a locked board
  // must still be able to explain itself), so this is where somebody learns that
  // most of what they can see is not available to them.
  const locked = refusedSummary(lockState());
  if (locked) {
    const note = document.createElement('p');
    note.className = 'admin-locked-note';
    note.textContent = locked;
    rail.appendChild(note);
  }

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
    // ⛔ It used to end "Use the Menu instead." The Menu was retired by #188's
    // second half, so the one sentence shown when something is broken was
    // sending people to a bar that no longer exists. ⚠️ There is no fallback
    // route to offer now, which is the honest thing to say: this is a fault in
    // the build, not something the operator can work around.
    warn.textContent = `No route registered for: ${missing.join(', ')}. `
      + 'This is a fault in this build, not something you can work around here.';
    rail.appendChild(warn);
  }

  return rail;
}

/** Redraw the rail, so the state lines and the refusals follow the board. */
/**
 * Help, rendered inside the overlay.
 *
 * ⭐ The first section that does not hand over to an old pane, which is the
 * pattern #222 wants for all of them -- and the reason it was possible here
 * first is that Help is text, so it fitted even in the overlay. The content
 * pane is where the rest of them go.
 *
 * ⛔ Reachable on a locked board, which is the whole reason Help is on this
 * page rather than in the view panel -- see the `about` item in
 * `admin-page.mjs`. A locked wall tablet must still be able to explain itself.
 */
function renderHelp() {
  const wrap = document.createElement('div');
  wrap.className = 'admin-section';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'admin-back';
  back.textContent = '\u2190 Administration';
  back.addEventListener('click', () => { view = 'rail'; renderAdminPage(); });
  wrap.appendChild(back);

  const version = document.createElement('p');
  version.className = 'admin-help__version';
  version.textContent = (deps && typeof deps.getVersion === 'function' && deps.getVersion()) || '';
  if (version.textContent) {
    wrap.appendChild(version);
  }

  // ⭐ The scannable URL lives with Help, which is where the original design
  // put it ("Scannable URL and Help fold into About & help"). It left the view
  // panel with Help and would otherwise have had nowhere at all.
  //
  // ⚠️ Not guarded, like Help: showing somebody the address of the board they
  // are standing in front of changes nothing.
  if (deps && typeof deps.showScannableUrl === 'function') {
    const qr = document.createElement('button');
    qr.type = 'button';
    qr.className = 'admin-help__qr';
    qr.textContent = 'Scannable URL';
    qr.addEventListener('click', () => deps.showScannableUrl());
    wrap.appendChild(qr);
  }

  HELP_SECTIONS.forEach((section) => {
    const heading = document.createElement('p');
    heading.className = 'admin-group__title';
    heading.textContent = section.title;
    wrap.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'admin-help__list';
    section.items.forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    });
    wrap.appendChild(list);
  });
  return wrap;
}

/**
 * ⛔⛔ The rail stays on screen, and the content pane changes.
 *
 * It used to be one body that Help *replaced*, because a 760px overlay had no
 * room for two panes. Full screen means a section can be read without losing
 * the way to the next one -- which is the point of a rail, and was the main
 * thing the overlay could not do.
 *
 * ⚠️ The rail is rebuilt on every render rather than diffed, because the state
 * lines and the per-item refusals follow the board and a stale "9 found" is
 * worse than a flicker.
 */
export function renderAdminPage() {
  const page = document.getElementById(PAGE_ID);
  if (!page) {
    return;
  }
  renderBanner();

  const rail = document.getElementById('admin-page-rail');
  if (rail) {
    rail.replaceChildren(renderRail());
  }

  const content = document.getElementById('admin-page-content');
  if (content) {
    content.replaceChildren(view === 'about' ? renderHelp() : renderWelcome());
  }

  // ⛔ The moved sections are static markup, not built here. They live in the
  // document so `config.js` can find its hosts by id exactly as it always has
  // -- `renderScreenRows` and the save path were never told they had moved --
  // so this shows and hides them rather than rendering them.
  //
  // ⚠️ `hidden` rather than a class, because the publish skeleton's
  // `[hidden]{display:none!important}` is the one rule that cannot be lost to
  // specificity, and a half-hidden editor that still takes clicks is worse
  // than a visible one.
  // ⛔ Read ONCE, before anything changes it. `shown` used to be updated inside
  // this loop, so a section considered later saw the value a section
  // considered earlier had just written -- and leaving Logs for Screens left
  // the log viewer's timer running, because by then `shown` already said
  // `screens`. Whether a timer stopped depended on the order of this array.
  const previous = shown;
  let next = null;

  MOVED_SECTIONS.forEach((id) => {
    const section = document.getElementById(`admin-section-${id}`);
    if (!section) {
      return;
    }
    const showing = view === id;
    section.hidden = !showing;

    // ⛔⛔ Filled when the section is OPENED, never on a redraw. This said
    // "filled on every show, not once" and was argued for on the grounds that
    // the configuration can change under the page -- and it reintroduced #180
    // exactly: `renderAdminPage` runs on every `wirelessboard:viewers` event,
    // each run refilled the editor from the stored configuration, and the row
    // somebody was typing into vanished about a second after they added it. A
    // stored configuration never contains a half-typed row.
    //
    // ⚠️ The cost is real and accepted: a section left open while another board
    // saves shows the older list until it is reopened. That is the same trade
    // #180 settled, and it is the right way round -- losing somebody's typing
    // is worse than showing them a list that is a minute old.
    if (shouldFillSection({ view, shown: previous, id })
        && deps && typeof deps.fillSection === 'function') {
      deps.fillSection(id);
    }

    // ⛔ And the other edge. A section can hold something that keeps running --
    // the log viewer follows the file on a timer -- and nothing told the host
    // when a section stopped being looked at, because until Logs moved no
    // section had anything to stop. A hidden pane still polling is a wall
    // tablet talking to the server about a page nobody can see.
    if (shouldReleaseSection({ view, shown: previous, id })
        && deps && typeof deps.releaseSection === 'function') {
      deps.releaseSection(id);
    }

    if (showing) {
      next = id;
    }
  });

  shown = next;

  // The welcome text and a moved section must never both be on screen.
  if (content) {
    content.hidden = MOVED_SECTIONS.includes(view);
  }
}

/**
 * @param {string} [section] open straight onto an in-page section.
 *
 * ⚠️ Only an in-page section, and silently the rail otherwise. The argument
 * exists for `#settings=logs`, a link that predates this page and named a tab
 * that no longer exists; a deep link that lands somewhere plausible is better
 * than one that opens an empty configuration page, which is what it did for
 * the few minutes between the markup moving and this being written.
 */
export function openAdminPage(section) {
  const page = document.getElementById(PAGE_ID);
  if (!page) {
    return;
  }
  lastFocus = document.activeElement;
  view = IN_PAGE_ITEMS.includes(section) ? section : 'rail';
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
  // ⛔ Closing the page is leaving every section in it. Without this the log
  // viewer kept following the file after the page was dismissed, which is the
  // same fault as a hidden section polling -- just harder to notice.
  if (shown && deps && typeof deps.releaseSection === 'function') {
    deps.releaseSection(shown);
  }
  shown = null;

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
    // ⛔⛔ Locked while the page is open: **re-render**, do not close.
    //
    // It used to close, because the door was all-or-nothing and a page open
    // behind a refused door made no sense. The door opens on a locked board
    // now -- Help is on this page and a locked wall tablet must still be able
    // to explain itself (#187) -- so what the lock refuses, it refuses on the
    // item, and the page redraws to show that.
    window.addEventListener('wirelessboard:view-changed', () => {
      if (isAdminPageOpen()) {
        renderAdminPage();
      }
    });
  } catch (_) { /* a board that cannot listen still opens the page */ }
}

export { DOOR_LABEL, DOOR_DETAIL, DOOR_SCOPE };
