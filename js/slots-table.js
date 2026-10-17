/**
 * The Slots section of the administration page.
 *
 * ⛔⛔ **The board is never touched here.** The editor this replaces rendered
 * every channel as a card with two boxes inside it, and to do that it switched
 * the group to all channels, turned the backgrounds off and forced a television
 * into desk mode — the trip #216 had to patch twice because it never switched
 * back. A table in the content pane needs none of it: nothing is borrowed, so
 * nothing has to be given back, and the wall keeps showing the service while
 * somebody types.
 *
 * The model lives in `slots-table.mjs`, which is where the cases that would
 * otherwise be found on a running board are tested.
 */

import { micboard } from './app.js';
import { postJSON } from './data.js';
import {
  STATUS_WORDS, STATUS_TONES, slotRows, applyNames, slotPayload,
  saveSummary, tableSummary,
} from './slots-table.mjs';

const BODY_ID = 'slots-rows';
const STATUS_ID = 'slots-status';

/**
 * The rows on screen, with what each one was loaded as.
 *
 * ⛔ Module state rather than read back out of the inputs at save time. The old
 * editor rebuilt its payload by walking the board's columns, so it could only
 * ever save what happened to be rendered; and reading the DOM gives no way to
 * tell an edited field from one that merely exists, which is what
 * `slotPayload` needs to send only what changed.
 */
let rows = [];

function setStatus(message) {
  const host = document.getElementById(STATUS_ID);
  if (host) {
    host.textContent = message || '';
  }
}

/** The State cell: a word, always, tinted — never colour alone. */
function stateCell(row) {
  const cell = document.createElement('td');
  cell.className = 'slots-cell slots-cell--state';
  if (row.offline) {
    cell.textContent = 'No receiver';
    cell.classList.add('is-idle');
    return cell;
  }
  const word = STATUS_WORDS[row.status] || row.status || 'Unknown';
  const tone = STATUS_TONES[row.status] || 'idle';
  cell.textContent = word;
  cell.classList.add(`is-${tone}`);
  return cell;
}

/**
 * One editable cell.
 *
 * ⛔ Updates the model and **never re-renders the list**. Rebuilding the rows
 * on input would replace the input being typed into, so the field would lose
 * focus on every keystroke — the same trap `renderScreenRows` documents.
 */
// ⛔ One name per field, matching the table headings and every other pane
// (#267). `deviceId` used to name the ROLE here, while the real `device_id`
// sat in the Receiver-reports column beside it.
const FIELD_LABELS = { person: 'Person', role: 'Role', position: 'Plan position' };

function editCell(row, key, placeholder) {
  const cell = document.createElement('td');
  cell.className = 'slots-cell';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control form-control-sm';
  input.value = row[key] || '';
  if (placeholder) {
    input.placeholder = placeholder;
  }
  input.setAttribute('aria-label', `${FIELD_LABELS[key] || key} on slot ${row.slot}`);
  input.dataset.slotsField = key;
  input.dataset.slot = String(row.slot);
  input.addEventListener('input', () => {
    row[key] = input.value;
    setStatus(tableSummary(rows));
  });
  cell.appendChild(input);
  return cell;
}

/**
 * The clear control.
 *
 * ⛔ A control, not an empty box. `config.py` pops the key when a value is
 * empty, so a stray delete and a tab away is indistinguishable from meaning it
 * — this is the deliberate way to take somebody off a slot, and it says so.
 *
 * ⚠️ It clears the **person** only. The device id is an override of what the
 * receiver reports, and emptying that box is already how you stop overriding.
 */
function clearCell(row) {
  const cell = document.createElement('td');
  cell.className = 'slots-cell slots-cell--clear';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-row-remove';
  button.textContent = '×';
  button.setAttribute('aria-label', `Clear the person on slot ${row.slot}`);
  button.title = 'Clear the person on this slot';
  button.addEventListener('click', () => {
    row.person = '';
    // In place, for the same reason the inputs are: nothing else on screen
    // should move because one row was cleared.
    const input = document.querySelector(`[data-slots-field="person"][data-slot="${row.slot}"]`);
    if (input) {
      input.value = '';
      input.focus();
    }
    setStatus(tableSummary(rows));
  });
  cell.appendChild(button);
  return cell;
}

