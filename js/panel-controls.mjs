/**
 * The board controls that are not stored preferences (#160).
 *
 * `view-controls.mjs` describes the view *preferences*: values this device
 * remembers, written to storage, carried in the hash. Its own comment drew a
 * line -- "⛔ Actions are not here… they stay keys and menu items".
 *
 * ⭐ That line held while the keys were the way to work the board. They are
 * not any more, so the things on the far side of it need somewhere to live:
 * backgrounds, fullscreen, and the two halves of the info drawer. They are
 * still not preferences -- nothing stores them -- so they keep their own table
 * and their own accessors rather than being forced into `view-prefs`.
 */

/**
 * ⛔ `infoDrawerMode` is a two-bit code, not four states.
 *
 * `elinfo` *AB*: **A** is the battery bars and chart, **B** is the status
 * stripe. `I` cycled all four blind, which is why nobody could say what it
 * did -- the four CSS blocks in `style.scss` are the only documentation there
 * has ever been. Two switches say it outright, and the stored value is
 * untouched so links and remembered settings still mean what they meant.
 */
export const DRAWER_MODES = ['elinfo00', 'elinfo01', 'elinfo10', 'elinfo11'];

export function isDrawerMode(mode) {
  return DRAWER_MODES.includes(mode);
}

/** The two switches, read out of the code. Anything unrecognised reads as both on, the default. */
export function drawerBits(mode) {
  const value = isDrawerMode(mode) ? mode : 'elinfo11';
  return {
    drawer: value[6] === '1' ? 'on' : 'off',
    stripe: value[7] === '1' ? 'on' : 'off',
  };
}

/** And back again. */
export function drawerModeFrom({ drawer, stripe }) {
  return `elinfo${drawer === 'on' ? '1' : '0'}${stripe === 'on' ? '1' : '0'}`;
}

/** One switch moved; the other keeps whatever it had. */
export function drawerModeWith(mode, which, value) {
  const bits = drawerBits(mode);
  bits[which] = value === 'on' ? 'on' : 'off';
  return drawerModeFrom(bits);
}

export const BACKGROUND_MODES = ['NONE', 'IMG', 'MP4'];

export const BOARD_CONTROLS = [
  {
    // ⭐ One setting, not two. `G` and `V` were separate keys that each cycled
    // through the same three states from a different starting point, which is
    // why pressing one while the other was active did something nobody could
    // predict.
    id: 'background',
    label: 'Backgrounds',
    group: 'Card',
    options: BACKGROUND_MODES,
    optionLabels: { NONE: 'Off', IMG: 'Photos', MP4: 'Video' },
    optionGlyphs: { NONE: '–', IMG: '▣', MP4: '▶' },
  },
  {
    id: 'drawer',
    label: 'Battery & chart',
    group: 'Card',
    options: ['off', 'on'],
    optionLabels: { off: 'Off', on: 'On' },
    switchOn: 'on',
  },
  {
    id: 'statusStripe',
    label: 'Status stripe',
    group: 'Card',
    options: ['off', 'on'],
    optionLabels: { off: 'Off', on: 'On' },
    switchOn: 'on',
  },
  {
    // ⚠️ Reads the browser, not a stored value: something else can leave
    // fullscreen (Escape, the window manager), and a switch that still said
    // "on" after that would be lying about the screen in front of you.
    id: 'fullscreen',
    label: 'Fullscreen',
    group: 'On screen',
    options: ['off', 'on'],
    optionLabels: { off: 'Off', on: 'On' },
    switchOn: 'on',
  },
];

/** "All channels" plus whatever groups are configured, for the picker. */
export function groupChoices(groups) {
  const choices = [{ value: 0, label: 'All channels' }];
  if (!groups || typeof groups !== 'object') {
    return choices;
  }
  Object.keys(groups)
    .map((key) => Number(key))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
    .forEach((n) => {
      const entry = groups[n] || groups[String(n)];
      const title = entry && typeof entry.title === 'string' ? entry.title.trim() : '';
      // ⛔ A group with no title still has to be pickable -- it was reachable
      // by pressing its number, and this is replacing that.
      choices.push({ value: n, label: title || `Group ${n}` });
    });
  return choices;
}
