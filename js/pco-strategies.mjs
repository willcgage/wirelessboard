/**
 * Choices that read as consequences, not as field names (#179).
 *
 * ⭐ The issue's third rule for making administration easy rather than merely
 * tidy: *"Clear slots nobody is assigned to says 'removes a name a person put
 * on by hand'. The three assignment strategies are named cards with what each
 * does, not three lines in a dropdown."*
 *
 * ⛔ The copy lives here, as data, for the same reason `help-content.mjs` does:
 * a sentence describing behaviour drifts away from the behaviour unless a test
 * can read it. `pco-strategies.test.mjs` checks the three ids against
 * `py/pco.py`'s `SUPPORTED_STRATEGIES`, so a strategy added, removed or renamed
 * on the server fails here rather than silently offering a card that resolves
 * to nothing.
 */

/**
 * The three ways a scheduled person reaches a slot.
 *
 * ⚠️ `title` names the thing it reads; `does` is what happens; `when` is the
 * case that should make somebody pick it. A card without the third is just a
 * longer dropdown.
 */
export const STRATEGIES = [
  {
    id: 'position_or_note',
    title: 'Team position, then the note',
    does: 'Reads the position somebody is scheduled under — “Vocal 1” — and falls back to the note '
      + 'category, then to an [ID] in their name.',
    when: 'The usual choice. Positions are already how a plan says who is doing what.',
    recommended: true,
  },
  {
    id: 'position',
    title: 'Team position only',
    does: 'Reads the position and nothing else. Somebody whose position names no slot is left '
      + 'unmatched rather than guessed at.',
    when: 'Positions are tidy and you would rather see a gap than a wrong name.',
  },
  {
    id: 'note_or_brackets',
    title: 'The note, then [ID] in the name',
    does: 'Reads the note category first, then an [ID] in the person’s name, and only then the '
      + 'position.',
    when: 'Carried over from how this was set up before positions were used. Legacy.',
    legacy: true,
  },
];

export const DEFAULT_STRATEGY = 'position_or_note';

export function strategyById(id) {
  return STRATEGIES.find((s) => s.id === id) || null;
}

/**
 * Switches whose label says what it *does to the board*, not what it is called.
 *
 * ⛔ `clear_unmatched` is the one that can take a name off a slot, and the
 * wording has to carry that: it removes a name **a person put there by hand**,
 * for the visiting speaker nobody told Planning Center about. That is why it is
 * off by default ([[pco-slot-assignments]]), and a label reading "clear
 * unmatched" would never have said so.
 */
export const CONSEQUENCES = {
  clear_unmatched: {
    control: 'pco-clear-unmatched',
    label: 'Take people off slots this plan does not fill',
    consequence: 'Removes a name somebody put on by hand — the spare handheld for a visiting '
      + 'speaker Planning Center was never told about. Off unless you want the board to match the '
      + 'plan exactly. ⭐ The slot keeps its device id, so it still matches next week.',
    severity: 'takes-away',
  },
  position_number_fallback: {
    // the element is pco-number-fallback, not pco-position-number-fallback
    control: 'pco-number-fallback',
    label: 'Match on the number in a position',
    consequence: '“Vocal 1” fills mic 1 and IEM 1 even when the names do not otherwise match. '
      + 'Only consulted when a position does not name a slot on its own. ⚠️ Single-team plans only: '
      + 'it keys on the trailing number, so “Vocal 1”, “Guitar 1” and “Host 1” would all claim the '
      + 'same slot.',
    severity: 'adds',
  },
  seed_extended_id: {
    control: 'pco-seed-extended-id',
    label: 'Write the position onto the slot as its device id',
    consequence: 'Fills an empty device id from the position, so the next sync has something to '
      + 'match on. It never overwrites an id somebody set.',
    severity: 'adds',
  },
  auto_sync: {
    control: 'pco-auto-sync',
    label: 'Re-sync by itself when the plan changes',
    consequence: 'The board rewrites itself with nobody present — including, if the setting above '
      + 'is also on, taking people off slots while nobody is watching. A slot two people both claim '
      + 'is never guessed at: it is left exactly as it is and flagged for a person. Needs the '
      + 'plan-change notice above. A rule set can turn this on for its own kind of plan.',
    severity: 'takes-away',
  },
};

/** Every consequence key, so a test can hold the markup to it. */
export const CONSEQUENCE_KEYS = Object.keys(CONSEQUENCES);
