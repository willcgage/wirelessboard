/**
 * The view panel (#111).
 *
 * Every view preference was a key and only a key. That is fine for whoever
 * knows them and useless for everyone else — and on a phone or a wall tablet
 * there is no keyboard at all, so none of them could be reached.
 *
 * ⭐ It did not replace the keys at first -- every row showed its own key, so
 * the panel taught the shortcuts rather than competing with them. ⛔ That is
 * no longer the design: #160 retired the bindings, and this panel is now the
 * only way to reach any of these. Nothing here may depend on a keyboard.
 *
 * ⛔ The rows are generated from `view-controls.mjs`, never written out here.
 * A hand-written list of the controls is the mistake `kbd.js` already made once
 * with the help overlay, and `view-controls.test.mjs` fails if the two drift.
 */

import {
  VIEW_CONTROLS, controlGroups, optionsInOrder, optionLabel, isSwitch, controlDescription,
} from './view-controls.mjs';
import { BOARD_CONTROLS, groupChoices } from './panel-controls.mjs';
import { screenChoices, describeScreenChoice } from './display-geometry.mjs';
import { scopeNote } from './viewer-scope.mjs';
import { DOOR_DETAIL, DOOR_SCOPE } from './admin-page.mjs';
import { isLocked } from './viewer-lock.mjs';

/**
 * Both tables, in one panel (#160).
 *
 * ⚠️ Preferences first within each section, then the live controls. The two
 * tables stay separate because one is stored and one is not -- but a person
 * reading the panel has no reason to care which, so the sections interleave
 * them rather than keeping two halves.
 */
function allControls() {
  return VIEW_CONTROLS.concat(BOARD_CONTROLS);
}

/**
 * ⛔ The board's own functions are injected, not imported.
 *
 * `app.js` imports this module and `display.js` imports `app.js`, so importing
 * either from here closes a cycle — and webpack resolved that cycle by leaving
 * the binding in the temporal dead zone. The symptom was the panel rendering
 * perfectly and the first click throwing `setDisplayMode is not defined`.
 * Taking the functions as parameters breaks the loop, and makes the panel
 * testable without booting the board.
 */
let board = {
  getScreens: () => [],
  getScreenId: () => '',
  setScreenId: () => {},
  setViewOption: () => null,
  viewOptionValue: () => undefined,
  setBoardOption: () => null,
  boardOptionValue: () => undefined,
  setDisplayMode: () => {},
  getDisplayMode: () => 'deskmode',
  getGroups: () => ({}),
  getGroup: () => 0,
  setGroup: () => {},
  getPagingState: () => ({ reason: null }),
  getLockState: () => 'off',
  openAdmin: () => {},
};

/**
 * ⛔ A preference is read and written through `view-prefs`; a live control is
 * not stored anywhere and is read straight back off the board. `storageKey` is
 * what tells them apart, and it is the same thing `view-controls.test.mjs`
 * already requires of every preference.
 */
function valueOf(control) {
  return control.storageKey
    ? board.viewOptionValue(control.id)
    : board.boardOptionValue(control.id);
}

function applyValue(control, value) {
  return control.storageKey
    ? board.setViewOption(control.id, value)
    : board.setBoardOption(control.id, value);
}

let lastFocused = null;

function panel() {
  return document.getElementById('view-panel');
}

export function isViewPanelOpen() {
  const el = panel();
  return Boolean(el && !el.hidden);
}

function renderSegmented(control) {
  const wrap = document.createElement('div');
  wrap.className = 'vp-seg';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', control.label);

  optionsInOrder(control).forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vp-opt';
    button.dataset.value = value;
    const glyph = control.optionGlyphs && control.optionGlyphs[value];
    // ⭐ A picture of the outcome beside the word: "side by side" and "stacked"
    // are the labels that stopped the grid-axis names reading backwards, and a
    // glyph settles it without anyone having to parse either (#115).
    button.textContent = glyph ? `${glyph} ${optionLabel(control, value)}` : optionLabel(control, value);
    const current = valueOf(control) === value;
    button.setAttribute('aria-pressed', String(current));
    button.addEventListener('click', () => {
      applyValue(control, value);
      renderViewPanel();
    });
    wrap.appendChild(button);
  });
  return wrap;
}

function renderSwitch(control) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vp-switch';
  const on = valueOf(control) === control.switchOn;
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', control.label);
  button.classList.toggle('is-on', on);
  button.addEventListener('click', () => {
    const next = on ? control.options.find((v) => v !== control.switchOn) : control.switchOn;
    applyValue(control, next);
    renderViewPanel();
  });
  return button;
}

