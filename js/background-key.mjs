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

/**
 * What each mode will accept, best first.
 *
 * Order is precedence, not preference: with both `jane smith.jpg` and
 * `jane smith.png` in the folder the jpg wins. That is deliberate — it means
 * widening this list can never change which file an existing board picks, only
 * give it something to find where it previously found nothing.
 *
 * The first entry is also what the guide table suggests when a slot has no file
 * yet, so keep the most ordinary format at the front.
 */
const MEDIA_EXTENSIONS = {
  IMG: ['.jpg', '.jpeg', '.png', '.webp'],
  // The mode is called MP4 in the interface, in the bgmode URL parameter and in
  // the saved default; it names the mode, not the container. .mov is here
  // because that is what a phone and most cameras record, and remuxing one is a
  // step operators should not have to know about -- but it stays second: what
  // actually plays is the codec inside, and H.264 in an .mp4 is the safest
  // combination the board can be handed.
  MP4: ['.mp4', '.mov'],
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
 * The file on disk that serves this slot in this mode, or '' when there is none.
 *
 * The key is lowercased, but what the server lists is whatever is actually in
 * the background directory -- `Jane Smith.JPG`, `Jane Smith.jpg`, the PascalCase
 * a phone or a stock library hands you. Comparing the key to those directly
 * meant only an all-lowercase filename ever matched, so a correctly named photo
 * showed as missing and the board rendered nothing.
 *
 * So the comparison is case-insensitive on both sides, and the entry returned is
 * the directory's own spelling: `/bg/<name>` is served straight off disk, and on
 * a case-sensitive filesystem asking for the lowercased form is a 404.
 */
export function findBackgroundFile(name, mode, available) {
  const key = backgroundKey(name);
  const extensions = MEDIA_EXTENSIONS[mode];
  if (!key || !extensions || !Array.isArray(available)) return '';

  // Format order is the outer loop, so a jpg always beats a png regardless of
  // how either is capitalised.
  for (let e = 0; e < extensions.length; e += 1) {
    const wanted = key + extensions[e];
    let insensitive = '';
    for (let i = 0; i < available.length; i += 1) {
      const entry = available[i];
      if (typeof entry !== 'string') continue;
      // An exactly-named file wins, so two files differing only in case resolve
      // the same way every render rather than by directory order.
      if (entry === wanted) return entry;
      if (!insensitive && backgroundKey(entry) === wanted) insensitive = entry;
    }
    if (insensitive) return insensitive;
  }
  return '';
}

/**
 * The filenames a slot would use, or null where there is no name to key on.
 * Returning both keeps the guide's two columns and the renderer's lookup in step.
 */
export function backgroundFilenames(name) {
  return {
    image: backgroundFilenameForMode(name, 'IMG'),
    video: backgroundFilenameForMode(name, 'MP4'),
  };
}

/**
 * The filename to suggest for one background mode; '' when the mode shows no
 * media. This is what to name a file that does not exist yet — several formats
 * are accepted, so use findBackgroundFile to learn what is actually there.
 */
export function backgroundFilenameForMode(name, mode) {
  const extensions = MEDIA_EXTENSIONS[mode];
  if (!extensions) return '';
  const key = backgroundKey(name);
  return key ? key + extensions[0] : '';
}

/** Every extension a mode accepts, best first. A copy: callers must not mutate. */
export function backgroundExtensions(mode) {
  const extensions = MEDIA_EXTENSIONS[mode];
  return extensions ? extensions.slice() : [];
}
