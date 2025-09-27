'use strict';

import { micboard } from './app.js';

const MEDIA_EXTENSIONS = {
  IMG: '.jpg',
  MP4: '.mp4',
};

const MEDIA_BASE_PATH = 'bg/';

function ensureMediaContainer(slotEl) {
  let container = slotEl.querySelector('.slot-media');
  if (!container) {
    container = document.createElement('div');
    container.className = 'slot-media';
    container.setAttribute('aria-hidden', 'true');
    slotEl.insertBefore(container, slotEl.firstChild);
  }
  return container;
}

function clearMedia(container) {
  container.classList.remove('is-active', 'is-image', 'is-video');
  container.dataset.mediaType = '';
  container.dataset.mediaName = '';
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function mountImage(container, filename) {
  const currentType = container.dataset.mediaType;
  const currentName = container.dataset.mediaName;
  if (currentType === 'image' && currentName === filename) {
    return;
  }

  clearMedia(container);

  const img = document.createElement('img');
  img.src = MEDIA_BASE_PATH + filename;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.className = 'slot-media__image';

  container.appendChild(img);
  container.dataset.mediaType = 'image';
  container.dataset.mediaName = filename;
  container.classList.add('is-active', 'is-image');
}

function mountVideo(container, filename) {
  const currentType = container.dataset.mediaType;
  const currentName = container.dataset.mediaName;
  if (currentType === 'video' && currentName === filename) {
    return;
  }

  clearMedia(container);

  const video = document.createElement('video');
  video.src = MEDIA_BASE_PATH + filename;
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.className = 'slot-media__video';

  container.appendChild(video);
  container.dataset.mediaType = 'video';
  container.dataset.mediaName = filename;
  container.classList.add('is-active', 'is-video');
}

function removeMedia(slotEl) {
  const container = slotEl.querySelector('.slot-media');
  if (!container) return;
  clearMedia(container);
}

export function updateBackground(slotEl) {
  if (!slotEl) return;

  const nameEl = slotEl.getElementsByClassName('name')[0];
  if (!nameEl) {
    removeMedia(slotEl);
    return;
  }

  const extension = MEDIA_EXTENSIONS[micboard.backgroundMode];
  if (!extension) {
    removeMedia(slotEl);
    return;
  }

  const baseName = String(nameEl.innerHTML || '')
    .trim()
    .toLowerCase();
  if (!baseName) {
    removeMedia(slotEl);
    return;
  }

  const filename = baseName + extension;

  if (micboard.backgroundMode === 'MP4') {
    if (Array.isArray(micboard.mp4_list) && micboard.mp4_list.indexOf(filename) > -1) {
      const container = ensureMediaContainer(slotEl);
      mountVideo(container, filename);
      return;
    }
    removeMedia(slotEl);
    return;
  }

  if (micboard.backgroundMode === 'IMG') {
    if (Array.isArray(micboard.img_list) && micboard.img_list.indexOf(filename) > -1) {
      const container = ensureMediaContainer(slotEl);
      mountImage(container, filename);
      return;
    }
    removeMedia(slotEl);
    return;
  }

  removeMedia(slotEl);
}

export function updateGIFBackgrounds() {
  const slots = document.getElementsByClassName('mic_name');
  for (let i = 0; i < slots.length; i += 1) {
    updateBackground(slots[i]);
  }
}
