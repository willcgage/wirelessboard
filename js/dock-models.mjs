/**
 * The docks you can pick instead of measuring one.
 *
 * ⭐ Asked for on 2026-10-15 — *"it may be helpful to create a list of Shure
 * wireless charging docks that can be used (model)… similar to how we can pick
 * a receiver from a list of Make and Model"* — and again on 2026-10-17, after
 * the venue test, in a sharper form:
 *
 *   "a dock that is not a charger will allow for the manual entry. Automatic
 *    width should be something to consider doing by picking the charger make
 *    and model. The manual setting of a width should not allow for anything
 *    over 12"."
 *
 * ⛔⛔ **Why this exists at all.** A venue board was configured with one dock
 * typed as `39` instead of `3.9`. The floor is the widest position underneath,
 * so every column had to be 39 inches on a 55-inch screen — **one column**,
 * and a wall that paged through twelve channels one at a time. Nothing in the
 * product questioned it. A number nobody can sanity-check is a number that
 * should not have to be typed.
 *
 * ⚠️ **The figures are derived, not read off a bay-layout drawing**: a
 * transmitter dock's published outside width divided by half its bay count,
 * because two bays sit front and back within one position. Four models landing
 * inside 24 mm of each other is strong corroboration, not proof — which is why
 * what a model fills in **stays editable**. The tape measure wins.
 *
 * ⛔ Models with no usable data are deliberately ABSENT rather than guessed:
 * SBC250, SBRC and SBC240 returned nothing trustworthy. Battery chargers
 * (SBC840/840M/SBC800/SBC210) are out of scope entirely — loose batteries are
 * on nobody's channel, so their bays belong to no slot and can never be
 * attributed.
 */

/**
 * ⛔ The hard ceiling on a typed width.
 *
 * The widest position in the table is the SBC450 at 4.42in. Twelve inches is
 * three times that — comfortably past any real dock, and far below the 39
 * inches that broke the venue board. A dock position is a place a microphone
 * stands in, not a shelf.
 */
export const MAX_POSITION_INCHES = 12;

/** The smallest width worth accepting. Below this it is a typo, not a dock. */
export const MIN_POSITION_INCHES = 0.5;

/**
 * What a dock can be chosen as.
 *
 * `networked` is the half that is more than a label: such a dock can be asked
 * what is in it, which is what would one day let a card grow a line at its
 * foot. Taken from Shure's own Networked Devices Matrix — the others are
 * absent from it and their guides describe power sharing only, which is good
 * evidence rather than a datasheet line reading "no network".
 */
export const DOCK_MODELS = [
  {
    id: 'sbc200',
    maker: 'Shure',
    model: 'SBC200',
    bays: 2,
    positions: 1,
    position_inches: 3.9,
    networked: false,
  },
  {
    id: 'sbc220',
    maker: 'Shure',
    model: 'SBC220',
    bays: 2,
    positions: 1,
    position_inches: 3.49,
    networked: true,
  },
  {
    id: 'sbc450',
    maker: 'Shure',
    model: 'SBC450',
    bays: 4,
    positions: 2,
    position_inches: 4.42,
    networked: true,
  },
  {
    id: 'sbc850',
    maker: 'Shure',
    model: 'SBC850',
    bays: 8,
    positions: 4,
    position_inches: 3.86,
    networked: true,
  },
];

/**
 * ⭐ A first-class choice, not a fallback.
 *
 * The list is never the only way to describe a room: a shelf, a drawer and a
 * tray that charges nothing are all places a microphone lives, and none of
 * them has a model number.
 */
export const OTHER_MODEL = 'other';

export function dockModel(id) {
  const wanted = String(id || '').trim().toLowerCase();
  if (!wanted || wanted === OTHER_MODEL) return null;
  return DOCK_MODELS.find((m) => m.id === wanted) || null;
}

/** `Shure SBC200 — 2 bays, 1 position, 3.9in` */
export function dockModelLabel(entry) {
  if (!entry) return 'Other — measured by hand';
  const places = entry.positions === 1 ? '1 position' : `${entry.positions} positions`;
  return `${entry.maker} ${entry.model} — ${entry.bays} bays, ${places}, ${entry.position_inches}in`;
}

/** What the model picker offers, "Other" last. */
export function dockModelChoices() {
  return DOCK_MODELS
    .map((m) => ({ value: m.id, label: dockModelLabel(m) }))
    .concat([{ value: OTHER_MODEL, label: dockModelLabel(null) }]);
}

/**
 * The row a chosen model produces, over whatever was there.
 *
 * ⚠️ Returns only what the model knows. The name is the operator's — "Green
 * Room run" says where it is, which a model number never does — and is left
 * exactly as typed.
 *
 * ⭐ `kind` comes along because it is the one fact a person cannot look up:
 * whether a dock can be asked what is in it is decided by the model, not by
 * the room.
 */
export function applyDockModel(row, id) {
  const entry = dockModel(id);
  const next = { ...(row || {}), model: entry ? entry.id : OTHER_MODEL };
  if (!entry) return next;

  next.position_inches = entry.position_inches;
  next.positions = entry.positions;
  next.kind = entry.networked ? 'networked' : 'charging';
  return next;
}

/**
 * Whether a typed width is one a dock could really have.
 *
 * Returns null when it is fine, or a sentence saying what is wrong.
 */
export function positionWidthProblem(value) {
  if (value === '' || value === null || value === undefined) {
    return 'How wide is one position, left to right? The venue\'s SBC200 is 3.9in.';
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 'The position width has to be a measurement in inches.';
  }
  if (n < MIN_POSITION_INCHES) {
    return `${n}in is narrower than any dock. Did you mean ${n * 10}in?`;
  }
  if (n > MAX_POSITION_INCHES) {
    // ⭐ Names the likely typo rather than only refusing. The venue typed 39
    // for 3.9, and a board that just says "too wide" leaves somebody hunting
    // for which of twelve rows they fumbled.
    const guess = n / 10;
    const hint = guess >= MIN_POSITION_INCHES && guess <= MAX_POSITION_INCHES
      ? ` Did you mean ${Number(guess.toFixed(2))}in?`
      : '';
    return `A position cannot be ${n}in — that is one place a microphone stands in, `
      + `not the whole dock. Keep it under ${MAX_POSITION_INCHES}in.${hint}`;
  }
  return null;
}
