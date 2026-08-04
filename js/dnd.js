import { Sortable, Plugins } from '@shopify/draggable';

import { micboard } from './app.js';
import { initChart, charts } from './chart-smoothie.js';
import { renderDisplayList, updateViewOnly } from './channelview.js';
import { postJSON } from './data.js';
import { toggleDisplayMode } from './display.js';

let swappable;

function slotOrder() {
  const slotList = [];
  const currentBoard = document.getElementById('micboard').getElementsByClassName('col-sm');

  for (let i = 0; i < currentBoard.length; i += 1) {
    const slot = parseInt(currentBoard[i].id.replace(/[^\d.]/g, ''), 10);
    if (slot && (slotList.indexOf(slot) === -1)) {
      slotList.push(slot);
    } else if (currentBoard[i].classList.contains('blank')) {
      slotList.push(0);
    }
  }

  return slotList;
}

// slotOrder reads the board, and the board only shows slots that have a
// transmitter -- so a slot whose transmitter has not arrived yet is missing
// from the order and saving the group dropped it for good. Its own entry in
// `slots` survived, so the loss was silent: the slot simply stopped belonging
// to the group. Put those back.
//
// A slot the operator genuinely dragged out is not affected: to be dragged it
// had to be rendered, which means it has a transmitter. Having no transmitter
// is exactly what separates "never shown" from "deliberately removed".
function withUnrenderedSlots(ordered) {
  const stored = micboard.groups[micboard.group];

  if (!stored || !stored.slots) {
    return ordered;
  }

  const merged = ordered.slice();

  stored.slots.forEach((slot, index) => {
    // 0 is a blank spacer, positional rather than a slot, and the board is
    // already the authority on where those sit.
    if (slot === 0 || merged.indexOf(slot) !== -1 || micboard.transmitters[slot]) {
      return;
    }
    merged.splice(Math.min(index, merged.length), 0, slot);
  });

  return merged;
}

function renderEditSlots(dl) {
  document.getElementById('eslotlist').innerHTML = '';

  const tx = micboard.transmitters;
  dl.forEach((e) => {
    let t;
    if (e !== 0) {
      // A configured slot has no transmitter until the next data push builds
      // one, so the two lists disagree for a moment after the configuration is
      // saved -- reading .slot off the gap threw and took the whole editor with
      // it. Skip it until it arrives, as renderDisplayList already does.
      if (typeof tx[e] === 'undefined') {
        return;
      }
      t = document.getElementById('column-template').content.cloneNode(true);
      t.querySelector('div.col-sm').id = `slot-${tx[e].slot}`;
      updateViewOnly(t, tx[e]);
    } else {
      t = document.createElement('div');
      t.className = 'col-sm';
    }
    document.getElementById('eslotlist').appendChild(t);
  });

  const b = document.getElementById('column-template').content.cloneNode(true);
  b.querySelector('p.name').innerHTML = 'BLANK';
  b.querySelector('.col-sm').classList.add('blank');
  document.getElementById('eslotlist').appendChild(b);
}

function calcEditSlots() {
  const output = [];
  micboard.config.slots.forEach((slot) => {
    if (micboard.displayList.indexOf(slot.slot) === -1) {
      output.push(slot.slot);
    }
  });

  return output;
}

function clearAll() {
  micboard.displayList = [];
  renderDisplayList(micboard.displayList);

  const eslots = calcEditSlots();
  renderEditSlots(eslots);
}

function onDrop(id, src, dst) {
  const slot = parseInt(id.id.replace(/[^\d.]/g, ''), 10);
  micboard.displayList = slotOrder();

  const eslots = calcEditSlots();
  renderEditSlots(eslots);

  // if (src === 'micboard' && dst === 'micboard') {
  // }
  if (src === 'eslotlist' && dst === 'micboard' && slot) {
    charts[slot] = initChart(document.getElementById(id.id), micboard.transmitters[slot]);
  }
  if (src === 'micboard' && dst === 'eslotlist' && slot) {
    charts[slot].slotChart.stop();
  }
}

export function updateEditor(group) {
  let title = '';
  let chartCheck = false;

  if (micboard.groups[group]) {
    title = micboard.groups[group].title;
    chartCheck = micboard.groups[group].hide_charts;
  }

  document.getElementById('sidebarTitle').innerHTML = `Group ${group}`;
  document.getElementById('groupTitle').value = title;
  // No chartCheck control has ever existed in the markup, so this threw on
  // every call -- and renderGroup calls updateEditor unconditionally, which is
  // what left the group and slot editors unopenable.
  const chartCheckBox = document.getElementById('chartCheck');
  if (chartCheckBox) {
    chartCheckBox.checked = chartCheck;
  }
}

function GridLayout() {
  const containerSelector = '.drag-container';
  const containers = document.querySelectorAll(containerSelector);

  if (containers.length === 0) {
    return false;
  }

  swappable = new Sortable(containers, {
    draggable: '.col-sm',
    mirror: {
      appendTo: containerSelector,
      constrainDimensions: true,
    },

    plugins: [Plugins.ResizeMirror],
  });
  renderEditSlots(calcEditSlots());
  swappable.on('sortable:stop', (evt) => {
    setTimeout(onDrop, 125, evt.dragEvent.source, evt.oldContainer.id, evt.newContainer.id);
  });

  return swappable;
}

export function groupEditToggle() {
  // The navbar carries container-fluid too and comes first in document order,
  // so [0] put sidebar-open on an element the sidebar is not inside -- and the
  // rule that reveals it, `.sidebar-open .sidebar-nav`, needs an ancestor.
  // Every other module already addresses this element by id.
  const container = document.getElementById('container');
  if (container.classList.contains('sidebar-open')) {
    container.classList.remove('sidebar-open');
    swappable.destroy();
  } else {
    if (micboard.displayMode === 'tvmode') {
      toggleDisplayMode();
    }
    container.classList.add('sidebar-open');
    GridLayout();
  }
}

function submitSlotUpdate() {
  const url = 'api/group';

  // With no control to read, fall back to what the group already has rather
  // than to false, so saving a group does not quietly turn its charts back on.
  const chartCheckBox = document.getElementById('chartCheck');
  const currentGroup = micboard.groups[micboard.group];

  const update = {
    group: micboard.group,
    title: document.getElementById('groupTitle').value,
    hide_charts: chartCheckBox
      ? chartCheckBox.checked
      : Boolean(currentGroup && currentGroup.hide_charts),
    slots: withUnrenderedSlots(slotOrder()),
  };

  postJSON(url, update);
  groupEditToggle();
}

export function initEditor() {
  document.getElementById('editorClose').addEventListener('click', () => {
    groupEditToggle();
  });

  document.getElementById('editorSave').addEventListener('click', () => {
    submitSlotUpdate();
  });
  document.getElementById('editorClear').addEventListener('click', () => {
    clearAll();
  });
}
