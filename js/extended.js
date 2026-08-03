import { micboard } from './app.js';
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
  postJSON(url, data, window.location.reload());
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

    slotSelector.querySelector('.chartzone').style.display = 'none';
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

  document.getElementById('slot-edit-clear-name').addEventListener('click', () => {
    const elements = document.getElementsByClassName('ext-name');
    Array.from(elements).forEach((e) => {
      e.value = '';
    });
  });
}

export function slotEditToggle() {
  renderGroup(0);
  setBackground('NONE');
  if (micboard.settingsMode !== 'EXTENDED') {
    if (micboard.displayMode === 'tvmode') {
      setDisplayMode('deskmode');
    }
    micboard.settingsMode = 'EXTENDED';
    initSlotEdit();
  }
}
