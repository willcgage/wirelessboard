import { micboard, updateHash } from './app.js';

import { updateGIFBackgrounds } from './gif.js';
import { requestTvLayoutUpdate } from './tv-layout.js';
import { ORIENTATIONS, ASPECTS, nextOption } from './board-layout.mjs';
import {
  writePref, safeStorage, ORIENTATION_KEY, ASPECT_KEY,
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
 * Reflect the two view choices onto the container, so CSS can key off them and
 * so the current state is legible in the DOM rather than only in a variable.
 */
function applyViewClasses() {
  const container = document.getElementById('container');
  if (!container) {
    return;
  }
  ORIENTATIONS.forEach((o) => container.classList.remove(`grid-${o}`));
  ASPECTS.forEach((a) => container.classList.remove(`aspect-${a}`));
  container.classList.add(`grid-${micboard.gridOrientation}`);
  container.classList.add(`aspect-${micboard.slotAspect}`);
}

export function applyBoardLayout() {
  applyViewClasses();
  requestTvLayoutUpdate();
}

/**
 * Cycle rather than set: one key per control instead of three, and the help
 * overlay stays one line each.
 */
export function cycleGridOrientation() {
  micboard.gridOrientation = nextOption(ORIENTATIONS, micboard.gridOrientation);
  writePref({ storage: safeStorage(), key: ORIENTATION_KEY, value: micboard.gridOrientation });
  applyBoardLayout();
  updateHash();
  return micboard.gridOrientation;
}

export function cycleSlotAspect() {
  micboard.slotAspect = nextOption(ASPECTS, micboard.slotAspect);
  writePref({ storage: safeStorage(), key: ASPECT_KEY, value: micboard.slotAspect });
  applyBoardLayout();
  updateHash();
  return micboard.slotAspect;
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
