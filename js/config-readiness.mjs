/**
 * Telling "this board has no channels" from "this board has not loaded yet" (#150).
 *
 * ⛔ The configuration editor could not tell the difference. It read
 * `micboard.config.slots`, found nothing before the first payload arrived, and
 * offered four blank rows — the same thing it offers a genuinely empty board.
 *
 * Pressing Save there writes what is on screen. Untouched blank rows are
 * dropped rather than flagged, so the payload is `slots: []`, and the server
 * takes it: verified against a running board, two configured channels became
 * none and the groups were left pointing at channels that no longer exist.
 *
 * ⚠️ The press is the likely part. An operator who opens the configuration page
 * and sees four unexpected blank rows concludes the board has lost its setup
 * and starts re-entering it — and Save is how you finish that.
 */

/**
 * Has the first payload arrived?
 *
 * `micboard.config` is undefined until `data.json` lands and is an object
 * afterwards, even for a board with no channels at all. That is the whole
 * distinction, and it is why this checks the container rather than its
 * contents.
 */
export function boardHasLoaded(board) {
  return !!(board && board.config && typeof board.config === 'object');
}

/** How many channels the board is configured with, as far as we know. */
export function configuredCount(board) {
  if (!boardHasLoaded(board)) {
    return null;
  }
  const { slots } = board.config;
  return Array.isArray(slots) ? slots.length : 0;
}

/**
 * What the editor should draw: 'waiting', 'empty' or 'configured'.
 *
 * ⛔ 'waiting' is the state that did not exist. Everything else follows from
 * having a name for it.
 */
export function editorState(board) {
  if (!boardHasLoaded(board)) {
    return 'waiting';
  }
  return configuredCount(board) > 0 ? 'configured' : 'empty';
}

/**
 * The confirmation for a save that would remove every channel, or null.
 *
 * ⚠️ Defence in depth rather than the fix. With the editor no longer offering
 * blank rows before the board has loaded, this should never fire by accident —
 * but it is the one guard that catches *any* route to the same outcome,
 * including ones nobody has thought of, and it is a single prompt on an action
 * that is rare and irreversible.
 *
 * ⭐ Deliberately not a blanket "are you sure?". It fires only when channels
 * would go from some to none, which is the case that cannot be undone by
 * typing the row back in — the groups have already been left dangling.
 */
export function emptyingSaveWarning(before, after) {
  // ⛔ null and undefined are checked before Number(), because `Number(null)`
  // is 0 and would turn "we do not know how many channels survive" into "none
  // survive" -- a prompt about a number nobody has. The same trap the battery
  // icon fell into.
  if (before === null || before === undefined || after === null || after === undefined) {
    return null;
  }
  const had = Number(before);
  const keeping = Number(after);
  if (!Number.isFinite(had) || !Number.isFinite(keeping)) {
    return null;
  }
  if (had <= 0 || keeping > 0) {
    return null;
  }
  return `This removes all ${had} channel${had === 1 ? '' : 's'} from the board. `
    + 'Groups will be left pointing at channels that no longer exist. Save anyway?';
}

/** What to show in the slot list while the board is still loading. */
export function waitingMessage() {
  return 'Reading the board’s configuration…';
}
