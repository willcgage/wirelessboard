/**
 * Which file a slot's photo or video is looked up under.
 *
 * There were two answers to this and they disagreed. The guide table in the
 * photo/video section derived the filename from the transmitter's own channel
 * name (`name_raw`), so it told operators to call the file `mic1 bob device.jpg`;
 * gif.js derived it from the displayed name, which is the person. Whichever one
 * you believed, the other was wrong, and media only appeared when a slot's
 * device happened to be named after the person on it.
 *
 * It is the person. A photo belongs to whoever is holding the microphone, not
 * to the microphone -- the transmitter keeps its label when it is handed to
 * someone else, and Planning Center reassigns people to slots every service.
 *
 * One module so the guide and the renderer cannot drift again: what the guide
 * tells you to name the file is by construction what the board goes looking for.
 * No DOM and no imports, so it is testable directly.
 */

const MEDIA_EXTENSIONS = {
  IMG: '.jpg',
  MP4: '.mp4',
};

/**
 * The name a slot's media is keyed on: the person, falling back to whatever the
 * board is displaying for that slot.
 *
 * `transmitter.name` is the resolved display name from the server, which is the
 * person once one is assigned (`extended_name`) and the device-derived name
 * otherwise — the same value that reaches the `.name` element the board renders.
 * ⛔ Deliberately NOT `name_raw`: that is the hardware's own channel label, and
 * preferring it was the bug.
 */
export function backgroundNameForSlot(transmitter, slotConfig) {
  if (transmitter && typeof transmitter === 'object') {
    if (transmitter.name) return String(transmitter.name);
  }
  if (slotConfig && typeof slotConfig === 'object') {
    // Before a transmitter reports in there is no resolved name, so fall back
    // to the assignment itself rather than to the device.
    if (slotConfig.extended_name) return String(slotConfig.extended_name);
  }
  return '';
}

/** Filenames are matched case-insensitively and untrimmed names are a typo trap. */
export function backgroundKey(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase();
}

/**
 * The filenames a slot would use, or null where there is no name to key on.
 * Returning both keeps the guide's two columns and the renderer's lookup in step.
 */
export function backgroundFilenames(name) {
  const key = backgroundKey(name);
  if (!key) return { image: '', video: '' };
  return { image: key + MEDIA_EXTENSIONS.IMG, video: key + MEDIA_EXTENSIONS.MP4 };
}

/** The filename for one background mode; '' when the mode shows no media. */
export function backgroundFilenameForMode(name, mode) {
  const extension = MEDIA_EXTENSIONS[mode];
  if (!extension) return '';
  const key = backgroundKey(name);
  return key ? key + extension : '';
}
