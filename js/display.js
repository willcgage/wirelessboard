import { micboard, updateHash } from './app';

import { updateGIFBackgrounds } from './gif';
import { requestTvLayoutUpdate } from './tv-layout.js';

function swapClass(selector, currentClass, newClass) {
  selector.classList.remove(currentClass);
  selector.classList.add(newClass);
}


export function setBackground(mode) {
  micboard.backgroundMode = mode;
  const elements = document.querySelectorAll('#micboard .mic_name')
  Array.from(elements).forEach((e) => {
    e.style.backgroundImage = ''
    e.style.backgroundSize = ''
  })
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
