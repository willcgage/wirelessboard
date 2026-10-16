import { micboard, updateHash } from './app.js';

import { updateGIFBackgrounds } from './gif.js';
import { renderGroup, renderDisplayList } from './channelview.js';
import { requestTvLayoutUpdate } from './tv-layout.js';
import {
  ARRANGEMENTS, CARD_SHAPES, TYPE_SIZES,
  COLUMN_CHOICES, WASH_STYLES, nextOption,
} from './board-layout.mjs';
import { controlFor, isValidValue } from './view-controls.mjs';
import { PLACEMENTS } from './live-strip.mjs';
import { refreshLiveStrip } from './live-strip-view.js';
import { ROTATION_STATES } from './rotation-states.mjs';
import { LOCK_STATES, isLocked, lockedJustNowNote } from './viewer-lock.mjs';
import { showLockNote, hideLockNote } from './viewer-lock-view.js';
import { startRotation, stopRotation } from './rotation-view.js';
import {
  writePref, safeStorage,
  ARRANGEMENT_KEY, CARD_SHAPE_KEY, TYPE_SIZE_KEY, COLUMNS_KEY,
  STATUS_BAR_PLACEMENTS,
  WASH_KEY, DISPLAY_MODE_KEY, DISPLAY_MODES,
  LIVE_PLACEMENT_KEY,
  ROTATION_KEY,
  VIEWER_LOCK_KEY,
} from './view-prefs.mjs';

function swapClass(selector, currentClass, newClass) {
  selector.classList.remove(currentClass);
  selector.classList.add(newClass);
}

export function setBackground(mode) {
  micboard.backgroundMode = mode;
  const elements = document.querySelectorAll('#micboard .mic_name');
  Array.from(elements).forEach((e) => {
    e.style.backgroundImage = '';
    e.style.backgroundSize = '';
  });
  updateGIFBackgrounds();
  updateHash();
}

function applyDefaultBackgroundIfNeeded() {
  // Auto-enable the preferred background type when TV mode starts with backgrounds off.
  const preferred = typeof micboard.backgroundDefaultMode === 'string'
    ? micboard.backgroundDefaultMode.toUpperCase()
    : 'NONE';
  if (micboard.backgroundMode !== 'NONE') {
    return;
  }
  if (preferred === 'IMG' || preferred === 'MP4') {
    setBackground(preferred);
  }
}

/**
 * Desk or TV.
 *
 * ⭐ Remembered, as of #216, so a wall comes back the way it was left -- after
 * a power cut, after Escape (which reloads the page), or after a visit to the
 * slot-name editor. It is the last of the view preferences to be stored and it
 * uses the same machinery as all of them.
 *
 * ⛔ `remember: false` for a switch the operator did not ask for. The slot-name
 * editor forces desk mode because two text fields per card are not something to
 * type into from across a room -- that is the editor's need, not a choice about
 * how this screen should look, and storing it would mean a board power-cut
 * mid-edit came back as a desk. Same shape as `setInfoDrawer`'s `switchToTv`.
 */
export function setDisplayMode(mode, { remember = true } = {}) {
  const previous = micboard.displayMode;
  const selector = document.getElementById('container');
  swapClass(selector, micboard.displayMode, mode);
  micboard.displayMode = mode;
  if (remember) {
    writePref({ storage: safeStorage(), key: DISPLAY_MODE_KEY, value: mode });
  }
  requestTvLayoutUpdate();

  // ⛔ Pocket is an ORDER, not a skin, so it needs the list drawn again --
  // Rack and Board show the display list as given and a class change is enough
  // for them. Without this, choosing Pocket left the channels in slot order
  // until the next payload happened to redraw them: the mode said "worst
  // first" and the board quietly did not.
  if (mode === 'pocketmode' || previous === 'pocketmode') {
    try {
      renderDisplayList(micboard.displayList || []);
    } catch (_) { /* a board with no list yet simply has nothing to reorder */ }
  }

  if (mode === 'tvmode') {
    applyDefaultBackgroundIfNeeded();
  }
}