/**
 * Desk or TV mode.
 *
 * ⚠️ Written out by hand rather than from a descriptor, because this row also
 * heads the Display group and carries the group and screen pickers beneath it.
 * It earns the place because every other control in this panel only acts in TV
 * mode -- a panel that let you set them without showing which mode you were in
 * would explain nothing when they did nothing.
 *
 * ⛔ It *is* a stored preference as of #216, which it was not before: display
 * mode used to live in the hash and in memory only, so a wall came back from a
 * power cut, from Escape -- which reloads the page -- or from a visit to the
 * slot-name editor showing the desk layout. `setDisplayMode` writes it now, so
 * this button is the operator's choice and it sticks.
 */
function renderDisplayRow() {
  const section = document.createElement('section');
  section.className = 'vp-group';

  const heading = document.createElement('p');
  heading.className = 'vp-group-title';
  heading.textContent = 'Display';
  section.appendChild(heading);

  const row = document.createElement('div');
  row.className = 'vp-row';

  const label = document.createElement('span');
  label.className = 'vp-label';
  label.textContent = 'Mode';
  row.appendChild(label);

  const seg = document.createElement('div');
  seg.className = 'vp-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Display mode');

  // ⛔ Three, and named for their readers rather than their hardware. "Desk"
  // and "TV" described where the screen was; Rack, Board and Pocket describe
  // who is looking and what they want from it, which is the thing that makes
  // them three modes rather than one layout with settings.
  //
  // ⚠️ The operator picks Pocket. There is no width threshold and nothing
  // automatic -- one rule for all three. A phone's first load is therefore the
  // Board layout, which is unreadable on it; the gear is the way out and is
  // never hidden.
  [['deskmode', 'Rack'], ['tvmode', 'Board'], ['pocketmode', 'Pocket']].forEach(([mode, text]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vp-opt';
    button.textContent = text;
    button.setAttribute('aria-pressed', String(board.getDisplayMode() === mode));
    button.addEventListener('click', () => {
      if (board.getDisplayMode() !== mode) {
        board.setDisplayMode(mode);
        renderViewPanel();
      }
    });
    seg.appendChild(button);
  });
  row.appendChild(seg);

  section.appendChild(row);
  section.appendChild(renderGroupRow());
  section.appendChild(renderScreenRow());
  const note = describeScreenChoice({
    screens: board.getScreens(),
    screenId: board.getScreenId(),
    widthPx: (window.screen && window.screen.width) || window.innerWidth,
    heightPx: (window.screen && window.screen.height) || window.innerHeight,
  });
  if (note) {
    const p = document.createElement('p');
    p.className = 'vp-row-note';
    p.textContent = note;
    section.appendChild(p);
  }
  return section;
}

/**
 * Which of the configured screens this device is (#170).
 *
 * ⭐ One tap, no typing. The screens are described once on a machine with a
 * keyboard; a television on a wall only has to say which one it is. That split
 * is the whole point -- the sizes are global because they describe the
 * building, and the answer is local because it describes this device.
 *
 * ⚠️ Shows only when screens have been configured. A board that has never
 * described one should not be asked a question with a single empty answer.
 */
