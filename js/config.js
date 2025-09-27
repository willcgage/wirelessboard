// Render the discovered device list in the config editor
function renderDiscoveredDeviceList() {
  const discoveredList = document.getElementById('discovered_list');
  if (!discoveredList) return;
  discoveredList.innerHTML = '';
  const discovered = micboard.discovered || [];
  if (!Array.isArray(discovered) || discovered.length === 0) return;
  discovered.forEach((slot) => {
    const t = document.getElementById('config-slot-template').content.cloneNode(true);
    const row = t.querySelector('.cfg-row');
    if (row) {
      row.id = 'slot-' + slot.slot;
      row.querySelector('.cfg-type').value = slot.type || '';
      row.querySelector('.cfg-ip').value = slot.ip || '';
      row.querySelector('.cfg-channel').value = slot.channel || '';
      const deviceInput = row.querySelector('.cfg-device-name');
      if (deviceInput) {
        const deviceName = slot.chan_name_raw || slot.name_raw || slot.name || '';
        deviceInput.value = deviceName;
      }
      const extInput = row.querySelector('.cfg-name');
      if (extInput && slot.extended_name) {
        extInput.value = slot.extended_name;
      }
    }
    discoveredList.appendChild(t);
  });
}
'use strict';

import { Sortable, Plugins } from '@shopify/draggable';

import { micboard, updateHash } from './app.js';
import { postJSON } from './data.js';

const NET_DEVICE_TYPES = ['axtd', 'ulxd', 'qlxd', 'uhfr', 'p10t'];

function updateSlotID() {
  const rows = document.querySelectorAll('#editor_holder .cfg-row');
  let slot = 1;
  Array.from(rows).forEach((row) => {
    row.id = 'slot-' + slot;
    const label = row.querySelector('.slot-number label');
    if (label) label.textContent = slot;
    slot += 1;
  });
}

// Ensure HUD is not blocking when entering settings/PCO
function hideHUDOverlay() {
  try {
    const hud = document.getElementById('hud');
    if (hud) {
      hud.classList.remove('show');
    }
  } catch (_) {}
}

function updateEditEntry(slotSelector, data) {
  if (data.ip) {
    slotSelector.querySelector('.cfg-ip').value = data.ip;
  }
  slotSelector.querySelector('.cfg-type').value = data.type;
  slotSelector.querySelector('.cfg-channel').value = data.channel;
  console.log(data);
}