/**
 * Reflect the view choices onto the container, so CSS can key off them and so
 * the current state is legible in the DOM rather than only in a variable.
 *
 * Arrangement and card shape are read here by JS rather than CSS -- the
 * geometry is arithmetic and arrives as custom properties -- but text placement
 * really is only presentation, so `text-*` is the one of the three that a
 * stylesheet rule actually acts on.
 */
function applyViewClasses() {
  const container = document.getElementById('container');
  if (!container) {
    return;
  }
  ARRANGEMENTS.forEach((a) => container.classList.remove(`arrangement-${a}`));
  CARD_SHAPES.forEach((s) => container.classList.remove(`card-${s}`));
  TYPE_SIZES.forEach((s) => container.classList.remove(`type-${s}`));
  WASH_STYLES.forEach((w) => container.classList.remove(`wash-${w}`));
  container.classList.add(`arrangement-${micboard.arrangement}`);
  container.classList.add(`card-${micboard.cardShape}`);
  // ⛔ Fixed at the bottom since #130; it was a setting and is not any more.
  container.classList.add('text-bottom');
  // `type-`, not `textsize-`: near-identical class prefixes on the same element
  // are a reading trap, and the variable these drive is already --tvmode-type-*.
  container.classList.add(`type-${micboard.typeSize}`);
  container.classList.add(`wash-${micboard.wash}`);
  // ⭐ Desk or TV, from the same resolved state as the rest (#216). This was
  // the one view class the container got from the markup instead of from
  // `micboard`, so a remembered TV board painted as a desk board until
  // something else happened to call `setDisplayMode`.
  DISPLAY_MODES.forEach((m) => container.classList.remove(m));
  container.classList.add(micboard.displayMode);
}

/**
 * The top bar's class goes on <body>, not on #container.
 *
 * ⛔ It has to. The bar is a sibling of #container, not a child, so a class on
 * the container cannot reach it -- which is exactly why the stylesheet's old
 * `.tvmode .navbar { display: none }` never hid anything in TV mode despite
 * looking like it would.
 */
/**
 * The locked class, on <body>.
 *
 * ⛔ This was `applyTopBarClass`, and it also wrote `topbar-shown` /
 * `topbar-hidden` for a preference that hid the menu bar. #188 retired the bar,
 * so there was nothing left for that class to hide and the preference went with
 * it -- a control that cannot change anything is worse than no control.
 *
 * ⚠️ The locked class stays, and stays on <body>, because rules outside
 * `#container` read it (#116).
 */
function applyLockedClass() {
  const { body } = document;
  if (!body) {
    return;
  }
  body.classList.toggle('viewer-locked', isLocked(micboard.viewerLock));
  // ⭐ Where the status bar sits, so the stylesheet can reserve the strip at the
  // right end (#188). On <body> for the same reason the locked class is: the
  // bar is a sibling of `#container`, not a child, so a class on the container
  // cannot reach it -- the mistake `.tvmode .navbar` made for two releases.
  STATUS_BAR_PLACEMENTS.forEach((p) => body.classList.remove(`statusbar-${p}`));
  body.classList.add(`statusbar-${micboard.statusBar || 'bottom'}`);
}

export function applyBoardLayout() {
  applyViewClasses();
  applyLockedClass();
  requestTvLayoutUpdate();

  // So anything showing these values can follow along. The panel (#111) mirrors
  // the same state the keys change, and a key pressed while it is open has to
  // move the control too or the two disagree about the board in front of you.
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const evt = (typeof window.CustomEvent === 'function')
        ? new CustomEvent('wirelessboard:view-changed')
        : new Event('wirelessboard:view-changed');
      window.dispatchEvent(evt);
    }
  } catch (_) {
    // A board that cannot announce a view change still has to change the view.
  }
}

/**
 * Set one view preference outright (#111).
 *
 * The keys cycle; a control in the panel picks a value. ⭐ Both land in the
 * same place -- the same field, the same storage key, the same hash -- because
 * a control and its key that disagreed would be worse than having only the key.
 */
export function setViewOption(id, value) {
  const control = controlFor(id);
  if (!isValidValue(control, value)) {
    return null;
  }
  micboard[id] = value;
  writePref({ storage: safeStorage(), key: control.storageKey, value });
  applyBoardLayout();
  updateHash();
  return value;
}

