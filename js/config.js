'use strict';

import { Collapse } from 'bootstrap';
import { Sortable, Plugins } from '@shopify/draggable';

import { micboard, updateHash } from './app.js';
import { postJSON } from './data.js';

const NET_DEVICE_TYPES = ['axtd', 'ulxd', 'qlxd', 'uhfr', 'p10t'];

// Render the discovered device list in the config editor
function renderDiscoveredDeviceList() {
  const discoveredList = document.getElementById('discovered_list');
  if (!discoveredList) return;
  discoveredList.innerHTML = '';
  const discovered = micboard.discovered || [];
  if (!Array.isArray(discovered) || discovered.length === 0) return;
  const template = document.getElementById('config-slot-template');
  if (!template || !template.content) return;

  discovered.forEach((slot) => {
    const t = template.content.cloneNode(true);
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
    if (!hud) return;
    Collapse.getOrCreateInstance(hud, { toggle: false }).hide();
    hud.classList.remove('show');
  } catch (_) {}
  try {
    const trigger = document.getElementById('go-hud');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  } catch (_) {}
}

function updateEditEntry(slotSelector, data) {
  if (data.ip) {
    slotSelector.querySelector('.cfg-ip').value = data.ip;
  }
  slotSelector.querySelector('.cfg-type').value = data.type;
  slotSelector.querySelector('.cfg-channel').value = data.channel;
}


function ensurePcoCredentialStatusElement() {
  let el = document.getElementById('pco-credential-status');
  if (el) {
    return el;
  }
  const tokenInput = document.getElementById('pco-token');
  if (!tokenInput || !tokenInput.parentElement) {
    return null;
  }
  el = document.createElement('small');
  el.id = 'pco-credential-status';
  el.className = 'form-text text-muted mt-1';
  tokenInput.parentElement.appendChild(el);
  return el;
}

function renderPcoCredentialStatus(authMeta = {}) {
  const statusEl = ensurePcoCredentialStatusElement();
  if (!statusEl) return;
  const hasCreds = !!authMeta.has_credentials;
  statusEl.classList.remove('text-danger', 'text-success', 'text-muted');
  if (hasCreds) {
    statusEl.classList.add('text-success');
    const suffix = authMeta.credential_id ? ` (${authMeta.credential_id})` : '';
    statusEl.textContent = `Credentials stored in system keyring${suffix}. Leave token and secret blank to keep them.`;
  } else {
    statusEl.classList.add('text-muted');
    statusEl.textContent = 'Enter your Planning Center token and secret, then save to store them securely.';
  }
}

const CONFIG_TAB_DEVICES = 'devices';
const CONFIG_TAB_LOGS = 'logs';
const LOG_PAGE_SIZE = 200;
const LOG_AUTO_REFRESH_INTERVAL = 5000;
const DEFAULT_LOG_SETTINGS = {
  level: 'INFO',
  console_level: 'WARNING',
  max_bytes: 10485760,
  backups: 5,
  levels: {},
};

const logViewerState = {
  initialized: false,
  loading: false,
  autoRefresh: false,
  pollTimer: null,
  entries: [],
  filters: {
    level: '',
    sources: [],
    search: '',
  },
  nextCursor: null,
  hasMore: false,
  latestIndex: -1,
  options: {
    levels: ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
    sources: [],
  },
  settings: null,
  pending: null,
};

function logEl(id) {
  return document.getElementById(id);
}

function ensureConfigTabsInitialized() {
  const container = document.getElementById('config-tabs');
  if (!container || container.dataset.tabsBound === 'true') return;
  container.dataset.tabsBound = 'true';
  const buttons = container.querySelectorAll('[data-config-tab]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const target = btn.getAttribute('data-config-tab');
      setConfigTab(target);
    });
  });
}