function showPCOView() {
  hideHUDOverlay();
  micboard.settingsMode = 'PCO';
  updateHash();
  const mb = document.getElementById('micboard');
  if (mb) mb.style.display = 'none';
  const settings = document.querySelector('.settings');
  if (settings) settings.style.display = 'none';
  const pcoView = document.getElementById('pco-settings');
  if (pcoView) pcoView.style.display = 'block';
  const backBtn = document.getElementById('pco-close') || document.getElementById('pco-back');
  if (backBtn) {
    backBtn.id = 'pco-close';
    backBtn.textContent = 'Close';
    backBtn.classList.remove('btn-link');
    backBtn.classList.add('btn-outline-secondary');
  }
  try { document.getElementById('pco-settings').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  const p = micboard.config.pco || {};
  const eEnabled = document.getElementById('pco-enabled');
  if (eEnabled) eEnabled.checked = !!p.enabled;
  const a = p.auth || {};
  const eToken = document.getElementById('pco-token');
  const eSecret = document.getElementById('pco-secret');
  if (eToken) eToken.value = a.token || '';
  if (eSecret) eSecret.value = a.secret || '';
  const s = p.services || {};
  const eStid = document.getElementById('pco-service-type-id');
  if (eStid) eStid.value = s.service_type_id || '';
  const m = p.mapping || {};
  const eCat = document.getElementById('pco-note-category');
  const eTeam = document.getElementById('pco-team-filter');
  if (eCat) eCat.value = m.note_category || 'Mic / IEM Assignments';
  if (eTeam) eTeam.value = Array.isArray(m.team_name_filter) ? m.team_name_filter.join(', ') : '';
  populatePCOFormFromServer();
  try { refreshPlansList(); } catch (e) {}
  const planSel = document.getElementById('pco-plan-select');
  if (planSel) planSel.innerHTML = '<option value="">Select a plan…</option>';
  const loadBtn = document.getElementById('pco-load-people');
  if (loadBtn) loadBtn.disabled = true;
  appendPcoLog('Opened PCO settings view');
}
function generateJSONConfig() {
  const slotList = [];
  const holder = document.getElementById('editor_holder');
  if (!holder) return slotList;
  const configBoard = holder.getElementsByClassName('cfg-row');

  for (let i = 0; i < configBoard.length; i += 1) {
    const slot = parseInt(configBoard[i].id.replace(/[^\d.]/g, ''), 10);
    if (slot && (slotList.indexOf(slot) === -1)) {
      const output = {};

      output.slot = slot;
      const typeVal = (configBoard[i].querySelector('.cfg-type')?.value || '').trim();
      const ipVal = (configBoard[i].querySelector('.cfg-ip')?.value || '').trim();
      const chanVal = parseInt(configBoard[i].querySelector('.cfg-channel')?.value, 10);
  const nameField = configBoard[i].querySelector('.cfg-name');
  const nameVal = nameField ? String(nameField.value || '').trim() : '';

      // Decide type: if a known network device type, require IP+Channel; otherwise default to offline when any meaningful data exists
      let finalType = typeVal;
      if (!finalType) {
        // If user provided a name but no type, treat as offline to persist the entry
        if (nameVal && !ipVal) {
          finalType = 'offline';
        } else if (!nameVal && !ipVal) {
          // Completely empty row — skip
          finalType = '';
        } else if (!nameVal && ipVal) {
          // IP without type — leave incomplete, skip; user must choose a type
          finalType = '';
        } else if (nameVal && ipVal) {
          // Both name and IP but no type — safest is to skip until type chosen
          finalType = '';
        }
      }

      if (!finalType) {
        // Skip rows that still lack a resolvable type
        continue;
      }

      output.type = finalType;

      if (NET_DEVICE_TYPES.indexOf(output.type) > -1) {
        // Only include IP/Channel for networked device types
        output.ip = ipVal;
        output.channel = Number.isFinite(chanVal) ? chanVal : 1;
      }

      if (nameField) {
        output.extended_name = nameVal;
      }

      slotList.push(output);
    }
  }
  return slotList;
}


function addAllDiscoveredDevices() {
  const devices = document.querySelectorAll('#discovered_list .cfg-row');
  const cfg_list = document.getElementById('editor_holder');
  if (!cfg_list || devices.length === 0) return;
  const top = cfg_list.querySelector('.cfg-row');

  devices.forEach((e) => {
    cfg_list.insertBefore(e, top);
  });
  updateSlotID();
}

function updateHiddenSlots() {
  const cfgRows = document.querySelectorAll('#editor_holder .cfg-row')
  Array.from(cfgRows).forEach((e) => {
    const type = e.querySelector('.cfg-type').value
    if ( type === 'offline' || type === '') {
      e.querySelector('.cfg-ip').style.display = "none"
      e.querySelector('.cfg-channel').style.display = "none"
    } else {
      e.querySelector('.cfg-ip').style.display = "block"
      e.querySelector('.cfg-channel').style.display = "block"
    }
  })
}

function setDeviceNameStatus(message, level = 'info') {
  const statusEl = document.getElementById('device-name-status');
  if (!statusEl) return;

  statusEl.classList.add('d-none');
  statusEl.classList.remove('text-muted', 'text-danger', 'text-warning', 'text-success');

  if (!message) {
    statusEl.textContent = '';
    return;
  }

  let cls = 'text-muted';
  if (level === 'error') {
    cls = 'text-danger';
  } else if (level === 'warn') {
    cls = 'text-warning';
  } else if (level === 'success') {
    cls = 'text-success';
  }

  statusEl.textContent = message;
  statusEl.classList.add(cls);
  statusEl.classList.remove('d-none');
}

function applyDeviceNameUpdates(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return { total: 0, named: 0 };

  const slotsMap = new Map();
  devices.forEach((entry) => {
    if (!entry || entry.slot == null) return;
    const slotNum = parseInt(entry.slot, 10);
    if (!Number.isFinite(slotNum)) return;
    const name = entry.name || '';
    const row = document.getElementById('slot-' + slotNum);
    if (row) {
      const input = row.querySelector('.cfg-device-name');
      if (input) input.value = name;
    }
    slotsMap.set(slotNum, name);

    if (micboard.transmitters && micboard.transmitters[slotNum]) {
      try {
        micboard.transmitters[slotNum].name_raw = name;
        micboard.transmitters[slotNum].chan_name_raw = name;
      } catch (_) {}
    }
  });

  if (micboard.config && Array.isArray(micboard.config.slots)) {
    micboard.config.slots.forEach((slotCfg) => {
      const slotNum = slotCfg && slotCfg.slot;
      if (!slotsMap.has(slotNum)) return;
      const name = slotsMap.get(slotNum);
      if (name) {
        slotCfg.chan_name_raw = name;
      } else {
        delete slotCfg.chan_name_raw;
      }
    });
  }

  let named = 0;
  slotsMap.forEach((value) => {
    if (value) named += 1;
  });

  return { total: slotsMap.size, named };
}

function clearDeviceNameInputs(slots) {
  const slotSet = Array.isArray(slots)
    ? new Set(slots.map((val) => parseInt(val, 10)).filter((val) => Number.isFinite(val)))
    : null;

  document.querySelectorAll('#editor_holder .cfg-row').forEach((row) => {
    const slotId = parseInt(String(row.id || '').replace(/[^0-9]/g, ''), 10);
    if (slotSet && !slotSet.has(slotId)) {
      return;
    }
    const input = row.querySelector('.cfg-device-name');
    if (input) input.value = '';
  });
}

function fetchDeviceNamesSnapshot() {
  return fetch('api/slot/device-names?_=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(resp => {
      if (!resp || resp.ok !== true) {
        throw new Error((resp && resp.error) || 'Request failed');
      }
      const devices = Array.isArray(resp.devices) ? resp.devices : [];
      const results = applyDeviceNameUpdates(devices);
      return { devices, results };
    });
}

