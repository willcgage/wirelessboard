/**
 * The furniture below a screen: charging docks and pickup pads (#203).
 *
 * ⭐ What this is really describing is **what a column points at.** The
 * television hangs above a piece of furniture with positions in it, and a
 * column on the board is meant to correspond to one of those positions. That is
 * why a column may not be narrower than a position: narrower than that and it
 * stops pointing at anything, which is the whole reason the board is on that
 * wall.
 *
 * ⛔ Two kinds, because a room has two kinds:
 *
 *   - a **dock** charges what sits in it (the venue's is a Shure SBC200, 3.9in
 *     per position, two bays, not networked — see #199)
 *   - a **pad** is a place on the table where microphones are left and nothing
 *     charges
 *
 * ⚠️ **The board treats them identically.** Both are rows of positions with a
 * width, and the floor they impose is the same. The kind exists so a person
 * editing the list knows which piece of furniture they are looking at, and so
 * the section can grow to IEM transmitters later without the word "dock"
 * having to cover everything. No layout code branches on it, and none should
 * without a reason that is written down.
 *
 * ⛔ It lives here rather than on a screen row because a dock is not a property
 * of a screen. One dock can sit under several screens; one screen can have no
 * furniture at all; a dock can be replaced without the screen changing. Keeping
 * the width on the screen meant typing it more than once with nothing keeping
 * the copies in step.
 *
 * Pure, so the rules can be checked without a DOM.
 */

/** What a piece of furniture can be. */
export const FURNITURE_KINDS = ['dock', 'pad'];

/** What each kind is called where a person reads it. */
export const FURNITURE_KIND_LABELS = {
  dock: 'Charging dock',
  pad: 'Pickup pad',
};

export function isFurnitureKind(value) {
  return FURNITURE_KINDS.includes(value);
}

/** A number, or null when it is not one we can use. */
function positive(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The furniture an installation has described, cleaned up.
 *
 * ⛔ An entry with no id or no position width is dropped rather than kept
 * half-made — it could be chosen from a list and would then silently impose
 * nothing, which is the same trap `normalizeScreens` avoids.
 */
export function normalizeFurniture(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  return list.reduce((out, entry) => {
    if (!entry || typeof entry !== 'object') return out;
    const id = String(entry.id || '').trim();
    const width = positive(entry.position_inches);
    if (!id || seen.has(id) || !width) return out;
    seen.add(id);
    out.push({
      id,
      name: String(entry.name || '').trim() || id,
      // ⚠️ Anything unrecognised becomes a dock rather than being dropped. The
      // width is the part that matters and it is present; refusing the whole
      // entry over a label would lose a real measurement.
      kind: isFurnitureKind(entry.kind) ? entry.kind : 'dock',
      position_inches: width,
      // Optional. Nothing reads it yet; it is what a person counts to check
      // they have described the right piece of furniture.
      positions: positive(entry.positions),
    });
    return out;
  }, []);
}

export function furnitureById(list, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  return normalizeFurniture(list).find((f) => f.id === wanted) || null;
}

/**
 * How wide one position is, for the screen a device says it is on.
 *
 * ⛔ **The legacy branch is not dead code and must not be deleted.** Before
 * #203 the width lived on the screen row as `min_column_inches`. A board that
 * described its screen under the old shape keeps working: the value is read
 * where it is, and is carried forward the next time the screens are saved.
 * Dropping it would silently widen that board's columns past the dock it was
 * measured against, which — now that the number decides the column count
 * (#201) — is a visible fault rather than a quiet one.
 *
 * ⚠️ A screen that names furniture wins over its own legacy value, so a board
 * that has been migrated is never pulled back by a leftover field.
 */
export function positionInchesForScreen({ screen, furniture }) {
  if (!screen) {
    return null;
  }
  const named = furnitureById(furniture, screen.furniture_id);
  if (named) {
    return named.position_inches;
  }
  return positive(screen.min_column_inches);
}

/** What the furniture picker on a screen row offers. */
export function furnitureChoices(list) {
  return [{ value: '', label: 'Nothing underneath — no minimum' }]
    .concat(normalizeFurniture(list).map((f) => ({
      value: f.id,
      label: `${f.name} — ${FURNITURE_KIND_LABELS[f.kind]}, ${f.position_inches}in positions`,
    })));
}
