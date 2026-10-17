/**
 * Editing the dock below the screens (#203).
 *
 * ⭐ The same shape as the screens editor beside it, and deliberately so: the
 * pairing, merge and summary all come from `editor-rows.mjs`, which is #180's
 * logic in one place rather than two. What is here is only what differs — what
 * counts as a problem with a dock, and what one is sent as.
 *
 * Pure, so the rules can be checked without a DOM.
 */

import {
  pairRows as rowsPairRows,
  toPayload as rowsToPayload,
  mergeSaved as rowsMergeSaved,
  saveCounts as rowsSaveCounts,
} from './editor-rows.mjs';
import { dockKind, screenNamesDock } from './docks.mjs';
import { positionWidthProblem, dockModel, OTHER_MODEL } from './dock-models.mjs';

/** A stable id from a name: lowercase, hyphenated, nothing surprising. */
export function dockId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** An id not already taken, so two docks named the same still both exist. */
export function uniqueDockId(name, existing = []) {
  const base = dockId(name) || 'dock';
  const taken = new Set(existing.filter(Boolean));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

function positive(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What is wrong with one row, or null.
 *
 * ⚠️ Per row, not per form. "Something is wrong with your dock" is not
 * actionable on a Sunday morning — the same rule every editor here follows.
 */
export function dockProblem(row) {
  const name = String((row && row.name) || '').trim();
  if (!name) {
    return 'Give it a name — "Main dock", "Stage left table".';
  }
  // ⛔ The width is required here, unlike on the screen row it came from. A
  // screen with nothing underneath it is a normal thing to describe; a dock
  // with no position width is not a dock, it is an empty entry that could be
  // chosen and would silently impose nothing.
  //
  // ⛔⛔ And it is now BOUNDED. A venue board was configured with one dock
  // typed as `39` instead of `3.9`; the floor is the widest position
  // underneath, so every column had to be 39 inches on a 55-inch screen. One
  // column, and a wall that paged through twelve channels one at a time.
  // Nothing in the product questioned it.
  const width = positionWidthProblem(row && row.position_inches);
  if (width) {
    return width;
  }
  // Optional, but junk in it is not.
  if (row.positions !== '' && row.positions !== null && row.positions !== undefined
    && !positive(row.positions)) {
    return 'How many positions has it got? A whole number, or leave it empty.';
  }
  return null;
}

export function docksHaveProblems(rows) {
  return (rows || []).some((row) => dockProblem(row) !== null);
}

const SPEC = {
  problem: dockProblem,
  entry: (row, ids) => ({
    id: row.id || uniqueDockId(String(row.name).trim(), ids),
    name: String(row.name).trim(),
    kind: dockKind(row.kind),
    position_inches: positive(row.position_inches),
    positions: positive(row.positions),
    // ⭐ Which model filled the two numbers in, so reopening the editor shows
    // what was chosen rather than only the figures it produced. `other` is a
    // real answer — a shelf has no model number — and is stored as one.
    model: dockModel(row.model) ? String(row.model) : OTHER_MODEL,
  }),
};

export function pairRows(rows) {
  return rowsPairRows(rows, SPEC);
}

export function toPayload(rows) {
  return rowsToPayload(rows, SPEC);
}

export function mergeSaved(rows, saved) {
  return rowsMergeSaved(rows, saved, SPEC);
}

/**
 * How many docks went, and how many were held back (A2).
 *
 * ⛔ This used to build its own sentence, and nothing ever called it — the
 * save line was the screens' alone. So a dock dropped for having no name was
 * reported by a sentence about screens, which is how the field test came to
 * say "I had to give the Dock a name before it would save": they worked it
 * out, the product never said it.
 */
export function saveCounts(rows) {
  return rowsSaveCounts(rows, SPEC);
}

/**
 * What a screen would lose by pointing somewhere else, or null.
 *
 * ⛔ Removing dock a screen names does not quietly widen that screen's
 * columns — it is told first. Since #201 the position width decides the column
 * count on `Side by side`, so losing it changes what the wall shows, and a
 * board that changed shape with no explanation is the thing this project keeps
 * paying for.
 */
export function screensUsing(dockEntryId, screens) {
  const wanted = String(dockEntryId || '').trim();
  if (!wanted) return [];
  return (screens || [])
    .filter((s) => s && screenNamesDock(s, wanted))
    .map((s) => String(s.name || s.id || '').trim())
    .filter(Boolean);
}
