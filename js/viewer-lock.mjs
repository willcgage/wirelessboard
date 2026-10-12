/**
 * Lock a device to display only (#116).
 *
 * The board has no authentication and this does not add any. What it answers
 * is a narrower, realer problem: a tablet screwed to a wall, or a phone handed
 * to a volunteer so they can watch battery levels, is one stray tap away from
 * the configuration editor — and a configuration save tears down every
 * receiver socket for ~2 seconds, which blanks the wall mid-service. The
 * person holding the phone has no idea that is what they did.
 *
 * ⚠️ So this is a guard against accidents, not a security control, and it must
 * not be described as one. It is stored per device like every other view
 * preference, it is undone from the view panel, and anyone who wants past it
 * can get past it in two taps. That is the correct strength for what it is.
 *
 * ⛔ It deliberately has no hash parameter, unlike every other view preference.
 * The others set a *look*, and a link that hands someone a different look is
 * fine. A link that silently takes the editors away — or hands them back — is
 * a different kind of thing, and a lock a URL can switch off would not even be
 * an accident guard.
 */

export const LOCK_STATES = ['off', 'on'];

export const LOCK_LABELS = { off: 'Off', on: 'On' };

/**
 * What a locked device refuses, by name.
 *
 * ⛔ Named, not inferred. Every one of these writes `config.json` on the
 * server, so every connected board follows — except `demo`, which is local but
 * replaces the whole board with invented data, and a wall showing invented
 * battery levels during a service is worse than a wall showing nothing.
 *
 * ⚠️ This list is an allow-by-omission: an action nobody added here stays
 * reachable on a locked board. `viewer-lock.test.mjs` reads `kbd.js` and fails
 * if a binding reaches one of the editors without the guard, which is the only
 * reason that trade is acceptable.
 */
export const GUARDED_ACTIONS = {
  config: 'the configuration editor',
  'group-edit': 'group editing',
  'slot-edit': 'slot naming',
  'background-library': 'the background library',
  pco: 'Planning Center',
  demo: 'demo mode',
};

/** The functions a locked device must not reach, for the drift guard. */
export const GUARDED_CALLS = ['initConfigEditor', 'groupEditToggle', 'slotEditToggle'];

export function isLocked(state) {
  return state === 'on';
}

export function allows(state, action) {
  if (!isLocked(state)) {
    return true;
  }
  return !Object.prototype.hasOwnProperty.call(GUARDED_ACTIONS, action);
}

/**
 * Why a tap did nothing, naming the thing that was refused.
 *
 * ⭐ A locked board that simply ignores a tap reads as a broken board, and
 * somebody will go looking for the fault during a service.
 */
export function refusalNote(action) {
  const what = GUARDED_ACTIONS[action];
  if (!what) {
    return null;
  }
  return `This board is locked to display only, so ${what} is not available. Unlock it in view settings.`;
}

/**
 * What a board says when a key just locked it.
 *
 * ⛔ Only for the key. Someone who flipped the switch in the panel is looking
 * at the switch and does not need telling -- but `K` is one keystroke away
 * from several others, and a board that silently hid its own menu mid-service
 * would be alarming to whoever did it by accident.
 */
export function lockedJustNowNote() {
  return 'Locked to display only. The gear in the corner unlocks it.';
}

/** The line the menu shows in place of the editors it has hidden. */
export function lockedMenuNote() {
  return 'Locked to display only — unlock in view settings.';
}

/**
 * What the switch in the panel says about itself.
 *
 * ⚠️ Says "accident", because claiming anything stronger would be a lie: the
 * server is unauthenticated and the switch is two taps from here.
 */
export function lockDescription(state) {
  if (isLocked(state)) {
    return 'Editors and configuration are hidden on this device. View settings still work.';
  }
  return 'Hide the editors and configuration on this device, so a tap cannot change every board.';
}
