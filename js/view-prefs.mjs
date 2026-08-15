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
