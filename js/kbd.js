/**
 * The one key left (#160).
 *
 * This file used to hold the whole board: twenty-odd bindings, the help
 * overlay generated from them, and a drift guard keeping the view panel in
 * step with them. All of it is gone, because the keys are no longer how this
 * board is operated — the gear panel holds everything about this device and
 * the navbar Menu holds everything that changes every board.
 *
 * ⛔ Escape stays, and it is not a shortcut. It is the way out of a pane that
 * would otherwise swallow the screen, which is why it ran ahead of every guard
 * even when there were guards. A board stuck in the config view with no way
 * back is worse than any keyboard-free principle.
 *
 * ⚠️ Before adding anything here, read #160. A key that does something no
 * control does is the state this work exists to leave behind — the gear panel
 * or the administration page is where it goes. (This said "the Menu", which
 * #188 retired; a note telling the next person to put a control somewhere
 * that no longer exists is its own small version of the same fault.)
 */

import { micboard, updateHash } from './app.js';

/**
 * Whether the keystroke belongs to whatever is being typed into.
 *
 * ⛔ Checked first. Escape inside a text field means "stop editing this", and
 * reloading the board out from under somebody mid-edit is not that.
 */
function isTyping(target) {
  if (!target) {
    return false;
  }
  const tag = target.tagName ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return Boolean(target.isContentEditable);
}

export function keybindings() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || isTyping(e.target)) {
      return;
    }
    // ⚠️ The view panel handles its own Escape in a capturing listener and
    // stops it reaching here, because closing a panel should not throw the
    // whole page away.
    micboard.settingsMode = 'NONE';
    updateHash();
    window.location.reload();
  }, false);
}
