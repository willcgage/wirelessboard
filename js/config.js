import { Collapse } from 'bootstrap';

import { postJSON } from './data.js';

const noop = () => {};

// Bootstrap text colours for the status lines above the PCO and log panes.
// Anything unrecognised falls back to text-muted, as the old nested ternaries did.
const STATUS_CLASSES = {
  success: 'text-success',
  error: 'text-danger',
  warn: 'text-warning',
};

let resolveMicboard = () => (typeof window !== 'undefined' ? window.micboard : null);
let pendingMicboard = {};
let updateHashRef = noop;

export function configureConfigModule({ micboard, getMicboard, updateHash } = {}) {
  if (typeof getMicboard === 'function') {
    resolveMicboard = getMicboard;
  } else if (micboard) {
    resolveMicboard = () => micboard;
  }
  if (typeof updateHash === 'function') {
    updateHashRef = updateHash;
  }
}

function currentMicboard() {
  const board = resolveMicboard() || null;
  if (board && pendingMicboard) {
    Object.assign(board, pendingMicboard);
    pendingMicboard = null;
  }
  return board;
}

const micboard = new Proxy({}, {
  get(_target, prop) {
    const board = currentMicboard();
    if (board && prop in board) {
      const value = board[prop];
      if (typeof value === 'function') {
        return value.bind(board);
      }
      return value;
    }
    if (pendingMicboard && prop in pendingMicboard) {
      return pendingMicboard[prop];
    }
    return undefined;
  },
  set(_target, prop, value) {
    const board = currentMicboard();
    if (board) {
      board[prop] = value;
    } else {
      if (!pendingMicboard) pendingMicboard = {};
      pendingMicboard[prop] = value;
    }
    return true;
  },
  has(_target, prop) {
    const board = currentMicboard();
    if (board && prop in board) return true;
    return pendingMicboard ? prop in pendingMicboard : false;
  },
  ownKeys() {
    const board = currentMicboard();
    const keys = board ? Reflect.ownKeys(board) : [];
    if (pendingMicboard) {
      for (const key of Reflect.ownKeys(pendingMicboard)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return keys;
  },
  getOwnPropertyDescriptor(_target, prop) {
    const board = currentMicboard();
    if (board) {
      const descriptor = Object.getOwnPropertyDescriptor(board, prop);
      if (descriptor) {
        descriptor.configurable = true;
        return descriptor;
      }
    }
    if (pendingMicboard) {
      const descriptor = Object.getOwnPropertyDescriptor(pendingMicboard, prop);
      if (descriptor) {
        descriptor.configurable = true;
        return descriptor;
      }
    }
    return undefined;
  },
});

const BACKGROUND_DEFAULT_MODES = ['NONE', 'IMG', 'MP4'];

function normalizeBackgroundDefault(value) {
  if (typeof value !== 'string') {
    return 'NONE';
  }
  const mode = value.trim().toUpperCase();
  return BACKGROUND_DEFAULT_MODES.includes(mode) ? mode : 'NONE';
}

function syncBackgroundDefaultMode(info) {
  const mode = normalizeBackgroundDefault(info && info.default_mode);
  try {
    const currentMode = normalizeBackgroundDefault(micboard.backgroundDefaultMode);
    if (currentMode === mode) {
      return;
    }
    micboard.backgroundDefaultMode = mode;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const eventName = 'wirelessboard:background-default-mode-updated';
      const evt = (typeof window.CustomEvent === 'function')
        ? new CustomEvent(eventName, { detail: { mode } })
        : new Event(eventName);
      window.dispatchEvent(evt);
    }
  } catch (_) {}
}

function invokeUpdateHash() {
  try {
    updateHashRef();
  } catch (err) {
    console.warn('updateHash invocation failed', err);
  }
}

const NET_DEVICE_TYPES = ['axtd', 'ulxd', 'qlxd', 'uhfr', 'p10t'];

const DISCOVERY_DEFAULTS = {
  auto: true,
  subnets: [],
  scan_interval: 60,
  timeout_ms: 750,
};

const DISCOVERY_MIN_INTERVAL = 15;
const DISCOVERY_MAX_INTERVAL = 900;
const DISCOVERY_MIN_TIMEOUT = 100;
const DISCOVERY_MAX_TIMEOUT = 5000;

const discoveryFormState = {
  initialized: false,
  dirty: false,
  settings: { ...DISCOVERY_DEFAULTS },
};

function normalizeDiscoverySettingsInput(raw) {
  const normalized = { ...DISCOVERY_DEFAULTS };
  if (!raw || typeof raw !== 'object') {
    return normalized;
  }

  if (typeof raw.auto === 'boolean') {
    normalized.auto = raw.auto;
  }

  let subnets = [];
  if (Array.isArray(raw.subnets)) {
    subnets = raw.subnets;
  } else if (typeof raw.subnets === 'string') {
    subnets = raw.subnets.replace(/[,;]/g, '\n').split(/\r?\n/);
  }

  const seen = new Set();
  normalized.subnets = subnets
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });

  const interval = parseInt(raw.scan_interval, 10);
  if (Number.isFinite(interval)) {
    normalized.scan_interval = Math.min(Math.max(interval, DISCOVERY_MIN_INTERVAL), DISCOVERY_MAX_INTERVAL);
  }

  const timeout = parseInt(raw.timeout_ms, 10);
  if (Number.isFinite(timeout)) {
    normalized.timeout_ms = Math.min(Math.max(timeout, DISCOVERY_MIN_TIMEOUT), DISCOVERY_MAX_TIMEOUT);
  }

  return normalized;
}

function setDiscoveryStatus(message, level = 'info') {
  const statusEl = document.getElementById('discovery-status');
  if (!statusEl) return;

  statusEl.textContent = message || '';
  statusEl.classList.remove('text-muted', 'text-success', 'text-danger', 'text-warning', 'text-info');

  if (!message) {
    statusEl.classList.add('text-muted');
    return;
  }

  let cls = 'text-info';
  if (level === 'success') {
    cls = 'text-success';
  } else if (level === 'error') {
    cls = 'text-danger';
  } else if (level === 'warn') {
    cls = 'text-warning';
  } else if (level === 'muted') {
    cls = 'text-muted';
  }

  statusEl.classList.add(cls);
}

function renderDiscoveryEnvironmentStatus(status) {
  const alert = document.getElementById('dcid-warning');
  if (!alert) return;

  alert.classList.add('d-none');
  alert.classList.remove('alert-danger', 'alert-warning', 'alert-info', 'alert-success');
  alert.textContent = '';

  if (!status || typeof status !== 'object') {
    return;
  }

  const { loaded, message, last_error: lastError } = status;

  if (loaded) {
    if (message) {
      alert.textContent = message;
      alert.classList.add('alert-info');
      alert.classList.remove('d-none');
    }
    return;
  }

  const fallbackMessage = 'Model resolution is unavailable. Install Shure Update Utility and export dcid.json to enable richer discovery results.';
  alert.textContent = message || lastError || fallbackMessage;
  alert.classList.add('alert-warning');
  alert.classList.remove('d-none');
}

if (typeof window !== 'undefined') {
  window.addEventListener('wirelessboard:discovery-status', (event) => {
    const status = event && event.detail && typeof event.detail === 'object'
      ? event.detail.status
      : micboard.discovery_status;
    renderDiscoveryEnvironmentStatus(status);
  });
}

function ensureDiscoveryFormBindings() {
  if (discoveryFormState.initialized) return;
  const form = document.getElementById('discovery-settings-form');
  if (!form) return;

  const markDirty = () => {
    discoveryFormState.dirty = true;
    setDiscoveryStatus('Pending changes — click Save Config to apply.', 'warn');
  };

  form.querySelectorAll('input, textarea').forEach((el) => {
    const eventName = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventName, markDirty);
  });

  discoveryFormState.initialized = true;
}

function renderDiscoverySettings(rawSettings) {
  const settings = normalizeDiscoverySettingsInput(rawSettings);
  discoveryFormState.settings = settings;
  discoveryFormState.dirty = false;

  const autoInput = document.getElementById('discovery-auto');
  if (autoInput) autoInput.checked = !!settings.auto;

  const subnetsInput = document.getElementById('discovery-subnets');
  if (subnetsInput) subnetsInput.value = settings.subnets.join('\n');

  const intervalInput = document.getElementById('discovery-scan-interval');
  if (intervalInput) intervalInput.value = settings.scan_interval;

  const timeoutInput = document.getElementById('discovery-timeout');
  if (timeoutInput) timeoutInput.value = settings.timeout_ms;

  setDiscoveryStatus('', 'muted');
  renderDiscoveryEnvironmentStatus(micboard.discovery_status);
}