function applyExtendedNameChanges(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return;

  updates.forEach(({ slot, extended_name: name }) => {
    if (!Number.isFinite(slot)) return;
    const value = name || '';

    if (micboard.config && Array.isArray(micboard.config.slots)) {
      const target = micboard.config.slots.find((s) => s && s.slot === slot);
      if (target) {
        if (value) {
          target.extended_name = value;
        } else {
          delete target.extended_name;
        }
      }
    }

    const cfgRow = document.getElementById('slot-' + slot);
    if (cfgRow) {
      const input = cfgRow.querySelector('.cfg-name');
      if (input) input.value = value;
    }

    const assignRow = document.querySelector(`#pco-assign-table tr[data-slot="${slot}"]`);
    if (assignRow) {
      const extCell = assignRow.querySelector('.pco-ext-name');
      if (extCell) extCell.textContent = value;
    }
  });
}

function appendPcoLog(message, level = 'info') {
  try {
    const container = document.getElementById('pco-log-entries');
    if (!container) return;
    const line = document.createElement('div');
    line.classList.add('pco-log-entry');
    if (level === 'error') {
      line.classList.add('text-danger');
    } else if (level === 'warn') {
      line.classList.add('text-warning');
    }
    const stamp = new Date().toLocaleTimeString();
    line.textContent = `[${stamp}] ${message}`;
    container.appendChild(line);
    while (container.childElementCount > 200) {
      container.removeChild(container.firstChild);
    }
    container.scrollTop = container.scrollHeight;
  } catch (_) {
    // swallow log errors
  }
}

function formatError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch (_) {
    return String(err);
  }
}

function closePCOView() {
  const pcoView = document.getElementById('pco-settings');
  if (pcoView) pcoView.style.display = 'none';
  const settings = document.querySelector('.settings');
  if (settings) settings.style.display = 'block';
  const mb = document.getElementById('micboard');
  if (mb) mb.style.display = '';
  micboard.settingsMode = 'CONFIG';
  updateHash();
  try { initConfigEditor(true); } catch (_) {}
}

