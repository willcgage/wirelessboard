/**
 * Remembering the view choices on the device.
 *
 * displayMode has always lived in the URL hash, which is per-tab and shareable
 * but forgotten on reload. That is wrong for the screens this runs on: a board
 * on a wall comes back from a power cut and should still be in the layout it
 * was left in, and nobody is there to press a key.
 *
 * So: the hash still wins when it says something, because a link someone was
 * handed should show what it promises. Otherwise the stored value, otherwise
 * the default.
 *
 * Storage is passed in rather than reached for, both so this can be tested and
 * because localStorage is not always there to be reached for -- it throws
 * outright in some privacy modes and under file:// origins, and a board that
 * refused to start over a remembered preference would be a poor trade.
 */

// ⛔ The stored keys keep their original names on purpose. 1.11.0 wrote them,
// and boards have them; renaming the key would orphan every remembered choice
// and quietly reset a wall display to the default. The *values* did change
// vocabulary, which is what migrateArrangement/migrateCardShape are for.
export const ARRANGEMENT_KEY = 'wirelessboard.gridOrientation';
export const CARD_SHAPE_KEY = 'wirelessboard.slotAspect';

// New in this build, so unlike the two above it is free to be named for what it
// holds and needs no value migration -- nothing has ever written it.
export const TYPE_SIZE_KEY = 'wirelessboard.typeSize';
// ⭐⭐ Where the status bar sits, and the strip reserved for it (#188).
//
// The maintainer's reason for retiring the menu bar:
//
//   "This allows everything to shift up providing space Top or Bottom for the
//    status bar."
//
// ⛔ The strip is reserved whenever it is not `off`, **not** only while the bar
// is showing. Reserving it on demand sets up a feedback loop: the strip reduces
// the height available, which reduces capacity, which can be what makes the
// board page, which shows the bar, which reserves the strip. A fixed strip has
// no such loop, cannot clip the bottom row, and does not reflow the board the
// moment paging starts -- `off` is there for an operator who wants the pixels.
//
// ⭐ This is the real fix for the clipped bottom row photographed on the wall:
// `.rotation-bar` was `position: fixed; bottom: 0` over a board laid out as
// though the whole screen were available, so the bar sat on the last row.
export const STATUS_BAR_KEY = 'wirelessboard.statusBar';
export const STATUS_BAR_PLACEMENTS = ['bottom', 'top', 'off'];
export function isStatusBarPlacement(value) {
  return STATUS_BAR_PLACEMENTS.includes(value);
}

// ⛔ `TOP_BAR_KEY` was here. #188 retired the bar it hid, so nothing reads the
// stored value any more. Boards still have it; it is left in storage rather
// than migrated, because an unread key costs nothing.
export const COLUMNS_KEY = 'wirelessboard.columns';
export const WASH_KEY = 'wirelessboard.wash';
// ⚠️ Where the Live strip sits is per device; *whether* to follow Live at all
// is server-side, because it spends one Planning Center account's API calls
// for everybody (#116's line, #121's strip).
export const LIVE_PLACEMENT_KEY = 'wirelessboard.livePlacement';
// ⭐ The rotation's *content* is global -- which groups, in what order, for how
// long -- but whether this screen pages is local. The wall rotates; the FOH
// laptop showing the same server does not (#113, and #116's line).
export const ROTATION_KEY = 'wirelessboard.rotation';
// ⛔ The one view preference with no hash parameter. A lock a link can switch
// off would not be an accident guard at all -- see `viewer-lock.mjs` (#116).
export const VIEWER_LOCK_KEY = 'wirelessboard.viewerLock';
// ⭐⭐ Desk or TV, remembered like every other look (#216).
//
// ⛔ It was the one view preference that was not. `micboard.displayMode` was
// initialised to `'deskmode'` in app.js and never stored, so TV mode survived
// only in the URL hash -- and the hash is lost the moment the slot-name editor
// opens, while Escape, the only way out of several panes, is a full page
// reload. A wall came back from any of those showing the desk layout, and
// nothing a person at the board could do put it right except finding the
// display-mode control again.
//
// ⭐ Per device, like the rest of this file: the wall is a television and the
// FOH laptop watching the same server is not.
export const DISPLAY_MODE_KEY = 'wirelessboard.displayMode';
export const DISPLAY_MODES = ['deskmode', 'tvmode'];
export function isDisplayMode(value) {
  return DISPLAY_MODES.includes(value);
}

// ⭐ Which of the configured screens this device is (#170). Per device because
// it *is* a device fact -- the wall above the dock and the laptop at front of
// house are different screens, and the laptop has no dock under it at all. The
// screens themselves are global; only the answer to "which one am I" is local.
export const SCREEN_KEY = 'wirelessboard.screenId';

export function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch (_) {
    // Access itself throws in some privacy modes.
  }
  return null;
}

/**
 * A value this build accepts, or null.
 *
 * `migrate` exists because the vocabulary changed after 1.11.0 shipped: boards
 * have `landscape` stored and links carry it. Translating is kinder than
 * ignoring, which would silently reset a wall display to the default.
 */
function accept(value, isValid, migrate) {
  if (typeof isValid !== 'function') {
    return null;
  }
  if (isValid(value)) {
    return value;
  }
  if (typeof migrate === 'function') {
    const migrated = migrate(value);
    if (isValid(migrated)) {
      return migrated;
    }
  }
  return null;
}

export function readPref({
  storage, key, isValid, migrate, fallback,
}) {
  try {
    const value = storage && storage.getItem ? storage.getItem(key) : null;
    const accepted = accept(value, isValid, migrate);
    if (accepted !== null) {
      return accepted;
    }
  } catch (_) {
    // A read that fails means "nothing remembered", not "stop".
  }
  return fallback;
}

export function writePref({ storage, key, value }) {
  try {
    if (storage && storage.setItem) {
      storage.setItem(key, value);
      return true;
    }
  } catch (_) {
    // Quota or a locked-down origin. Losing the preference costs one keypress
    // next time, which is not worth an error path on the board.
  }
  return false;
}

/**
 * hash beats stored beats default.
 *
 * An unrecognised value anywhere is ignored rather than trusted -- these end up
 * in a CSS class name and a grid calculation, and a link is the easiest thing
 * in the app for someone to have typed by hand.
 */
export function resolvePref({
  hashValue, storage, key, isValid, migrate, fallback,
}) {
  const fromHash = accept(hashValue, isValid, migrate);
  if (fromHash !== null) {
    return fromHash;
  }
  return readPref({
    storage, key, isValid, migrate, fallback,
  });
}
