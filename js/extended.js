import { micboard, updateHash } from './app.js';
import { postJSON } from './data.js';
import { renderGroup } from './channelview.js';
import { setDisplayMode, setBackground } from './display.js';

function configArrayGenerator() {
  const slots = [];
  micboard.config.slots.forEach((s) => {
    slots[s.slot] = s;
  });
  return slots;
}

function slotValues() {
  const slotList = [];
  const currentBoard = document.getElementById('micboard').getElementsByClassName('col-sm');

  for (let i = 0; i < currentBoard.length; i += 1) {
    const slot = parseInt(currentBoard[i].id.replace(/[^\d.]/g, ''), 10);
    if (slot && (slotList.indexOf(slot) === -1)) {
      const output = {};

      output.slot = slot;
      output.extended_id = currentBoard[i].querySelector('.ext-id').value;
      output.extended_name = currentBoard[i].querySelector('.ext-name').value;

      slotList.push(output);
    }
  }
  return slotList;
}

function loadBulkNames() {
  const names = document.getElementById('bulkbox').value.split('\n');

  const currentBoard = document.getElementById('micboard').getElementsByClassName('col-sm');

  for (let i = 0; i < currentBoard.length; i += 1) {
    if (typeof names[i] === 'undefined') {
      // does not exist
    } else {
      // does exist
      currentBoard[i].getElementsByClassName('ext-name')[0].value = names[i];
    }
  }
}

function submitUpdate(data) {
  const url = 'api/slot';
  // ⛔⛔ `() => window.location.reload()`, not `window.location.reload()`.
  //
  // `postJSON(url, data, callback)` wants a FUNCTION. Passing the invocation
  // ran the reload while the arguments were being evaluated -- before
  // `postJSON` was entered -- so every save raced a navigation that had
  // already been scheduled, and the browser was free to cancel the request.
  // ⚠️ Saving in this editor is on the list of things never verified against
  // real hardware; this is the likeliest reason it would have failed there.
  postJSON(url, data, () => window.location.reload());
}

function initSlotEdit() {
  const tx = micboard.transmitters;
  const slots = configArrayGenerator();

  tx.forEach((t) => {
    const slotSelector = document.getElementById(`slot-${t.slot}`);

    // renderDisplayList skips a slot it has no transmitter for, and a group
    // can still name a slot the configuration no longer has, so a transmitter
    // here is not guaranteed a rendered column to write into.
    if (!slotSelector) {
      return;
    }

    slotSelector.querySelector('.chartzone').hidden = true;
    slotSelector.querySelector('.errorzone').style.display = 'block';
    slotSelector.querySelector('.diversity').style.display = 'none';
    slotSelector.querySelector('.editzone').style.display = 'block';
    slotSelector.querySelector('.info-drawer').style.display = 'block';

    if (t.channel) {
      slotSelector.querySelector('.errortype').innerHTML = `Slot ${t.slot} CH ${t.channel}`;
    } else {
      slotSelector.querySelector('.errortype').innerHTML = `Slot ${t.slot}`;
    }

    slotSelector.querySelector('.ip').innerHTML = t.ip;
    slotSelector.querySelector('.rxinfo').innerHTML = t.name_raw;

    // Likewise in the other direction: a transmitter can outlive its entry in
    // the configuration, and indexing the gap threw before either field was
    // read. An empty object leaves both inputs at their blank defaults.
    const slotConfig = slots[t.slot] || {};

    if (slotConfig.extended_id) {
      slotSelector.querySelector('.ext-id').value = slotConfig.extended_id;
    }
    if (slotConfig.extended_name) {
      slotSelector.querySelector('.ext-name').value = slotConfig.extended_name;
    }
  });

  // Leaving this editor does not remove the clone, so re-entering would append
  // a second copy and put duplicate ids back in the document — the very fault
  // the slot-edit-* names above were introduced to remove.
  const existing = document.getElementById('save-box');
  if (existing) existing.remove();

  const t = document.getElementById('save-template').content.cloneNode(true);
  document.getElementById('micboard').appendChild(t);

  document.getElementById('slotSave').addEventListener('click', () => {
    submitUpdate(slotValues());
  });

  document.getElementById('bulk-name-loader').addEventListener('click', () => {
    loadBulkNames();
  });

  // slot-edit-* rather than clear-id / clear-name: those ids belong to the
  // settings page, which sits inside #micboard and therefore comes first in
  // document order. Binding by the shared id attached these handlers to the
  // settings buttons instead, leaving the ones in this editor inert.
  document.getElementById('slot-edit-clear-id').addEventListener('click', () => {
    const elements = document.getElementsByClassName('ext-id');
    Array.from(elements).forEach((e) => {
      e.value = '';
    });
  });

  // ⛔ The only way to reach the bulk-paste box used to be Shift+N (#160).
  const showPaste = document.getElementById('show-paste-box');
  if (showPaste) {
    showPaste.addEventListener('click', () => {
      const box = document.getElementById('paste-box');
      if (box) {
        box.style.display = 'block';
        const field = document.getElementById('bulkbox');
        if (field && typeof field.focus === 'function') field.focus();
      }
    });
  }

  document.getElementById('slot-edit-clear-name').addEventListener('click', () => {
    const elements = document.getElementsByClassName('ext-name');
    Array.from(elements).forEach((e) => {
      e.value = '';
    });
  });
}

