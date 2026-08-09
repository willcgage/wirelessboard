/**
 * The shape of update-state.json, and the rules for changing it.
 *
 * The file started out holding one key -- the version whose prompt had been
 * dismissed -- and was written by replacing the whole object with that key. A
 * second key could not survive that: turning automatic checks off and then
 * dismissing a prompt would have silently turned them back on. So every write
 * merges onto what is already there, and anything this module does not know
 * about is carried through untouched rather than dropped.
 *
 * Pure by design, like update-check.js and update-prompt.js beside it, so the
 * rules can be tested without a filesystem or an electron import.
 */

// Checks stay on unless somebody says otherwise. A board that quietly stopped
// looking for updates would be worse than one that asks.
const DEFAULTS = Object.freeze({
  automaticChecks: true,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * What the file means, given whatever was actually in it.
 *
 * A missing or malformed value falls back to the default rather than being
 * treated as false: the cost of guessing "on" is one prompt too many, and the
 * cost of guessing "off" is a board that never mentions a security update
 * again.
 */
function normalizeSettings(parsed) {
  const source = isPlainObject(parsed) ? parsed : {};
  return {
    automaticChecks: typeof source.automaticChecks === 'boolean'
      ? source.automaticChecks
      : DEFAULTS.automaticChecks,
  };
}

/**
 * The object to write, given what is on disk and what is being changed.
 *
 * Unknown keys are preserved deliberately: a newer build may have written
 * something this one has never heard of, and an older build quietly discarding
 * a user's settings is a bad way to find that out.
 */
function mergeSettings(existing, patch) {
  const base = isPlainObject(existing) ? existing : {};
  const change = isPlainObject(patch) ? patch : {};
  return { ...base, ...change };
}

/**
 * Whether a check should go ahead.
 *
 * A check the operator asked for by hand always goes ahead -- switching the
 * automatic checks off means "stop doing this on your own", not "refuse when I
 * ask". Without that, turning them off would leave no way to update
 * deliberately short of editing a file.
 */
function shouldCheck({ settings, manual = false } = {}) {
  if (manual) {
    return true;
  }
  return normalizeSettings(settings).automaticChecks;
}

module.exports = {
  DEFAULTS,
  normalizeSettings,
  mergeSettings,
  shouldCheck,
};