export function initConfigEditor(force = false) {
  if (!force && micboard.settingsMode === 'CONFIG') {
    console.log('oh that explains it!')
    return;
  }

  hideHUDOverlay();
  micboard.settingsMode = 'CONFIG';
  updateHash();
  const mb = document.getElementById('micboard');
  if (mb) mb.style.display = '';
  const pcoView = document.getElementById('pco-settings');
  if (pcoView) pcoView.style.display = 'none';
  const settings = document.querySelector('.settings');
  if (settings) settings.style.display = 'block';

  // Render slot list (replacement for missing renderSlotList)
  const holder = document.getElementById('editor_holder');
  if (holder) {
    holder.innerHTML = '';
    const slots = (micboard.config && micboard.config.slots) || [];
    if (Array.isArray(slots) && slots.length > 0) {
      slots.forEach(slot => {
        const t = document.getElementById('config-slot-template').content.cloneNode(true);
        const row = t.querySelector('.cfg-row');
        if (row) {
          // Set slot number as id for later reference
          row.id = 'slot-' + slot.slot;
          // Populate fields
          row.querySelector('.cfg-type').value = slot.type || '';
          row.querySelector('.cfg-ip').value = slot.ip || '';
          row.querySelector('.cfg-channel').value = slot.channel || '';
          const deviceInput = row.querySelector('.cfg-device-name');
          if (deviceInput) {
            const tx = (micboard.transmitters && micboard.transmitters[slot.slot]) || {};
            let deviceName = slot.chan_name_raw || '';
            if (!deviceName && tx) {
              deviceName = tx.name_raw || '';
              if (!deviceName) {
                deviceName = tx.name || '';
              }
            }
            deviceInput.value = deviceName;
          }
          const nameInput = row.querySelector('.cfg-name');
          if (nameInput) nameInput.value = slot.extended_name || '';
        }
        holder.appendChild(t);
      });
    } else {
      // Provide some empty rows so users can manually configure slots
      for (let i = 0; i < 4; i += 1) {
        const t = document.getElementById('config-slot-template').content.cloneNode(true);
        holder.appendChild(t);
      }
      updateSlotID();
    }
  }
  renderDiscoveredDeviceList();


  updateHiddenSlots();
  setDeviceNameStatus('');
  // Delegate cfg-type change so newly added rows are handled
  holder?.addEventListener('change', (ev) => {
    if (ev.target && ev.target.classList && ev.target.classList.contains('cfg-type')) {
      updateHiddenSlots();
    }
  });

  const clearIds = document.getElementById('clear-id');
  if (clearIds) clearIds.addEventListener('click', () => {
    const rows = document.querySelectorAll('#editor_holder .cfg-row');
    Array.from(rows).forEach(r => {
      const idInput = r.querySelector('.cfg-ip');
      if (idInput) idInput.value = '';
    });
  });

  const clearNameButtons = document.querySelectorAll('#clear-name');
  if (clearNameButtons && clearNameButtons.length) {
    clearNameButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const extendedInputs = document.querySelectorAll('#editor_holder .cfg-name');
        Array.from(extendedInputs).forEach(input => { input.value = ''; });
      });
    });
  }

  const clearDeviceBtn = document.getElementById('clear-device-names');
  if (clearDeviceBtn) {
    clearDeviceBtn.addEventListener('click', () => {
      if (clearDeviceBtn.disabled) return;
      clearDeviceBtn.disabled = true;
      setDeviceNameStatus('Clearing device names...');

      fetch('api/slot/device-names/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: '{}'
      })
        .then(r => r.json())
        .then(resp => {
          if (!resp || resp.ok !== true) {
            throw new Error((resp && resp.error) || 'Request failed');
          }
          const cleared = Array.isArray(resp.cleared) ? resp.cleared : [];
          let slotsToClear = Array.from(new Set(cleared.map((val) => parseInt(val, 10)).filter((val) => Number.isFinite(val))));

          if (!slotsToClear.length) {
            slotsToClear = Array.from(document.querySelectorAll('#editor_holder .cfg-row'))
              .map((row) => parseInt(String(row.id || '').replace(/[^0-9]/g, ''), 10))
              .filter((val) => Number.isFinite(val));
          }

          if (slotsToClear.length) {
            const payload = slotsToClear.map((slot) => ({ slot, name: '' }));
            applyDeviceNameUpdates(payload);
            clearDeviceNameInputs(slotsToClear);
            setDeviceNameStatus(`Cleared device names for ${slotsToClear.length} slot${slotsToClear.length === 1 ? '' : 's'}.`, 'success');
          } else {
            setDeviceNameStatus('No device names to clear.', 'warn');
          }
        })
        .catch(err => {
          setDeviceNameStatus(`Failed to clear device names: ${formatError(err)}`, 'error');
        })
        .then(() => {
          clearDeviceBtn.disabled = false;
        });
    });
  }

  const readDeviceBtn = document.getElementById('read-device-names');
  if (readDeviceBtn) {
    readDeviceBtn.addEventListener('click', () => {
      if (readDeviceBtn.disabled) return;
      readDeviceBtn.disabled = true;
      setDeviceNameStatus('Reading device names...');

      fetchDeviceNamesSnapshot()
        .then(({ results }) => {
          if (!results.total) {
            setDeviceNameStatus('No configured slots to update.', 'warn');
          } else {
            const msg = `Read device names for ${results.named}/${results.total} slot${results.total === 1 ? '' : 's'}.`;
            setDeviceNameStatus(msg, results.named ? 'success' : 'warn');
          }
        })
        .catch(err => {
          setDeviceNameStatus(`Failed to read device names: ${formatError(err)}`, 'error');
        })
        .then(() => {
          readDeviceBtn.disabled = false;
        });
    });
  }

  // Initialize PCO form from current config
  const pco = micboard.config.pco || {};
  const elEnabled = document.getElementById('pco-enabled');
  if (elEnabled) elEnabled.checked = !!pco.enabled;
  const auth = pco.auth || {};
  const elToken = document.getElementById('pco-token');
  const elSecret = document.getElementById('pco-secret');
  if (elToken && auth.token) elToken.value = auth.token;
  if (elSecret && auth.secret) elSecret.value = auth.secret;
  const services = pco.services || {};
  const elSt = document.getElementById('pco-service-type');
  if (elSt) elSt.value = (services.service_type || services.service_type_id || '');
  const mapping = pco.mapping || {};
  const elCat = document.getElementById('pco-note-category');
  if (elCat) elCat.value = mapping.note_category || 'Mic / IEM Assignments';
  if (Array.isArray(mapping.team_name_filter)) {
    const elTeam = document.getElementById('pco-team-filter');
    if (elTeam) elTeam.value = mapping.team_name_filter.join(', ');
  }

  const addDisc = document.getElementById('add-discovered');
  if (addDisc) addDisc.addEventListener('click', () => {
    addAllDiscoveredDevices();
  });

  const saveBtn = document.getElementById('save');
  if (saveBtn) saveBtn.addEventListener('click', ()=> {
    const data = generateJSONConfig();
    const url = 'api/config';
    console.log(data);
    postJSON(url, data, () => {
      micboard.settingsMode = 'NONE';
      updateHash();
      window.location.reload();
    });
  });

  // Delegate delete-row for both initial and newly added rows
  const holderEl = document.getElementById('editor_holder');
  if (holderEl) {
    holderEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.del-btn button');
      if (btn) {
        const row = btn.closest('.cfg-row');
        if (row) row.remove();
        updateSlotID();
        renderDiscoveredDeviceList();
      }
    });
  }

  const clearBtn = document.getElementById('clear-config');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    const cfg_list = document.querySelectorAll('#editor_holder .cfg-row')
    Array.from(cfg_list).forEach(e => e.remove())
    let t;
    for (let i = 0; i < 4; i += 1) {
      t = document.getElementById('config-slot-template').content.cloneNode(true);
      document.getElementById('editor_holder').append(t);
    }
    updateSlotID();
    updateHiddenSlots();
  renderDiscoveredDeviceList();
  });

  const addRowBtn = document.getElementById('add-config-row');
  if (addRowBtn) addRowBtn.addEventListener('click', () => {
    const t = document.getElementById('config-slot-template').content.cloneNode(true);
    document.getElementById('editor_holder').append(t);
    updateSlotID();
    updateHiddenSlots();
  });
}