/** What the board currently has, for whatever is drawing the controls. */
export function viewOptionValue(id) {
  return micboard[id];
}

/**
 * Cycle rather than set: one key per control instead of three, and the help
 * overlay stays one line each.
 */
export function cycleArrangement() {
  micboard.arrangement = nextOption(ARRANGEMENTS, micboard.arrangement);
  writePref({ storage: safeStorage(), key: ARRANGEMENT_KEY, value: micboard.arrangement });
  applyBoardLayout();
  updateHash();
  return micboard.arrangement;
}

export function cycleCardShape() {
  micboard.cardShape = nextOption(CARD_SHAPES, micboard.cardShape);
  writePref({ storage: safeStorage(), key: CARD_SHAPE_KEY, value: micboard.cardShape });
  applyBoardLayout();
  updateHash();
  return micboard.cardShape;
}

export function cycleTypeSize() {
  micboard.typeSize = nextOption(TYPE_SIZES, micboard.typeSize);
  writePref({ storage: safeStorage(), key: TYPE_SIZE_KEY, value: micboard.typeSize });
  applyBoardLayout();
  updateHash();
  return micboard.typeSize;
}

/**
 * Whether the status colour owns the band or the whole card (#130).
 */
/**
 * Where the service-position strip sits (#121).
 *
 * ⚠️ Per device, not per board. The wall wants the spare card; a phone in a
 * pocket wants the top. Whether to follow Live at all is a server setting,
 * because it spends one Planning Center account's allowance for everybody.
 */
/**
 * Whether this screen pages through its groups (#113).
 *
 * ⛔ Per device. The rotation's content -- which groups, in what order, for how
 * long -- is global and lives in `config.json`; whether *this* screen pages is
 * local, because the wall rotates and the FOH laptop watching the same server
 * does not.
 */
export function cycleRotation() {
  micboard.rotation = nextOption(ROTATION_STATES, micboard.rotation);
  writePref({ storage: safeStorage(), key: ROTATION_KEY, value: micboard.rotation });
  // ⛔ The driver decides whether to page, not this (#202). Switching rotation
  // off must not stop a board that cannot show every channel: the alternative
  // to paging there is hiding one. `startRotation` restarts from page one and
  // ticks immediately, so the answer is known by the next line.
  startRotation();
  if (!micboard.pagingReason) {
    // Nothing forces paging, and the operator has turned it off: back to
    // whatever the board was showing before it started.
    stopRotation();
    renderGroup(micboard.group || 0);
  }
  updateHash();
  return micboard.rotation;
}

export function cycleLivePlacement() {
  micboard.livePlacement = nextOption(PLACEMENTS, micboard.livePlacement);
  writePref({ storage: safeStorage(), key: LIVE_PLACEMENT_KEY, value: micboard.livePlacement });
  applyBoardLayout();
  // ⚠️ Redraw now. Waiting for the next poll means up to fifteen seconds of an
  // operator thinking the key is broken and pressing it again.
  refreshLiveStrip(micboard.livePlacement);
  updateHash();
  return micboard.livePlacement;
}

export function cycleWash() {
  micboard.wash = nextOption(WASH_STYLES, micboard.wash);
  writePref({ storage: safeStorage(), key: WASH_KEY, value: micboard.wash });
  applyBoardLayout();
  updateHash();
  return micboard.wash;
}

/**
 * How many columns the board may use (#112).
 *
 * Cycles like the controls above rather than taking a number, so it fits the
 * one-key-per-control shape. `auto` is in the list, so a few presses always
 * gets back to the board deciding for itself.
 */
export function cycleColumns() {
  micboard.columns = nextOption(COLUMN_CHOICES, micboard.columns);
  writePref({ storage: safeStorage(), key: COLUMNS_KEY, value: micboard.columns });
  applyBoardLayout();
  updateHash();
  return micboard.columns;
}