function renderScreenRow() {
  const choices = screenChoices(board.getScreens());
  if (choices.length <= 1) {
    return document.createDocumentFragment();
  }

  const row = document.createElement('div');
  row.className = 'vp-row';

  const label = document.createElement('span');
  label.className = 'vp-label';
  label.textContent = 'This screen';
  row.appendChild(label);

  const select = document.createElement('select');
  select.className = 'vp-select';
  select.setAttribute('aria-label', 'Which screen this is');
  const current = String(board.getScreenId() || '');
  choices.forEach((choice) => {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    if (choice.value === current) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener('change', () => {
    board.setScreenId(select.value);
    renderViewPanel();
  });
  row.appendChild(select);
  return row;
}

/**
 * Which group this screen is showing (#160).
 *
 * ⛔ This replaces the number keys, which were the *only* way to change group
 * -- `preset-link` in `app.js` has been dead markup since the micboard import,
 * so on a board with no keyboard the groups could not be reached at all.
 *
 * ⚠️ Per device, like everything else in this panel. Which channels are in a
 * group is global and lives in `config.json`; which group *this* screen is
 * looking at is nobody else's business.
 */
function renderGroupRow() {
  const row = document.createElement('div');
  row.className = 'vp-row';

  const label = document.createElement('span');
  label.className = 'vp-label';
  label.textContent = 'Showing';
  row.appendChild(label);

  const choices = groupChoices(board.getGroups());
  const current = Number(board.getGroup()) || 0;

  // A select rather than a segmented control: there can be nine of these and
  // their names are as long as somebody wanted them to be.
  const select = document.createElement('select');
  select.className = 'vp-select';
  select.setAttribute('aria-label', 'Group');
  choices.forEach((choice) => {
    const option = document.createElement('option');
    option.value = String(choice.value);
    option.textContent = choice.label;
    if (choice.value === current) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  select.addEventListener('change', () => {
    board.setGroup(Number(select.value) || 0);
  });
  row.appendChild(select);
  return row;
}

/**
 * The way out of this panel and into everything that is not this screen (#188).
 *
 * ⛔⛔ This is the route that did not exist. The menu bar carried the only
 * pointer route to every global setting, `body.topbar-hidden .navbar` removes
 * it, and #160 retired the keyboard -- so on a board with the bar hidden the
 * way to reach any global setting was to put back a bar you had deliberately
 * hidden. Every one of the first sixteen venue photographs is in that state.
 *
 * ⚠️ It carries the boundary on itself, which is the second of the three
 * places it is stated. #116 exists because the per-device / global split was
 * invisible, and putting global settings behind this same gear erases the
 * distinction unless the route re-states it.
 *
 * ⛔ Drawn refused, not hidden, when the board is locked to display only --
 * with the reason and where to undo it. A door that vanishes teaches nobody
 * that the lock is on.
 */
function renderAdminDoor() {
  const door = document.getElementById('admin-door');
  if (!door) {
    return;
  }
  const detail = door.querySelector('.admin-door__detail');
  const scope = door.querySelector('.admin-door__scope');
  if (detail) detail.textContent = DOOR_DETAIL;

  // ⛔⛔ The door opens on a locked board, and that is a deliberate reversal.
  //
  // It used to be disabled outright: locked meant the page would not open at
  // all. Help now lives on that page, and a locked wall tablet must still be
  // able to explain itself (#187) — so the lock refuses what it has always
  // refused, on the items, and the door is no longer a gate.
  //
  // ⚠️ The door still *says* so, because somebody who taps it expecting to
  // change a receiver should learn why before they go looking.
  const locked = isLocked(board.getLockState());
  door.classList.toggle('is-locked', locked);
  door.disabled = false;
  if (scope) {
    scope.textContent = locked
      ? 'Display only — Help is readable, the rest is locked'
      : DOOR_SCOPE;
  }

  if (!door.dataset.bound) {
    door.dataset.bound = 'true';
    door.addEventListener('click', () => {
      closeViewPanel();
      board.openAdmin();
    });
  }
}

export function renderViewPanel() {
  const body = document.getElementById('view-panel-body');
  if (!body) {
    return;
  }
  body.innerHTML = '';
  body.appendChild(renderDisplayRow());

  // ⛔ Say so rather than letting someone press four controls that cannot do
  // anything: a desk-mode card hugs its content, so there is no slack for any
  // of the layout or card settings below to move.
  if (board.getDisplayMode() !== 'tvmode') {
    const note = document.createElement('p');
    note.className = 'vp-note';
    note.textContent = 'The settings below apply to TV mode.';
    body.appendChild(note);
  }

  // ⭐ Says which side of the line these are on (#116). Everything in this
  // panel is stored in this browser; nothing here reaches another board.
  const foot = document.querySelector('.view-panel-foot');
  if (foot) {
    foot.textContent = scopeNote('device');
  }

  renderAdminDoor();

  controlGroups(allControls()).forEach((group) => {
    const section = document.createElement('section');
    section.className = 'vp-group';

    const heading = document.createElement('p');
    heading.className = 'vp-group-title';
    heading.textContent = group.name;
    section.appendChild(heading);

    group.controls.forEach((control) => {
      const row = document.createElement('div');
      row.className = 'vp-row';

      const label = document.createElement('span');
      label.className = 'vp-label';
      label.textContent = control.label;
      row.appendChild(label);

      row.appendChild(isSwitch(control) ? renderSwitch(control) : renderSegmented(control));

      section.appendChild(row);

      const described = controlDescription(control, valueOf(control));
      if (described) {
        const note = document.createElement('p');
        note.className = 'vp-row-note';
        note.textContent = described;
        section.appendChild(note);
      }

      // ⛔ The switch keeps the operator's value and the board says why it is
      // not in force (#202). The alternative was writing their stored setting
      // for them, which is the mistake behind "never flip a persisted flag as a
      // side effect" -- and it would leave a board later cut back to twelve
      // channels still rotating, with no record of why it was ever turned on.
      if (control.id === 'rotation') {
        const paging = board.getPagingState() || {};
        if (paging.reason === 'required') {
          const forced = document.createElement('p');
          forced.className = 'vp-row-note is-forced';
          const parts = Number(paging.total) > 0 && Number(paging.shown) > 0
            ? ` — ${paging.total} channels, ${paging.shown} fit. Showing all of them in `
              + `${Math.ceil(paging.total / paging.shown)} parts.`
            : '.';
          forced.textContent = `On anyway${parts}`;
          section.appendChild(forced);
        }
      }
    });

    body.appendChild(section);
  });
}

export function closeViewPanel() {
  const el = panel();
  if (!el || el.hidden) {
    return;
  }
  el.hidden = true;
  const opener = lastFocused;
  lastFocused = null;
  if (opener && typeof opener.focus === 'function') {
    opener.focus();
  }
}

/**
 * ⛔ A locked board opens this panel on the way out of being locked (#116).
 *
 * The lock is the last row of a panel that is roughly twice as tall as the
 * space it has on a phone, so on a locked wall tablet the one control that
 * matters was below the fold and reached by scrolling. It is still only a
 * scroll away -- nobody was ever stuck -- but "the way back is down there
 * somewhere" is not good enough for the control that hides all the others.
 *
 * ⚠️ Only when locked. Opening halfway down a panel nobody needed scrolled
 * would be worse than the problem.
 */
function revealTheWayOut(el) {
  if (board.viewOptionValue('viewerLock') !== 'on') {
    return null;
  }
  const row = [...el.querySelectorAll('.vp-row')]
    .find((candidate) => candidate.querySelector('.vp-switch')
      && /lock/i.test(candidate.textContent));
  if (!row) {
    return null;
  }
  try {
    row.scrollIntoView({ block: 'center' });
  } catch (_) {
    // An older engine without the options object still has the plain call.
    try { row.scrollIntoView(); } catch (__) { /* and if not, the scroll remains */ }
  }
  return row.querySelector('.vp-switch');
}

export function openViewPanel() {
  const el = panel();
  if (!el) {
    return;
  }
  lastFocused = document.activeElement;
  renderViewPanel();
  el.hidden = false;
  // The unlock when there is one, otherwise the first thing in the panel.
  const target = revealTheWayOut(el)
    || el.querySelector('button, [href], input, select, textarea');
  if (target && typeof target.focus === 'function') {
    target.focus();
  }
}

export function toggleViewPanel() {
  if (isViewPanelOpen()) {
    closeViewPanel();
  } else {
    openViewPanel();
  }
}

export function initViewPanel(hooks = {}) {
  board = { ...board, ...hooks };
  const el = panel();
  if (!el || el.dataset.bound) {
    return;
  }
  el.dataset.bound = 'true';

  // ⭐ Help and the scannable URL close the panel on their way out, the same as
  // the administration door does. Both open something that covers the panel --
  // the Help overlay sits at z-index 1060 against the panel's 1041, measured
  // overlapping it by 336x336 -- so leaving the panel up puts a half-hidden
  // control list under the thing it just opened.
  //
  // ⚠️ Bound here rather than in app.js, because closing the panel is the
  // panel's business; app.js owns what the buttons *do*.
  ['go-hud', 'go-qr'].forEach((id) => {
    const link = document.getElementById(id);
    if (link) {
      link.addEventListener('click', () => closeViewPanel());
    }
  });
  const closeButton = document.getElementById('view-panel-close');
  if (closeButton) {
    closeButton.addEventListener('click', closeViewPanel);
  }

  // ⛔ Capture, and stop the event, because `kbd.js` binds Escape ahead of its
  // own guards and *reloads the board* with it. Leaving the panel's Escape to
  // bubble would close the panel by throwing the whole page away.
  document.addEventListener('keydown', (event) => {
    if (!isViewPanelOpen()) {
      return;
    }
    if (event.key === 'Escape') {
      event.stopImmediatePropagation();
      event.preventDefault();
      closeViewPanel();
      return;
    }
    if (event.key === 'Tab') {
      // A small trap: the panel is a dialog over a board whose keys all do
      // something, so tabbing out of it and pressing space is a live hazard.
      const focusable = [...el.querySelectorAll('button, [href], input, select, textarea')]
        .filter((node) => !node.disabled);
      if (!focusable.length) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, true);

  // A key pressed while the panel is open has to move the control too, or the
  // two are showing different boards.
  window.addEventListener('wirelessboard:view-changed', () => {
    if (isViewPanelOpen()) {
      renderViewPanel();
    }
  });
}