function setConfigTab(tabName, options = {}) {
  const target = tabName === CONFIG_TAB_LOGS ? CONFIG_TAB_LOGS : CONFIG_TAB_DEVICES;
  micboard.configTab = target;
  if (micboard && micboard.url) {
    micboard.url.settings = target === CONFIG_TAB_LOGS ? 'logs' : 'true';
  }

  const buttons = document.querySelectorAll('[data-config-tab]');
  buttons.forEach((btn) => {
    const isActive = btn.getAttribute('data-config-tab') === target;
    btn.classList.toggle('btn-secondary', isActive);
    btn.classList.toggle('btn-outline-secondary', !isActive);
    btn.classList.toggle('active', isActive);
  });

  const devicesView = logEl('config-devices-view');
  const logsView = logEl('config-logs-view');
  if (devicesView) devicesView.classList.toggle('d-none', target !== CONFIG_TAB_DEVICES);
  if (logsView) logsView.classList.toggle('d-none', target !== CONFIG_TAB_LOGS);

  if (target === CONFIG_TAB_LOGS) {
    ensureLogViewerInitialized();
    if (options.forceReload) {
      loadLogs({ reset: true }).catch(() => {});
    }
  } else {
    stopLogAutoRefresh(true);
  }

  if (micboard.settingsMode === 'CONFIG') {
    try {
      updateHash();
    } catch (_) {}
  }
}

function ensureLogViewerInitialized() {
  if (logViewerState.initialized) return;
  const container = logEl('config-logs-view');
  if (!container) return;
  bindLogViewerHandlers();
  logViewerState.initialized = true;
  refreshLogMetadata({ initial: true }).catch((err) => {
    setLogsStatus(`Failed to load logs: ${formatError(err)}`, 'error');
  });
}

function bindLogViewerHandlers() {
  const container = logEl('config-logs-view');
  if (!container || container.dataset.logBound === 'true') return;
  container.dataset.logBound = 'true';

  const filterForm = logEl('log-filter-form');
  if (filterForm) {
    filterForm.addEventListener('submit', (event) => {
      event.preventDefault();
      updateLogFiltersFromForm();
      loadLogs({ reset: true }).catch(() => {});
    });
  }

  const refreshBtn = logEl('logs-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      updateLogFiltersFromForm();
      loadLogs({ reset: true }).catch(() => {});
    });
  }

  const loadOlderBtn = logEl('logs-load-older');
  if (loadOlderBtn) {
    loadOlderBtn.addEventListener('click', () => {
      if (!logViewerState.hasMore) return;
      loadLogs({ reset: false, newer: false }).catch(() => {});
    });
  }

  const followBtn = logEl('logs-toggle-follow');
  if (followBtn) {
    followBtn.addEventListener('click', () => {
      if (logViewerState.autoRefresh) {
        stopLogAutoRefresh();
      } else {
        startLogAutoRefresh();
      }
    });
  }

  const downloadBtn = logEl('logs-download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      downloadLogsAsJson();
    });
  }

  const purgeBtn = logEl('logs-purge');
  if (purgeBtn) {
    purgeBtn.addEventListener('click', () => {
      if (!confirm('Purge all log files? This will clear the current log and any backups.')) return;
      setLogsStatus('Purging logs…', 'info');
      fetch('api/logs/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then((response) => {
          if (!response.ok) throw new Error('Request failed (' + response.status + ')');
          return response.json();
        })
        .then((data) => {
          if (!data || data.ok !== true) {
            throw new Error((data && data.error) || 'Unable to purge logs');
          }
          stopLogAutoRefresh(true);
          setLogsStatus('Logs purged.', 'success');
          logViewerState.entries = [];
          logViewerState.nextCursor = null;
          logViewerState.hasMore = false;
          logViewerState.latestIndex = -1;
          renderLogEntries();
          updateLogControls(false);
        })
        .catch((err) => {
          setLogsStatus(`Failed to purge logs: ${formatError(err)}`, 'error');
        });
    });
  }

  const settingsForm = logEl('log-settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveLogSettings().catch(() => {});
    });
  }

  const resetButton = logEl('log-settings-reset');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      resetLogSettingsForm();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLogAutoRefresh(true);
    }
  });
}

