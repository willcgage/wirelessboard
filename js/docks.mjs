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
 * ⛔⛔ **A position is a UNIT, not a bay.** This comment said the opposite, and
 * recorded the maintainer's own decision backwards. In their words:
 *
 *   "a SBC200 has two bays, but they would line up with a single slot since
 *    the two bays are front and back and not side to side"
 *
 * Two bays, one behind the other, occupy one place on the table: the
 * microphone in front and that performer's IEM behind it. So one unit is one
 * position is one column, and the width to measure is the unit's.
 *
 * ⚠️ The help text in `demo.html` has always said this ("Not one bay"), and no
 * code ever branched on the claim, so nothing behaved wrongly -- but the
 * comment is what the next change follows, and following it would have given
 * the venue's eleven SBC200s **twenty-two** columns instead of eleven.
 *
 * ⚠️ It matters most on **Board mode on a television**, where the dock is
 * physically under the screen: Rack has no dock to point at and Pocket is one
 * column.
 *
 * ⛔ **Everything down there is a dock**, whatever it does. The kinds say whether
 * it charges and whether it can be talked to (the venue's is a Shure SBC200, 3.9in
 * per position, two bays, charging but not networked — see #199).
 *
 * ⚠️ **The board treats them identically.** Every entry is a row of positions
 * with a width, and the floor they impose is the same. The kind exists so a person
 * editing the list knows which one they are looking at, and so the section can
 * take IEM transmitters later without every entry having to charge something. No
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
      // ⭐ How many places this dock has, side by side. Optional, and it is
      // what makes one row describe a RUN of identical units: the venue has
      // eleven SBC200s under one screen, which is one entry of eleven
      // positions rather than eleven entries of one.
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
 * Whether a screen names this dock, in any of the shapes a screen has had.
 *
 * ⚠️ Deliberately NOT `screenDocks(...).some(...)`. The editor asks this while
 * a dock is being removed, of a screen list that has not been normalized -- so
 * the dock in question may already be gone from the list, which `screenDocks`
 * would silently drop. The question here is what the screen *says*, not what
 * resolves.
 */
export function screenNamesDock(screen, dockId) {
  const wanted = String(dockId || '').trim();
  if (!screen || !wanted) return false;
  const named = Array.isArray(screen.dock_ids)
    ? screen.dock_ids
    : [screen.dock_id || screen.furniture_id];
  return named.some((id) => String(id || '').trim() === wanted);
}

/**
 * Every dock underneath a screen, in the order the screen names them.
 *
 * ⛔ A screen used to name exactly one (`dock_id`, a `<select>`), which the
 * venue reported as a plain limit: *"I can only choose 1 dock under a screen
 * right now; however, I have 11 under the Green Room Screen I am testing and
 * using in production now."* Eleven units in a row is the ordinary case, not
 * an exotic one.
 *
 * ⚠️ `dock_id` is read and never written. A board described under the old
 * shape keeps its floor, for the same reason `min_column_inches` is still
 * read: dropping the link on read would silently widen that board's columns
 * past the dock they were measured against.
 */
export function screenDocks({ screen, docks }) {
  if (!screen) {
    return [];
  }
  const all = normalizeDocks(docks);
  const byId = new Map(all.map((d) => [d.id, d]));

  const named = Array.isArray(screen.dock_ids) && screen.dock_ids.length
    ? screen.dock_ids
    : [screen.dock_id];

  const seen = new Set();
  const under = [];
  named.forEach((raw) => {
    const id = String(raw || '').trim();
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    under.push(byId.get(id));
  });
  return under;
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
 *
 * ⭐ With several docks underneath, the floor is the **widest** of them. The
 * number is a minimum, not an alignment guarantee: a column narrower than any
 * position below it stops pointing at that position, so the widest is the one
 * that has to fit. Mixed widths cannot all line up in a uniform grid, and this
 * does not pretend otherwise.
 */
export function positionInchesForScreen({ screen, docks }) {
  if (!screen) {
    return null;
  }
  const under = screenDocks({ screen, docks });
  if (under.length) {
    return under.reduce((widest, d) => Math.max(widest, d.position_inches), 0);
  }
  return positive(screen.min_column_inches);
}

/**
 * How many places there are under a screen, all its docks added up.
 *
 * ⛔ **Null unless every dock underneath says.** `positions` is optional and
 * was read by nothing until now, so almost no board declares it. Guessing a
 * count from the docks that happen to mention one would hand a board a column
 * count built from half its furniture -- worse than having none, because
 * nothing on screen would say which half.
 *
 * ⭐ This is the number `board-layout.mjs` means by "the column count is the
 * dock's, not the channel count's". Until now that sentence described nothing:
 * the width floor was wired up and the count never was.
 */
export function dockPositionsForScreen({ screen, docks }) {
  const under = screenDocks({ screen, docks });
  if (!under.length || under.some((d) => !positive(d.positions))) {
    return null;
  }
  return under.reduce((total, d) => total + d.positions, 0);
}

/**
 * What the board will read off this screen row, in a sentence.
 *
 * ⭐ Said back to whoever is describing the room, because the count is the one
 * thing they can check against the table in front of them: eleven units should
 * read eleven places. Until A3 that number was typed, stored, and read by
 * nothing, so nobody could tell whether it had been entered correctly.
 *
 * ⚠️ Says so plainly when a dock has no `positions`, rather than quietly
 * summing the ones that do. A count built from half the furniture is worse
 * than none, because nothing on screen would say which half.
 */
export function describeScreenDocks(screen, docks) {
  const under = screenDocks({ screen, docks });
  if (!under.length) {
    return positive(screen && screen.min_column_inches)
      ? `Nothing named underneath — using ${screen.min_column_inches}in from before.`
      : 'Nothing underneath, so this screen sets no minimum column width.';
  }

  const inches = positionInchesForScreen({ screen, docks });
  const places = dockPositionsForScreen({ screen, docks });
  const units = under.length === 1 ? '1 dock' : `${under.length} docks`;

  if (places === null) {
    const unsaid = under.filter((d) => !positive(d.positions)).map((d) => d.name);
    return `${units} underneath, columns at least ${inches}in. `
      + `How many places? Not said for ${unsaid.join(', ')}.`;
  }
  return `${units} underneath: ${places} place${places === 1 ? '' : 's'}, `
    + `columns at least ${inches}in.`;
}

/** What the dock picker on a screen row offers. */
export function dockChoices(list) {
  return [{ value: '', label: 'Nothing underneath — no minimum' }]
    .concat(normalizeDocks(list).map((f) => ({
      value: f.id,
      label: `${f.name} — ${DOCK_KIND_LABELS[f.kind]}, ${f.position_inches}in positions`,
    })));
}
