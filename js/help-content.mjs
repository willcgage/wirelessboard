/**
 * What Help says (#188, and the maintainer's audit of it 2026-10-14).
 *
 * ⛔⛔ **The content it replaces was wrong, and one line of it was dangerous.**
 * Three of the four Quick Start items pointed at a `Menu` that #188 retired, so
 * the first thing a lost operator read was three routes that do not exist. And
 * the last line said:
 *
 *   "Keep another tab on the Config view during events so adjustments never
 *    interrupt the board."
 *
 * ⛔ That is the opposite of true. A configuration save tears down every
 * receiver socket, sleeps about two seconds and rebuilds -- so saving from a
 * second tab mid-service is precisely what blanks the wall. The advice told
 * somebody to do the one thing every warning in `viewer-scope.mjs` exists to
 * prevent.
 *
 * ⭐ Data, not markup, so it can be read by a test. `help-content.test.mjs`
 * fails if it mentions a key, a Menu, or a second tab on Config again -- the
 * three ways this text has already gone stale.
 */

export const HELP_SECTIONS = [
  {
    title: 'This screen',
    items: [
      'The gear, bottom right, is the only control the board always has. Everything is behind it.',
      'What is in it changes this screen only, and is remembered on this device: desk or TV, the arrangement, how many columns, the card’s shape and status colour, text size, backgrounds, where the status bar sits, and the display-only lock.',
    ],
  },
  {
    title: 'Every board',
    items: [
      'Administration, at the foot of the gear, holds what every board shares: receivers, screens and docks, slot names, the background library, Planning Center, and the logs.',
      'Changes there reach every connected board at once. The page says so, and says how many boards are connected.',
      'Saving the configuration disconnects the receivers for a couple of seconds while they are rebuilt. It is not something to do during a service.',
    ],
  },
  {
    title: 'When the board is locked to display only',
    items: [
      'The gear still opens, and so does Administration — but receivers, screens, slots, backgrounds, Planning Center and demo mode are refused, each saying so.',
      'Unlock it in the gear, under On screen.',
    ],
  },
  {
    title: 'When a channel looks wrong',
    items: [
      'A card headed Slot 4 instead of HH-4 has no receiver behind it: that slot is a placeholder, or its receiver is not answering.',
      'If the board is showing fewer channels than you expect, read the bar on the status strip. It names the page, counts the channels, and holds on a page where a channel needs attention rather than cycling past it.',
    ],
  },
  {
    title: 'Keyboard',
    items: [
      'There is none, by design. Escape closes whatever is open, and every control is on screen.',
    ],
  },
];

/** Every line, for a test that has to read them all. */
export function helpLines() {
  return HELP_SECTIONS.flatMap((s) => s.items);
}
