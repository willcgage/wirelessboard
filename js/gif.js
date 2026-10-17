import { micboard } from './app.js';
import { findBackgroundFile } from './background-key.mjs';
import { photoScale, blurRadius } from './photo-fit.mjs';

const MEDIA_BASE_PATH = 'bg/';

/**
 * Size the photograph to its card (#172).
 *
 * ⚠️ Reads the box from the container rather than the card, because the card
 * also holds the text band and the photograph does not get that space.
 */
function fitPhoto(container) {
  const img = container.querySelector('.slot-media__image');
  if (!img || !img.naturalWidth) {
    return;
  }
  const boxW = container.clientWidth;
  const boxH = container.clientHeight;
  if (!boxW || !boxH) {
    return;
  }
  container.style.setProperty(
    '--photo-scale',
    String(photoScale(img.naturalWidth, img.naturalHeight, boxW, boxH)),
  );
  container.style.setProperty('--photo-blur', `${blurRadius(boxW, boxH).toFixed(1)}px`);
}

/**
 * ⭐ One observer for every card, not one each. The board relays out constantly
 * — arrangement, columns, card shape, paging — and the scale depends on the
 * card's shape, so it has to be recomputed rather than set once on load.
 *
 * ⚠️ Safe against a layout loop: the scale is applied as a `transform`, which
 * does not affect layout, so nothing this writes can resize the box that
 * triggered it.
 */
const photoResize = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    entries.forEach((entry) => fitPhoto(entry.target));
  })
  : null;

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
  if (photoResize) {
    photoResize.unobserve(container);
  }
  container.style.removeProperty('--photo-scale');
  container.style.removeProperty('--photo-blur');
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

  const src = MEDIA_BASE_PATH + filename;

  // ⭐ The filler first, so it paints behind. Same `src`, so the browser serves
  // it from cache and the card costs one request, not two.
  const backdrop = document.createElement('img');
  backdrop.src = src;
  backdrop.alt = '';
  backdrop.decoding = 'async';
  backdrop.loading = 'lazy';
  backdrop.className = 'slot-media__backdrop';
  container.appendChild(backdrop);

  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.className = 'slot-media__image';
  // ⚠️ Both paths are needed: `load` for a fresh request, and the immediate
  // call for one served from cache, where `complete` is already true and the
  // event has fired before this listener could be attached.
  img.addEventListener('load', () => fitPhoto(container));
  container.appendChild(img);

  container.dataset.mediaType = 'image';
  container.dataset.mediaName = filename;
  container.classList.add('is-active', 'is-image');
  if (img.complete) {
    fitPhoto(container);
  }
  if (photoResize) {
    photoResize.observe(container);
  }
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

  // The rendered name, which is the person once one is assigned. Derived
  // through background-key.mjs so this and the guide table in the photo/video
  // section cannot disagree about what the file is called.
  const rawName = nameEl.textContent || nameEl.innerText || nameEl.innerHTML || '';

  // Resolved against the directory listing rather than assumed, so `Jane
  // Smith.JPG` matches and is then requested under that exact spelling -- /bg/
  // is served off disk, where case matters.
  if (micboard.backgroundMode === 'MP4') {
    const filename = findBackgroundFile(rawName, 'MP4', micboard.mp4_list, mediaAssignments());
    if (filename) {
      const container = ensureMediaContainer(slotEl);
      mountVideo(container, filename);
      return;
    }
    removeMedia(slotEl);
    return;
  }

  if (micboard.backgroundMode === 'IMG') {
    const filename = findBackgroundFile(rawName, 'IMG', micboard.img_list, mediaAssignments());
    if (filename) {
      const container = ensureMediaContainer(slotEl);
      mountImage(container, filename);
      return;
    }
    removeMedia(slotEl);
    return;
  }

  removeMedia(slotEl);
}

/**
 * The photos chosen by hand, from the served config (#145).
 *
 * ⚠️ Read fresh each render rather than cached. A choice made on a laptop
 * reaches this board through the ordinary payload, and a cached copy would
 * leave a wall showing the old photo until somebody reloaded it.
 */
function mediaAssignments() {
  const media = micboard.config && micboard.config.media;
  return (media && typeof media.assignments === 'object') ? media.assignments : null;
}

export function updateGIFBackgrounds() {
  const slots = document.getElementsByClassName('mic_name');
  for (let i = 0; i < slots.length; i += 1) {
    updateBackground(slots[i]);
  }
}