function updateLogFiltersFromForm() {
  const levelSelect = logEl('log-level');
  logViewerState.filters.level = levelSelect ? levelSelect.value : '';

  const sourcesSelect = logEl('log-sources');
  if (sourcesSelect) {
    const selected = Array.from(sourcesSelect.selectedOptions || [])
      .map((option) => option.value)
      .filter((value) => value);
    logViewerState.filters.sources = selected;
  } else {
    logViewerState.filters.sources = [];
  }

  const searchInput = logEl('log-search');
  logViewerState.filters.search = searchInput ? searchInput.value.trim() : '';
}

async function refreshLogMetadata({ initial = false } = {}) {
  const statusLabel = initial ? 'Loading logs…' : 'Refreshing log metadata…';
  setLogsStatus(statusLabel, 'info');
  try {
    const response = await fetch('api/logs/settings?_=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Request failed (' + response.status + ')');
    }
    const data = await response.json();
    if (data && data.ok === false) {
      throw new Error(data.error || 'Unable to fetch logging metadata');
    }

    if (Array.isArray(data.levels) && data.levels.length) {
      logViewerState.options.levels = data.levels;
    }
    if (Array.isArray(data.sources)) {
      logViewerState.options.sources = data.sources;
    }

    const filters = logViewerState.filters;
    if (filters.level && !logViewerState.options.levels.includes(filters.level)) {
      filters.level = '';
    }
    filters.sources = filters.sources.filter((source) => logViewerState.options.sources.includes(source));

    logViewerState.settings = data.logging || logViewerState.settings || DEFAULT_LOG_SETTINGS;
    renderLogFilters();
    renderLogSettings();

    if (initial) {
      await loadLogs({ reset: true });
    }
  } catch (err) {
    setLogsStatus(`Failed to load log metadata: ${formatError(err)}`, 'error');
    throw err;
  }
}

function normalizeEntry(entry) {
  if (!entry) return;
  if (!entry.source) {
    if (entry.logger && typeof entry.logger === 'string') {
      entry.source = entry.logger.split('.').slice(1).join('.') || entry.logger;
    } else {
      entry.source = 'core';
    }
  }

  const idx = parseInt(entry.index != null ? entry.index : entry.cursor, 10);
  if (Number.isFinite(idx) && idx >= 0) {
    entry.index = idx;
    entry.cursor = String(idx);
  } else {
    entry.index = -1;
  }

  if (!entry.context || typeof entry.context !== 'object') {
    entry.context = entry.context ? { value: entry.context } : {};
  }
}

function renderLogFilters() {
  const levelSelect = logEl('log-level');
  if (levelSelect) {
    const current = logViewerState.filters.level;
    levelSelect.innerHTML = '';
    const anyOption = document.createElement('option');
    anyOption.value = '';
    anyOption.textContent = 'All Levels';
    levelSelect.appendChild(anyOption);
    logViewerState.options.levels.forEach((level) => {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = level;
      if (current === level) option.selected = true;
      levelSelect.appendChild(option);
    });
  }

  const sourcesSelect = logEl('log-sources');
  if (sourcesSelect) {
    const selectedSet = new Set(logViewerState.filters.sources);
    sourcesSelect.innerHTML = '';
    logViewerState.options.sources.forEach((source) => {
      const option = document.createElement('option');
      option.value = source;
      option.textContent = source;
      option.selected = selectedSet.has(source);
      sourcesSelect.appendChild(option);
    });
  }
}

