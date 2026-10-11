/**
 * The view panel (#111).
 *
 * Every view preference was a key and only a key. That is fine for whoever
 * knows them and useless for everyone else — and on a phone or a wall tablet
 * there is no keyboard at all, so none of them could be reached.
 *
 * ⭐ The panel does not replace the keys. Every row shows its own key, so the
 * panel teaches the shortcuts rather than competing with them; someone who
 * opens it twice a week stops needing it.
 *
 * ⛔ The rows are generated from `view-controls.mjs`, never written out here.
 * A hand-written list of the controls is the mistake `kbd.js` already made once
 * with the help overlay, and `view-controls.test.mjs` fails if the two drift.
 */

import {
  controlGroups, optionsInOrder, optionLabel, isSwitch,
} from './view-controls.mjs';

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
  setViewOption: () => null,
  viewOptionValue: () => undefined,
  setDisplayMode: () => {},
  getDisplayMode: () => 'deskmode',
};

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
    const current = board.viewOptionValue(control.id) === value;
    button.setAttribute('aria-pressed', String(current));
    button.addEventListener('click', () => {
      board.setViewOption(control.id, value);
    });
    wrap.appendChild(button);
  });
  return wrap;
}

function renderSwitch(control) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vp-switch';
  const on = board.viewOptionValue(control.id) === control.switchOn;
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', control.label);
  button.classList.toggle('is-on', on);
  button.addEventListener('click', () => {
    const next = on ? control.options.find((v) => v !== control.switchOn) : control.switchOn;
    board.setViewOption(control.id, next);
  });
  return button;
}

/**
 * Desk or TV mode (`T`).
 *
 * ⚠️ The one row here that is not a stored preference: display mode lives in
 * the hash and in memory, not in `view-prefs`, so it has no descriptor and is
 * written out by hand. It earns the exception because every other control in
 * this panel only acts in TV mode -- a panel that let you set them without
 * showing which mode you were in would explain nothing when they did nothing.
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

  [['deskmode', 'Desk'], ['tvmode', 'TV']].forEach(([mode, text]) => {
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

  const key = document.createElement('kbd');
  key.className = 'vp-key';
  key.textContent = 'T';
  row.appendChild(key);

  section.appendChild(row);
  return section;
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

  controlGroups().forEach((group) => {
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

      // The key, so the panel teaches rather than replaces.
      const key = document.createElement('kbd');
      key.className = 'vp-key';
      key.textContent = control.key.toUpperCase();
      row.appendChild(key);

      section.appendChild(row);
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

export function openViewPanel() {
  const el = panel();
  if (!el) {
    return;
  }
  lastFocused = document.activeElement;
  renderViewPanel();
  el.hidden = false;
  const first = el.querySelector('button, [href], input, select, textarea');
  if (first && typeof first.focus === 'function') {
    first.focus();
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