// ⛔⛔ What the board was showing before the editor took it over (#216).
//
// The editor is a desk-mode view on purpose -- two text fields per card are not
// something to type into from across a room -- and it says so by switching the
// board to desk mode. What it never did was switch back, and the consequences
// compound on a wall:
//
//   1. `setDisplayMode('deskmode')` runs, so the television is now showing the
//      desk layout: a card a third of the width, at desk proportions.
//   2. `updateHash()` then writes a hash with no `tvmode` in it, because the
//      board is no longer in TV mode. The hash is the only thing that restores
//      TV mode on a load -- `displayMode` is the one view preference that is
//      never persisted (app.js:56) -- so the way back out is now gone too.
//   3. Escape, the only exit, does `window.location.reload()`. The board comes
//      back up from that hash, in desk mode.
//
// So editing slot names on the wall left the wall in desk mode, and nothing an
// operator could do from the board would put it back short of finding the
// display-mode control again.
//
// ⚠️ The group goes the same way: entry does `renderGroup(0)`, which *sets*
// `micboard.group = 0`, so a board showing one group came back showing all
// channels. Both are remembered here and both are restored.
let boardBeforeEdit = null;

/**
 * Open the slot-name editor, or close it if it is already open.
 *
 * ⛔ It is a toggle now, and it was not. `slotEditToggle` did its work inside
 * `if (micboard.settingsMode !== 'EXTENDED')`, so a second press of the same
 * control fell through the guard having already called `renderGroup(0)` --
 * which rebuilt the cards without the editor on them. That left the board in
 * the worst of the three states: desk mode, no editor, and `settingsMode` still
 * `'EXTENDED'`, which made the guard refuse to open it ever again. Measured on
 * a development board in TV mode: card 420x191 -> 310x126, fields gone, control
 * dead.
 */
export function slotEditToggle() {
  if (micboard.settingsMode === 'EXTENDED') {
    slotEditClose();
    return;
  }

  boardBeforeEdit = {
    displayMode: micboard.displayMode,
    group: micboard.group || 0,
  };

  renderGroup(0);
  setBackground('NONE');
  if (micboard.displayMode === 'tvmode') {
    // ⛔ Not remembered. Desk mode here is the editor's need, not a choice
    // about how this screen should look -- a board power-cut mid-edit must come
    // back as the wall it is, not as the desk the editor wanted (#216).
    setDisplayMode('deskmode', { remember: false });
  }
  micboard.settingsMode = 'EXTENDED';
  initSlotEdit();
}

/**
 * Leave the editor and give the board back.
 *
 * ⚠️ `settingsMode` is cleared **first**. `channelview` asks whether it is
 * `'EXTENDED'` while rendering, so re-rendering before clearing it would draw
 * the cards as though the editor were still open.
 */
export function slotEditClose() {
  if (micboard.settingsMode !== 'EXTENDED') {
    return;
  }
  micboard.settingsMode = 'NONE';

  // Leaving it would put a second copy in the document the next time the
  // editor opens, which is the duplicate-id fault the slot-edit-* names exist
  // to avoid.
  const box = document.getElementById('save-box');
  if (box) {
    box.remove();
  }

  const before = boardBeforeEdit;
  boardBeforeEdit = null;
  if (before && before.displayMode && before.displayMode !== micboard.displayMode) {
    // Likewise on the way back: this restores what was already stored, so
    // writing it again would only be a chance to write something else.
    setDisplayMode(before.displayMode, { remember: false });
  }
  // ⭐ Re-renders from the template, so the editor's own styling -- the hidden
  // chart zone, the shown error zone, the input boxes -- goes with it rather
  // than being undone field by field.
  renderGroup(before ? before.group : (micboard.group || 0));
  // ⛔ After the mode is back, so `tvmode` is in the hash again and a reload
  // returns to the wall layout rather than the desk one.
  updateHash();
}