// PCO dedicated view helpers and bindings
function populatePCOFormFromServer() {
  try {
    appendPcoLog('Fetching saved PCO configuration...');
     fetch('api/pco/config?_=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(cfg => {
        const p = (cfg && cfg.pco) || {};
        const elEnabled = document.getElementById('pco-enabled');
        const elToken = document.getElementById('pco-token');
        const elSecret = document.getElementById('pco-secret');
        const elStid = document.getElementById('pco-service-type-id');
        const elCat = document.getElementById('pco-note-category');
        const elTeam = document.getElementById('pco-team-filter');
        if (elEnabled) elEnabled.checked = !!p.enabled;
        const a = p.auth || {};
        if (elToken) elToken.value = a.token || '';
        if (elSecret) elSecret.value = a.secret || '';
        const s = p.services || {};
        const elSt2 = document.getElementById('pco-service-type');
        if (elSt2) elSt2.value = (s.service_type || s.service_type_id || '');
        const m = p.mapping || {};
        if (elCat) elCat.value = m.note_category || 'Mic / IEM Assignments';
        if (elTeam) elTeam.value = Array.isArray(m.team_name_filter) ? m.team_name_filter.join(', ') : '';
        appendPcoLog('Loaded saved PCO configuration');
      })
      .catch((err) => {
        appendPcoLog(`Failed to load saved PCO configuration: ${formatError(err)}`, 'warn');
      });
  } catch (e) {/* ignore */}
}

// (duplicate showPCOView removed)

// Navbar link
export function bindPcoNav() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.id === 'go-pco') {
      e.preventDefault();
      showPCOView();
      try { document.getElementById('navbarToggleExternalContent').classList.remove('show'); } catch (err) {}
    }
  });
  window.addEventListener('micboard:open-pco', showPCOView);
  window.addEventListener('wirelessboard:open-pco', showPCOView);
}

function buildPcoPayload() {
  return {
    enabled: document.getElementById('pco-enabled')?.checked || false,
    auth: {
      token: document.getElementById('pco-token')?.value || '',
      secret: document.getElementById('pco-secret')?.value || '',
    },
    services: {
      plan: { select: 'next' }
    },
    mapping: {
      strategy: 'note_or_brackets',
      note_category: (document.getElementById('pco-note-category')?.value || 'Mic / IEM Assignments'),
      team_name_filter: (document.getElementById('pco-team-filter')?.value || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s)
    }
  };
}

function handlePcoSave() {
  const payload = buildPcoPayload();
  appendPcoLog('Saving PCO configuration...');
  postJSON('api/pco/config', payload, () => {
    const el = document.getElementById('pco-save-status');
    if (el) {
      el.classList.remove('d-none');
      setTimeout(() => {
        el.classList.add('d-none');
        micboard.config.pco = payload;
      }, 750);
    }
    appendPcoLog('PCO configuration saved.');
  }, (err) => {
    appendPcoLog(`PCO configuration save failed: ${formatError(err)}`, 'error');
  });
}