function renderRows() {
  const body = document.getElementById(BODY_ID);
  if (!body) {
    return;
  }
  body.replaceChildren();

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'slots-cell text-muted';
    td.textContent = 'No slots configured. Add receivers first, then come back.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    if (row.offline) {
      tr.className = 'is-offline';
    }

    const slot = document.createElement('th');
    slot.scope = 'row';
    slot.className = 'slots-cell slots-cell--slot';
    slot.textContent = String(row.slot);
    tr.appendChild(slot);

    const reports = document.createElement('td');
    reports.className = 'slots-cell slots-cell--reports';
    // ⛔ Said in words. A blank column on an offline slot reads as missing
    // data, which is the reading that got #186 filed as a rendering bug.
    reports.textContent = row.offline ? 'no receiver behind this slot' : (row.reports || '—');
    if (row.offline) {
      reports.classList.add('is-idle');
    }
    tr.appendChild(reports);

    // ⛔ The placeholder is NOT the device id any more. An empty Role cell
    // showing `HH-1` taught everyone that a role is an equipment label,
    // which is how the column came to be headed "Device id" at all.
    tr.appendChild(editCell(row, 'role', 'no role set'));
    tr.appendChild(editCell(row, 'person', 'nobody assigned'));
    // ⭐ #238. Typed here, and overwritten by the next sync that names it.
    tr.appendChild(editCell(row, 'position', 'no plan position'));
    tr.appendChild(stateCell(row));
    tr.appendChild(clearCell(row));

    body.appendChild(tr);
  });
}

/**
 * Fill the table from the stored configuration.
 *
 * ⛔ Called when the section is **opened**, never on a redraw — `fillSection`
 * is wired to the transition in for exactly this reason. Refilling on every
 * render is #180: the administration page re-renders on every `viewers` event,
 * and the row somebody was typing into vanished about a second after they
 * added it.
 */
export function refreshSlotsTable() {
  rows = slotRows({
    config: micboard.config,
    transmitters: micboard.transmitters,
  });
  renderRows();
  setStatus(tableSummary(rows));
}

function fillFromList() {
  const box = document.getElementById('slots-paste');
  if (!box) {
    return;
  }
  rows = applyNames(rows, box.value);
  renderRows();
  // ⚠️ Says what it did and what it did not do. Filling and saving are separate
  // on purpose, so a paste can be read back and corrected before it reaches any
  // board.
  setStatus(`${tableSummary(rows)} Not saved yet — read it back, then save.`);
}

function save() {
  const payload = slotPayload(rows);
  if (!payload.length) {
    setStatus('Nothing changed, so nothing was sent.');
    return;
  }
  // ⛔ Worked out before the request, like `saveScreens`: computed afterwards it
  // would compare the saved rows with themselves.
  const summary = saveSummary(rows);

  postJSON('api/slot', payload, () => {
    // ⛔⛔ No `window.location.reload()`. The old editor reloaded the whole
    // board on every save — which, from a section of the administration page,
    // would throw away the page somebody is working in. It also raced the
    // request it had just scheduled (#236).
    //
    // ⭐ What was sent is now what is stored, so the rows become their own
    // baseline and a second save sends nothing.
    rows = rows.map((row) => ({ ...row, wasRole: row.role, wasPerson: row.person }));
    const box = document.getElementById('slots-paste');
    if (box) {
      box.value = '';
    }
    renderRows();
    setStatus(`${summary} ${tableSummary(rows)}`);
  });
}

/**
 * Bind the section's controls.
 *
 * ⚠️ Delegated from the section, and bound once at start-up — the section's
 * markup is static and lives in the document whether or not it is on screen,
 * so binding on each fill would stack a second handler per visit. That is the
 * 1.7.0 listener-stacking fault, and the backgrounds pane already guards
 * against it the same way.
 */
export function initSlotsTable() {
  const section = document.getElementById('admin-section-slots');
  if (!section) {
    return;
  }
  section.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) {
      return;
    }
    if (target.id === 'slots-fill-from-list') {
      event.preventDefault();
      fillFromList();
    } else if (target.id === 'slots-save') {
      event.preventDefault();
      save();
    }
  });
}