function renderLogSettings() {
  const settings = Object.assign({}, DEFAULT_LOG_SETTINGS, logViewerState.settings || {});
  if (typeof settings.levels !== 'object' || settings.levels === null) {
    settings.levels = {};
  }

  const levelSelect = logEl('log-setting-level');
  if (levelSelect) {
    levelSelect.innerHTML = '';
    logViewerState.options.levels.forEach((level) => {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = level;
      if (settings.level === level) option.selected = true;
      levelSelect.appendChild(option);
    });
  }

  const consoleSelect = logEl('log-setting-console-level');
  if (consoleSelect) {
    consoleSelect.innerHTML = '';
    logViewerState.options.levels.forEach((level) => {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = level;
      if (settings.console_level === level) option.selected = true;
      consoleSelect.appendChild(option);
    });
  }

  const maxBytesInput = logEl('log-setting-max-bytes');
  if (maxBytesInput) {
    maxBytesInput.value = Number.isFinite(settings.max_bytes) ? settings.max_bytes : DEFAULT_LOG_SETTINGS.max_bytes;
  }

  const backupsInput = logEl('log-setting-backups');
  if (backupsInput) {
    backupsInput.value = Number.isFinite(settings.backups) ? settings.backups : DEFAULT_LOG_SETTINGS.backups;
  }

  const overridesBody = logEl('log-level-overrides');
  if (overridesBody) {
    overridesBody.innerHTML = '';
    logViewerState.options.sources.forEach((source) => {
      const row = document.createElement('tr');
      const sourceCell = document.createElement('td');
      sourceCell.textContent = source;
      const selectCell = document.createElement('td');
      const select = document.createElement('select');
      select.className = 'form-select form-select-sm log-level-override';
      select.dataset.overrideTarget = source;

      const inheritOption = document.createElement('option');
      inheritOption.value = '';
      inheritOption.textContent = '(inherit)';
      select.appendChild(inheritOption);

      const overrideValue = getOverrideForSource(source, settings.levels);
      logViewerState.options.levels.forEach((level) => {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = level;
        if (overrideValue === level) option.selected = true;
        select.appendChild(option);
      });

      selectCell.appendChild(select);
      row.appendChild(sourceCell);
      row.appendChild(selectCell);
      overridesBody.appendChild(row);
    });
  }
}

function getOverrideForSource(source, overrides) {
  if (!overrides) return '';
  if (Object.prototype.hasOwnProperty.call(overrides, source)) {
    return overrides[source];
  }
  const fullName = 'micboard.' + source;
  if (Object.prototype.hasOwnProperty.call(overrides, fullName)) {
    return overrides[fullName];
  }
  return '';
}

function collectLogSettingsPayload() {
  const payload = {};
  const levelSelect = logEl('log-setting-level');
  if (levelSelect && levelSelect.value) payload.level = levelSelect.value;

  const consoleSelect = logEl('log-setting-console-level');
  if (consoleSelect && consoleSelect.value) payload.console_level = consoleSelect.value;

  const maxBytesInput = logEl('log-setting-max-bytes');
  if (maxBytesInput && maxBytesInput.value) {
    const bytes = parseInt(maxBytesInput.value, 10);
    if (Number.isFinite(bytes) && bytes > 0) payload.max_bytes = bytes;
  }

  const backupsInput = logEl('log-setting-backups');
  if (backupsInput && backupsInput.value) {
    const backups = parseInt(backupsInput.value, 10);
    if (Number.isFinite(backups) && backups >= 0) payload.backups = backups;
  }

  const overrides = {};
  document.querySelectorAll('.log-level-override').forEach((select) => {
    const source = select.dataset.overrideTarget;
    const value = select.value;
    if (source && value) {
      overrides[source] = value;
    }
  });
  payload.levels = overrides;
  return payload;
}

async function saveLogSettings() {
  const payload = collectLogSettingsPayload();
  setLogSettingsStatus('Saving logging preferences…', 'info');
  try {
    const response = await fetch('api/logs/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error('Request failed (' + response.status + ')');
    }
    const data = await response.json();
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || 'Unable to update logging settings');
    }
    logViewerState.settings = data.logging || payload;
    renderLogSettings();
    setLogSettingsStatus('Logging settings updated.', 'success');
  } catch (err) {
    setLogSettingsStatus(`Failed to update logging settings: ${formatError(err)}`, 'error');
    throw err;
  }
}

function resetLogSettingsForm() {
  renderLogSettings();
  setLogSettingsStatus('Reverted to last saved settings.', 'info');
}