function handlePcoSync() {
  const summaryEl = document.getElementById('pco-sync-summary');
  const jsonEl = document.getElementById('pco-sync-json');
  const tbl = document.getElementById('pco-assignments-table');
  const enabled = document.getElementById('pco-enabled')?.checked;
  const token = document.getElementById('pco-token')?.value || '';
  const secret = document.getElementById('pco-secret')?.value || '';
  if (!enabled || !token || !secret) {
    appendPcoLog('Cannot sync with PCO: enable integration and provide token/secret.', 'warn');
    if (summaryEl) summaryEl.innerHTML = '<span class="text-warning">Set Enabled, Token, and Secret, then Save before Sync.</span>';
    return;
  }
  if (summaryEl) summaryEl.innerHTML = '';
  if (jsonEl) jsonEl.textContent = '';
  if (tbl) {
    tbl.style.display = 'none';
    const tbody = tbl.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
  }
  const planSel = document.getElementById('pco-plan-select');
  const selectedPlan = planSel ? (planSel.value || '') : '';
  const url = selectedPlan ? ('api/pco/sync?plan=' + encodeURIComponent(selectedPlan)) : 'api/pco/sync';
  appendPcoLog(`Syncing assignments with PCO ${selectedPlan ? `(plan ${selectedPlan})` : '(auto plan)' }...`);
  fetch(url, { method: 'POST' })
    .then(r => r.json())
    .then(resp => {
      if (jsonEl) jsonEl.textContent = JSON.stringify(resp, null, 2);
      if (resp && resp.ok) {
        const a = resp.assignments || 0;
        const u = resp.updates || 0;
        const pid = resp.plan_id || '-';
        if (summaryEl) summaryEl.innerHTML = `Plan ${pid}: ${a} assignment(s), ${u} update(s)`;
        appendPcoLog(`Sync complete for plan ${pid}: ${a} assignment(s), ${u} update(s).`);
        if (Array.isArray(resp.assignment_details) && resp.assignment_details.length) {
          const tbody = document.querySelector('#pco-assignments-table tbody');
          if (tbody) {
            resp.assignment_details.forEach(item => {
              const tr = document.createElement('tr');
              const td1 = document.createElement('td');
              const td2 = document.createElement('td');
              td1.textContent = item.id || '';
              td2.textContent = item.name || '';
              tr.appendChild(td1); tr.appendChild(td2);
              tbody.appendChild(tr);
            });
            if (tbl) tbl.style.display = 'block';
          }
        }
      } else {
        if (summaryEl) summaryEl.innerHTML = `<span class="text-danger">${(resp && resp.error) || 'Sync failed'}</span>`;
        appendPcoLog(`PCO sync failed: ${(resp && resp.error) || 'Unknown error'}`, 'error');
      }
    })
    .catch(err => {
      if (summaryEl) summaryEl.innerHTML = `<span class="text-danger">${err}</span>`;
      appendPcoLog(`PCO sync request error: ${formatError(err)}`, 'error');
    });
}

export function bindPcoHandlers() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'pco-save') {
      e.preventDefault();
      handlePcoSave();
    } else if (t.id === 'pco-sync') {
      e.preventDefault();
      handlePcoSync();
    } else if (t.id === 'pco-refresh-plans') {
      e.preventDefault();
      refreshPlansList();
    } else if (t.id === 'pco-load-people') {
      e.preventDefault();
      loadPeopleForSelectedService();
    }
  }, { passive: false });

  document.addEventListener('submit', (e) => {
    const t = e.target;
    if (t && t.id === 'pco-form') {
      e.preventDefault();
      handlePcoSave();
    }
  }, { passive: false });
}

function refreshPlansList() {
  const sel = document.getElementById('pco-plan-select');
  const btn = document.getElementById('pco-load-people');
  if (sel) sel.innerHTML = '<option value="">Loading…</option>';
  if (btn) btn.disabled = true;
  appendPcoLog('Fetching plan list from PCO...');
  fetch('api/pco/plans?_=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(resp => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to load plans');
      const plans = resp.plans || [];
      if (sel) {
        sel.innerHTML = '<option value="">Select a plan…</option>';
        plans.forEach(p => {
          const label = `${p.service_type_name ? p.service_type_name + ' — ' : ''}${p.short_dates || p.dates || ''} — ${p.title || ''}`;
          const opt = document.createElement('option');
          opt.value = p.id || '';
          opt.textContent = label;
          sel.appendChild(opt);
        });
      }
      appendPcoLog(`Fetched ${plans.length} plan(s) from PCO.`);
    })
    .catch(err => {
      if (sel) sel.innerHTML = '<option value="">No plans</option>';
      console.warn('Failed to load plans', err);
      appendPcoLog(`Failed to fetch plans: ${formatError(err)}`, 'error');
    });
}

