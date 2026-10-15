/**
 * The dock below a screen: bays that charge, and pads that do not (#203).
 *
 * ⭐ What this is really describing is **what a column points at.** The
 * television hangs above something with positions in it, and a
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
 * editing the list knows which one they are looking at, and so the section can
 * take IEM transmitters later without every entry having to be a charger. No
 * layout code branches on it, and none should without a reason written down.
 *
 * ⛔ It lives here rather than on a screen row because a dock is not a property
 * of a screen. One dock can sit under several screens; one screen can have no
 * dock at all; a dock can be replaced without the screen changing. Keeping
 * the width on the screen meant typing it more than once with nothing keeping
 * the copies in step.
 *
 * Pure, so the rules can be checked without a DOM.
 */

/**
 * What a dock can be.
 *
 * ⛔ **Everything underneath a screen is a dock**, settled by the maintainer
 * 2026-10-15: *"Everything should be a Dock, whether it is a non-charging dock,
 * or a charging dock (non-network enabled or network enabled)."* This replaced
 * a `dock` / `pad` split.
 *
 * ⭐ Why that is the better model: "pad" named the *absence* of a feature as a
 * different kind of object, so a table-top spot and the rack it replaced were
 * two things rather than one thing with charging switched off. The list is now
 * one kind of object along one axis — does it charge, and can it be talked to.
 *
 * ⚠️ The axis is deliberately ordered, not a pair of flags: a networked dock
 * that does not charge is not a thing anyone has, and two booleans would make
 * room for it in the editor. If one ever appears, it earns a fourth value here
 * rather than a second field everywhere.
 *
 * ⭐ `networked` is the only one that is more than a label: a networked dock can
 * be asked what is in it and how charged it is, which makes it a data source
 * the way a receiver is. Nothing reads it yet (#199 — the venue's SBC200 is not
 * networked), so it is recorded now so the list does not need reshaping later.
 */
export const DOCK_KINDS = ['charging', 'networked', 'noncharging'];

/** What each kind is called where a person reads it. */
export const DOCK_KIND_LABELS = {
  charging: 'Charging dock',
  networked: 'Charging dock, networked',
  noncharging: 'Non-charging dock',
};

/**
 * The two kinds this replaced, mapped so that no described dock changes meaning.
 *
 * ⛔ **Read, never written, and not interchangeable.** A stored `dock` was
 * labelled *Charging dock*; a stored `pad` was a place where nothing charges.
 * Collapsing both to one value would tell an operator their dock charges when
 * it does not, or the reverse — and the kind is the only record of that, since
 * nothing in the layout branches on it.
 */
const LEGACY_DOCK_KINDS = { dock: 'charging', pad: 'noncharging' };

/** True for a kind this version writes. Legacy values are read, not written. */
export function isDockKind(value) {
  return DOCK_KINDS.includes(value);
}

/**
 * A stored kind, as one of the current kinds.
 *
 * ⚠️ Anything unrecognised becomes `charging` rather than being dropped, which
 * is what the old code did via its `dock` default. The width is the part that
 * matters and it is present; refusing a row over a label would lose a real
 * measurement, and that measurement now decides the column count (#201).
 */
export function dockKind(value) {
  const raw = String(value == null ? '' : value).trim();
  if (isDockKind(raw)) return raw;
  return LEGACY_DOCK_KINDS[raw] || 'charging';
}

/** A number, or null when it is not one we can use. */
function positive(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The docks an installation has described, cleaned up.
 *
 * ⛔ An entry with no id or no position width is dropped rather than kept
 * half-made — it could be chosen from a list and would then silently impose
 * nothing, which is the same trap `normalizeScreens` avoids.
 */
export function normalizeDocks(list) {
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
      kind: dockKind(entry.kind),
      position_inches: width,
      // Optional. Nothing reads it yet; it is what a person counts to check
      // they have described the right one.
      positions: positive(entry.positions),
    });
    return out;
  }, []);
}

export function dockById(list, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  return normalizeDocks(list).find((f) => f.id === wanted) || null;
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
 * ⚠️ A screen that names a dock wins over its own legacy value, so a board
 * that has been migrated is never pulled back by a leftover field.
 */
export function positionInchesForScreen({ screen, docks }) {
  if (!screen) {
    return null;
  }
  const named = dockById(docks, screen.dock_id);
  if (named) {
    return named.position_inches;
  }
  return positive(screen.min_column_inches);
}

/** What the dock picker on a screen row offers. */
export function dockChoices(list) {
  return [{ value: '', label: 'Nothing underneath — no minimum' }]
    .concat(normalizeDocks(list).map((f) => ({
      value: f.id,
      label: `${f.name} — ${DOCK_KIND_LABELS[f.kind]}, ${f.position_inches}in positions`,
    })));
}
