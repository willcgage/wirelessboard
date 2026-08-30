import { micboard, updateHash } from './app.js';

import { updateGIFBackgrounds } from './gif.js';
import { requestTvLayoutUpdate } from './tv-layout.js';
import {
  ARRANGEMENTS, CARD_SHAPES, TEXT_POSITIONS, TYPE_SIZES, nextOption,
} from './board-layout.mjs';
import {
  writePref, safeStorage,
  ARRANGEMENT_KEY, CARD_SHAPE_KEY, TEXT_POSITION_KEY, TYPE_SIZE_KEY,
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

export function setDisplayMode(mode) {
  const selector = document.getElementById('container');
  swapClass(selector, micboard.displayMode, mode);
  micboard.displayMode = mode;
  requestTvLayoutUpdate();
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
  TEXT_POSITIONS.forEach((p) => container.classList.remove(`text-${p}`));
  TYPE_SIZES.forEach((s) => container.classList.remove(`type-${s}`));
  container.classList.add(`arrangement-${micboard.arrangement}`);
  container.classList.add(`card-${micboard.cardShape}`);
  container.classList.add(`text-${micboard.textPosition}`);
  // `type-`, not `textsize-`: near-identical class prefixes on the same element
  // are a reading trap, and the variable these drive is already --tvmode-type-*.
  container.classList.add(`type-${micboard.typeSize}`);
}

export function applyBoardLayout() {
  applyViewClasses();
  requestTvLayoutUpdate();
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

export function cycleTextPosition() {
  micboard.textPosition = nextOption(TEXT_POSITIONS, micboard.textPosition);
  writePref({ storage: safeStorage(), key: TEXT_POSITION_KEY, value: micboard.textPosition });
  applyBoardLayout();
  updateHash();
  return micboard.textPosition;
}

export function cycleTypeSize() {
  micboard.typeSize = nextOption(TYPE_SIZES, micboard.typeSize);
  writePref({ storage: safeStorage(), key: TYPE_SIZE_KEY, value: micboard.typeSize });
  applyBoardLayout();
  updateHash();
  return micboard.typeSize;
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

export function setInfoDrawer(mode) {
  const selector = document.getElementById('micboard');
  swapClass(selector, micboard.infoDrawerMode, mode);
  micboard.infoDrawerMode = mode;
  setDisplayMode('tvmode');
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
