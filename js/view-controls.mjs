/**
 * The view controls, described once (#111, #115).
 *
 * Every one of these is a *state* the board persists: the panel sets it, the
 * hash can carry it, and `view-prefs.mjs` stores it per device. Describing
 * them in one table is what lets the panel be generated rather than written
 * out by hand, which is the mistake the help overlay made once already.
 *
 * ⛔ Actions are not here, and nor is anything the board does not store.
 * Backgrounds, fullscreen and the info drawer are live board state and live in
 * `panel-controls.mjs`; the editors and the config view are in the navbar
 * Menu. The line here is whether there is a value to *remember*.
 *
 * ⚠️ These used to carry a `key` as well, and `view-controls.test.mjs` checked
 * both directions against `kbd.js`. #160 retired the bindings, so that guard
 * is now the opposite one: nothing may be bound to a key at all.
 *
 * ⚠️ `options` is the cycle order, which is also the storage vocabulary and so
 * cannot be rearranged for looks. `order` exists for the one case where reading
 * order differs from cycling order — type size cycles medium → small → large
 * because medium is the default, but reads S M L.
 */

import {
  ARRANGEMENTS, CARD_SHAPES, TYPE_SIZES,
  COLUMN_CHOICES, WASH_STYLES,
} from './board-layout.mjs';
import {
  ARRANGEMENT_KEY, CARD_SHAPE_KEY, TYPE_SIZE_KEY,
  COLUMNS_KEY, WASH_KEY, LIVE_PLACEMENT_KEY, ROTATION_KEY,
  VIEWER_LOCK_KEY, STATUS_BAR_KEY, STATUS_BAR_PLACEMENTS,
} from './view-prefs.mjs';
import { PLACEMENTS, PLACEMENT_LABELS } from './live-strip.mjs';
import { ROTATION_STATES, ROTATION_LABELS } from './rotation-states.mjs';
import { LOCK_STATES, LOCK_LABELS, lockDescription } from './viewer-lock.mjs';