async function loadLogs({ reset = false, newer = false } = {}) {
  if (logViewerState.loading) {
    logViewerState.pending = {
      reset: reset || (logViewerState.pending && logViewerState.pending.reset),
      newer: newer || (logViewerState.pending && logViewerState.pending.newer),
    };
    return;
  }

  if (reset) {
    logViewerState.entries = [];
    logViewerState.nextCursor = null;
    logViewerState.hasMore = false;
    logViewerState.latestIndex = -1;
    renderLogEntries();
  }

  logViewerState.loading = true;
  updateLogControls(true);

  try {
    const params = new URLSearchParams();
    params.set('limit', String(LOG_PAGE_SIZE));
    if (logViewerState.filters.level) params.set('level', logViewerState.filters.level);
    logViewerState.filters.sources.forEach((source) => {
      params.append('source', source);
    });
    if (logViewerState.filters.search) params.set('search', logViewerState.filters.search);

    if (newer) {
      if (logViewerState.latestIndex >= 0) params.set('cursor', String(logViewerState.latestIndex));
      params.set('direction', 'asc');
      params.set('newer', 'true');
    } else {
      params.set('direction', 'desc');
      if (!reset && logViewerState.nextCursor !== null && logViewerState.nextCursor !== undefined) {
        params.set('cursor', String(logViewerState.nextCursor));
      }
    }

    const response = await fetch('api/logs?' + params.toString(), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Request failed (' + response.status + ')');
    }
    const data = await response.json();
    if (data && data.ok === false) {
      throw new Error(data.error || 'Unable to read logs');
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    entries.forEach(normalizeEntry);

    if (newer) {
      if (entries.length) {
        entries.sort((a, b) => (b.index || 0) - (a.index || 0));
        const fresh = entries.filter((entry) => (entry.index ?? -1) > logViewerState.latestIndex);
        if (fresh.length) {
          logViewerState.entries = fresh.concat(logViewerState.entries);
        }
      }
    } else if (reset) {
      logViewerState.entries = entries;
    } else {
      logViewerState.entries = logViewerState.entries.concat(entries);
    }

    logViewerState.entries.sort((a, b) => (b.index || 0) - (a.index || 0));
    logViewerState.latestIndex = logViewerState.entries.reduce((max, entry) => {
      if (entry.index != null && entry.index > max) return entry.index;
      return max;
    }, logViewerState.latestIndex);

    logViewerState.nextCursor = data && data.cursor != null ? data.cursor : null;
    logViewerState.hasMore = !!(data && data.has_more);

    renderLogEntries();

    if (entries.length) {
      setLogsStatus(`Loaded ${entries.length} log entr${entries.length === 1 ? 'y' : 'ies'}.`, 'success');
    } else if (reset) {
      setLogsStatus('No log entries matched your filters yet.', 'info');
    } else if (newer) {
      setLogsStatus('No new log entries.', 'info');
    } else {
      setLogsStatus('No more matching log entries.', 'info');
    }
  } catch (err) {
    setLogsStatus(`Failed to load logs: ${formatError(err)}`, 'error');
    throw err;
  } finally {
    logViewerState.loading = false;
    updateLogControls(false);
    if (logViewerState.pending) {
      const pending = logViewerState.pending;
      logViewerState.pending = null;
      loadLogs(pending).catch(() => {});
    }
  }
}

function renderLogEntries() {
  const tbody = logEl('log-entries');
  const emptyState = logEl('logs-empty-state');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (!logViewerState.entries.length) {
    if (emptyState) emptyState.classList.remove('d-none');
    updateLogControls(false);
    return;
  }
  if (emptyState) emptyState.classList.add('d-none');

  logViewerState.entries.forEach((entry) => {
    const row = document.createElement('tr');
    row.className = 'log-entry';
    row.dataset.level = entry.level || '';
    row.dataset.source = entry.source || '';

    const tsCell = document.createElement('td');
    if (entry.ts) {
      try {
        const dt = new Date(entry.ts);
        tsCell.textContent = dt.toLocaleString();
      } catch (_) {
        tsCell.textContent = entry.ts;
      }
    } else {
      tsCell.textContent = '—';
    }
    row.appendChild(tsCell);

    const levelCell = document.createElement('td');
    const badge = document.createElement('span');
    const levelName = (entry.level || 'INFO').toString().toUpperCase();
    badge.className = 'log-level-badge level-' + levelName.toLowerCase();
    badge.textContent = levelName;
    levelCell.appendChild(badge);
    row.appendChild(levelCell);

    const sourceCell = document.createElement('td');
    const sourcePill = document.createElement('span');
    sourcePill.className = 'log-source-pill';
    sourcePill.textContent = entry.source || entry.logger || 'core';
    sourceCell.appendChild(sourcePill);
    row.appendChild(sourceCell);

    const messageCell = document.createElement('td');
    const mainMessage = document.createElement('div');
    mainMessage.className = 'log-message';
    mainMessage.textContent = entry.message || '';
    messageCell.appendChild(mainMessage);

    if (entry.context && Object.keys(entry.context).length) {
      const details = document.createElement('details');
      details.className = 'log-context';
      const summary = document.createElement('summary');
      summary.textContent = 'Context';
      details.appendChild(summary);
      const pre = document.createElement('pre');
      try {
        pre.textContent = JSON.stringify(entry.context, null, 2);
      } catch (_) {
        pre.textContent = String(entry.context);
      }
      details.appendChild(pre);
      messageCell.appendChild(details);
    }

    if (entry.exc_info) {
      const details = document.createElement('details');
      details.className = 'log-context';
      const summary = document.createElement('summary');
      summary.textContent = 'Exception';
      details.appendChild(summary);
      const pre = document.createElement('pre');
      pre.textContent = entry.exc_info;
      details.appendChild(pre);
      messageCell.appendChild(details);
    }

    row.appendChild(messageCell);
    tbody.appendChild(row);
  });

  updateLogControls(false);
}

function setLogsStatus(message, level = 'info') {
  const statusEl = logEl('logs-status');
  if (!statusEl) return;
  statusEl.classList.remove('text-muted', 'text-success', 'text-warning', 'text-danger');
  let cls = 'text-muted';
  if (level === 'success') cls = 'text-success';
  else if (level === 'warn' || level === 'warning') cls = 'text-warning';
  else if (level === 'error') cls = 'text-danger';
  statusEl.classList.add(cls);
  statusEl.textContent = message || '';
}

function setLogSettingsStatus(message, level = 'info') {
  const statusEl = logEl('log-settings-status');
  if (!statusEl) return;
  statusEl.classList.remove('text-muted', 'text-success', 'text-warning', 'text-danger');
  let cls = 'text-muted';
  if (level === 'success') cls = 'text-success';
  else if (level === 'warn' || level === 'warning') cls = 'text-warning';
  else if (level === 'error') cls = 'text-danger';
  statusEl.classList.add(cls);
  statusEl.textContent = message || '';
}

function updateLogControls(disable) {
  const loading = disable || logViewerState.loading;
  const refreshBtn = logEl('logs-refresh');
  if (refreshBtn) refreshBtn.disabled = loading;

  const loadOlderBtn = logEl('logs-load-older');
  if (loadOlderBtn) loadOlderBtn.disabled = loading || !logViewerState.hasMore;

  const purgeBtn = logEl('logs-purge');
  if (purgeBtn) purgeBtn.disabled = loading;

  const downloadBtn = logEl('logs-download');
  if (downloadBtn) downloadBtn.disabled = !logViewerState.entries.length;

  const followBtn = logEl('logs-toggle-follow');
  if (followBtn) {
    followBtn.disabled = loading && !logViewerState.autoRefresh;
    followBtn.classList.toggle('active', logViewerState.autoRefresh);
    followBtn.textContent = logViewerState.autoRefresh ? 'Stop Live Tail' : 'Start Live Tail';
  }
}

function startLogAutoRefresh() {
  if (logViewerState.autoRefresh) return;
  logViewerState.autoRefresh = true;
  updateLogControls(false);
  loadLogs({ newer: true }).catch(() => {});
  logViewerState.pollTimer = window.setInterval(() => {
    loadLogs({ newer: true }).catch(() => {});
  }, LOG_AUTO_REFRESH_INTERVAL);
  setLogsStatus('Live tail started.', 'info');
}

function stopLogAutoRefresh(silent = false) {
  if (!logViewerState.autoRefresh) return;
  logViewerState.autoRefresh = false;
  if (logViewerState.pollTimer) {
    clearInterval(logViewerState.pollTimer);
    logViewerState.pollTimer = null;
  }
  updateLogControls(false);
  if (!silent) {
    setLogsStatus('Live tail stopped.', 'info');
  }
}

function downloadLogsAsJson() {
  if (!logViewerState.entries.length) {
    setLogsStatus('No log entries to download yet.', 'warn');
    return;
  }
  try {
    const payload = logViewerState.entries.map((entry) => {
      const copy = Object.assign({}, entry);
      return copy;
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'wirelessboard-logs-' + new Date().toISOString().replace(/[:]/g, '-') + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 0);
    setLogsStatus('Downloaded current log view.', 'success');
  } catch (err) {
    setLogsStatus(`Failed to prepare download: ${formatError(err)}`, 'error');
  }
}

if (micboard && typeof micboard === 'object') {
  micboard.stopLogAutoRefresh = stopLogAutoRefresh;
}


function showPCOView() {
  hideHUDOverlay();
  stopLogAutoRefresh(true);
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
  const eToken = document.getElementById('pco-token');
  const eSecret = document.getElementById('pco-secret');
  if (eToken) eToken.value = '';
  if (eSecret) eSecret.value = '';
  renderPcoCredentialStatus(p.auth || {});
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
  const cfgList = document.getElementById('editor_holder');
  if (!cfgList || devices.length === 0) return;

  const template = document.getElementById('config-slot-template');
  if (!template || !template.content) return;

  devices.forEach((sourceRow) => {
    const fragment = template.content.cloneNode(true);
    const targetRow = fragment.querySelector('.cfg-row');
    if (!targetRow) return;

    const copyValue = (selector) => {
      const src = sourceRow.querySelector(selector);
      const dest = targetRow.querySelector(selector);
      if (src && dest) {
        dest.value = src.value;
      }
    };

    copyValue('.cfg-type');
    copyValue('.cfg-ip');
    copyValue('.cfg-channel');
    copyValue('.cfg-device-name');
    copyValue('.cfg-name');

    cfgList.appendChild(fragment);
  });

  updateSlotID();
  updateHiddenSlots();
}

function updateHiddenSlots() {
  const cfgRows = document.querySelectorAll('#editor_holder .cfg-row');
  Array.from(cfgRows).forEach((row) => {
    const type = row.querySelector('.cfg-type').value;
    if (type === 'offline' || type === '') {
      row.querySelector('.cfg-ip').style.display = 'none';
      row.querySelector('.cfg-channel').style.display = 'none';
    } else {
      row.querySelector('.cfg-ip').style.display = 'block';
      row.querySelector('.cfg-channel').style.display = 'block';
    }
  });
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

  ensureConfigTabsInitialized();
  if (!micboard.configTab) micboard.configTab = CONFIG_TAB_DEVICES;
  setConfigTab(micboard.configTab, { forceReload: force });

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
  const elToken = document.getElementById('pco-token');
  const elSecret = document.getElementById('pco-secret');
  if (elToken) elToken.value = '';
  if (elSecret) elSecret.value = '';
  renderPcoCredentialStatus(pco.auth || {});
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
        micboard.config.pco = p;
        const elEnabled = document.getElementById('pco-enabled');
        const elToken = document.getElementById('pco-token');
        const elSecret = document.getElementById('pco-secret');
        const elStid = document.getElementById('pco-service-type-id');
        const elCat = document.getElementById('pco-note-category');
        const elTeam = document.getElementById('pco-team-filter');
        if (elEnabled) elEnabled.checked = !!p.enabled;
        if (elToken) elToken.value = '';
        if (elSecret) elSecret.value = '';
        const s = p.services || {};
        if (elStid) elStid.value = s.service_type_id || '';
        const elSt2 = document.getElementById('pco-service-type');
        if (elSt2) elSt2.value = (s.service_type || s.service_type_id || '');
        const m = p.mapping || {};
        if (elCat) elCat.value = m.note_category || 'Mic / IEM Assignments';
        if (elTeam) elTeam.value = Array.isArray(m.team_name_filter) ? m.team_name_filter.join(', ') : '';
        renderPcoCredentialStatus(p.auth || {});
        appendPcoLog('Loaded saved PCO configuration.');
        if (p.auth && p.auth.has_credentials) {
          appendPcoLog('Existing credentials detected in system keyring.');
        } else {
          appendPcoLog('No stored credentials found yet.');
        }
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
  const enabled = document.getElementById('pco-enabled')?.checked || false;
  const token = (document.getElementById('pco-token')?.value || '').trim();
  const secret = (document.getElementById('pco-secret')?.value || '').trim();
  const serviceType = (document.getElementById('pco-service-type')?.value || '').trim();
  const serviceTypeId = (document.getElementById('pco-service-type-id')?.value || '').trim();
  const noteCategory = (document.getElementById('pco-note-category')?.value || 'Mic / IEM Assignments').trim();
  const teamFilterRaw = (document.getElementById('pco-team-filter')?.value || '');
  const payload = {
    enabled,
    services: {
      plan: { select: 'next' },
    },
    mapping: {
      strategy: 'note_or_brackets',
      note_category: noteCategory,
      team_name_filter: teamFilterRaw.split(',').map(s => s.trim()).filter(s => s),
    },
  };
  if (serviceType) {
    payload.services.service_type = serviceType;
  }
  if (serviceTypeId) {
    payload.services.service_type_id = serviceTypeId;
  }
  if (token || secret) {
    payload.auth = { token, secret };
  }
  return payload;
}

function handlePcoSave() {
  const payload = buildPcoPayload();
  appendPcoLog('Saving PCO configuration...');
  postJSON('api/pco/config', payload, (resp) => {
    const statusEl = document.getElementById('pco-save-status');
    const ok = resp && resp.ok !== false;
    if (!ok) {
      const msg = (resp && resp.error) ? resp.error : 'Save failed';
      if (statusEl) {
        statusEl.classList.remove('d-none');
        statusEl.classList.remove('text-success');
        statusEl.classList.add('text-danger');
        statusEl.textContent = msg;
      }
      appendPcoLog(`PCO configuration save failed: ${msg}`, 'error');
      return;
    }

    const savedConfig = (resp && resp.pco) || {};
    micboard.config.pco = savedConfig;
    renderPcoCredentialStatus(savedConfig.auth || {});
    const tokenEl = document.getElementById('pco-token');
    const secretEl = document.getElementById('pco-secret');
    if (tokenEl) tokenEl.value = '';
    if (secretEl) secretEl.value = '';

    if (statusEl) {
      statusEl.classList.remove('text-danger');
      statusEl.classList.remove('d-none');
      statusEl.classList.add('text-success');
      statusEl.textContent = 'Saved!';
      setTimeout(() => {
        statusEl.classList.add('d-none');
      }, 1000);
    }
    appendPcoLog('PCO configuration saved.');
    if (savedConfig.auth && savedConfig.auth.has_credentials) {
      appendPcoLog('Credentials stored securely in system keyring.');
    } else {
      appendPcoLog('No credentials stored yet.');
    }
  }, (err) => {
    appendPcoLog(`PCO configuration save failed: ${formatError(err)}`, 'error');
  });
}

function handlePcoSync() {
  const summaryEl = document.getElementById('pco-sync-summary');
  const jsonEl = document.getElementById('pco-sync-json');
  const tbl = document.getElementById('pco-assignments-table');
  const enabled = document.getElementById('pco-enabled')?.checked;
  const pendingToken = (document.getElementById('pco-token')?.value || '').trim();
  const pendingSecret = (document.getElementById('pco-secret')?.value || '').trim();
  const authMeta = (micboard.config.pco && micboard.config.pco.auth) || {};
  const hasStoredCredentials = !!authMeta.has_credentials;
  if (!enabled) {
    appendPcoLog('Cannot sync with PCO: enable the integration first.', 'warn');
    if (summaryEl) summaryEl.innerHTML = '<span class="text-warning">Enable the integration, save, then sync.</span>';
    return;
  }
  if (!hasStoredCredentials) {
    const needsSave = pendingToken && pendingSecret;
    appendPcoLog('Cannot sync with PCO: store credentials and save before syncing.', 'warn');
    if (summaryEl) {
      const hint = needsSave ? 'Save your new token and secret, then try again.' : 'Enter your token and secret, save, then try again.';
      summaryEl.innerHTML = `<span class="text-warning">${hint}</span>`;
    }
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