function loadPeopleForSelectedService() {
  const planSel = document.getElementById('pco-plan-select');
  const planId = planSel ? (planSel.value || '') : '';
  const summary = document.getElementById('pco-people-summary');
  const tblWrap = document.getElementById('pco-people-table');
  const tbody = document.querySelector('#pco-people-table tbody');
  const assignSummary = document.getElementById('pco-assign-summary');
  if (!planId) {
    appendPcoLog('Cannot load people: select a plan first.', 'warn');
    if (summary) summary.innerHTML = '<span class="text-warning">Select a Plan first.</span>';
    return;
  }
  if (summary) summary.textContent = '';
  if (tbody) tbody.innerHTML = '';
  if (tblWrap) tblWrap.style.display = 'none';
  appendPcoLog(`Loading people for plan ${planId}...`);
  fetch('api/pco/people?plan=' + encodeURIComponent(planId) + '&_=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(resp => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to load people');
      const ppl = resp.people || [];
      ppl.forEach(p => {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        const td2 = document.createElement('td');
        const td3 = document.createElement('td');
        td1.textContent = p.name || '';
        td2.textContent = p.team || '';
        const notesArr = Array.isArray(p.notes) ? p.notes : [];
        td3.textContent = (notesArr.length ? notesArr.join(' | ') : '');
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
        if (tbody) tbody.appendChild(tr);
      });
      if (tblWrap) tblWrap.style.display = 'block';
      if (summary) {
        const cats = Array.isArray(resp.note_categories) && resp.note_categories.length ? ` | Categories: ${resp.note_categories.join(', ')}` : '';
        summary.textContent = `Plan ${resp.plan_id || planId}: ${ppl.length} people${cats}`;
      }
      appendPcoLog(`Loaded ${ppl.length} person records for plan ${resp.plan_id || planId}.`);
      try { buildAssignmentTable(ppl); } catch (e) {
        if (assignSummary) assignSummary.innerHTML = `<span class="text-danger">Failed to build assignment list: ${e}</span>`;
        appendPcoLog(`Failed to build assignment list: ${formatError(e)}`, 'error');
      }
    })
    .catch(err => {
      if (summary) summary.innerHTML = `<span class="text-danger">${err}</span>`;
      appendPcoLog(`Failed to load people: ${formatError(err)}`, 'error');
    });
}

// Shared: build assignment table with selects from the people list
function buildAssignmentTable(ppl) {
  const assignTbl = document.getElementById('pco-assign-table');
  const assignBody = document.querySelector('#pco-assign-table tbody');
  const assignSummary = document.getElementById('pco-assign-summary');
  const slots = (micboard.config && micboard.config.slots) || [];
  if (!Array.isArray(slots) || slots.length === 0) {
    if (assignBody) assignBody.innerHTML = '';
    if (assignTbl) assignTbl.style.display = 'none';
    if (assignSummary) assignSummary.innerHTML = '<span class="text-warning">No slots configured. Add slots in Config to enable assignments.</span>';
    return;
  }
  if (assignBody) assignBody.innerHTML = '';
  // Create a sorted copy by slot number
  const sorted = slots.slice().sort((a,b) => (a.slot||0) - (b.slot||0));
  // Create a shared select options fragment from people list
  const optionsHTML = ['<option value="">-- choose --</option>']
    .concat(ppl.map(p => {
      const notesArr = Array.isArray(p.notes) ? p.notes : [];
      const extra = notesArr.length ? notesArr.join(' | ') : '';
      const label = p.name + (p.team ? ' ['+p.team+']' : '') + (extra ? ' — ' + extra : '');
      return `<option value="${encodeURIComponent(p.name)}">${label}</option>`;
    }))
    .join('');
  sorted.forEach(s => {
    const tr = document.createElement('tr');
    const tdSlot = document.createElement('td');
    const tdDev = document.createElement('td');
    const tdDevName = document.createElement('td');
    const tdExtName = document.createElement('td');
    const tdSel = document.createElement('td');
    tr.setAttribute('data-slot', String(s.slot ?? ''));
    tdSlot.textContent = String(s.slot || '');
    tdDev.textContent = `${s.type || ''}${s.channel ? ' ch'+s.channel : ''}`.trim();
    // Device name: try to pull from live transmitter cache if present
    let devName = s.chan_name_raw || '';
    try {
      const tx = micboard.transmitters && micboard.transmitters[s.slot];
      if (!devName && tx) {
        devName = tx.name_raw || '';
        if (!devName) {
          devName = tx.name || '';
        }
      }
    } catch (_) {}
  tdDevName.textContent = devName;
  tdExtName.classList.add('pco-ext-name');
  tdExtName.textContent = s.extended_name || '';
    const sel = document.createElement('select');
    sel.className = 'form-select form-select-sm pco-person-select';
    sel.setAttribute('data-slot', String(s.slot || ''));
    sel.innerHTML = optionsHTML;
    tdSel.appendChild(sel);
    tr.appendChild(tdSlot); tr.appendChild(tdDev); tr.appendChild(tdDevName); tr.appendChild(tdExtName); tr.appendChild(tdSel);
    assignBody && assignBody.appendChild(tr);
  });
  if (assignTbl) assignTbl.style.display = 'block';
  appendPcoLog(`Assignment table prepared for ${sorted.length} slot(s).`);
}

