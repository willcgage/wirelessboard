/**
 * A slot with no receiver behind it (#186).
 *
 * ⛔ A slot of `type: 'offline'` is a configured intention -- "a channel goes
 * here" -- with nothing answering for it. `py/offline.py` sends it with
 * `status: 'UNASSIGNED'`, an empty `device_id` and frequency `000000`, and the
 * card used to draw that as an ordinary quiet channel: a name, a battery
 * outline, two empty sparklines. On a wall, "no receiver here" and "a channel
 * nobody is talking on" looked the same, and the only difference was a heading
 * reading `Slot 7`, which nobody reads that way.
 *
 * ⭐ So the card says it in words, and shows nothing that could be taken for a
 * reading. It is deliberately NOT an alarm colour: nothing is wrong, nothing is
 * there.
 */

/** True when the card describes a slot no receiver is behind. */
export function hasNoReceiver(data) {
  return Boolean(data) && data.type === 'offline';
}

/** The status chip such a card carries in place of its quiet state. */
export const NO_RECEIVER_CHIP = Object.freeze({ glyph: '–', word: 'No receiver' });