function collectDiscoverySettingsFromForm() {
  const form = document.getElementById('discovery-settings-form');
  if (!form) {
    return { ...discoveryFormState.settings };
  }

  const autoInput = document.getElementById('discovery-auto');
  const subnetsInput = document.getElementById('discovery-subnets');
  const intervalInput = document.getElementById('discovery-scan-interval');
  const timeoutInput = document.getElementById('discovery-timeout');

  const payload = {
    auto: autoInput ? !!autoInput.checked : DISCOVERY_DEFAULTS.auto,
    subnets: subnetsInput ? subnetsInput.value : [],
    scan_interval: intervalInput ? intervalInput.value : DISCOVERY_DEFAULTS.scan_interval,
    timeout_ms: timeoutInput ? timeoutInput.value : DISCOVERY_DEFAULTS.timeout_ms,
  };

  return normalizeDiscoverySettingsInput(payload);
}

// Render the discovered device list in the config editor
function renderDiscoveredDeviceList() {
  const discoveredList = document.getElementById('discovered_list');
  if (!discoveredList) return;
  renderDiscoveryEnvironmentStatus(micboard.discovery_status);
  discoveredList.innerHTML = '';
  const discovered = micboard.discovered || [];
  if (!Array.isArray(discovered) || discovered.length === 0) return;
  const template = document.getElementById('config-slot-template');
  if (!template || !template.content) return;

  discovered.forEach((slot) => {
    const t = template.content.cloneNode(true);
    const row = t.querySelector('.cfg-row');
    if (row) {
      row.id = `slot-${slot.slot}`;
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
    row.id = `slot-${slot}`;
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

const backgroundDirectoryState = {
  info: null,
  loading: false,
  saving: false,
};

const backgroundFilenameGuideState = {
  scheduled: false,
};

const GOOGLE_DRIVE_AUTH_MESSAGE = 'wirelessboard:drive-auth';

const googleDriveState = {
  provider: null,
  loading: false,
  saving: false,
  authWindow: null,
};

let googleDriveMessageListenerBound = false;

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
    invokeUpdateHash();
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
      if (!window.confirm('Purge all log files? This will clear the current log and any backups.')) return;
      setLogsStatus('Purging logs…', 'info');
      fetch('api/logs/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Request failed (${response.status})`);
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
    const response = await fetch(`api/logs/settings?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
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

    const { filters } = logViewerState;
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
  const settings = { ...DEFAULT_LOG_SETTINGS, ...logViewerState.settings || {} };
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
  const fullName = `micboard.${source}`;
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
    const { value } = select;
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
      throw new Error(`Request failed (${response.status})`);
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

    const response = await fetch(`api/logs?${params.toString()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
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
      const { pending } = logViewerState;
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
    badge.className = `log-level-badge level-${levelName.toLowerCase()}`;
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
      const copy = { ...entry };
      return copy;
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wirelessboard-logs-${new Date().toISOString().replace(/[:]/g, '-')}.json`;
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

function collectSlotConfiguration() {
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

function generateJSONConfig() {
  const slots = collectSlotConfiguration();
  const discovery = collectDiscoverySettingsFromForm();
  return { slots, discovery };
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
    const row = document.getElementById(`slot-${slotNum}`);
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
  return fetch(`api/slot/device-names?_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
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

    const cfgRow = document.getElementById(`slot-${slot}`);
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

/** Escape text bound for innerHTML. Team and position names come from the
 *  Planning Center API, so they are not ours to trust as markup. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function setBackgroundDirectoryStatus(message, level = 'info') {
  const statusEl = document.getElementById('background-directory-status');
  if (!statusEl) return;

  statusEl.textContent = message || '';
  statusEl.classList.remove('text-success', 'text-danger', 'text-warning', 'text-muted');

  if (!message) {
    statusEl.classList.add('text-muted');
    return;
  }

  statusEl.classList.add(STATUS_CLASSES[level] || 'text-muted');
}

function normalizeBackgroundKey(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function dispatchBackgroundLibraryUpdated() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  try {
    const event = (typeof window.CustomEvent === 'function')
      ? new CustomEvent('wirelessboard:background-library-updated')
      : new Event('wirelessboard:background-library-updated');
    window.dispatchEvent(event);
  } catch (err) {
    console.warn('Failed to dispatch background-library-updated', err);
  }
}

function currentSlotList() {
  const slots = (micboard.config && Array.isArray(micboard.config.slots)) ? micboard.config.slots : [];
  if (!Array.isArray(slots)) {
    return [];
  }
  return [...slots].sort((a, b) => {
    const aSlot = Number(a && a.slot);
    const bSlot = Number(b && b.slot);
    if (!Number.isFinite(aSlot) && !Number.isFinite(bSlot)) return 0;
    if (!Number.isFinite(aSlot)) return 1;
    if (!Number.isFinite(bSlot)) return -1;
    return aSlot - bSlot;
  });
}

function resolveDeviceName(slotNumber, slotConfig) {
  const txList = micboard && micboard.transmitters;
  let name = '';
  if (txList && typeof txList === 'object') {
    const tx = Array.isArray(txList) ? txList[slotNumber] : txList[String(slotNumber)] || txList[slotNumber];
    if (tx) {
      name = tx.name_raw || tx.name || tx.device_name || tx.device || tx.label || '';
    }
  }
  if (!name && slotConfig) {
    name = slotConfig.chan_name_raw || slotConfig.device || slotConfig.name || '';
  }
  return name || '';
}

function decorateFilenameCell(cell, filename, exists) {
  cell.textContent = '';
  cell.classList.remove('text-muted');
  if (!filename) {
    cell.textContent = '—';
    cell.classList.add('text-muted');
    return;
  }

  const filenameEl = document.createElement('span');
  filenameEl.textContent = filename;
  cell.appendChild(filenameEl);

  const statusEl = document.createElement('span');
  statusEl.className = `small ms-2 ${exists ? 'text-success' : 'text-warning'}`;
  statusEl.textContent = exists ? 'available' : 'missing';
  cell.appendChild(statusEl);
}

export function renderBackgroundFilenameGuide() {
  const table = document.getElementById('background-filename-table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const emptyNotice = document.getElementById('background-filename-empty');

  while (tbody.firstChild) {
    tbody.removeChild(tbody.firstChild);
  }

  const slots = currentSlotList();
  const hasSlots = slots.length > 0;
  let populated = false;

  const imgList = Array.isArray(micboard.img_list) ? micboard.img_list : [];
  const mp4List = Array.isArray(micboard.mp4_list) ? micboard.mp4_list : [];

  slots.forEach((slotConfig) => {
    const slotNumber = Number(slotConfig && slotConfig.slot);
    if (!Number.isFinite(slotNumber)) {
      return;
    }

    const deviceName = resolveDeviceName(slotNumber, slotConfig);
    const baseKey = normalizeBackgroundKey(deviceName);
    const imgFilename = baseKey ? `${baseKey}.jpg` : '';
    const videoFilename = baseKey ? `${baseKey}.mp4` : '';
    const hasImg = !!(imgFilename && imgList.indexOf(imgFilename) > -1);
    const hasVideo = !!(videoFilename && mp4List.indexOf(videoFilename) > -1);

    const row = document.createElement('tr');

    const slotCell = document.createElement('th');
    slotCell.scope = 'row';
    slotCell.textContent = Number.isFinite(slotNumber) ? slotNumber : '—';
    row.appendChild(slotCell);

    const nameCell = document.createElement('td');
    if (deviceName) {
      nameCell.textContent = deviceName;
    } else {
      nameCell.textContent = '—';
      nameCell.classList.add('text-muted');
    }
    row.appendChild(nameCell);

    const imgCell = document.createElement('td');
    decorateFilenameCell(imgCell, imgFilename, hasImg);
    row.appendChild(imgCell);

    const videoCell = document.createElement('td');
    decorateFilenameCell(videoCell, videoFilename, hasVideo);
    row.appendChild(videoCell);

    tbody.appendChild(row);
    populated = true;
  });

  table.classList.toggle('d-none', !hasSlots);
  if (emptyNotice) {
    emptyNotice.hidden = hasSlots;
  }

  if (!populated && hasSlots) {
    const placeholder = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'text-muted';
    cell.textContent = 'Slots are configured but no device names are available yet.';
    placeholder.appendChild(cell);
    tbody.appendChild(placeholder);
  }
}

export function scheduleBackgroundFilenameGuide() {
  if (backgroundFilenameGuideState.scheduled) {
    return;
  }
  backgroundFilenameGuideState.scheduled = true;
  const scheduleFn = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
    ? window.requestAnimationFrame.bind(window)
    : (cb) => setTimeout(cb, 16);
  scheduleFn(() => {
    backgroundFilenameGuideState.scheduled = false;
    try {
      renderBackgroundFilenameGuide();
    } catch (err) {
      console.error('Failed to render background filename guide', err);
    }
  });
}

function renderBackgroundDirectory(info) {
  const input = document.getElementById('background-directory');
  const help = document.getElementById('background-directory-help');
  const saveBtn = document.getElementById('background-directory-save');
  const resetBtn = document.getElementById('background-directory-reset');
  const defaultModeSelect = document.getElementById('background-default-mode');
  const busy = backgroundDirectoryState.loading || backgroundDirectoryState.saving;

  if (input) {
    if (info && info.source === 'config') {
      input.value = info.configured_path || info.resolved_path || '';
    } else if (info && info.source === 'cli') {
      input.value = info.resolved_path || '';
    } else if (info && info.resolved_path) {
      input.value = '';
      input.placeholder = info.default_path || info.resolved_path || '';
    } else {
      input.value = '';
    }

    const disableInput = busy || (info && info.source === 'cli');
    input.disabled = disableInput;
  }

  if (saveBtn) {
    const disableSave = busy || !info || info.source === 'cli';
    saveBtn.disabled = disableSave;
  }

  if (resetBtn) {
    const disableReset = busy || !info || info.source === 'cli' || (info && info.source === 'default');
    resetBtn.disabled = disableReset;
  }

  if (defaultModeSelect) {
    const mode = normalizeBackgroundDefault(info && info.default_mode);
    defaultModeSelect.value = mode;
    const supported = Array.isArray(info && info.supported_modes)
      ? (info.supported_modes.map((item) => normalizeBackgroundDefault(item))).filter((item, index, list) => list.indexOf(item) === index)
      : BACKGROUND_DEFAULT_MODES;
    Array.from(defaultModeSelect.options || []).forEach((option) => {
      const optionMode = normalizeBackgroundDefault(option.value);
      const allowed = supported.includes(optionMode);
      option.hidden = !allowed;
      option.disabled = !allowed;
    });
    defaultModeSelect.disabled = busy;
  }

  if (help) {
    let text = 'Background folder information unavailable.';
    if (info) {
      if (info.source === 'cli') {
        text = `Command-line override in use: ${info.resolved_path || 'unknown path'}. Update the launch parameters to change this folder.`;
      } else if (info.source === 'config') {
        text = `Using custom folder: ${info.resolved_path || 'unknown path'}.`;
      } else {
        text = `Using default folder: ${info.resolved_path || info.default_path || 'unresolved path'}.`;
      }
      if (info.exists === false) {
        text += ' The folder does not currently exist.';
      }
    }
    help.textContent = text;
  }
}

function ensureBackgroundDirectoryBindings() {
  const form = document.getElementById('background-directory-form');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.getElementById('background-directory');
      const value = input ? input.value.trim() : '';
      const useDefault = !value;
      const modeSelect = document.getElementById('background-default-mode');
      const defaultMode = modeSelect ? modeSelect.value : 'NONE';
      saveBackgroundDirectory(value, { useDefault, defaultMode }).catch(() => {});
    });
  }

  const resetBtn = document.getElementById('background-directory-reset');
  if (resetBtn && resetBtn.dataset.bound !== 'true') {
    resetBtn.dataset.bound = 'true';
    resetBtn.addEventListener('click', () => {
      const modeSelect = document.getElementById('background-default-mode');
      const defaultMode = modeSelect ? modeSelect.value : 'NONE';
      saveBackgroundDirectory('', { useDefault: true, defaultMode }).catch(() => {});
    });
  }
}

async function loadBackgroundDirectoryState({ silent = false } = {}) {
  if (backgroundDirectoryState.loading) {
    return;
  }

  backgroundDirectoryState.loading = true;
  renderBackgroundDirectory(backgroundDirectoryState.info);
  if (!silent) {
    setBackgroundDirectoryStatus('Loading background folder…', 'info');
  }

  try {
    const response = await fetch(`api/backgrounds?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    const data = await response.json();
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || 'Unable to load background folder details');
    }
    backgroundDirectoryState.info = data.backgrounds || null;
    syncBackgroundDefaultMode(backgroundDirectoryState.info);
    renderBackgroundDirectory(backgroundDirectoryState.info);
    if (!silent) {
      setBackgroundDirectoryStatus('Background folder loaded.', 'success');
    } else {
      setBackgroundDirectoryStatus('', 'info');
    }
    dispatchBackgroundLibraryUpdated();
  } catch (err) {
    renderBackgroundDirectory(backgroundDirectoryState.info);
    if (!silent) {
      setBackgroundDirectoryStatus(`Failed to load background folder: ${formatError(err)}`, 'error');
    } else {
      setBackgroundDirectoryStatus(`Failed to load background folder: ${formatError(err)}`, 'error');
    }
    throw err;
  } finally {
    backgroundDirectoryState.loading = false;
    renderBackgroundDirectory(backgroundDirectoryState.info);
  }
}

async function saveBackgroundDirectory(path, { useDefault = false, defaultMode = 'NONE' } = {}) {
  if (backgroundDirectoryState.saving) {
    return;
  }

  backgroundDirectoryState.saving = true;
  renderBackgroundDirectory(backgroundDirectoryState.info);
  const savingMessage = useDefault ? 'Reverting to the default background folder…' : 'Saving background folder…';
  setBackgroundDirectoryStatus(savingMessage, 'info');

  try {
    const normalizedPath = typeof path === 'string' ? path.trim() : '';
    const effectivePath = useDefault ? '' : normalizedPath;
    const payload = effectivePath ? { directory: effectivePath } : { use_default: true };
    payload.default_mode = normalizeBackgroundDefault(defaultMode);
    const response = await fetch('api/backgrounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    const data = await response.json();
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || 'Unable to update background folder');
    }
    backgroundDirectoryState.info = data.backgrounds || null;
    syncBackgroundDefaultMode(backgroundDirectoryState.info);
    renderBackgroundDirectory(backgroundDirectoryState.info);
    setBackgroundDirectoryStatus('Background folder updated. Refresh the board if new media does not appear automatically.', 'success');
    dispatchBackgroundLibraryUpdated();
  } catch (err) {
    setBackgroundDirectoryStatus(`Failed to update background folder: ${formatError(err)}`, 'error');
    renderBackgroundDirectory(backgroundDirectoryState.info);
    throw err;
  } finally {
    backgroundDirectoryState.saving = false;
    renderBackgroundDirectory(backgroundDirectoryState.info);
  }
}

function setGoogleDriveStatus(message, level = 'info') {
  const statusEl = document.getElementById('google-drive-status');
  if (!statusEl) return;

  statusEl.textContent = message || '';
  statusEl.classList.remove('text-success', 'text-danger', 'text-warning', 'text-muted');

  if (!message) {
    statusEl.classList.add('text-muted');
    return;
  }

  statusEl.classList.add(STATUS_CLASSES[level] || 'text-muted');
}

function formatGoogleDriveClientSummary(summary = {}) {
  if (!summary || !summary.has_configuration) {
    return 'No OAuth client uploaded yet.';
  }

  const info = summary.installed || summary.web || {};
  const parts = [];
  if (info.project_id) parts.push(`Project: ${info.project_id}`);
  if (info.client_id) parts.push(`Client ID: ${info.client_id}`);
  if (Array.isArray(info.redirect_uris) && info.redirect_uris.length) {
    parts.push(`Redirect URIs: ${info.redirect_uris.length}`);
  }
  if (Array.isArray(info.javascript_origins) && info.javascript_origins.length) {
    parts.push(`Origins: ${info.javascript_origins.length}`);
  }

  return parts.length ? parts.join('\n') : 'OAuth client is present.';
}

function updateGoogleDriveControlState() {
  const busy = googleDriveState.loading || googleDriveState.saving;
  const provider = googleDriveState.provider || {};
  const hasClient = !!(provider.client && provider.client.has_configuration);
  const hasAuth = !!(provider.auth && provider.auth.has_credentials);

  const enabledInput = document.getElementById('google-drive-enabled');
  if (enabledInput) {
    enabledInput.disabled = googleDriveState.loading && !provider;
    enabledInput.checked = !!provider.enabled;
  }

  const fileInput = document.getElementById('google-drive-client-file');
  if (fileInput) fileInput.disabled = busy;

  const clearClientBtn = document.getElementById('google-drive-client-clear');
  if (clearClientBtn) clearClientBtn.disabled = busy || !hasClient;

  const refreshBtn = document.getElementById('google-drive-refresh');
  if (refreshBtn) refreshBtn.disabled = busy;

  const authStartBtn = document.getElementById('google-drive-auth-start');
  if (authStartBtn) authStartBtn.disabled = busy || !hasClient;

  const authClearBtn = document.getElementById('google-drive-auth-clear');
  if (authClearBtn) authClearBtn.disabled = busy || !hasAuth;

  const authRefreshBtn = document.getElementById('google-drive-auth-refresh');
  if (authRefreshBtn) authRefreshBtn.disabled = busy;
}

function renderGoogleDriveSettings(provider = {}) {
  googleDriveState.provider = provider;

  const summaryEl = document.getElementById('google-drive-client-summary');
  if (summaryEl) {
    summaryEl.textContent = formatGoogleDriveClientSummary(provider.client);
  }

  const authStatusEl = document.getElementById('google-drive-auth-status');
  if (authStatusEl) {
    authStatusEl.classList.remove('text-success', 'text-warning', 'text-danger', 'text-muted');
    if (provider.auth && provider.auth.has_credentials) {
      authStatusEl.classList.add('text-success');
      const updated = provider.auth.updated_at ? new Date(provider.auth.updated_at).toLocaleString() : null;
      authStatusEl.textContent = updated
        ? `Authorized · updated ${updated}`
        : 'Authorized for Google Drive access.';
    } else {
      authStatusEl.classList.add('text-warning');
      authStatusEl.textContent = 'Not authorized yet. Start the Google sign-in flow to grant access.';
    }
  }

  updateGoogleDriveControlState();
}

function ensureGoogleDriveMessageBinding() {
  if (googleDriveMessageListenerBound) return;
  googleDriveMessageListenerBound = true;
  window.addEventListener('message', handleGoogleDriveAuthMessage);
}

function handleGoogleDriveAuthMessage(event) {
  if (!event || !event.data || event.origin !== window.location.origin) {
    return;
  }

  const payload = event.data;
  if (payload.type !== GOOGLE_DRIVE_AUTH_MESSAGE) {
    return;
  }

  if (googleDriveState.authWindow && !googleDriveState.authWindow.closed) {
    try { googleDriveState.authWindow.close(); } catch (_) {}
  }
  googleDriveState.authWindow = null;

  if (payload.ok) {
    setGoogleDriveStatus('Google Drive access granted.', 'success');
  } else {
    const message = payload.error || 'Google Drive authorization failed.';
    setGoogleDriveStatus(message, 'error');
  }

  loadGoogleDriveState({ silent: true }).catch(() => {});
}

async function loadGoogleDriveState({ silent = false } = {}) {
  if (googleDriveState.loading) {
    return;
  }

  googleDriveState.loading = true;
  updateGoogleDriveControlState();
  if (!silent) {
    setGoogleDriveStatus('Loading Google Drive settings…', 'info');
  }

  try {
    const response = await fetch(`api/cloud/google-drive/config?_=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      throw new Error(message);
    }
    renderGoogleDriveSettings(data.drive || {});
    if (!silent) {
      setGoogleDriveStatus('Google Drive settings loaded.', 'success');
    }
  } catch (err) {
    setGoogleDriveStatus(`Failed to load Google Drive settings: ${formatError(err)}`, 'error');
    throw err;
  } finally {
    googleDriveState.loading = false;
    updateGoogleDriveControlState();
  }
}

async function updateGoogleDriveSettings(payload, { successMessage } = {}) {
  googleDriveState.saving = true;
  updateGoogleDriveControlState();
  setGoogleDriveStatus('Saving Google Drive settings…', 'info');

  try {
    const response = await fetch('api/cloud/google-drive/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      throw new Error(message);
    }

    renderGoogleDriveSettings(data.drive || {});
    setGoogleDriveStatus(successMessage || 'Google Drive settings saved.', 'success');
  } catch (err) {
    setGoogleDriveStatus(`Failed to update Google Drive settings: ${formatError(err)}`, 'error');
    throw err;
  } finally {
    googleDriveState.saving = false;
    updateGoogleDriveControlState();
  }
}

async function handleGoogleDriveClientFile(event) {
  const input = event.target;
  const file = input && input.files && input.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    await updateGoogleDriveSettings({ client: parsed }, { successMessage: 'OAuth client uploaded.' });
  } catch (err) {
    setGoogleDriveStatus(`Failed to upload OAuth client: ${formatError(err)}`, 'error');
    throw err;
  } finally {
    try { if (input) input.value = ''; } catch (_) {}
  }
}

async function removeGoogleDriveClient() {
  try {
    await updateGoogleDriveSettings({ client: null }, { successMessage: 'OAuth client removed.' });
  } catch (err) {
    // status already handled inside updateGoogleDriveSettings
  }
}

async function startGoogleDriveAuthorization() {
  if (googleDriveState.saving) return;
  ensureGoogleDriveMessageBinding();

  googleDriveState.saving = true;
  updateGoogleDriveControlState();
  setGoogleDriveStatus('Starting Google authorization…', 'info');

  const redirectUri = `${window.location.origin}/oauth/google-drive`;

  try {
    const response = await fetch('api/cloud/google-drive/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uri: redirectUri }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      throw new Error(message);
    }

    const authUrl = data.flow && data.flow.authorization_url;
    if (!authUrl) {
      throw new Error('Authorization URL missing from response.');
    }

    const popup = window.open(authUrl, 'wirelessboard-google-drive', 'width=520,height=720');
    if (!popup) {
      throw new Error('Popup blocked. Allow popups for this site and try again.');
    }

    googleDriveState.authWindow = popup;
    try { popup.focus(); } catch (_) {}
    setGoogleDriveStatus('Complete the Google window to finish sign-in.', 'info');
  } catch (err) {
    setGoogleDriveStatus(`Failed to start Google authorization: ${formatError(err)}`, 'error');
    throw err;
  } finally {
    googleDriveState.saving = false;
    updateGoogleDriveControlState();
  }
}

async function clearGoogleDriveCredentials() {
  if (googleDriveState.saving) return;

  googleDriveState.saving = true;
  updateGoogleDriveControlState();
  setGoogleDriveStatus('Removing Google Drive credentials…', 'info');

  try {
    const response = await fetch('api/cloud/google-drive/auth/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      throw new Error(message);
    }

    await loadGoogleDriveState({ silent: true });
    setGoogleDriveStatus('Google Drive credentials removed.', 'success');
  } catch (err) {
    setGoogleDriveStatus(`Failed to remove Google Drive credentials: ${formatError(err)}`, 'error');
    throw err;
  } finally {
    googleDriveState.saving = false;
    updateGoogleDriveControlState();
  }
}

function ensureGoogleDriveBindings() {
  const container = document.getElementById('cloud-google-drive');
  if (!container || container.dataset.bound === 'true') return;
  container.dataset.bound = 'true';

  ensureGoogleDriveMessageBinding();

  const enabledInput = document.getElementById('google-drive-enabled');
  if (enabledInput) {
    enabledInput.addEventListener('change', () => {
      updateGoogleDriveSettings({ enabled: !!enabledInput.checked }, { successMessage: 'Google Drive provider updated.' })
        .catch(() => { loadGoogleDriveState({ silent: true }).catch(() => {}); });
    });
  }

  const fileInput = document.getElementById('google-drive-client-file');
  if (fileInput) {
    fileInput.addEventListener('change', (event) => {
      handleGoogleDriveClientFile(event).catch(() => {});
    });
  }

  const clearClientBtn = document.getElementById('google-drive-client-clear');
  if (clearClientBtn) {
    clearClientBtn.addEventListener('click', () => {
      removeGoogleDriveClient().catch(() => {});
    });
  }

  const refreshBtn = document.getElementById('google-drive-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadGoogleDriveState().catch(() => {});
    });
  }

  const authStartBtn = document.getElementById('google-drive-auth-start');
  if (authStartBtn) {
    authStartBtn.addEventListener('click', () => {
      startGoogleDriveAuthorization().catch(() => {});
    });
  }

  const authClearBtn = document.getElementById('google-drive-auth-clear');
  if (authClearBtn) {
    authClearBtn.addEventListener('click', () => {
      clearGoogleDriveCredentials().catch(() => {});
    });
  }

  const authRefreshBtn = document.getElementById('google-drive-auth-refresh');
  if (authRefreshBtn) {
    authRefreshBtn.addEventListener('click', () => {
      loadGoogleDriveState().catch(() => {});
    });
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
  micboard.url.background = undefined;
  const pcoNavBtn = document.getElementById('go-pco');
  if (pcoNavBtn) pcoNavBtn.setAttribute('aria-expanded', 'false');
  invokeUpdateHash();
  try { initConfigEditor(true); } catch (_) {}
}

export function initConfigEditor(force = false) {
  if (micboard && typeof micboard === 'object') {
    micboard.stopLogAutoRefresh = stopLogAutoRefresh;
  }
  if (!force && micboard.settingsMode === 'CONFIG') {
    return;
  }

  hideHUDOverlay();
  micboard.settingsMode = 'CONFIG';
  micboard.url.background = undefined;
  invokeUpdateHash();
  const mb = document.getElementById('micboard');
  if (mb) mb.style.display = '';
  const pcoView = document.getElementById('pco-settings');
  if (pcoView) pcoView.style.display = 'none';
  const settings = document.querySelector('.settings');
  if (settings) settings.style.display = 'block';

  ensureConfigTabsInitialized();
  if (!micboard.configTab) micboard.configTab = CONFIG_TAB_DEVICES;
  setConfigTab(micboard.configTab, { forceReload: force });

  ensureBackgroundDirectoryBindings();
  if (force || !backgroundDirectoryState.info) {
    loadBackgroundDirectoryState({ silent: true });
  } else {
    renderBackgroundDirectory(backgroundDirectoryState.info);
  }

  ensureGoogleDriveBindings();
  loadGoogleDriveState({ silent: true }).catch(() => {});

  // Render slot list (replacement for missing renderSlotList)
  const holder = document.getElementById('editor_holder');
  if (holder) {
    holder.innerHTML = '';
    const slots = (micboard.config && micboard.config.slots) || [];
    if (Array.isArray(slots) && slots.length > 0) {
      slots.forEach((slot) => {
        const t = document.getElementById('config-slot-template').content.cloneNode(true);
        const row = t.querySelector('.cfg-row');
        if (row) {
          // Set slot number as id for later reference
          row.id = `slot-${slot.slot}`;
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

  ensureDiscoveryFormBindings();
  const discoveryConfig = (micboard.config && micboard.config.discovery) || discoveryFormState.settings;
  renderDiscoverySettings(discoveryConfig);

  updateHiddenSlots();
  setDeviceNameStatus('');
  // Delegate cfg-type change so newly added rows are handled
  holder?.addEventListener('change', (ev) => {
    if (ev.target && ev.target.classList && ev.target.classList.contains('cfg-type')) {
      updateHiddenSlots();
    }
  });

  const clearIds = document.getElementById('clear-id');
  if (clearIds) {
    clearIds.addEventListener('click', () => {
      const rows = document.querySelectorAll('#editor_holder .cfg-row');
      Array.from(rows).forEach((r) => {
        const idInput = r.querySelector('.cfg-ip');
        if (idInput) idInput.value = '';
      });
    });
  }

  const clearNameButtons = document.querySelectorAll('#clear-name');
  if (clearNameButtons && clearNameButtons.length) {
    clearNameButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const extendedInputs = document.querySelectorAll('#editor_holder .cfg-name');
        Array.from(extendedInputs).forEach((input) => { input.value = ''; });
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
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
        .then((r) => r.json())
        .then((resp) => {
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
        .catch((err) => {
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
        .catch((err) => {
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
  applyPcoMappingToForm(pco.mapping);

  const addDisc = document.getElementById('add-discovered');
  if (addDisc) {
    addDisc.addEventListener('click', () => {
      addAllDiscoveredDevices();
    });
  }

  const saveBtn = document.getElementById('save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const data = generateJSONConfig();
      const url = 'api/config';
      setDiscoveryStatus('Saving discovery settings…', 'info');
      postJSON(url, data, (resp) => {
        if (resp && typeof resp === 'object') {
          if (!micboard.config) micboard.config = {};
          if (resp.config && typeof resp.config === 'object') {
            micboard.config = resp.config;
          }
          if (resp.discovery && typeof resp.discovery === 'object') {
            micboard.config.discovery = resp.discovery;
          }
          if (resp.discovery_status && typeof resp.discovery_status === 'object') {
            micboard.discovery_status = resp.discovery_status;
          }
        }
        setDiscoveryStatus('Discovery settings saved. Reloading…', 'success');
        renderDiscoveryEnvironmentStatus(micboard.discovery_status);
        micboard.settingsMode = 'NONE';
        invokeUpdateHash();
        window.location.reload();
      }, (err) => {
        setDiscoveryStatus(`Failed to save discovery settings: ${formatError(err)}`, 'error');
      });
    });
  }

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
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const cfg_list = document.querySelectorAll('#editor_holder .cfg-row');
      Array.from(cfg_list).forEach((e) => e.remove());
      let t;
      for (let i = 0; i < 4; i += 1) {
        t = document.getElementById('config-slot-template').content.cloneNode(true);
        document.getElementById('editor_holder').append(t);
      }
      updateSlotID();
      updateHiddenSlots();
      renderDiscoveredDeviceList();
    });
  }

  const addRowBtn = document.getElementById('add-config-row');
  if (addRowBtn) {
    addRowBtn.addEventListener('click', () => {
      const t = document.getElementById('config-slot-template').content.cloneNode(true);
      document.getElementById('editor_holder').append(t);
      updateSlotID();
      updateHiddenSlots();
    });
  }
}

// PCO dedicated view helpers and bindings
function populatePCOFormFromServer() {
  try {
    appendPcoLog('Fetching saved PCO configuration...');
    fetch(`api/pco/config?_=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((cfg) => {
        const p = (cfg && cfg.pco) || {};
        micboard.config.pco = p;
        const elEnabled = document.getElementById('pco-enabled');
        const elToken = document.getElementById('pco-token');
        const elSecret = document.getElementById('pco-secret');
        const elStid = document.getElementById('pco-service-type-id');
        if (elEnabled) elEnabled.checked = !!p.enabled;
        if (elToken) elToken.value = '';
        if (elSecret) elSecret.value = '';
        const s = p.services || {};
        if (elStid) elStid.value = s.service_type_id || '';
        const elSt2 = document.getElementById('pco-service-type');
        if (elSt2) elSt2.value = (s.service_type || s.service_type_id || '');
        applyPcoMappingToForm(p.mapping);
        ensureNotePreviewUI();
        renderPcoCredentialStatus(p.auth || {});
        appendPcoLog('Loaded saved PCO configuration.');
        if (p.auth && p.auth.has_credentials) {
          appendPcoLog('Existing credentials detected in system keyring.');
        } else {
          appendPcoLog('No stored credentials found yet.');
        }
        refreshPlansList({ auto: true });
      })
      .catch((err) => {
        appendPcoLog(`Failed to load saved PCO configuration: ${formatError(err)}`, 'warn');
      });
  } catch (e) { /* ignore */ }
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

// Planning Center carries the mic name and number on the team position, so the
// position is the default source and the note category is only a fallback.
const DEFAULT_PCO_STRATEGY = 'position_or_note';

function applyPcoMappingToForm(mapping) {
  const m = mapping || {};
  const elCat = document.getElementById('pco-note-category');
  const elSource = document.getElementById('pco-note-source');
  const elTeam = document.getElementById('pco-team-filter');
  const elStrategy = document.getElementById('pco-strategy');
  const elNumberFallback = document.getElementById('pco-number-fallback');
  const elSeed = document.getElementById('pco-seed-extended-id');

  if (elCat) elCat.value = m.note_category || 'Mic / IEM Assignments';
  if (elSource) elSource.value = m.note_source || 'person';
  if (elTeam) elTeam.value = Array.isArray(m.team_name_filter) ? m.team_name_filter.join(', ') : '';
  if (elStrategy) elStrategy.value = m.strategy || DEFAULT_PCO_STRATEGY;
  if (elNumberFallback) elNumberFallback.checked = m.position_number_fallback === true;
  if (elSeed) elSeed.checked = m.seed_extended_id === true;
  renderPcoTeamChoices(null);
}

// -- Team chooser -----------------------------------------------------------
// The saved filter is a list of names matched case-insensitively as substrings.
// Typing them by hand meant a team was one "&"-vs-"and" away from silently
// matching nothing, so the names come from the plan itself and the hidden
// #pco-team-filter input stays the single source of truth for the payload.

function currentTeamFilter() {
  const raw = document.getElementById('pco-team-filter')?.value || '';
  return raw.split(',').map((s) => s.trim()).filter((s) => s);
}

function syncTeamFilterFromChoices() {
  const host = document.getElementById('pco-team-choices');
  const hidden = document.getElementById('pco-team-filter');
  if (!host || !hidden) return;
  const boxes = Array.from(host.querySelectorAll('input[type="checkbox"][data-team]'));
  if (!boxes.length) return;
  hidden.value = boxes.filter((b) => b.checked).map((b) => b.dataset.team).join(', ');
}

/**
 * Render the team list. Pass the /api/pco/teams payload, or null to fall back
 * to whatever names are already saved -- the panel opens before a plan is
 * chosen, and an existing filter should still be visible then.
 */
function renderPcoTeamChoices(teams) {
  const host = document.getElementById('pco-team-choices');
  if (!host) return;

  if (!Array.isArray(teams)) {
    const saved = currentTeamFilter();
    host.innerHTML = saved.length
      ? `<div class="small text-muted mb-1">Saved filter (choose a plan to edit):</div>${
        saved.map((n) => `<div class="pco-team-row">• ${escapeHtml(n)}</div>`).join('')}`
      : '<span class="text-muted small">Choose a plan above to list its teams.</span>';
    return;
  }

  if (!teams.length) {
    host.innerHTML = '<span class="text-warning small">This plan has nobody scheduled.</span>';
    return;
  }

  host.innerHTML = teams.map((t, i) => {
    const id = `pco-team-cb-${i}`;
    const positions = (t.positions || []).join(', ');
    return `<div class="form-check pco-team-row">
      <input class="form-check-input" type="checkbox" id="${id}"
             data-team="${escapeHtml(t.name)}"${t.selected ? ' checked' : ''}>
      <label class="form-check-label" for="${id}" title="${escapeHtml(positions)}">
        ${escapeHtml(t.name)}
        <span class="pco-team-meta">— ${t.people} ${t.people === 1 ? 'person' : 'people'}</span>
      </label>
    </div>`;
  }).join('');

  // No boxes ticked means no filter, which lets every team through -- including
  // camera and production crew competing for microphone slots. Say so.
  syncTeamFilterFromChoices();
}

function loadPcoTeams() {
  const host = document.getElementById('pco-team-choices');
  const planId = document.getElementById('pco-plan-select')?.value || '';
  const serviceId = document.getElementById('pco-service-type-id')?.value || '';
  if (!host) return;
  if (!planId) {
    renderPcoTeamChoices(null);
    return;
  }

  host.innerHTML = '<span class="text-muted small">Loading teams…</span>';
  const q = `plan=${encodeURIComponent(planId)}${serviceId ? `&service=${encodeURIComponent(serviceId)}` : ''}`;
  fetch(`api/pco/teams?${q}&_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to load teams');
      renderPcoTeamChoices(resp.teams || []);
      appendPcoLog(`Found ${(resp.teams || []).length} team(s) on the selected plan.`);
    })
    .catch((err) => {
      host.innerHTML = `<span class="text-danger small">${formatError(err)}</span>`;
      appendPcoLog(`Failed to load teams: ${formatError(err)}`, 'error');
    });
}

function loadPcoServiceTypes() {
  const sel = document.getElementById('pco-service-type-id');
  if (!sel) return;
  const saved = sel.value || '';
  fetch(`api/pco/services?_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to load service types');
      const services = resp.services || [];
      sel.innerHTML = '<option value="">All service types</option>';
      services.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id || '';
        opt.textContent = s.name || `Service ${s.id}`;
        sel.appendChild(opt);
      });
      if (saved) sel.value = saved;
      appendPcoLog(`Fetched ${services.length} service type(s).`);
    })
    .catch((err) => {
      appendPcoLog(`Failed to fetch service types: ${formatError(err)}`, 'error');
    });
}

function buildPcoPayload() {
  const enabled = document.getElementById('pco-enabled')?.checked || false;
  const token = (document.getElementById('pco-token')?.value || '').trim();
  const secret = (document.getElementById('pco-secret')?.value || '').trim();
  const serviceType = (document.getElementById('pco-service-type')?.value || '').trim();
  const serviceTypeId = (document.getElementById('pco-service-type-id')?.value || '').trim();
  const noteCategory = (document.getElementById('pco-note-category')?.value || 'Mic / IEM Assignments').trim();
  const noteSource = (document.getElementById('pco-note-source')?.value || 'person').trim() || 'person';
  const teamFilterRaw = (document.getElementById('pco-team-filter')?.value || '');
  const strategy = (document.getElementById('pco-strategy')?.value || '').trim() || DEFAULT_PCO_STRATEGY;
  const numberFallbackEl = document.getElementById('pco-number-fallback');
  const seedExtendedIdEl = document.getElementById('pco-seed-extended-id');
  const payload = {
    enabled,
    services: {
      plan: { select: 'next' },
    },
    mapping: {
      strategy,
      note_category: noteCategory,
      note_source: noteSource,
      team_name_filter: teamFilterRaw.split(',').map((s) => s.trim()).filter((s) => s),
      position_number_fallback: numberFallbackEl ? !!numberFallbackEl.checked : false,
      seed_extended_id: seedExtendedIdEl ? !!seedExtendedIdEl.checked : false,
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

function ensureNotePreviewUI() {
  const input = document.getElementById('pco-note-category');
  if (!input) return;

  const sourceSelect = document.getElementById('pco-note-source');
  if (!sourceSelect) {
    const select = document.createElement('select');
    select.id = 'pco-note-source';
    select.className = 'form-select form-select-sm mt-2 mt-md-0';
    ['person', 'plan'].forEach((val) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val === 'person' ? 'People notes' : 'Plan notes';
      select.appendChild(opt);
    });
    // Try to place next to the note category input if wrapped in a flex container
    if (input.parentElement && input.parentElement.classList.contains('pco-note-row')) {
      input.parentElement.appendChild(select);
    } else if (input.parentElement) {
      input.parentElement.appendChild(select);
    } else {
      input.insertAdjacentElement('afterend', select);
    }
  }

  let btn = document.getElementById('pco-note-preview');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pco-note-preview';
    btn.className = 'btn btn-outline-secondary btn-sm ms-2 mt-2 mt-md-0';
    btn.textContent = 'Fetch Notes';
    if (input.parentElement) {
      input.parentElement.appendChild(btn);
    } else {
      input.insertAdjacentElement('afterend', btn);
    }
  }

  let result = document.getElementById('pco-note-preview-results');
  if (!result) {
    result = document.createElement('div');
    result.id = 'pco-note-preview-results';
    result.className = 'small text-muted mt-2';
    const parent = input.parentElement;
    if (parent && parent.parentElement) {
      parent.parentElement.insertBefore(result, parent.nextSibling);
    } else if (parent) {
      parent.appendChild(result);
    } else {
      input.insertAdjacentElement('afterend', result);
    }
  }
}

function renderNotePreviewResults(target, notes, planId, catName) {
  if (!target) return;
  target.innerHTML = '';

  const summary = document.createElement('div');
  summary.textContent = `Plan ${planId || '-'} — ${notes.length} note${notes.length === 1 ? '' : 's'} for "${catName}"`;
  target.appendChild(summary);

  if (!notes.length) {
    return;
  }

  const table = document.createElement('table');
  table.className = 'table table-sm table-striped mt-1';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Ext ID', 'Person', 'Team', 'Position', 'Note'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  notes.forEach((n) => {
    const tr = document.createElement('tr');
    ['ext_id', 'person', 'team', 'position', 'note'].forEach((key) => {
      const td = document.createElement('td');
      td.textContent = (n && n[key]) ? n[key] : '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  target.appendChild(table);
}

function handleNotePreview() {
  ensureNotePreviewUI();
  const catEl = document.getElementById('pco-note-category');
  const cat = (catEl?.value || 'Mic / IEM Assignments').trim();
  const sourceEl = document.getElementById('pco-note-source');
  const source = (sourceEl?.value || 'person').trim() || 'person';
  const planSel = document.getElementById('pco-plan-select');
  const planId = planSel ? (planSel.value || '') : '';
  const resultEl = document.getElementById('pco-note-preview-results');
  const btn = document.getElementById('pco-note-preview');

  if (!planId) {
    if (resultEl) resultEl.innerHTML = '<span class="text-warning">Select a plan, then fetch notes.</span>';
    appendPcoLog('Select a plan before fetching notes.', 'warn');
    return;
  }

  if (btn) btn.disabled = true;
  if (resultEl) resultEl.innerHTML = '<span class="text-muted">Loading notes...</span>';
  appendPcoLog(`Fetching ${source === 'plan' ? 'plan' : 'people'} notes for "${cat}"...`);

  fetch(`api/pco/notes?plan=${encodeURIComponent(planId)}&source=${encodeURIComponent(source)}&_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to fetch notes');
      const catName = resp.note_category || cat;
      const respSource = resp.note_source || source;
      const notes = Array.isArray(resp.notes) ? resp.notes : [];
      if (notes.length === 0 && resultEl) {
        resultEl.innerHTML = `<span class="text-warning">No ${respSource === 'plan' ? 'plan' : 'people'} notes found for "${catName}".</span>`;
      } else {
        renderNotePreviewResults(resultEl, notes, resp.plan_id || planId, `${catName} (${respSource === 'plan' ? 'Plan' : 'People'})`);
      }
      appendPcoLog(`Fetched ${notes.length} ${respSource === 'plan' ? 'plan' : 'people'} note(s) for "${catName}" (plan ${resp.plan_id || planId}).`);
    })
    .catch((err) => {
      if (resultEl) resultEl.innerHTML = `<span class="text-danger">${formatError(err)}</span>`;
      appendPcoLog(`Failed to fetch notes: ${formatError(err)}`, 'error');
    })
    .finally(() => {
      if (btn) btn.disabled = false;
    });
}

if (typeof window !== 'undefined') {
  window.addEventListener('wirelessboard:background-view-opened', () => {
    try { ensureBackgroundDirectoryBindings(); } catch (_) {}
    try { loadBackgroundDirectoryState({ silent: true }); } catch (_) {}
    try { ensureGoogleDriveBindings(); } catch (_) {}
    try { loadGoogleDriveState({ silent: true }); } catch (_) {}
    try { scheduleBackgroundFilenameGuide(); } catch (_) {}
  });

  window.addEventListener('wirelessboard:slot-name-updated', () => {
    try { scheduleBackgroundFilenameGuide(); } catch (_) {}
  });

  window.addEventListener('wirelessboard:background-library-updated', () => {
    try { scheduleBackgroundFilenameGuide(); } catch (_) {}
  });
}

function showPCOView() {
  hideHUDOverlay();
  stopLogAutoRefresh(true);
  micboard.settingsMode = 'PCO';
  micboard.url.background = undefined;
  const bgNavBtn = document.getElementById('go-background');
  if (bgNavBtn) bgNavBtn.setAttribute('aria-expanded', 'false');
  const pcoNavBtn = document.getElementById('go-pco');
  if (pcoNavBtn) pcoNavBtn.setAttribute('aria-expanded', 'true');
  invokeUpdateHash();
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
  ensureNotePreviewUI();
  populatePCOFormFromServer();
  const planSel = document.getElementById('pco-plan-select');
  if (planSel) planSel.innerHTML = '<option value="">Select a plan...</option>';
  const loadBtn = document.getElementById('pco-load-people');
  if (loadBtn) loadBtn.disabled = true;
  // Step 2 needs the service type list before it is any use.
  loadPcoServiceTypes();
  renderPcoTeamChoices(null);
  appendPcoLog('Opened PCO settings view');
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

function describeSlotMatch(slot) {
  if (!slot) return '';
  const bits = [`slot ${slot.slot}`];
  if (slot.kind) bits.push(slot.kind === 'iem' ? 'IEM' : 'mic');
  else if (slot.type) bits.push(slot.type);
  if (slot.extended_id) bits.push(`“${slot.extended_id}”`);
  return bits.join(' · ');
}

const MATCH_SOURCE_LABELS = {
  position: 'team position',
  note: 'note category',
  bracket: '[ID] in name',
};

function renderSyncAssignments(details) {
  const tbl = document.getElementById('pco-assignments-table');
  const tbody = document.querySelector('#pco-assignments-table tbody');
  if (!tbl || !tbody) return;
  tbody.innerHTML = '';

  const headRow = document.querySelector('#pco-assignments-table thead tr');
  if (headRow) {
    headRow.innerHTML = '<th>Position</th><th>Person</th><th>Team</th><th>Slots</th><th>Matched by</th>';
  }

  details.forEach((item) => {
    const tr = document.createElement('tr');
    const slots = Array.isArray(item.slots) ? item.slots : [];
    const cells = [
      item.position || item.id || '',
      item.name || '',
      item.team || '',
      slots.map(describeSlotMatch).join(', '),
      MATCH_SOURCE_LABELS[item.matched_via] || item.matched_via || '',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  tbl.style.display = details.length ? 'block' : 'none';
}

function renderSyncConflicts(conflicts) {
  const target = document.getElementById('pco-conflicts');
  if (!target) return;
  target.innerHTML = '';
  if (!Array.isArray(conflicts) || !conflicts.length) return;

  const heading = document.createElement('div');
  heading.className = 'text-danger';
  heading.textContent = `${conflicts.length} slot${conflicts.length === 1 ? '' : 's'} claimed by more than one person:`;
  target.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'mb-0';
  conflicts.forEach((c) => {
    const names = (c.claimants || []).map((x) => x.name).filter(Boolean);
    const li = document.createElement('li');
    li.textContent = `slot ${c.slot}: ${names.join(', ')} — “${c.winner}” wins`;
    list.appendChild(li);
  });
  target.appendChild(list);
}

function renderSyncUnmatched(unmatched) {
  const target = document.getElementById('pco-unmatched');
  if (!target) return;
  target.innerHTML = '';
  if (!Array.isArray(unmatched) || !unmatched.length) return;

  const heading = document.createElement('div');
  heading.className = 'text-warning';
  heading.textContent = `${unmatched.length} scheduled ${unmatched.length === 1 ? 'person' : 'people'} had no matching slot:`;
  target.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'mb-0';
  unmatched.forEach((entry) => {
    const li = document.createElement('li');
    const label = entry.position || entry.note || entry.name || '?';
    li.textContent = entry.name ? `${label} — ${entry.name}` : label;
    list.appendChild(li);
  });
  target.appendChild(list);

  const hint = document.createElement('div');
  hint.className = 'text-muted mt-1';
  hint.textContent = 'Give those slots a matching Extended ID in the Config view, or enable number matching.';
  target.appendChild(hint);
}

function handlePcoSync(dryRun = false) {
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
  const unmatchedEl = document.getElementById('pco-unmatched');
  if (unmatchedEl) unmatchedEl.innerHTML = '';
  const conflictsEl = document.getElementById('pco-conflicts');
  if (conflictsEl) conflictsEl.innerHTML = '';

  const planSel = document.getElementById('pco-plan-select');
  const selectedPlan = planSel ? (planSel.value || '') : '';
  const endpoint = dryRun ? 'api/pco/preview' : 'api/pco/sync';
  const url = selectedPlan ? `${endpoint}?plan=${encodeURIComponent(selectedPlan)}` : endpoint;
  const verb = dryRun ? 'Previewing' : 'Syncing';
  appendPcoLog(`${verb} assignments with PCO ${selectedPlan ? `(plan ${selectedPlan})` : '(auto plan)'}...`);

  fetch(url, { method: 'POST' })
    .then((r) => r.json())
    .then((resp) => {
      if (jsonEl) jsonEl.textContent = JSON.stringify(resp, null, 2);
      if (!resp || !resp.ok) {
        const message = (resp && resp.error) || (dryRun ? 'Preview failed' : 'Sync failed');
        if (summaryEl) summaryEl.innerHTML = `<span class="text-danger">${message}</span>`;
        appendPcoLog(`PCO ${dryRun ? 'preview' : 'sync'} failed: ${message}`, 'error');
        return;
      }

      const details = Array.isArray(resp.assignment_details) ? resp.assignment_details : [];
      const unmatched = Array.isArray(resp.unmatched) ? resp.unmatched : [];
      const conflicts = Array.isArray(resp.conflicts) ? resp.conflicts : [];
      const planId = resp.plan_id || '-';
      const slotsMatched = resp.slots_matched || 0;
      const summaryParts = [
        `Plan ${planId}`,
        `${details.length} assignment${details.length === 1 ? '' : 's'}`,
        `${slotsMatched} slot${slotsMatched === 1 ? '' : 's'} matched`,
      ];
      if (resp.dry_run) {
        summaryParts.push('<strong>preview only — nothing saved</strong>');
      } else {
        summaryParts.push(`${resp.updates || 0} update${(resp.updates || 0) === 1 ? '' : 's'}`);
      }
      if (unmatched.length) summaryParts.push(`${unmatched.length} unmatched`);
      if (conflicts.length) summaryParts.push(`<span class="text-danger">${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}</span>`);
      if (summaryEl) summaryEl.innerHTML = summaryParts.join(' — ');

      appendPcoLog(
        `${resp.dry_run ? 'Preview' : 'Sync'} complete for plan ${planId}: `
        + `${details.length} assignment(s), ${slotsMatched} slot(s) matched, `
        + `${resp.dry_run ? 'no changes written' : `${resp.updates || 0} update(s)`}`
        + `${unmatched.length ? `, ${unmatched.length} unmatched` : ''}.`,
        unmatched.length ? 'warn' : 'info',
      );

      renderSyncAssignments(details);
      renderSyncConflicts(conflicts);
      renderSyncUnmatched(unmatched);
    })
    .catch((err) => {
      if (summaryEl) summaryEl.innerHTML = `<span class="text-danger">${formatError(err)}</span>`;
      appendPcoLog(`PCO ${dryRun ? 'preview' : 'sync'} request error: ${formatError(err)}`, 'error');
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
      handlePcoSync(false);
    } else if (t.id === 'pco-preview-sync') {
      e.preventDefault();
      handlePcoSync(true);
    } else if (t.id === 'pco-note-preview') {
      e.preventDefault();
      handleNotePreview();
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

function refreshPlansList(options = {}) {
  const autoTrigger = !!(options && options.auto);
  const sel = document.getElementById('pco-plan-select');
  const btn = document.getElementById('pco-load-people');
  if (btn) btn.disabled = true;
  const cfg = (micboard.config && micboard.config.pco) || {};
  const enabled = !!cfg.enabled;
  const authMeta = cfg.auth || {};
  const hasStoredCreds = !!authMeta.has_credentials;
  const tokenInput = document.getElementById('pco-token');
  const secretInput = document.getElementById('pco-secret');
  const pendingToken = (tokenInput && tokenInput.value ? tokenInput.value : '').trim();
  const pendingSecret = (secretInput && secretInput.value ? secretInput.value : '').trim();

  if (!enabled) {
    if (sel) sel.innerHTML = '<option value="">Enable PCO and save settings to load plans.</option>';
    if (!autoTrigger) appendPcoLog('Enable the PCO integration and save before fetching plans.', 'warn');
    else appendPcoLog('Skipping plan fetch: integration is disabled.', 'info');
    return;
  }

  if (!hasStoredCreds) {
    const needsSave = pendingToken && pendingSecret;
    const msg = needsSave
      ? 'Save your new PCO token and secret, then refresh plans.'
      : 'Store your PCO token and secret, then refresh plans.';
    if (sel) sel.innerHTML = `<option value="">${msg}</option>`;
    appendPcoLog(`Skipping plan fetch: ${msg}`, autoTrigger ? 'info' : 'warn');
    return;
  }

  if (sel) sel.innerHTML = '<option value="">Loading…</option>';
  // Without a service type the list aggregates every service type in the
  // account, which on a mid-sized church is dozens of unrelated plans.
  const serviceId = (document.getElementById('pco-service-type-id')?.value || '').trim();
  const scope = serviceId ? `service=${encodeURIComponent(serviceId)}&` : '';
  appendPcoLog(serviceId ? 'Fetching plans for the selected service type...' : 'Fetching plan list from PCO...');
  fetch(`api/pco/plans?${scope}_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to load plans');
      const plans = resp.plans || [];
      if (sel) {
        sel.innerHTML = '<option value="">Select a plan…</option>';
        plans.forEach((p) => {
          // Scoped to one service type the API omits its name, and most plans
          // carry no title -- joining only the parts present avoids "Aug 2 — ".
          const label = [p.service_type_name, p.short_dates || p.dates, p.title]
            .map((part) => (part || '').trim()).filter((part) => part).join(' — ');
          const opt = document.createElement('option');
          opt.value = p.id || '';
          opt.textContent = label;
          sel.appendChild(opt);
        });
      }
      appendPcoLog(`Fetched ${plans.length} plan(s) from PCO.`);
    })
    .catch((err) => {
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
  fetch(`api/pco/people?plan=${encodeURIComponent(planId)}&_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to load people');
      const ppl = resp.people || [];
      ppl.forEach((p) => {
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
    .catch((err) => {
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
  const sorted = slots.slice().sort((a, b) => (a.slot || 0) - (b.slot || 0));
  // Create a shared select options fragment from people list
  const optionsHTML = ['<option value="">-- choose --</option>']
    .concat(ppl.map((p) => {
      const notesArr = Array.isArray(p.notes) ? p.notes : [];
      const extra = notesArr.length ? notesArr.join(' | ') : '';
      const position = (p.position || '').trim();
      // The position is what makes the assignment repeatable: it is the label a
      // later sync matches against, where the person's name changes week to week.
      const label = p.name
        + (position ? ` — ${position}` : '')
        + (p.team ? ` [${p.team}]` : '')
        + (extra ? ` — ${extra}` : '');
      return `<option value="${encodeURIComponent(p.name)}" data-position="${escapeHtml(position)}">${escapeHtml(label)}</option>`;
    }))
    .join('');
  let slotsMissingLabels = 0;
  sorted.forEach((s) => {
    const tr = document.createElement('tr');
    const tdSlot = document.createElement('td');
    const tdDev = document.createElement('td');
    const tdDevName = document.createElement('td');
    const tdExtId = document.createElement('td');
    const tdExtName = document.createElement('td');
    const tdSel = document.createElement('td');
    tr.setAttribute('data-slot', String(s.slot ?? ''));
    tdSlot.textContent = String(s.slot || '');
    tdDev.textContent = `${s.type || ''}${s.channel ? ` ch${s.channel}` : ''}`.trim();
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
    // The position this slot already answers to. Filled in, the slot resolves
    // itself on every future plan; blank, it needs assigning by hand each time.
    tdExtId.classList.add('pco-ext-id');
    if (s.extended_id) {
      tdExtId.textContent = s.extended_id;
    } else {
      tdExtId.innerHTML = '<span class="text-muted">—</span>';
    }
    tdExtName.classList.add('pco-ext-name');
    tdExtName.textContent = s.extended_name || '';
    const hasLabel = Boolean((devName && devName.trim()) || (s.extended_name && String(s.extended_name).trim()));
    if (!hasLabel) {
      slotsMissingLabels += 1;
    }
    const sel = document.createElement('select');
    sel.className = 'form-select form-select-sm pco-person-select';
    sel.setAttribute('data-slot', String(s.slot || ''));
    sel.innerHTML = optionsHTML;
    tdSel.appendChild(sel);
    tr.appendChild(tdSlot); tr.appendChild(tdDev); tr.appendChild(tdDevName);
    tr.appendChild(tdExtId); tr.appendChild(tdExtName); tr.appendChild(tdSel);
    if (assignBody) assignBody.appendChild(tr);
  });
  if (assignTbl) assignTbl.style.display = 'block';
  if (assignSummary) {
    if (slotsMissingLabels === sorted.length) {
      assignSummary.innerHTML = '<span class="text-warning">All configured slots are missing device names or extended names. Add names in the Config view so you can map people to slots.</span>';
    } else if (slotsMissingLabels > 0) {
      const plural = slotsMissingLabels === 1 ? '' : 's';
      assignSummary.innerHTML = `<span class="text-warning">${slotsMissingLabels} slot${plural} currently lack device names or extended names. Add them in Config for smoother assignments.</span>`;
    } else {
      assignSummary.textContent = 'Select people to assign or use Auto-fill to match by notes.';
    }
  }
  appendPcoLog(`Assignment table prepared for ${sorted.length} slot(s).`);
}

// Back button and selection bindings
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'pco-plan-select') {
    const loadBtn = document.getElementById('pco-load-people');
    if (loadBtn) loadBtn.disabled = !(t.value);
    // Teams are a property of the chosen plan, so re-read them whenever it changes.
    loadPcoTeams();
  }
  if (t.id === 'pco-service-type-id') {
    // Narrowing the service type changes which plans are on offer, and the
    // previously selected plan may not be among them.
    refreshPlansList({ auto: true });
    renderPcoTeamChoices(null);
  }
  if (t.matches && t.matches('#pco-team-choices input[type="checkbox"][data-team]')) {
    syncTeamFilterFromChoices();
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
    Array.from(sels).forEach((sel) => { sel.value = ''; });
  }
}, { passive: false });

function applyAssignmentsFromSelects() {
  const summary = document.getElementById('pco-assign-summary');
  const sels = document.querySelectorAll('#pco-assign-table select.pco-person-select');
  const remember = document.getElementById('pco-remember-positions')?.checked !== false;
  const configuredSlots = (micboard.config && micboard.config.slots) || [];
  const slotsByNumber = new Map(configuredSlots.map((s) => [s.slot, s]));

  const updates = [];
  const seeded = [];
  Array.from(sels).forEach((sel) => {
    const slotStr = sel.getAttribute('data-slot') || '';
    const slot = Number.parseInt(slotStr, 10);
    const name = sel.value ? decodeURIComponent(sel.value) : '';
    if (!Number.isFinite(slot) || !name) return;

    const update = { slot, extended_name: name };

    // Record the position, not the person. Names change every week; the
    // position is what a later sync matches on, which is what turns this
    // hand assignment into an automatic one next time. Never overwrite an
    // ID already there -- the operator may have labelled that slot on purpose.
    const position = (sel.selectedOptions[0]?.dataset.position || '').trim();
    const existingId = (slotsByNumber.get(slot)?.extended_id || '').trim();
    if (remember && position && !existingId) {
      update.extended_id = position;
      seeded.push(`slot ${slot} → “${position}”`);
    }

    updates.push(update);
  });

  if (updates.length === 0) {
    if (summary) summary.innerHTML = '<span class="text-warning">Select at least one person.</span>';
    appendPcoLog('No assignments selected to apply.', 'warn');
    return;
  }
  appendPcoLog(`Applying ${updates.length} assignment update(s) to slots...`);
  postJSON('api/slot', updates, () => {
    const note = seeded.length
      ? ` ${seeded.length} slot${seeded.length === 1 ? '' : 's'} will now match automatically.`
      : '';
    if (summary) summary.textContent = `Applied ${updates.length} update(s).${note}`;
    appendPcoLog(`Applied ${updates.length} assignment update(s).`);
    if (seeded.length) appendPcoLog(`Remembered position on ${seeded.join(', ')}.`);
    try { applyExtendedNameChanges(updates); } catch (e) {
      appendPcoLog(`Unable to refresh extended names locally: ${formatError(e)}`, 'warn');
    }
    // Reflect the newly written IDs without a full reload of the view.
    updates.forEach((u) => {
      if (!u.extended_id) return;
      const target = slotsByNumber.get(u.slot);
      if (target) target.extended_id = u.extended_id;
      const cellSelector = `#pco-assign-table tr[data-slot="${u.slot}"] .pco-ext-id`;
      const cell = document.querySelector(cellSelector);
      if (cell) cell.textContent = u.extended_id;
    });
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
  fetch(`api/pco/people?plan=${encodeURIComponent(planId)}&_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      const ppl = resp.people || [];
      const existingSelects = document.querySelectorAll('#pco-assign-table select.pco-person-select');
      if (!existingSelects || existingSelects.length === 0) {
        try { buildAssignmentTable(ppl); } catch (e) {}
      }
      const normalize = (s) => String(s || '').trim().toLowerCase();
      const byNote = new Map();
      const byExtId = new Map();
      ppl.forEach((p) => {
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
      Array.from(sels).forEach((sel) => {
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
    .catch((err) => {
      if (assignSummary) assignSummary.innerHTML = `<span class="text-danger">Auto-fill failed: ${err}</span>`;
      appendPcoLog(`Auto-fill failed: ${formatError(err)}`, 'error');
    });
}