// Back button and selection bindings
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'pco-plan-select') {
    const loadBtn = document.getElementById('pco-load-people');
    if (loadBtn) loadBtn.disabled = !(t.value);
  }
}, { passive: true });

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'pco-close') {
    e.preventDefault();
    closePCOView();
  }
  if (t.id === 'pco-apply-assignments') {
    e.preventDefault();
    applyAssignmentsFromSelects();
  }
  if (t.id === 'pco-autofill-assignments') {
    e.preventDefault();
    autoFillAssignmentsFromNotes();
  }
  if (t.id === 'pco-clear-assignment-selects') {
    e.preventDefault();
    const sels = document.querySelectorAll('#pco-assign-table select.pco-person-select');
    Array.from(sels).forEach(sel => { sel.value = ''; });
  }
}, { passive: false });

function applyAssignmentsFromSelects() {
  const summary = document.getElementById('pco-assign-summary');
  const sels = document.querySelectorAll('#pco-assign-table select.pco-person-select');
  const updates = [];
  Array.from(sels).forEach(sel => {
    const slotStr = sel.getAttribute('data-slot') || '';
    const slot = Number.parseInt(slotStr, 10);
    const name = sel.value ? decodeURIComponent(sel.value) : '';
    if (Number.isFinite(slot) && name) {
      updates.push({ slot, extended_name: name });
    }
  });
  if (updates.length === 0) {
    if (summary) summary.innerHTML = '<span class="text-warning">Select at least one person.</span>';
    appendPcoLog('No assignments selected to apply.', 'warn');
    return;
  }
  appendPcoLog(`Applying ${updates.length} assignment update(s) to slots...`);
  postJSON('api/slot', updates, () => {
    if (summary) summary.textContent = `Applied ${updates.length} update(s).`;
    appendPcoLog(`Applied ${updates.length} assignment update(s).`);
    try { applyExtendedNameChanges(updates); } catch (e) {
      appendPcoLog(`Unable to refresh extended names locally: ${formatError(e)}`, 'warn');
    }
  }, (err) => {
    appendPcoLog(`Failed to apply assignments: ${formatError(err)}`, 'error');
  });
}
function autoFillAssignmentsFromNotes() {
  const planSel = document.getElementById('pco-plan-select');
  const planId = planSel ? (planSel.value || '') : '';
  const assignSummary = document.getElementById('pco-assign-summary');
  if (!planId) {
    if (assignSummary) assignSummary.innerHTML = '<span class="text-warning">Select a Plan first.</span>';
    appendPcoLog('Cannot auto-fill assignments: select a plan first.', 'warn');
    return;
  }
  appendPcoLog(`Auto-filling assignments from notes for plan ${planId}...`);
  fetch('api/pco/people?plan=' + encodeURIComponent(planId) + '&_=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(resp => {
      const ppl = resp.people || [];
      const existingSelects = document.querySelectorAll('#pco-assign-table select.pco-person-select');
      if (!existingSelects || existingSelects.length === 0) {
        try { buildAssignmentTable(ppl); } catch (e) {}
      }
      const normalize = (s) => String(s || '').trim().toLowerCase();
      const byNote = new Map();
      const byExtId = new Map();
      ppl.forEach(p => {
        const notesArr = Array.isArray(p.notes) ? p.notes : [];
        for (const n of notesArr) {
          const k = normalize(n);
          if (!k) continue;
          if (!byNote.has(k)) byNote.set(k, new Set());
          byNote.get(k).add(p.name);
          const mm = String(n || '').match(/\[\s*([^\]]+?)\s*\]/);
          if (mm) {
            const bid = mm[1].trim();
            if (bid && !byExtId.has(bid)) byExtId.set(bid, p.name);
          }
        }
        const m = (p.name || '').match(/\[\s*([^\]]+?)\s*\]/);
        if (m) {
          const bid = m[1].trim();
          if (bid && !byExtId.has(bid)) byExtId.set(bid, p.name);
        }
      });
      const sels = document.querySelectorAll('#pco-assign-table select.pco-person-select');
      let matched = 0;
      Array.from(sels).forEach(sel => {
        const row = sel.closest('tr');
        const currentName = row ? (row.querySelector('td:nth-child(3)')?.textContent || '') : '';
        const k = normalize(currentName);
        const set = k ? byNote.get(k) : undefined;
        if (set && set.size === 1) {
          const [name] = Array.from(set);
          sel.value = encodeURIComponent(name);
          matched += 1;
          return;
        }
        const m = currentName.match(/\[\s*([^\]]+?)\s*\]/);
        const wantId = m ? m[1].trim() : '';
        if (wantId && byExtId.has(wantId)) {
          const name = byExtId.get(wantId);
          sel.value = encodeURIComponent(name);
          matched += 1;
        }
      });
      if (assignSummary) assignSummary.textContent = `Auto-filled ${matched} selection(s).`;
      appendPcoLog(`Auto-fill completed: matched ${matched} slot(s).`);
    })
    .catch(err => {
      if (assignSummary) assignSummary.innerHTML = `<span class="text-danger">Auto-fill failed: ${err}</span>`;
      appendPcoLog(`Auto-fill failed: ${formatError(err)}`, 'error');
    });
}