export const VIEW_CONTROLS = [
  {
    id: 'rotation',
    label: 'Page through groups',
    group: 'Layout',
    storageKey: ROTATION_KEY,
    options: ROTATION_STATES,
    optionLabels: ROTATION_LABELS,
    optionGlyphs: { off: '–', on: '⟳' },
  },
  {
    id: 'livePlacement',
    label: 'Service position',
    group: 'Layout',
    storageKey: LIVE_PLACEMENT_KEY,
    options: PLACEMENTS,
    optionLabels: PLACEMENT_LABELS,
    optionGlyphs: {
      bottom: '▁', top: '▔', card: '▣', off: '–',
    },
    order: ['off', 'top', 'bottom', 'card'],
  },
  {
    id: 'arrangement',
    label: 'Arrangement',
    group: 'Layout',
    storageKey: ARRANGEMENT_KEY,
    options: ARRANGEMENTS,
    // ⭐ #115: these name the *outcome*, because the stored words name the
    // grid's axis and read backwards out loud -- the arrangement that fills the
    // screen with twelve columns is stored as `row`. The stored values are
    // untouched; only what a person reads changes.
    optionLabels: {
      fit: 'Fit', row: 'Side by side', column: 'Stacked', grid: 'Grid',
    },
    optionGlyphs: {
      fit: '▣', row: '▮▮▮', column: '☰', grid: '▦',
    },
  },
  {
    id: 'columns',
    label: 'Columns on screen',
    group: 'Layout',
    storageKey: COLUMNS_KEY,
    options: COLUMN_CHOICES,
    // A ceiling, not an exact count, and the label has to say so or six
    // channels on a board of four columns looks like a bug.
    optionLabels: {
      auto: 'Auto', 4: 'Max 4', 6: 'Max 6', 8: 'Max 8', 10: 'Max 10', 12: 'Max 12',
    },
  },
  {
    id: 'cardShape',
    label: 'Card shape',
    group: 'Layout',
    storageKey: CARD_SHAPE_KEY,
    options: CARD_SHAPES,
    optionLabels: { auto: 'Auto', wide: '16:9', tall: '3:4' },
  },
  {
    id: 'wash',
    label: 'Status colour',
    group: 'Card',
    storageKey: WASH_KEY,
    options: WASH_STYLES,
    optionLabels: { band: 'Band only', full: 'Whole card', rail: 'Edge rail' },
    // ⭐ Says why it may appear to do nothing (#130). With a photo present the
    // whole-card wash is almost entirely behind the picture -- which is why
    // the band is the default on a board where most people have photos. The
    // control is still right for photo-less cards, and a control that looks
    // broken is worse than one that explains itself in a line.
    describe: (value) => {
      if (value === 'full') return 'Visible on cards with no photo — a picture covers the wash.';
      // ⭐ #193. Names the trade rather than the mechanism: what somebody gets
      // for moving the colour off the band is a bigger face.
      if (value === 'rail') return 'A stripe down the edge, so the band shrinks and the photo grows.';
      return 'The band carries the colour, so the photo stays clear.';
    },
  },
  {
    id: 'typeSize',
    label: 'Text size',
    group: 'Card',
    storageKey: TYPE_SIZE_KEY,
    options: TYPE_SIZES,
    order: ['small', 'medium', 'large'],
    optionLabels: { small: 'S', medium: 'M', large: 'L' },
  },
  {
    // ⭐⭐ The strip the menu bar's retirement freed (#188). The maintainer's
    // reason for asking: "This allows everything to shift up providing space
    // Top or Bottom for the status bar."
    //
    // ⛔ Reserved whether or not the board is paging — see `STATUS_BAR_KEY` for
    // why reserving it on demand would be a feedback loop.
    id: 'statusBar',
    label: 'Status bar',
    group: 'On screen',
    storageKey: STATUS_BAR_KEY,
    options: STATUS_BAR_PLACEMENTS,
    order: ['off', 'top', 'bottom'],
    optionLabels: { bottom: 'Bottom', top: 'Top', off: 'Off' },
    optionGlyphs: { bottom: '▁', top: '▔', off: '–' },
    describe: () => 'Keeps a strip clear so a paging board never covers the last row.',
  },
  {
    // ⚠️ A state, not an action, which is why it belongs in this table at all:
    // a locked board stays locked across a reload, and something has to show
    // that it is. It sits beside the status bar row because both are about what
    // the board gives up its own height for, rather than how a card looks.
    id: 'viewerLock',
    label: 'Lock to display only',
    group: 'On screen',
    storageKey: VIEWER_LOCK_KEY,
    options: LOCK_STATES,
    optionLabels: LOCK_LABELS,
    switchOn: 'on',
    // ⭐ The only control that needs a sentence. Every other row's label says
    // what it does; this one has to say what it does *not* do, because a
    // control called "lock" invites being mistaken for a security control.
    describe: lockDescription,
  },
];

/** The groups in the order the panel shows them, with their controls. */
export function controlGroups(controls = VIEW_CONTROLS) {
  const seen = [];
  controls.forEach((control) => {
    if (!seen.includes(control.group)) {
      seen.push(control.group);
    }
  });
  return seen.map((name) => ({
    name,
    controls: controls.filter((control) => control.group === name),
  }));
}

export function controlFor(id, controls = VIEW_CONTROLS) {
  return controls.find((control) => control.id === id) || null;
}

/** The values in reading order, which is the cycle order unless told otherwise. */
export function optionsInOrder(control) {
  if (!control) {
    return [];
  }
  if (Array.isArray(control.order)) {
    // Anything the display order forgets still has to appear, or a value would
    // become unreachable from the panel while the key still cycles to it.
    const extra = control.options.filter((value) => !control.order.includes(value));
    return control.order.filter((v) => control.options.includes(v)).concat(extra);
  }
  return control.options.slice();
}

export function optionLabel(control, value) {
  if (!control) {
    return String(value);
  }
  const labels = control.optionLabels || {};
  return labels[value] || String(value);
}

/** A switch is a control with exactly two states and an `on` value. */
export function isSwitch(control) {
  return Boolean(control && control.switchOn && control.options.length === 2);
}

/** The sentence under a row, for the one control that needs one. */
export function controlDescription(control, value) {
  if (!control || typeof control.describe !== 'function') {
    return null;
  }
  return control.describe(value) || null;
}

export function isValidValue(control, value) {
  return Boolean(control) && control.options.includes(value);
}