/**
 * Lock this device to display only (#116).
 *
 * ⚠️ Not a security control and the label says so. It stops a tap on a wall
 * tablet reaching a configuration save, which drops every receiver socket for
 * ~2 seconds and blanks every board in the building.
 */
export function cycleViewerLock() {
  micboard.viewerLock = nextOption(LOCK_STATES, micboard.viewerLock);
  writePref({ storage: safeStorage(), key: VIEWER_LOCK_KEY, value: micboard.viewerLock });
  applyBoardLayout();
  if (isLocked(micboard.viewerLock)) {
    // ⚠️ Say so. `K` sits among keys people press on purpose, and a board that
    // silently emptied its own menu would be alarming to whoever hit it by
    // accident -- the one direction of this toggle that is a surprise.
    showLockNote(lockedJustNowNote());
  } else {
    // ⛔ And take it away on the way back, or a board that has just been
    // unlocked spends four seconds saying it is locked.
    hideLockNote();
  }
  // ⛔ No updateHash(). The lock has no hash parameter on purpose -- a link
  // that switched it off would make it no guard at all.
  return micboard.viewerLock;
}

export function toggleDisplayMode() {
  switch (micboard.displayMode) {
    case 'deskmode': setDisplayMode('tvmode');
      break;
    case 'tvmode': setDisplayMode('deskmode');
      setBackground('NONE');
      break;
    default:
      break;
  }
  updateHash();
}

/**
 * Fullscreen, moved out of `kbd.js` (#160).
 *
 * ⚠️ Prefixed and unprefixed both: this runs in Electron and in whatever
 * browser a phone brought along, and the venue board is a Chromium that has
 * had the prefixed names for years.
 */
export function isFullscreen() {
  if (typeof document === 'undefined') {
    return false;
  }
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export function setFullscreen(wanted) {
  try {
    if (wanted && !isFullscreen()) {
      const el = document.documentElement;
      const request = el.requestFullscreen || el.webkitRequestFullscreen;
      if (request) request.call(el);
    } else if (!wanted && isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  } catch (_) {
    // A browser that refuses fullscreen (it needs a user gesture, and some
    // app views never allow it) must not take the panel down with it.
  }
  return isFullscreen();
}

export function toggleImageBackground() {
  if (micboard.displayMode === 'tvmode') {
    switch (micboard.backgroundMode) {
      case 'NONE': setBackground('IMG');
        break;
      case 'MP4': setBackground('IMG');
        break;
      case 'IMG': setBackground('NONE');
        break;
      default: break;
    }
  }
}

export function toggleVideoBackground() {
  if (micboard.displayMode === 'tvmode') {
    switch (micboard.backgroundMode) {
      case 'NONE': setBackground('MP4');
        break;
      case 'IMG': setBackground('MP4');
        break;
      case 'MP4': setBackground('NONE');
        break;
      default: break;
    }
  }
}

/**
 * Show or hide the card's status stripe and battery/chart drawer.
 *
 * ⚠️ `switchToTv` exists because the `I` key always forced TV mode -- the
 * elinfo rules only apply there, so a key that did nothing in desk mode would
 * have looked broken. From the panel that is the wrong behaviour: flipping a
 * switch should not move the board to another display mode behind you, and the
 * panel already says in so many words that these apply to TV mode (#160).
 */
export function setInfoDrawer(mode, { switchToTv = true } = {}) {
  const selector = document.getElementById('micboard');
  swapClass(selector, micboard.infoDrawerMode, mode);
  micboard.infoDrawerMode = mode;
  if (switchToTv) {
    setDisplayMode('tvmode');
  }
  updateHash();
}

export function toggleInfoDrawer() {
  switch (micboard.infoDrawerMode) {
    case 'elinfo00': setInfoDrawer('elinfo01');
      break;
    case 'elinfo01': setInfoDrawer('elinfo10');
      break;
    case 'elinfo10': setInfoDrawer('elinfo11');
      break;
    case 'elinfo11': setInfoDrawer('elinfo00');
      break;
    default:
      break;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('wirelessboard:background-default-mode-updated', () => {
    if (micboard.displayMode === 'tvmode') {
      applyDefaultBackgroundIfNeeded();
    }
  });
}
