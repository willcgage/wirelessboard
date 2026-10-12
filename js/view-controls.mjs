/**
 * The view controls, described once (#111, #115).
 *
 * Every one of these is a *state* the board persists: a key cycles it, the
 * panel sets it directly, the hash can carry it, and `view-prefs.mjs` stores it
 * per device. Describing them in one table means the panel cannot drift from
 * the keyboard — the same bargain `kbd.js` struck when the help overlay stopped
 * being hand-written markup.
 *
 * ⛔ Actions are not here. Fullscreen, the QR code, the editors and the config
 * view *do* something once; they stay keys and menu items. The line is whether
 * there is a value to show when nothing is being pressed.
 *
 * ⚠️ `options` is the cycle order, which is also the storage vocabulary and so
 * cannot be rearranged for looks. `order` exists for the one case where reading
 * order differs from cycling order — type size cycles medium → small → large
 * because medium is the default, but reads S M L.
 */

import {
  ARRANGEMENTS, CARD_SHAPES, TEXT_POSITIONS, TYPE_SIZES, TOP_BAR_STATES,
  COLUMN_CHOICES, WASH_STYLES,
} from './board-layout.mjs';
import {
  ARRANGEMENT_KEY, CARD_SHAPE_KEY, TEXT_POSITION_KEY, TYPE_SIZE_KEY,
  TOP_BAR_KEY, COLUMNS_KEY, WASH_KEY, LIVE_PLACEMENT_KEY, ROTATION_KEY,
} from './view-prefs.mjs';
import { PLACEMENTS, PLACEMENT_LABELS } from './live-strip.mjs';
import { ROTATION_STATES, ROTATION_LABELS } from './rotation-states.mjs';

export const VIEW_CONTROLS = [
  {
    id: 'rotation',
    key: 'r',
    label: 'Page through groups',
    group: 'Layout',
    storageKey: ROTATION_KEY,
    options: ROTATION_STATES,
    optionLabels: ROTATION_LABELS,
    optionGlyphs: { off: '–', on: '⟳' },
  },
  {
    id: 'livePlacement',
    key: 'l',
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
    key: 'o',
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
    key: 'c',
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
    key: 'a',
    label: 'Card shape',
    group: 'Layout',
    storageKey: CARD_SHAPE_KEY,
    options: CARD_SHAPES,
    optionLabels: { auto: 'Auto', wide: '16:9', tall: '3:4' },
  },
  {
    id: 'textPosition',
    key: 'p',
    label: 'Text band',
    group: 'Card',
    storageKey: TEXT_POSITION_KEY,
    options: TEXT_POSITIONS,
    optionLabels: { bottom: 'Bottom', top: 'Top' },
  },
  {
    id: 'wash',
    key: 'w',
    label: 'Status colour',
    group: 'Card',
    storageKey: WASH_KEY,
    options: WASH_STYLES,
    optionLabels: { band: 'Band only', full: 'Whole card' },
  },
  {
    id: 'typeSize',
    key: 'z',
    label: 'Text size',
    group: 'Card',
    storageKey: TYPE_SIZE_KEY,
    options: TYPE_SIZES,
    order: ['small', 'medium', 'large'],
    optionLabels: { small: 'S', medium: 'M', large: 'L' },
  },
  {
    id: 'topBar',
    key: 'h',
    label: 'Wirelessboard bar',
    group: 'On screen',
    storageKey: TOP_BAR_KEY,
    options: TOP_BAR_STATES,
    optionLabels: { shown: 'Shown', hidden: 'Hidden' },
    // Two states read better as a switch than as two buttons.
    switchOn: 'shown',
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

export function isValidValue(control, value) {
  return Boolean(control) && control.options.includes(value);
}
