/**
 * Editing the furniture below the screens (#203).
 *
 * ⭐ The same shape as the screens editor beside it, and deliberately so: the
 * pairing, merge and summary all come from `editor-rows.mjs`, which is #180's
 * logic in one place rather than two. What is here is only what differs — what
 * counts as a problem with a dock or a pad, and what one is sent as.
 *
 * Pure, so the rules can be checked without a DOM.
 */

import {
  pairRows as rowsPairRows,
  toPayload as rowsToPayload,
  mergeSaved as rowsMergeSaved,
  saveSummary as rowsSaveSummary,
} from './editor-rows.mjs';
import { isFurnitureKind } from './furniture.mjs';

/** A stable id from a name: lowercase, hyphenated, nothing surprising. */
export function furnitureId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** An id not already taken, so two docks named the same still both exist. */
export function uniqueFurnitureId(name, existing = []) {
  const base = furnitureId(name) || 'dock';
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
 * ⚠️ Per row, not per form. "Something is wrong with your furniture" is not
 * actionable on a Sunday morning — the same rule every editor here follows.
 */
export function furnitureProblem(row) {
  const name = String((row && row.name) || '').trim();
  if (!name) {
    return 'Give it a name — "Main dock", "Stage left pad".';
  }
  // ⛔ The width is required here, unlike on the screen row it came from. A
  // screen with nothing underneath it is a normal thing to describe; a dock
  // with no position width is not a dock, it is an empty entry that could be
  // chosen and would silently impose nothing.
  if (!positive(row && row.position_inches)) {
    return 'How wide is one position, left to right? The venue\'s SBC200 is 3.9in.';
  }
  // Optional, but junk in it is not.
  if (row.positions !== '' && row.positions !== null && row.positions !== undefined
    && !positive(row.positions)) {
    return 'How many positions has it got? A whole number, or leave it empty.';
  }
  return null;
}

export function furnitureHasProblems(rows) {
  return (rows || []).some((row) => furnitureProblem(row) !== null);
}

const SPEC = {
  problem: furnitureProblem,
  entry: (row, ids) => ({
    id: row.id || uniqueFurnitureId(String(row.name).trim(), ids),
    name: String(row.name).trim(),
    // ⚠️ Anything unrecognised becomes a dock rather than failing the row. The
    // width is the part that matters and it is present by now.
    kind: isFurnitureKind(row.kind) ? row.kind : 'dock',
    position_inches: positive(row.position_inches),
    positions: positive(row.positions),
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

export function saveSummary(rows) {
  return rowsSaveSummary(rows, SPEC, {
    noun: (n) => (n === 1 ? 'dock or pad' : 'docks and pads'),
    nothing: 'Nothing described. Screens will have no minimum column width.',
  });
}

/**
 * What a screen would lose by pointing somewhere else, or null.
 *
 * ⛔ Removing furniture a screen names does not quietly widen that screen's
 * columns — it is told first. Since #201 the position width decides the column
 * count on `Side by side`, so losing it changes what the wall shows, and a
 * board that changed shape with no explanation is the thing this project keeps
 * paying for.
 */
export function screensUsing(furnitureEntryId, screens) {
  const wanted = String(furnitureEntryId || '').trim();
  if (!wanted) return [];
  return (screens || [])
    .filter((s) => s && String(s.furniture_id || '').trim() === wanted)
    .map((s) => String(s.name || s.id || '').trim())
    .filter(Boolean);
}
