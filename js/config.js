import { Collapse, Modal } from 'bootstrap';

import { postJSON } from './data.js';
import { resolveSlotType } from './slot-rules.mjs';
import { discoveryHint } from './discovery-hint.mjs';
import {
  backgroundNameForSlot, backgroundFilenames, findBackgroundFile, backgroundKey,
} from './background-key.mjs';
import { summariseGroups, unassignedSlots, slotLabel } from './group-summary.mjs';
import { DEFAULT_DWELL_SECONDS } from './rotation.mjs';
import { scopeNote, globalChangeWarning } from './viewer-scope.mjs';
import {
  ACTION_LABELS, changedRows, unchangedRows, diffHeadline,
  nameCell as diffNameCell, describeRow, rowClass, shouldFoldUnchanged, foldedLabel,
} from './sync-diff.mjs';
import { isLocked } from './viewer-lock.mjs';
import {
  screenProblem, toPayload as screensToPayload, saveSummary as screensSaveSummary,
  mergeSaved,
} from './screens-editor.mjs';
import { showLockRefusal } from './viewer-lock-view.js';
import { assignNumbers } from './slot-numbering.mjs';
import {
  channelsToAdd, allChannelsToAdd, addLabel,
} from './receiver-expand.mjs';
import {
  groupRows, groupHeading, splitAddresses,
  manualReceiverRows, manualReceiverBlocker,
} from './receiver-groups.mjs';
import {
  editorState, configuredCount, emptyingSaveWarning, waitingMessage,
} from './config-readiness.mjs';
import {
  OVERRIDABLE,
  uniqueId,
  bindingKind,
  overriddenKeys,
  describeBinding,
  folderPath,
  bindingIsDangling,
  validateProfile,
  toPayload as profilesToPayload,
} from './profile-editor.mjs';
import {
  connectBlocker,
  connectSummary,
  isConnected,
  storedCredentialsNote,
} from './pco-connect.mjs';
import {
  NEXT_PLAN,
  planLabel,
  nextPlanOptionLabel,
  resolvePlanId,
  syncPlanParam,
  planDescription,
  planBlocker,
} from './plan-choice.mjs';
import {
  CLEAR_ASSIGNMENT,
  parseSelection,
  assignedSlots,
  clearUpdates,
  clearAllConfirmation,
  clearedSummary,
} from './clear-assignments.mjs';

const noop = () => {};

/** The last answer from `api/pco/connect`, or null if none this session (#120). */
let lastConnect = null;

/**
 * The rule sets being edited, and what Planning Center has to bind them to.
 *
 * ⚠️ Held here rather than read back out of the DOM on save. A binding is an
 * id while the panel shows a name, and round-tripping that through the markup
 * is how a renamed folder turns into a profile bound to nothing.
 */
let pcoProfiles = [];
let pcoServiceTypes = [];
let pcoFolders = [];

/**
 * What the server last said "next upcoming" resolves to (#120).
 *
 * ⚠️ A cache for labelling and for the lookups that need a concrete id. A sync
 * never reads it -- see `syncPlanParam`.
 */
let nextPlanInfo = null;

/** The select's raw value: a plan id, `NEXT_PLAN`, or ''. */
function planChoice() {
  const sel = document.getElementById('pco-plan-select');
  return sel ? (sel.value || '') : '';
}

/** The concrete plan id for a lookup, or '' when there is not one yet. */
function selectedPlanId() {
  return resolvePlanId(planChoice(), nextPlanInfo);
}

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

// ⛔ Every receiver type the server can drive must be here, or a save drops the
// slot's IP and channel. SLX-D shipped in 1.16.0 missing from this list, and a
// save wrote a slot the loader could not read. py/tests/test_vendor_seam.py
// checks it against vendor.supported_types().
const NET_DEVICE_TYPES = ['axtd', 'ulxd', 'qlxd', 'uhfr', 'slxd', 'slxdplus', 'p10t'];

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

// The discovery status line sits with the discovery settings, well above the
// Save button and easily off screen. Anything about the save itself belongs
// next to the button that caused it.
function setConfigSaveStatus(message, level = 'info') {
  const statusEl = document.getElementById('config-save-status');
  if (!statusEl) return;

  statusEl.textContent = message || '';
  statusEl.classList.remove('text-muted', 'text-success', 'text-danger', 'text-warning', 'text-info');

  if (level === 'success') {
    statusEl.classList.add('text-success');
  } else if (level === 'error') {
    statusEl.classList.add('text-danger');
  } else if (level === 'warn') {
    statusEl.classList.add('text-warning');
  } else {
    statusEl.classList.add('text-muted');
  }
}

// A board whose config.json did not load cleanly now starts anyway, so that the
// interface is reachable at all -- but it comes up with an empty board and
// writes nothing back, and neither of those is obvious from looking at it. An
// admin who is not told will read it as "my configuration is gone" and rebuild
// it by hand. Say what happened, and offer the two ways out.
function renderConfigHealth(health) {
  const banner = document.getElementById('config-health-banner');
  if (!banner) return;

  if (!health || !health.degraded) {
    banner.hidden = true;
    return;
  }

  const detail = document.getElementById('config-health-detail');
  if (detail) {
    detail.textContent = health.config_path
      ? `${health.config_path} could not be read as a usable configuration, so this board `
        + 'started with no devices.'
      : 'The configuration file could not be read as a usable configuration, so this '
        + 'board started with no devices.';
  }

  // Offering a restore with no backup to restore from is a dead end, and the
  // admin cannot tell it is one until they press it.
  const restoreBtn = document.getElementById('config-restore-backup');
  if (restoreBtn) {
    restoreBtn.hidden = !health.backup_available;
    restoreBtn.title = health.backup_available && health.backup_path
      ? `Restores ${health.backup_path}`
      : '';
  }

  banner.hidden = false;
}

function setConfigHealthStatus(message, level = 'info') {
  const statusEl = document.getElementById('config-health-status');
  if (!statusEl) return;

  statusEl.textContent = message || '';
  statusEl.classList.remove('text-white', 'text-warning-emphasis');
  if (level === 'error') {
    statusEl.classList.add('text-warning-emphasis');
  } else {
    statusEl.classList.add('text-white');
  }
}

function runConfigRecovery(action, buttons) {
  buttons.forEach((btn) => { if (btn) btn.disabled = true; });
  setConfigHealthStatus(
    action === 'restore' ? 'Restoring the last working configuration…' : 'Resetting to defaults…',
  );

  postJSON('api/config/recover', { action }, (resp) => {
    // postJSON resolves the body whatever the status is, so a refusal (no
    // backup, unusable backup) arrives here rather than in the error handler.
    if (!resp || resp.ok !== true) {
      buttons.forEach((btn) => { if (btn) btn.disabled = false; });
      const reason = (resp && resp.error) || 'unknown error';
      setConfigHealthStatus(`Could not recover: ${reason}`, 'error');
      return;
    }
    setConfigHealthStatus('Configuration recovered. Reloading…');
    window.location.reload();
  }, (err) => {
    buttons.forEach((btn) => { if (btn) btn.disabled = false; });
    setConfigHealthStatus(`Could not recover: ${formatError(err)}`, 'error');
  });
}

function ensureConfigHealthBindings() {
  const banner = document.getElementById('config-health-banner');
  if (!banner || banner.dataset.bound === 'true') return;
  banner.dataset.bound = 'true';

  const restoreBtn = document.getElementById('config-restore-backup');
  const resetBtn = document.getElementById('config-reset-defaults');
  const buttons = [restoreBtn, resetBtn];

  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      runConfigRecovery('restore', buttons);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // Destructive and not obviously so -- "defaults" reads as harmless until
      // it has replaced a config someone spent a service building.
      // eslint-disable-next-line no-alert
      if (!window.confirm(
        'Reset the configuration to defaults?\n\n'
        + 'Every slot and group will be cleared. The file being replaced is kept '
        + 'alongside it as config.json.rejected.',
      )) return;
      runConfigRecovery('defaults', buttons);
    });
  }
}

async function loadConfigHealth() {
  try {
    const response = await fetch(`api/config?_=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) return;
    renderConfigHealth(data.health);
  } catch (_) {
    // A board that cannot reach its own API has a louder problem than this
    // banner, and the rest of the config view reports it.
  }
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
// An empty list used to render as blank space under the "Discovered Devices"
// heading, which told an operator whose receivers were missing nothing at all --
// not even whether a scan had run. The wording rules are in discovery-hint.mjs
// so they can be tested without a DOM.
function renderDiscoveryHint(container) {
  const hint = discoveryHint({
    scan: micboard.discovery_scan,
    config: (micboard.config && micboard.config.discovery) || null,
    deviceCount: 0,
  });
  if (!hint) return;

  const box = document.createElement('div');
  box.id = 'discovery-empty-hint';
  box.className = 'alert alert-secondary small';
  box.setAttribute('role', 'status');

  const title = document.createElement('strong');
  title.textContent = hint.title;
  box.appendChild(title);

  hint.body.forEach((line) => {
    const p = document.createElement('p');
    p.className = 'mb-1 mt-2';
    p.textContent = line;
    box.appendChild(p);
  });

  // Only when there is somewhere to send them. The field is in the panel above
  // and easy to scroll past, so the hint moves the page to it rather than just
  // naming it.
  if (hint.showManualHint) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'btn btn-sm btn-outline-secondary mt-2';
    jump.textContent = 'Add a manual CIDR range';
    jump.addEventListener('click', () => {
      const field = document.getElementById('discovery-subnets');
      if (!field) return;
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.focus();
    });
    box.appendChild(jump);
  }

  container.appendChild(box);
}

function renderDiscoveredDeviceList() {
  const discoveredList = document.getElementById('discovered_list');
  if (!discoveredList) return;
  renderDiscoveryEnvironmentStatus(micboard.discovery_status);
  discoveredList.innerHTML = '';
  const discovered = micboard.discovered || [];
  if (!Array.isArray(discovered) || discovered.length === 0) {
    renderDiscoveryHint(discoveredList);
    return;
  }
  const template = document.getElementById('config-slot-template');
  if (!template || !template.content) return;

  // What the editor is showing, so a receiver already added reads as added
  // even before the save.
  const configured = Array.from(document.querySelectorAll('#editor_holder .cfg-row')).map((row) => ({
    ip: (row.querySelector('.cfg-ip')?.value || '').trim(),
    channel: Number.parseInt(row.querySelector('.cfg-channel')?.value, 10),
  }));
  discovered.forEach((slot) => {
    const t = template.content.cloneNode(true);
    const row = t.querySelector('.cfg-row');
    if (row) {
      // ⛔ No `slot-N` id here. The editor's rows and the board's channel cards
      // both use that namespace and this list sits before both in the
      // document, so a lookup by slot id was finding a *discovered* row
      // instead. The address identifies a receiver; a slot number never did.
      row.dataset.receiverIp = slot.ip || '';
      row.querySelector('.cfg-type').value = slot.type || '';
      row.querySelector('.cfg-ip').value = slot.ip || '';
      row.querySelector('.cfg-channel').value = slot.channel || '';
      const deviceInput = row.querySelector('.cfg-device-name');
      if (deviceInput) {
        const deviceName = slot.chan_name_raw || slot.name_raw || slot.name || '';
        deviceInput.value = deviceName;
      }
      const idInput = row.querySelector('.cfg-id');
      if (idInput && slot.extended_id) {
        idInput.value = slot.extended_id;
      }
      const extInput = row.querySelector('.cfg-name');
      if (extInput && slot.extended_name) {
        extInput.value = slot.extended_name;
      }

      // ⭐ One receiver at a time, as well as all at once. A rack shared with
      // another system, or a board being set up one unit at a time, had no way
      // to take just one.
      const actions = row.querySelector('.del-btn');
      if (actions) {
        const button = actions.querySelector('button');
        if (button) {
          button.className = 'btn btn-outline-primary btn-sm add-discovered-one';
          button.textContent = addLabel(slot, configured);
          button.disabled = !channelsToAdd(slot, configured).length;
          button.dataset.receiverIp = slot.ip || '';
          button.removeAttribute('aria-hidden');
        }
      }
    }
    discoveredList.appendChild(t);
  });
}

/**
 * Re-open the editor once the board's configuration arrives (#150).
 *
 * ⚠️ Listens once. The payload fires several times a second and
 * `initConfigEditor` rebuilds every row, so re-rendering on each one would
 * wipe whatever the operator had started typing.
 */
let waitingForConfig = false;
function waitForConfigThenRender() {
  if (waitingForConfig) return;
  waitingForConfig = true;
  const onLoaded = () => {
    window.removeEventListener('wirelessboard:config-loaded', onLoaded);
    waitingForConfig = false;
    // Only if the editor is still on screen and still waiting.
    if (document.getElementById('editor-waiting')) {
      initConfigEditor(true);
    }
  };
  window.addEventListener('wirelessboard:config-loaded', onLoaded);
}

/**
 * Give every configuration row its slot number (#147).
 *
 * ⛔ Rows that already have a number **keep it**. This used to renumber from 1
 * in document order, and because groups store slot numbers — and Planning
 * Center assignments and `config_mix` resolve through them — deleting a
 * channel handed other people's channels to other groups.
 *
 * Reproduced on a board before fixing: Vocals = [1,2] = Alice and Bob, Band =
 * [3,4] = Carol and Dave. Delete Bob, save, and the slots became 1, 2, 3 while
 * the groups still said [1,2] and [3,4] — so Carol was in Vocals. Every group
 * had the right shape and every name was a real name.
 */
function updateSlotID() {
  const rows = Array.from(document.querySelectorAll('#editor_holder .cfg-row'));
  const numbers = assignNumbers(rows.map((row) => row.id || null));
  rows.forEach((row, index) => {
    const slot = numbers[index];
    row.id = `slot-${slot}`;
    const label = row.querySelector('.slot-number label');
    if (label) label.textContent = slot;
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

/**
 * The credential line under the token field.
 *
 * ⚠️ Since #120 the Connect button owns this message, and the old copy here
 * said the wrong thing — "then save to store them securely", when saving is no
 * longer how credentials are stored. Where Connect's own line exists this one
 * stays empty rather than contradicting it; two status lines about one fact is
 * exactly the clutter #120 is about.
 */
function renderPcoCredentialStatus(authMeta = {}) {
  const statusEl = ensurePcoCredentialStatusElement();
  if (!statusEl) return;
  statusEl.classList.remove('text-danger', 'text-success', 'text-muted');

  if (document.getElementById('pco-connect-status')) {
    statusEl.textContent = '';
    return;
  }

  const hasCreds = !!authMeta.has_credentials;
  if (hasCreds) {
    statusEl.classList.add('text-success');
    const suffix = authMeta.credential_id ? ` (${authMeta.credential_id})` : '';
    statusEl.textContent = `Credentials stored in system keyring${suffix}.`;
  } else {
    statusEl.classList.add('text-muted');
    statusEl.textContent = 'Enter your Planning Center token and secret, then press Connect.';
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

// The picker walks the service's filesystem rather than the browser's: the
// board is opened with shell.openExternal, so there is no Electron dialog to
// call, and a browser folder input never reveals an absolute path.
const folderPickerState = {
  listing: null,
  loading: false,
  bound: false,
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

// Returns the slots to save alongside the rows that could not be saved, so the
// caller can say so. Dropping them quietly behind a "saved" message meant an
// operator could fill in a receiver, press Save, and watch the row disappear
// having been told it worked.
function collectSlotConfiguration() {
  const slotList = [];
  const incomplete = [];
  const holder = document.getElementById('editor_holder');
  if (!holder) return { slots: slotList, incomplete };
  const configBoard = holder.getElementsByClassName('cfg-row');

  for (let i = 0; i < configBoard.length; i += 1) {
    const slot = parseInt(configBoard[i].id.replace(/[^\d.]/g, ''), 10);
    // slotList holds objects, so indexOf(slot) — a number — never matched and
    // this guard did nothing. Compare against the slot numbers already added.
    if (slot && !slotList.some((entry) => entry.slot === slot)) {
      const output = {};

      output.slot = slot;
      const typeVal = (configBoard[i].querySelector('.cfg-type')?.value || '').trim();
      const ipVal = (configBoard[i].querySelector('.cfg-ip')?.value || '').trim();
      const chanVal = parseInt(configBoard[i].querySelector('.cfg-channel')?.value, 10);
      const nameField = configBoard[i].querySelector('.cfg-name');
      const nameVal = nameField ? String(nameField.value || '').trim() : '';
      const idField = configBoard[i].querySelector('.cfg-id');
      const idVal = idField ? String(idField.value || '').trim() : '';

      // The rules themselves live in slot-rules.mjs, away from the DOM reading,
      // so they can be tested directly.
      const resolved = resolveSlotType({
        type: typeVal, ip: ipVal, name: nameVal, id: idVal,
      });

      if (!resolved.type) {
        // A row with nothing in it is just an unused blank from Add Row, so it
        // is dropped without comment. One the operator actually typed into is
        // reported instead -- that is data about to go missing.
        if (resolved.incomplete) {
          incomplete.push({
            slot, ip: ipVal, name: nameVal, id: idVal,
          });
        }
        continue;
      }

      output.type = resolved.type;

      if (NET_DEVICE_TYPES.indexOf(output.type) > -1) {
        // Only include IP/Channel for networked device types
        output.ip = ipVal;
        output.channel = Number.isFinite(chanVal) ? chanVal : 1;
      }

      if (nameField) {
        output.extended_name = nameVal;
      }

      // Only sent when the field is present, because config_mix keeps the
      // stored extended_id whenever the key is absent — that is what stops a
      // save from wiping the positions the PCO seed workflow writes.
      if (idField) {
        output.extended_id = idVal;
      }

      slotList.push(output);
    }
  }
  return { slots: slotList, incomplete };
}

function generateJSONConfig() {
  const { slots, incomplete } = collectSlotConfiguration();
  const discovery = collectDiscoverySettingsFromForm();
  return { slots, discovery, incomplete };
}

/**
 * Put the given channel rows into the editor.
 *
 * ⚠️ Works from the discovered *data*, not from the rendered rows. Copying the
 * markup is what limited this to one row per receiver: the list shows a
 * receiver once, and a receiver is not a channel.
 */
function appendChannelRows(rows) {
  const cfgList = document.getElementById('editor_holder');
  const template = document.getElementById('config-slot-template');
  if (!cfgList || !template || !template.content || !rows.length) return 0;

  rows.forEach((row) => {
    const fragment = template.content.cloneNode(true);
    const target = fragment.querySelector('.cfg-row');
    if (!target) return;
    const set = (selector, value) => {
      const el = target.querySelector(selector);
      if (el) el.value = value;
    };
    set('.cfg-type', row.type || '');
    set('.cfg-ip', row.ip || '');
    set('.cfg-channel', String(row.channel));
    set('.cfg-device-name', row.device_name || '');
    cfgList.appendChild(fragment);
  });

  updateSlotID();
  updateHiddenSlots();
  renderReceiverHeadings();
  renderDiscoveredDeviceList();
  return rows.length;
}

/**
 * The channels the editor is currently showing, saved or not.
 *
 * ⛔ Read from the rows, not from `micboard.config.slots`. The saved config is
 * what the board last wrote; the rows are what the operator is looking at. A
 * second press of Add before saving duplicated every channel when this checked
 * the saved list -- one press gave four rows, two gave eight.
 */
function channelsInEditor() {
  return Array.from(document.querySelectorAll('#editor_holder .cfg-row')).map((row) => ({
    ip: (row.querySelector('.cfg-ip')?.value || '').trim(),
    channel: Number.parseInt(row.querySelector('.cfg-channel')?.value, 10),
  }));
}

/** Every discovered receiver, expanded to the channels it actually has. */
function addAllDiscoveredDevices() {
  const discovered = micboard.discovered || [];
  const added = appendChannelRows(allChannelsToAdd(discovered, channelsInEditor()));
  if (!added) {
    setConfigSaveStatus('Every discovered channel is already in the list.', 'info');
  }
}

/**
 * Add a receiver that discovery cannot see.
 *
 * ⛔ Asks for the channel count rather than inferring it. A model string
 * decides the count, not the type -- `axtd` is both AD4D at two channels and
 * AD4Q at four, and the model tables for SLX-D are empty because those strings
 * have never been observed. Guessing would quietly configure channels that are
 * not there.
 */
function addManualReceiver() {
  const status = document.getElementById('manual-rx-status');
  const spec = {
    ip: document.getElementById('manual-rx-ip')?.value,
    type: document.getElementById('manual-rx-type')?.value,
    channels: document.getElementById('manual-rx-channels')?.value,
  };

  const blocker = manualReceiverBlocker(spec);
  if (blocker) {
    if (status) {
      status.className = 'small text-warning';
      status.textContent = blocker;
    }
    return;
  }

  // Channels this receiver already has on screen are left alone, the same rule
  // the discovered path follows.
  const wanted = manualReceiverRows(spec);
  const existing = channelsInEditor();
  const rows = wanted.filter((row) => !existing.some(
    (slot) => slot.ip === row.ip && slot.channel === row.channel,
  ));

  if (!rows.length) {
    if (status) {
      status.className = 'small text-muted';
      status.textContent = 'Those channels are already in the list.';
    }
    return;
  }

  appendChannelRows(rows);
  if (status) {
    status.className = 'small text-success';
    status.textContent = `Added ${rows.length} channel${rows.length === 1 ? '' : 's'} for ${spec.ip}.`;
  }
  const ipInput = document.getElementById('manual-rx-ip');
  if (ipInput) ipInput.value = '';
}

/** One receiver, expanded the same way. */
function addDiscoveredReceiver(ip) {
  const discovered = micboard.discovered || [];
  const device = discovered.find((d) => String(d.ip || '').trim() === String(ip || '').trim());
  if (!device) return;
  appendChannelRows(channelsToAdd(device, channelsInEditor()));
}

/** The human model names, so a heading does not say "axtd" at an operator. */
function receiverTypeLabels() {
  const labels = {};
  const select = document.getElementById('manual-rx-type');
  if (select) {
    Array.from(select.options).forEach((opt) => {
      if (opt.value) labels[opt.value] = opt.textContent.trim();
    });
  }
  return labels;
}

/**
 * Put a heading above each run of rows that share an address (#144).
 *
 * ⚠️ Headings only -- no rows are moved. The saved slots array is written in
 * document order, so reordering here would change what the board shows for
 * anyone whose channels are not in groups. A receiver whose channels have been
 * separated therefore shows two headings, which is what the configuration
 * actually says.
 */
function renderReceiverHeadings() {
  const holder = document.getElementById('editor_holder');
  if (!holder) return;

  holder.querySelectorAll('.rx-heading').forEach((el) => el.remove());

  const rows = Array.from(holder.querySelectorAll('.cfg-row'));
  if (!rows.length) return;

  const described = rows.map((row) => ({
    ip: (row.querySelector('.cfg-ip')?.value || '').trim(),
    type: (row.querySelector('.cfg-type')?.value || '').trim(),
    device_name: (row.querySelector('.cfg-device-name')?.value || '').trim(),
  }));

  const groups = groupRows(described);
  const labels = receiverTypeLabels();
  const split = splitAddresses(groups);

  groups.forEach((group) => {
    const first = rows[group.rows[0].index];
    if (!first) return;
    const heading = document.createElement('div');
    heading.className = 'rx-heading small text-muted mt-2';
    heading.textContent = groupHeading(group, { typeLabels: labels });
    if (group.ip && split.includes(group.ip)) {
      // Almost never deliberate, and the reason a receiver "looks like two" is
      // not visible from the rows themselves.
      const note = document.createElement('span');
      note.className = 'text-warning ms-2';
      note.textContent = '— this receiver’s channels are split up';
      heading.appendChild(note);
    }
    holder.insertBefore(heading, first);
  });
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
    // ⛔ Scoped to the editor. The board's channel cards use the same
    // `slot-N` ids and come first in the document, so a bare getElementById
    // returns the card -- which has no `.cfg-*` fields, so this silently did
    // nothing. Found while reproducing #147.
    const row = document.querySelector(`#editor_holder #slot-${slotNum}`);
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

    // Scoped for the same reason as above: the board card wins a bare lookup.
    const cfgRow = document.querySelector(`#editor_holder #slot-${slot}`);
    if (cfgRow) {
      const input = cfgRow.querySelector('.cfg-name');
      if (input) input.value = value;
    }

    const assignRow = document.querySelector(`#pco-assign-table tr[data-slot="${slot}"]`);
    if (assignRow) {
      const extCell = assignRow.querySelector('.pco-ext-name');
      if (extCell) extCell.textContent = value;
      // A cleared slot's dropdown goes back to "leave it alone" (#135). Left on
      // "clear this slot" it would clear again on the next Apply, which looks
      // like the clear never took.
      if (!value) {
        const sel = assignRow.querySelector('select.pco-person-select');
        if (sel) sel.value = '';
      }
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

// The name this slot's media is keyed on. Was `resolveDeviceName`, and it
// preferred `name_raw` -- the transmitter's own channel label -- so the guide
// told operators to name files after the device while gif.js went looking for
// the person. backgroundNameForSlot is now the single answer both use.
function resolveBackgroundName(slotNumber, slotConfig) {
  const txList = micboard && micboard.transmitters;
  let tx = null;
  if (txList && typeof txList === 'object') {
    tx = Array.isArray(txList) ? txList[slotNumber] : txList[String(slotNumber)] || txList[slotNumber];
  }
  return backgroundNameForSlot(tx, slotConfig);
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

export /**
 * A chooser for one person's photo or video.
 *
 * ⛔ The blank option is "match by filename", not "no media". Removing a choice
 * puts the person back on the rule the board has always used; it does not make
 * their card blank.
 */
function mediaPicker(name, mode, available, onDisk, suggested) {
  const key = backgroundKey(name);
  const chosen = currentMediaAssignments()[key] || '';

  const select = document.createElement('select');
  select.className = 'form-select form-select-sm media-pick';
  select.dataset.person = name;
  select.dataset.mode = mode;

  const fallback = document.createElement('option');
  fallback.value = '';
  // Says what the fallback will actually do for this person, which is the
  // thing the old guide column existed to tell them.
  fallback.textContent = onDisk
    ? `Match by filename — ${onDisk}`
    : `Match by filename — ${suggested}`;
  select.appendChild(fallback);

  available.forEach((file) => {
    const option = document.createElement('option');
    option.value = file;
    option.textContent = file;
    if (file === chosen) option.selected = true;
    select.appendChild(option);
  });

  // ⚠️ A choice pointing at a file that has gone stays selectable and visible,
  // rather than silently reverting to filename matching -- otherwise the only
  // symptom of a renamed file is a photo quietly changing.
  if (chosen && !available.includes(chosen)) {
    const missing = document.createElement('option');
    missing.value = chosen;
    missing.textContent = `${chosen} — not in the folder`;
    missing.selected = true;
    select.appendChild(missing);
  }

  return select;
}

/** The choices the board is currently serving. */
function currentMediaAssignments() {
  const media = micboard.config && micboard.config.media;
  return (media && typeof media.assignments === 'object') ? media.assignments : {};
}

function renderBackgroundFilenameGuide() {
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

    const backgroundName = resolveBackgroundName(slotNumber, slotConfig);
    const { image: imgFilename, video: videoFilename } = backgroundFilenames(backgroundName);

    // The file on disk if there is one, whatever its capitalisation. Showing
    // that spelling rather than the suggested one is the point: the operator
    // who named a photo `Jane Smith.JPG` should see it listed as available, not
    // be told to rename a file the board is already using.
    const imgOnDisk = findBackgroundFile(backgroundName, 'IMG', imgList);
    const videoOnDisk = findBackgroundFile(backgroundName, 'MP4', mp4List);
    const hasImg = !!imgOnDisk;
    const hasVideo = !!videoOnDisk;

    const row = document.createElement('tr');

    const slotCell = document.createElement('th');
    slotCell.scope = 'row';
    slotCell.textContent = Number.isFinite(slotNumber) ? slotNumber : '—';
    row.appendChild(slotCell);

    const nameCell = document.createElement('td');
    if (backgroundName) {
      nameCell.textContent = backgroundName;
    } else {
      nameCell.textContent = '—';
      nameCell.classList.add('text-muted');
    }
    row.appendChild(nameCell);

    // ⭐ A picker, not just a report. Naming a file after someone is a poor
    // interface even though it is a fine rule: it means renaming files in
    // Finder to match what Planning Center calls them, and it breaks on two
    // people called Dave, on a married name, on an apostrophe (#145).
    //
    // ⚠️ Filename matching stays the default option, so a folder of correctly
    // named photos keeps working and nothing has to be migrated.
    const imgCell = document.createElement('td');
    if (backgroundName && imgList.length) {
      imgCell.appendChild(mediaPicker(backgroundName, 'IMG', imgList, imgOnDisk, imgFilename));
    } else {
      decorateFilenameCell(imgCell, imgOnDisk || imgFilename, hasImg);
    }
    row.appendChild(imgCell);

    const videoCell = document.createElement('td');
    if (backgroundName && mp4List.length) {
      videoCell.appendChild(mediaPicker(backgroundName, 'MP4', mp4List, videoOnDisk, videoFilename));
    } else {
      decorateFilenameCell(videoCell, videoOnDisk || videoFilename, hasVideo);
    }
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

    const browseBtn = document.getElementById('background-directory-browse');
    if (browseBtn) {
      // Browsing only helps if the chosen path can then be saved, and a
      // command-line override means it cannot.
      browseBtn.disabled = disableInput;
    }
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

function setFolderPickerStatus(message, level = 'info') {
  const statusEl = document.getElementById('folder-picker-status');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.className = `small mb-2 ${STATUS_CLASSES[level] || 'text-muted'}`;
}

function renderFolderPicker() {
  const list = document.getElementById('folder-picker-list');
  const pathEl = document.getElementById('folder-picker-path');
  const upBtn = document.getElementById('folder-picker-up');
  const selectBtn = document.getElementById('folder-picker-select');
  const { listing } = folderPickerState;

  if (pathEl) {
    pathEl.textContent = listing && listing.path ? listing.path : 'This Computer';
  }

  if (upBtn) {
    // At a filesystem root there is nowhere further up, so Up returns to the
    // list of drives and home folders rather than going nowhere.
    upBtn.disabled = folderPickerState.loading || !listing || listing.is_roots;
  }

  if (selectBtn) {
    selectBtn.disabled = folderPickerState.loading || !listing || !listing.path;
  }

  if (!list) return;
  list.textContent = '';

  if (folderPickerState.loading) {
    return;
  }

  if (!listing || !Array.isArray(listing.entries) || listing.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-muted small';
    empty.textContent = listing && listing.path
      ? 'No sub-folders here. Use This Folder to select it.'
      : 'Nothing to show.';
    list.appendChild(empty);
    return;
  }

  listing.entries.forEach((entry) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'list-group-item list-group-item-action';
    item.textContent = entry.name;
    item.addEventListener('click', () => {
      loadFolderPicker(entry.path).catch(() => {});
    });
    list.appendChild(item);
  });
}

async function loadFolderPicker(path) {
  if (folderPickerState.loading) {
    return;
  }

  folderPickerState.loading = true;
  renderFolderPicker();
  setFolderPickerStatus('Loading…', 'info');

  try {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    const response = await fetch(`api/folders${query}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || `Request failed (${response.status})`);
    }
    folderPickerState.listing = data.folder || null;
    setFolderPickerStatus('', 'info');
  } catch (err) {
    // Keep the previous listing on screen: a folder that cannot be read is a
    // dead end, not a reason to lose the operator's place.
    setFolderPickerStatus(formatError(err), 'error');
  } finally {
    folderPickerState.loading = false;
    renderFolderPicker();
  }
}

function openFolderPicker() {
  const modalEl = document.getElementById('folder-picker-modal');
  if (!modalEl) return;

  ensureFolderPickerBindings();
  Modal.getOrCreateInstance(modalEl).show();

  const input = document.getElementById('background-directory');
  const typed = input ? input.value.trim() : '';
  const { info } = backgroundDirectoryState;
  const start = typed || (info && (info.resolved_path || info.default_path)) || '';
  // A path that no longer exists answers 400; the roots list is the way back.
  loadFolderPicker(start).catch(() => {});
}

function ensureFolderPickerBindings() {
  if (folderPickerState.bound) return;
  const modalEl = document.getElementById('folder-picker-modal');
  if (!modalEl) return;
  folderPickerState.bound = true;

  const upBtn = document.getElementById('folder-picker-up');
  if (upBtn) {
    upBtn.addEventListener('click', () => {
      const { listing } = folderPickerState;
      if (!listing || listing.is_roots) return;
      loadFolderPicker(listing.parent || '').catch(() => {});
    });
  }

  const homeBtn = document.getElementById('folder-picker-home');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      loadFolderPicker('').catch(() => {});
    });
  }

  const selectBtn = document.getElementById('folder-picker-select');
  if (selectBtn) {
    selectBtn.addEventListener('click', () => {
      const { listing } = folderPickerState;
      if (!listing || !listing.path) return;
      const input = document.getElementById('background-directory');
      if (input) {
        input.value = listing.path;
      }
      Modal.getOrCreateInstance(modalEl).hide();
      // Choosing is not saving -- Save Folder still has to be pressed, and the
      // status line is where that gets said.
      setBackgroundDirectoryStatus(`Folder selected. Press Save Folder to apply ${listing.path}.`, 'info');
    });
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

  const browseBtn = document.getElementById('background-directory-browse');
  if (browseBtn && browseBtn.dataset.bound !== 'true') {
    browseBtn.dataset.bound = 'true';
    browseBtn.addEventListener('click', () => {
      openFolderPicker();
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

/**
 * Which boards a change here reaches (#116).
 *
 * The split is real and nothing said so: the view panel writes to this
 * browser, while everything on this page is the server's and lands on every
 * connected board at once.
 */
function renderConfigScopeNote() {
  const note = document.getElementById('config-scope-note');
  if (!note) {
    return;
  }
  note.textContent = scopeNote('global', micboard.viewers);

  // ⚠️ The config view opens before the first payload lands, so the count is
  // not known yet when this first runs. Follow it rather than printing one
  // stale sentence and leaving it there.
  if (!note.dataset.bound) {
    note.dataset.bound = 'true';
    window.addEventListener('wirelessboard:viewers', () => {
      note.textContent = scopeNote('global', micboard.viewers);
    });
  }
}

/**
 * The groups panel (#114).
 *
 * ⭐ Built with createElement rather than innerHTML: these strings are people's
 * names arriving from PCO and from a hand-edited config.json, and one of them
 * will eventually contain an apostrophe or an angle bracket.
 */
function renderGroupSummary() {
  const holder = document.getElementById('groups-summary');
  if (!holder) {
    return;
  }
  holder.innerHTML = '';

  const slots = (micboard.config && micboard.config.slots) || [];
  const groups = micboard.groups || {};
  const rows = summariseGroups(groups, slots);
  const loose = unassignedSlots(groups, slots);

  const names = (list) => list.map(slotLabel).join(', ');

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'text-muted small';
    empty.textContent = 'No groups yet. Open a group from the bar and press E to put channels in one.';
    holder.appendChild(empty);
  }

  rows.forEach((row) => {
    const card = document.createElement('div');
    card.className = 'group-row';
    card.dataset.group = String(row.group);

    const head = document.createElement('div');
    head.className = 'group-row-head';

    const key = document.createElement('span');
    key.className = 'group-key';
    key.textContent = String(row.group);
    head.appendChild(key);

    // Renaming sends the title alone. That is only safe because update_group
    // edits the fields a payload carries and leaves the rest -- a rename has
    // no business knowing the membership it never showed anyone.
    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'form-control form-control-sm group-title';
    title.value = row.title;
    title.setAttribute('aria-label', `Name of group ${row.group}`);
    title.addEventListener('change', () => {
      const next = title.value.trim();
      if (!next || next === row.title) {
        title.value = row.title;
        return;
      }
      postJSON('api/group', { group: row.group, title: next });
      row.title = next;
    });
    head.appendChild(title);

    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = `${row.count} ch`;
    head.appendChild(count);

    // ⭐ List order is rotation order (#113), so these move the show, not just
    // the list. Up and down rather than a drag handle: the same outcome,
    // reachable from a keyboard and a touch display, and nothing to mis-drop.
    const move = (direction) => {
      const order = rows.map((r) => r.group);
      const from = order.indexOf(row.group);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= order.length) return;
      order.splice(to, 0, order.splice(from, 1)[0]);
      postJSON('api/group', { order }, () => {
        micboard.groupOrder = order;
        renderGroupSummary();
      });
    };

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn btn-outline-secondary btn-sm group-move';
    up.textContent = '↑';
    up.setAttribute('aria-label', `Move group ${row.group} earlier in the rotation`);
    up.addEventListener('click', () => move(-1));
    head.appendChild(up);

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn btn-outline-secondary btn-sm group-move';
    down.textContent = '↓';
    down.setAttribute('aria-label', `Move group ${row.group} later in the rotation`);
    down.addEventListener('click', () => move(1));
    head.appendChild(down);

    card.appendChild(head);

    // The two fields the wall's rotation reads. ⚠️ Each sends only itself --
    // `update_group` edits what a payload carries, so a dwell change must not
    // have to send back a membership it never showed anyone.
    const stored = (micboard.config && Array.isArray(micboard.config.groups))
      ? micboard.config.groups.find((g) => Number(g.group) === Number(row.group)) || {}
      : {};

    const rotation = document.createElement('div');
    rotation.className = 'group-rotation';

    const rotateId = `group-rotate-${row.group}`;
    const rotateWrap = document.createElement('div');
    rotateWrap.className = 'form-check form-check-inline mb-0';
    const rotateInput = document.createElement('input');
    rotateInput.type = 'checkbox';
    rotateInput.className = 'form-check-input';
    rotateInput.id = rotateId;
    // Absent means yes, matching `rotates()` — a board that turned rotation on
    // and saw nothing because no group had opted in would look broken.
    rotateInput.checked = stored.rotate !== false;
    rotateInput.addEventListener('change', () => {
      postJSON('api/group', { group: row.group, rotate: rotateInput.checked });
      stored.rotate = rotateInput.checked;
    });
    const rotateLabel = document.createElement('label');
    rotateLabel.className = 'form-check-label small';
    rotateLabel.htmlFor = rotateId;
    rotateLabel.textContent = 'In the rotation';
    rotateWrap.appendChild(rotateInput);
    rotateWrap.appendChild(rotateLabel);
    rotation.appendChild(rotateWrap);

    const dwellLabel = document.createElement('label');
    dwellLabel.className = 'small text-muted ms-2';
    dwellLabel.htmlFor = `group-dwell-${row.group}`;
    dwellLabel.textContent = 'Hold for';
    rotation.appendChild(dwellLabel);

    const dwell = document.createElement('input');
    dwell.type = 'number';
    dwell.id = `group-dwell-${row.group}`;
    dwell.className = 'form-control form-control-sm group-dwell';
    dwell.min = '5';
    dwell.max = '600';
    dwell.step = '5';
    dwell.value = Number.isFinite(Number(stored.dwell)) && stored.dwell ? stored.dwell : '';
    // Blank is "use the board's default", which is a real answer and the one
    // most groups want -- not every group needs its own timing.
    dwell.placeholder = String(DEFAULT_DWELL_SECONDS);
    dwell.addEventListener('change', () => {
      postJSON('api/group', { group: row.group, dwell: dwell.value });
    });
    rotation.appendChild(dwell);

    const seconds = document.createElement('span');
    seconds.className = 'small text-muted';
    seconds.textContent = 'seconds';
    rotation.appendChild(seconds);

    card.appendChild(rotation);

    const members = document.createElement('p');
    members.className = 'group-members';
    members.textContent = row.count ? names(row.slots) : 'No channels in this group';
    if (!row.count) members.classList.add('is-empty');
    card.appendChild(members);

    // A group pointing at a slot that no longer exists. Deleting a slot does
    // not visit every group, so these accumulate silently.
    if (row.missing.length) {
      const stale = document.createElement('p');
      stale.className = 'group-missing';
      stale.textContent = `Missing slots: ${row.missing.join(', ')}`;
      card.appendChild(stale);
    }

    holder.appendChild(card);
  });

  // ⭐ The reason this panel exists.
  const orphans = document.createElement('div');
  orphans.className = 'group-row group-orphans';
  const head = document.createElement('div');
  head.className = 'group-row-head';
  const label = document.createElement('span');
  label.className = 'group-title-static';
  label.textContent = 'In no group';
  head.appendChild(label);
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = `${loose.length} ch`;
  head.appendChild(count);
  orphans.appendChild(head);

  const detail = document.createElement('p');
  detail.className = 'group-members';
  if (loose.length) {
    detail.textContent = names(loose);
  } else {
    detail.textContent = 'Every channel is in at least one group.';
    detail.classList.add('is-empty');
  }
  orphans.appendChild(detail);
  holder.appendChild(orphans);
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

  ensureConfigHealthBindings();
  loadConfigHealth();

  renderConfigScopeNote();
  renderGroupSummary();

  // Render slot list (replacement for missing renderSlotList)
  const holder = document.getElementById('editor_holder');
  if (holder) {
    holder.innerHTML = '';
    // ⛔ Before the first payload there is no way to tell an empty board from
    // an unloaded one, and the blank-row fallback below looks identical in
    // both cases. Saving those blanks writes `slots: []` and wipes a
    // configured board -- verified against a running server (#150). So say
    // what is happening and draw nothing until the board has actually loaded.
    if (editorState(micboard) === 'waiting') {
      const waiting = document.createElement('div');
      waiting.className = 'small text-muted p-2';
      waiting.id = 'editor-waiting';
      waiting.textContent = waitingMessage();
      holder.appendChild(waiting);
      renderDiscoveredDeviceList();
      // ⚠️ And come back when it lands. Without this the editor waits for ever
      // -- which trades one broken state for another, quieter one.
      waitForConfigThenRender();
      return;
    }
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
          const idInput = row.querySelector('.cfg-id');
          if (idInput) idInput.value = slot.extended_id || '';
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
      renderReceiverHeadings();
    }
  }
  // Also for the configured-rows path above, which does not renumber anything.
  renderReceiverHeadings();
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
      // Was .cfg-ip — so "Clear IDs" wiped every receiver's IP address. There
      // was no Slot ID field to clear at the time; there is one now.
      const rows = document.querySelectorAll('#editor_holder .cfg-row');
      Array.from(rows).forEach((r) => {
        const idInput = r.querySelector('.cfg-id');
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
  applyPcoMappingToForm(pco.mapping);
  applyPcoProfilesToForm(pco);
  applyPcoWatchToForm(pco);
  // The screens the building has (#170), beside the rest of the configuration.
  applyScreensToForm(micboard.config || {});

  // ⛔ Guarded, like #save below. This function runs again on every settings
  // open and on closePCOView(), and an unguarded binding stacked one more
  // listener per visit -- so one click eventually added every discovered
  // channel several times over. Same shape as the bug that destroyed a config.
  const addDisc = document.getElementById('add-discovered');
  if (addDisc && addDisc.dataset.bound !== 'true') {
    addDisc.dataset.bound = 'true';
    addDisc.addEventListener('click', () => {
      addAllDiscoveredDevices();
    });
  }

  // ⚠️ Editing a row's address changes which receiver it belongs to, and a
  // heading describing rows that have since moved is worse than no heading.
  const editorHolder = document.getElementById('editor_holder');
  if (editorHolder && editorHolder.dataset.headingsBound !== 'true') {
    editorHolder.dataset.headingsBound = 'true';
    editorHolder.addEventListener('change', (e) => {
      if (e.target.closest('.cfg-ip, .cfg-type')) renderReceiverHeadings();
    });
  }

  // Saving a photo choice (#145). Delegated on the guide table, which is
  // rebuilt whenever the slot list or the folder changes.
  const guide = document.getElementById('background-filename-guide');
  if (guide && guide.dataset.bound !== 'true') {
    guide.dataset.bound = 'true';
    guide.addEventListener('change', (e) => {
      const select = e.target.closest('.media-pick');
      if (!select) return;
      postJSON(
        'api/media/assignment',
        { name: select.dataset.person, file: select.value },
        (resp) => {
          if (!resp || !resp.ok) return;
          // Keep the served copy in step so the board picks it up without a
          // reload; the next payload confirms it.
          if (!micboard.config.media) micboard.config.media = {};
          micboard.config.media.assignments = resp.assignments;
          scheduleBackgroundFilenameGuide();
        },
      );
    });
  }

  const addRx = document.getElementById('add-receiver');
  if (addRx && addRx.dataset.bound !== 'true') {
    addRx.dataset.bound = 'true';
    addRx.addEventListener('click', () => addManualReceiver());
  }

  const discoveredList = document.getElementById('discovered_list');
  if (discoveredList && discoveredList.dataset.bound !== 'true') {
    discoveredList.dataset.bound = 'true';
    discoveredList.addEventListener('click', (e) => {
      const button = e.target.closest('.add-discovered-one');
      if (!button) return;
      e.preventDefault();
      addDiscoveredReceiver(button.dataset.receiverIp);
    });
  }

  // #save lives in the served markup, so it outlives this function -- and this
  // function runs again every time the settings view is opened, and again on
  // closePCOView(). Binding unconditionally stacked one more click listener per
  // visit, and a single click then fired that many concurrent POSTs to
  // /api/config. Three of them arriving together is what destroyed an
  // operator's config.json on site. Same dataset.bound guard the other
  // ensure*Bindings helpers here use.
  const saveBtn = document.getElementById('save');
  if (saveBtn && saveBtn.dataset.bound !== 'true') {
    saveBtn.dataset.bound = 'true';
    saveBtn.addEventListener('click', () => {
      // A save takes seconds -- it tears down and redials every receiver -- and
      // there is no feedback on the button itself, so waiting operators click
      // it again. The server serialises saves now, but a second one is still a
      // second full rebuild of every receiver that nobody asked for.
      if (saveBtn.dataset.saving === 'true') return;

      const { incomplete, ...data } = generateJSONConfig();

      // Saving reloads the page, so a warning afterwards would be wiped along
      // with the rows it was about. Stop here instead and let the operator
      // finish them -- nothing is written, so nothing is lost either way.
      if (incomplete.length) {
        const described = incomplete.map((row) => {
          const detail = row.ip || row.name || row.id;
          return detail ? `slot ${row.slot} (${detail})` : `slot ${row.slot}`;
        }).join(', ');
        setConfigSaveStatus(
          `Nothing was saved. Choose a device type for ${described}, or clear the row to discard it.`,
          'error',
        );
        return;
      }

      // ⛔ Defence in depth for #150. With the editor no longer offering blank
      // rows before the board has loaded this should never fire by accident,
      // but it catches *any* route to the same outcome -- and that outcome is
      // not undoable by typing the rows back in, because the groups have
      // already been left pointing at channels that no longer exist.
      const emptying = emptyingSaveWarning(configuredCount(micboard), data.slots.length);
      if (emptying && !window.confirm(emptying)) {
        setConfigSaveStatus('Save cancelled.', 'info');
        return;
      }

      // ⛔ Only when somebody else is watching, and it names the cost: reconfig
      // drops every receiver socket for ~2 seconds, so this can blank a wall
      // mid-service. A prompt that always appeared would be dismissed unread.
      const warning = globalChangeWarning(micboard.viewers, { receivers: true });
      if (warning && !window.confirm(warning)) {
        setConfigSaveStatus('Save cancelled.', 'info');
        return;
      }

      const url = 'api/config';
      // Held until the page reloads on success, so the button stays shut for
      // the whole round trip rather than only until the response lands.
      saveBtn.dataset.saving = 'true';
      saveBtn.disabled = true;
      setConfigSaveStatus('Saving…', 'info');
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
        // Released only on failure -- the success path reloads the page.
        saveBtn.dataset.saving = 'false';
        saveBtn.disabled = false;
        setConfigSaveStatus(`Failed to save: ${formatError(err)}`, 'error');
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
        renderReceiverHeadings();
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
      renderReceiverHeadings();
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
      renderReceiverHeadings();
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
        applyPcoMappingToForm(p.mapping);
        applyPcoProfilesToForm(p);
        applyPcoWatchToForm(p);
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
    }
  });
  window.addEventListener('micboard:open-pco', showPCOView);
  window.addEventListener('wirelessboard:open-pco', showPCOView);
}

// Planning Center carries the mic name and number on the team position, so the
// position is the default source and the note category is only a fallback.
const DEFAULT_PCO_STRATEGY = 'position_or_note';

/**
 * Load the rule sets into the editor (#139).
 *
 * ⚠️ Deep-copied: they are edited in place, and editing the live config object
 * would apply changes the operator has not saved -- and could not cancel.
 */
// Planning Center's own three, in its own words. ⛔ The values are the stored
// vocabulary and `pco_live.timer_mode` rejects anything else, so this list and
// that tuple have to agree (#121).
const TIMER_MODES = ['full_item_length', 'end_item_on_time', 'end_service_on_time'];

/** Load the watch settings (#140) and the Live strip's (#121). */
function applyPcoWatchToForm(pcoCfg) {
  const cfg = pcoCfg || {};
  // ⚠️ Server settings, not matching rules and not per screen: following Live
  // spends one Planning Center account's allowance on behalf of every board.
  const liveStripEl = document.getElementById('pco-live-strip');
  if (liveStripEl) liveStripEl.checked = cfg.live_strip === true;
  const liveTimerEl = document.getElementById('pco-live-timer-mode');
  if (liveTimerEl) {
    liveTimerEl.value = TIMER_MODES.includes(cfg.live_timer_mode)
      ? cfg.live_timer_mode : 'full_item_length';
  }
  const watchEl = document.getElementById('pco-watch-active');
  if (watchEl) watchEl.checked = cfg.watch_active_plan === true;
  const interval = document.getElementById('pco-watch-interval');
  if (interval) {
    const seconds = Number(cfg.watch_interval_seconds);
    interval.value = Number.isFinite(seconds) && seconds > 0 ? seconds : 120;
  }
  const grace = document.getElementById('pco-watch-grace');
  if (grace) {
    const minutes = Number(cfg.watch_grace_minutes);
    grace.value = Number.isFinite(minutes) && minutes >= 0 ? minutes : 60;
  }
}

function applyPcoProfilesToForm(pcoCfg) {
  const list = (pcoCfg && pcoCfg.profiles) || [];
  pcoProfiles = Array.isArray(list)
    ? list.map((profile) => ({ ...profile, mapping: { ...(profile.mapping || {}) } }))
    : [];
  renderPcoProfiles();
}

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
  const elClearUnmatched = document.getElementById('pco-clear-unmatched');
  if (elClearUnmatched) elClearUnmatched.checked = m.clear_unmatched === true;
  const elAutoSync = document.getElementById('pco-auto-sync');
  if (elAutoSync) elAutoSync.checked = m.auto_sync === true;

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
  const planId = selectedPlanId();
  const serviceId = document.getElementById('pco-service-type-id')?.value || '';
  if (!host) return;
  if (!planId) {
    renderPcoTeamChoices(null);
    return;
  }

  host.innerHTML = '<span class="text-muted small">Loading teams…</span>';
  // Only ever called because the operator picked a plan or a service type, so
  // it carries refresh=1 for the same reason the people lookup does.
  const q = `plan=${encodeURIComponent(planId)}${serviceId ? `&service=${encodeURIComponent(serviceId)}` : ''}`;
  fetch(`api/pco/teams?${q}&refresh=1&_=${Date.now()}`, { cache: 'no-store' })
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
  const serviceTypeId = (document.getElementById('pco-service-type-id')?.value || '').trim();
  const noteCategory = (document.getElementById('pco-note-category')?.value || 'Mic / IEM Assignments').trim();
  const noteSource = (document.getElementById('pco-note-source')?.value || 'person').trim() || 'person';
  const teamFilterRaw = (document.getElementById('pco-team-filter')?.value || '');
  const strategy = (document.getElementById('pco-strategy')?.value || '').trim() || DEFAULT_PCO_STRATEGY;
  const numberFallbackEl = document.getElementById('pco-number-fallback');
  const seedExtendedIdEl = document.getElementById('pco-seed-extended-id');
  const clearUnmatchedEl = document.getElementById('pco-clear-unmatched');
  const autoSyncEl = document.getElementById('pco-auto-sync');
  const liveStripEl = document.getElementById('pco-live-strip');
  const liveTimerEl = document.getElementById('pco-live-timer-mode');
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
      clear_unmatched: clearUnmatchedEl ? !!clearUnmatchedEl.checked : false,
      auto_sync: autoSyncEl ? !!autoSyncEl.checked : false,
    },
  };
  if (serviceTypeId) {
    payload.services.service_type_id = serviceTypeId;
  }
  // ⚠️ Always sent, including as an empty list -- `update_pco_config` merges,
  // so omitting the key would make removing the last rule set impossible.
  payload.profiles = profilesToPayload(pcoProfiles);

  // Watching the active plan (#140). ⚠️ The numbers are sent as given and
  // clamped on the server, so a value typed here cannot put the watcher into
  // a state the server would not accept on its own.
  const watchEl = document.getElementById('pco-watch-active');
  payload.watch_active_plan = watchEl ? !!watchEl.checked : false;
  const interval = Number.parseInt(document.getElementById('pco-watch-interval')?.value, 10);
  if (Number.isFinite(interval)) payload.watch_interval_seconds = interval;
  const grace = Number.parseInt(document.getElementById('pco-watch-grace')?.value, 10);
  if (Number.isFinite(grace)) payload.watch_grace_minutes = grace;

  // The service-position strip (#121). ⛔ Server settings: following Live at
  // all, and which of Planning Center's three timers to use. *Where* the strip
  // sits is per screen and lives in view preferences, not here.
  payload.live_strip = liveStripEl ? !!liveStripEl.checked : false;
  if (liveTimerEl && TIMER_MODES.includes(liveTimerEl.value)) {
    payload.live_timer_mode = liveTimerEl.value;
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
  const planId = selectedPlanId();
  const resultEl = document.getElementById('pco-note-preview-results');
  const btn = document.getElementById('pco-note-preview');

  const blocker = planBlocker(planChoice(), nextPlanInfo);
  if (blocker) {
    if (resultEl) resultEl.innerHTML = `<span class="text-warning">${escapeHtml(blocker)}</span>`;
    appendPcoLog(blocker, 'warn');
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
  // ⛔ A locked device must not reach Planning Center either: a sync rewrites
  // every slot name on every board (#116).
  if (isLocked(micboard.viewerLock)) {
    showLockRefusal('pco');
    return;
  }
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
  // Opening the panel says nothing about which plan is next any more; the
  // answer is re-fetched with the list rather than carried over from whenever
  // the panel was last open.
  nextPlanInfo = null;
  lastConnect = null;
  setConnectStatus('', null);
  applyConnectedState();
  // Step 2 needs the service type list before it is any use.
  loadPcoServiceTypes();
  // Step 6 needs service types *and* folders, so a binding can be shown by
  // name rather than by the id that is actually stored.
  loadPcoBindingTargets();
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

/**
 * One row of the diff: what is on the slot, and what would be (#120).
 *
 * ⛔ textContent throughout. These are names from Planning Center and slot
 * labels somebody typed, and this table is rebuilt from a network response.
 */
function diffRow(change) {
  const tr = document.createElement('tr');
  tr.className = rowClass(change.action);

  const cells = [
    String(change.slot ?? ''),
    ACTION_LABELS[change.action] || change.action || '',
    diffNameCell(change.from),
    diffNameCell(change.to),
    describeRow(change),
  ];
  cells.forEach((text, i) => {
    const td = document.createElement('td');
    td.textContent = text;
    // The two name columns are the comparison; everything else is context.
    if (i === 2 || i === 3) td.className = 'sync-name';
    tr.appendChild(td);
  });
  return tr;
}

/**
 * The preview, as a diff of the board (#120).
 *
 * ⭐ This replaced a table of position / person / team / slots / matched-by,
 * which described the *plan*. An operator pressing Sync Now is agreeing to a
 * change to their board, and the old table never showed who was on a slot
 * already -- so the one question it could not answer was the only one worth
 * asking.
 */
function renderSyncDiff(changes) {
  const tbl = document.getElementById('pco-assignments-table');
  const tbody = document.querySelector('#pco-assignments-table tbody');
  if (!tbl || !tbody) return;
  tbody.innerHTML = '';

  const headRow = document.querySelector('#pco-assignments-table thead tr');
  if (headRow) {
    headRow.innerHTML = '<th>Slot</th><th></th><th>On it now</th><th>After</th><th>Why</th>';
  }

  const rows = Array.isArray(changes) ? changes : [];
  changedRows(rows).forEach((change) => tbody.appendChild(diffRow(change)));

  // ⭐ The quiet rows are kept but folded: on a board that synced last week
  // most rows are "already correct" and they bury the two that matter.
  const quiet = unchangedRows(rows);
  if (shouldFoldUnchanged(rows)) {
    const tr = document.createElement('tr');
    tr.className = 'sync-row-fold';
    const td = document.createElement('td');
    td.colSpan = 5;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-link btn-sm p-0';
    toggle.textContent = foldedLabel(rows);
    toggle.addEventListener('click', () => {
      const shown = tbody.querySelectorAll('tr.sync-row-unchanged').length > 0;
      if (shown) {
        tbody.querySelectorAll('tr.sync-row-unchanged').forEach((el) => el.remove());
        toggle.textContent = foldedLabel(rows);
      } else {
        quiet.forEach((change) => tbody.appendChild(diffRow(change)));
        toggle.textContent = 'Hide the slots that already match';
      }
    });
    td.appendChild(toggle);
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    quiet.forEach((change) => tbody.appendChild(diffRow(change)));
  }

  tbl.style.display = rows.length ? 'block' : 'none';
}

function renderSyncConflicts(conflicts) {
  const target = document.getElementById('pco-conflicts');
  if (!target) return;
  target.innerHTML = '';
  if (!Array.isArray(conflicts) || !conflicts.length) return;

  const heading = document.createElement('div');
  heading.className = 'text-danger';
  // ⛔ Says what happened, not just that something did. A contested slot is
  // left exactly as it was -- neither name written, and not cleared either --
  // so the operator has to know the board is still showing whatever was there
  // before, and that only they can settle it.
  heading.textContent = `${conflicts.length} slot${conflicts.length === 1 ? '' : 's'} claimed by more than one person `
    + '— left alone, nobody written:';
  target.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'mb-0';
  conflicts.forEach((c) => {
    const names = (c.claimants || []).map((x) => x.name).filter(Boolean);
    const li = document.createElement('li');
    li.textContent = `slot ${c.slot}: ${names.join(' and ')} both claim it`;
    list.appendChild(li);
  });
  target.appendChild(list);

  const note = document.createElement('div');
  note.className = 'small text-muted mt-1';
  note.textContent = 'Fix it in Planning Center and sync again, or set the name by hand below.';
  target.appendChild(note);
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

  const choice = planChoice();
  // ⛔ On "next upcoming" this sends no plan at all, so the server resolves it
  // at sync time. Sending the id resolved when the panel was opened would make
  // a board left up for a week sync last Sunday's plan.
  const planParam = syncPlanParam(choice);
  const endpoint = dryRun ? 'api/pco/preview' : 'api/pco/sync';
  const url = planParam ? `${endpoint}?plan=${encodeURIComponent(planParam)}` : endpoint;
  const verb = dryRun ? 'Previewing' : 'Syncing';
  appendPcoLog(`${verb} assignments with PCO (${planDescription(choice, nextPlanInfo)})...`);

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
      const changes = Array.isArray(resp.changes) ? resp.changes : [];
      const planId = resp.plan_id || '-';
      const slotsMatched = resp.slots_matched || 0;
      // ⭐ The diff's own sentence goes first (#120). "Plan 42 — 9 assignments
      // — 9 slots matched" is all true and answers nothing: an operator wants
      // to know what is about to happen to the board.
      const summaryParts = [diffHeadline(changes, { dryRun: Boolean(resp.dry_run) })];
      if (resp.dry_run) {
        summaryParts.push('<strong>preview only — nothing saved</strong>');
      }
      summaryParts.push(`Plan ${planId}`);
      if (unmatched.length) summaryParts.push(`${unmatched.length} unmatched`);
      // ⛔ What a sync takes *off* the board, and what it refuses to guess at,
      // used to be appended here (#135). The diff headline now says both, in
      // the same sentence as everything else -- saying them twice made the
      // line long enough that nobody would read either.
      const clearable = Array.isArray(resp.clearable) ? resp.clearable : [];
      if (summaryEl) summaryEl.innerHTML = summaryParts.join(' — ');

      if (clearable.length) {
        // Names them, so an unwanted clear can be put back by hand.
        const which = clearable.map((c) => `slot ${c.slot} (${c.name || 'unnamed'})`).join(', ');
        appendPcoLog(`${resp.dry_run ? 'Would clear' : 'Cleared'}: ${which}`, 'warn');
      }

      appendPcoLog(
        `${resp.dry_run ? 'Preview' : 'Sync'} complete for plan ${planId}: `
        + `${details.length} assignment(s), ${slotsMatched} slot(s) matched, `
        + `${resp.dry_run ? 'no changes written' : `${resp.updates || 0} update(s)`}`
        + `${unmatched.length ? `, ${unmatched.length} unmatched` : ''}.`,
        unmatched.length ? 'warn' : 'info',
      );

      renderSyncDiff(changes);
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
    } else if (t.id === 'pco-profile-add') {
      e.preventDefault();
      pcoProfiles.push({
        id: uniqueId('Rule set', pcoProfiles),
        name: '',
        mapping: {},
      });
      renderPcoProfiles();
    } else if (t.classList && t.classList.contains('pco-profile-remove')) {
      e.preventDefault();
      const index = Number.parseInt(t.getAttribute('data-index'), 10);
      if (Number.isFinite(index)) {
        pcoProfiles.splice(index, 1);
        renderPcoProfiles();
      }
    } else if (t.id === 'pco-connect') {
      e.preventDefault();
      handlePcoConnect();
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

/**
 * Ask the server which plan is next and relabel the option with its date.
 *
 * ⛔ Goes to its own endpoint rather than taking the first row of the plan
 * list: the list is scoped to the chosen service type, while a sync falls back
 * to scanning every service type when none is chosen. Offering one plan and
 * syncing another would be worse than not offering it at all.
 */
function refreshNextPlan() {
  const sel = document.getElementById('pco-plan-select');
  return fetch(`api/pco/next-plan?_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      nextPlanInfo = resp && typeof resp === 'object' ? resp : null;
      const opt = sel ? sel.querySelector(`option[value="${NEXT_PLAN}"]`) : null;
      if (opt) opt.textContent = nextPlanOptionLabel(nextPlanInfo);
      if (nextPlanInfo && nextPlanInfo.ok) {
        appendPcoLog(`Next upcoming plan is ${nextPlanInfo.plan_id}${nextPlanInfo.label ? ` (${nextPlanInfo.label})` : ''}.`);
      } else if (nextPlanInfo && nextPlanInfo.error) {
        appendPcoLog(`Could not work out the next plan: ${nextPlanInfo.error}`, 'warn');
      }
      return nextPlanInfo;
    })
    .catch((err) => {
      nextPlanInfo = { ok: false, error: formatError(err) };
      appendPcoLog(`Could not work out the next plan: ${formatError(err)}`, 'warn');
      return nextPlanInfo;
    });
}

/** Paint the line beside the Connect button. */
function setConnectStatus(text, level) {
  const el = document.getElementById('pco-connect-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'small';
  if (level && level !== 'ok') {
    el.classList.add(STATUS_CLASSES[level === 'error' ? 'error' : level] || 'text-muted');
  } else if (level === 'ok') {
    el.classList.add(STATUS_CLASSES.success);
  } else {
    el.classList.add('text-muted');
  }
}

/**
 * Connect: check the credentials against Planning Center, then store them (#120).
 *
 * ⛔ Deliberately not part of the form's Save. Saving used to be the only way
 * to store a token, and nothing exercised it until the operator tried to fetch
 * plans — so setup was save → fetch → find out it was wrong → save again, and
 * a bad token sat in the keyring looking like a good one.
 *
 * ⚠️ The token and secret go in the request body, never the query string: a
 * URL ends up in logs, in history, and in the referrer of the next request.
 */
function handlePcoConnect() {
  const tokenEl = document.getElementById('pco-token');
  const secretEl = document.getElementById('pco-secret');
  const btn = document.getElementById('pco-connect');
  const token = tokenEl ? tokenEl.value : '';
  const secret = secretEl ? secretEl.value : '';

  const blocker = connectBlocker(token, secret);
  if (blocker) {
    setConnectStatus(blocker, 'warn');
    appendPcoLog(blocker, 'warn');
    return;
  }

  if (btn) btn.disabled = true;
  setConnectStatus('Checking with Planning Center…', null);
  appendPcoLog('Checking the PCO token and secret...');

  fetch('api/pco/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token.trim(), secret: secret.trim() }),
  })
    .then((r) => r.json())
    .then((resp) => {
      lastConnect = resp && typeof resp === 'object' ? resp : null;
      const enabled = !!document.getElementById('pco-enabled')?.checked;
      const summary = connectSummary(resp, { enabled });
      setConnectStatus(summary.text, summary.level);
      appendPcoLog(summary.text, summary.level === 'ok' ? 'info' : summary.level);

      if (resp && resp.ok) {
        // ⚠️ Clear the fields now they are in the keyring. Leaving a secret on
        // screen in a room where a board is on a wall is its own problem, and
        // a populated field also reads as "not saved yet".
        if (tokenEl) tokenEl.value = '';
        if (secretEl) secretEl.value = '';
        if (micboard.config && micboard.config.pco) {
          micboard.config.pco.auth = { ...(micboard.config.pco.auth || {}), has_credentials: true };
        }
        // ⛔ Does not touch `pco-enabled`. That switch is the admin's: on stays
        // on, off stays off, and a save is what changes it. Connecting is not
        // consent to enable -- a board may be deliberately out of service.
        applyConnectedState();
        refreshPlansList({ auto: true });
      }
    })
    .catch((err) => {
      lastConnect = { ok: false, error: formatError(err) };
      const summary = connectSummary(lastConnect);
      setConnectStatus(summary.text, summary.level);
      appendPcoLog(`Connect failed: ${formatError(err)}`, 'error');
    })
    .finally(() => {
      if (btn) btn.disabled = false;
    });
}

/**
 * Reflect whether the board has working credentials.
 *
 * ⚠️ Stored credentials count, not only a connect made in this session — a
 * board set up months ago must not look like one that was never set up.
 */
function applyConnectedState() {
  const authMeta = (micboard.config && micboard.config.pco && micboard.config.pco.auth) || {};
  const hasStored = !!authMeta.has_credentials;
  const connected = isConnected({ hasStoredCredentials: hasStored, lastConnect });

  const refreshBtn = document.getElementById('pco-refresh-plans');
  if (refreshBtn) refreshBtn.disabled = !connected;

  // Only speak when nothing has been said this session; a fresh "Connected as
  // ..." should not be overwritten by the generic stored-credentials note.
  const statusEl = document.getElementById('pco-connect-status');
  if (statusEl && !statusEl.textContent.trim()) {
    setConnectStatus(storedCredentialsNote(hasStored), hasStored ? 'ok' : null);
  }
  return connected;
}

/** Options for a profile's binding picker, grouped by kind. */
function bindingOptionsHTML(profile) {
  const kind = bindingKind(profile);
  let chosen = '';
  if (kind === 'service_type') chosen = `st:${profile.service_type_id}`;
  if (kind === 'folder') chosen = `fo:${profile.folder_id}`;

  const option = (value, label) => `<option value="${escapeHtml(value)}"${value === chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  const parts = [option('', 'Chosen by hand when syncing')];
  if (pcoServiceTypes.length) {
    parts.push('<optgroup label="Service type">');
    pcoServiceTypes.forEach((st) => parts.push(option(`st:${st.id}`, st.name || `Service type ${st.id}`)));
    parts.push('</optgroup>');
  }
  if (pcoFolders.length) {
    parts.push('<optgroup label="Folder (covers every service type inside it)">');
    pcoFolders.forEach((f) => parts.push(option(`fo:${f.id}`, folderPath(f, pcoFolders) || `Folder ${f.id}`)));
    parts.push('</optgroup>');
  }

  // ⛔ A binding whose target is gone must stay selectable, or opening the
  // panel silently rewrites it to "chosen by hand" and the operator never
  // learns the folder was renamed.
  if (chosen && !parts.some((part) => part.includes(`value="${chosen}"`))) {
    parts.push(option(chosen, `${describeBinding(profile, { serviceTypes: pcoServiceTypes, folders: pcoFolders })}`));
  }
  return parts.join('');
}

/** The per-rule override controls for one profile. */
function overrideRowsHTML(profile, index) {
  const mapping = profile.mapping || {};
  return OVERRIDABLE.map((entry) => {
    const on = entry.key in mapping && mapping[entry.key] !== null;
    const value = mapping[entry.key];
    let control = '';
    if (entry.key === 'strategy') {
      control = `<select class="form-select form-select-sm pco-profile-value" data-index="${index}" data-key="${entry.key}"${on ? '' : ' disabled'}>
        ${['position_or_note', 'position', 'note_or_brackets'].map((v) => `<option value="${v}"${v === value ? ' selected' : ''}>${v}</option>`).join('')}
      </select>`;
    } else if (entry.key === 'note_source') {
      control = `<select class="form-select form-select-sm pco-profile-value" data-index="${index}" data-key="${entry.key}"${on ? '' : ' disabled'}>
        ${['person', 'plan', 'auto'].map((v) => `<option value="${v}"${v === value ? ' selected' : ''}>${v}</option>`).join('')}
      </select>`;
    } else if (entry.key === 'team_name_filter') {
      const text = Array.isArray(value) ? value.join(', ') : '';
      control = `<input type="text" class="form-control form-control-sm pco-profile-value" data-index="${index}" data-key="${entry.key}" value="${escapeHtml(text)}" placeholder="Vocal, Band"${on ? '' : ' disabled'}>`;
    } else if (entry.key === 'note_category') {
      control = `<input type="text" class="form-control form-control-sm pco-profile-value" data-index="${index}" data-key="${entry.key}" value="${escapeHtml(value || '')}"${on ? '' : ' disabled'}>`;
    } else {
      control = `<div class="form-check mb-0"><input type="checkbox" class="form-check-input pco-profile-value" data-index="${index}" data-key="${entry.key}"${value ? ' checked' : ''}${on ? '' : ' disabled'}></div>`;
    }

    return `<div class="d-flex align-items-center gap-2 mb-1">
      <div class="form-check mb-0" style="min-width:11rem">
        <input type="checkbox" class="form-check-input pco-profile-override" id="po-${index}-${entry.key}" data-index="${index}" data-key="${entry.key}"${on ? ' checked' : ''}>
        <label class="form-check-label small" for="po-${index}-${entry.key}">${escapeHtml(entry.label)}</label>
      </div>
      <div class="flex-grow-1">${control}</div>
    </div>`;
  }).join('');
}

/**
 * Draw the rule sets.
 *
 * ⚠️ Every problem is shown on the card it belongs to rather than as one
 * summary line. "Something is wrong with your rule sets" is not actionable on
 * a Sunday morning.
 */
/** What the board's own form currently says for a mapping key. */
function currentBoardMappingValue(key) {
  const el = {
    strategy: 'pco-strategy',
    note_category: 'pco-note-category',
    note_source: 'pco-note-source',
    team_name_filter: 'pco-team-filter',
    position_number_fallback: 'pco-number-fallback',
    seed_extended_id: 'pco-seed-extended-id',
    clear_unmatched: 'pco-clear-unmatched',
    auto_sync: 'pco-auto-sync',
  }[key];
  const node = el ? document.getElementById(el) : null;
  if (!node) return key === 'team_name_filter' ? [] : '';
  if (node.type === 'checkbox') return !!node.checked;
  if (key === 'team_name_filter') {
    return node.value.split(',').map((x) => x.trim()).filter((x) => x);
  }
  return node.value;
}

function renderPcoProfiles() {
  const host = document.getElementById('pco-profile-list');
  if (!host) return;

  if (!pcoProfiles.length) {
    host.innerHTML = '<div class="small text-muted">No rule sets. Every plan uses the settings above.</div>';
    return;
  }

  host.innerHTML = pcoProfiles.map((profile, index) => {
    const problem = validateProfile(profile, pcoProfiles);
    const dangling = bindingIsDangling(profile, {
      serviceTypes: pcoServiceTypes, folders: pcoFolders,
    });
    const overrides = overriddenKeys(profile).length;

    return `<div class="p-2 mb-2 border rounded">
      <div class="d-flex flex-wrap gap-2 align-items-center">
        <input type="text" class="form-control form-control-sm pco-profile-name" data-index="${index}"
               value="${escapeHtml(profile.name || '')}" placeholder="Name, e.g. Wednesday Youth" style="max-width:16rem">
        <select class="form-select form-select-sm pco-profile-binding" data-index="${index}" style="max-width:22rem">
          ${bindingOptionsHTML(profile)}
        </select>
        <button type="button" class="btn btn-outline-danger btn-sm pco-profile-remove" data-index="${index}">Remove</button>
      </div>
      <div class="small ${dangling ? 'text-danger' : 'text-muted'} mt-1">
        ${escapeHtml(describeBinding(profile, { serviceTypes: pcoServiceTypes, folders: pcoFolders }))}
        &mdash; ${overrides} rule${overrides === 1 ? '' : 's'} changed
      </div>
      ${problem ? `<div class="small text-warning mt-1">${escapeHtml(problem)}</div>` : ''}
      <div class="mt-2">${overrideRowsHTML(profile, index)}</div>
    </div>`;
  }).join('');
}

/** Service types and folders, so bindings can be shown by name. */
function loadPcoBindingTargets() {
  const seen = (resp, key) => (resp && resp.ok && Array.isArray(resp[key]) ? resp[key] : []);
  return Promise.all([
    fetch(`api/pco/services?_=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    fetch(`api/pco/folders?_=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
  ]).then(([services, folders]) => {
    pcoServiceTypes = seen(services, 'services');
    pcoFolders = seen(folders, 'folders');
    renderPcoProfiles();
  });
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
    if (sel) sel.innerHTML = '<option value="">Tick Enable PCO and save, then refresh plans.</option>';
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

  // ⚠️ Read before the "Loading…" placeholder wipes it, or the operator's
  // explicit choice is lost on every refresh.
  const previous = sel ? (sel.value || '') : '';
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
        // ⭐ "Next upcoming" is first and is what the select lands on, because
        // it is the right answer almost every week. Picking this Sunday's plan
        // out of a list by hand was the one chore nobody could skip (#120).
        sel.innerHTML = `<option value="${NEXT_PLAN}">${nextPlanOptionLabel(nextPlanInfo)}</option>`
          + '<option value="">Select a plan…</option>';
        plans.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id || '';
          opt.textContent = planLabel(p);
          sel.appendChild(opt);
        });
        // Keep an explicit choice across a refresh; otherwise land on "next".
        sel.value = previous && previous !== NEXT_PLAN && plans.some((p) => p.id === previous)
          ? previous
          : NEXT_PLAN;
      }
      appendPcoLog(`Fetched ${plans.length} plan(s) from PCO.`);
      return refreshNextPlan().then(() => {
        // Setting `.value` fires no change event, so the work the operator's
        // own selection would have triggered has to be done by hand.
        if (btn) btn.disabled = !selectedPlanId();
        if (sel && sel.value === NEXT_PLAN && selectedPlanId()) loadPcoTeams();
      });
    })
    .catch((err) => {
      if (sel) sel.innerHTML = '<option value="">No plans</option>';
      console.warn('Failed to load plans', err);
      appendPcoLog(`Failed to fetch plans: ${formatError(err)}`, 'error');
    });
}

/**
 * Drop everything belonging to a plan that is no longer selected.
 *
 * The people table, the assignment builder below it and the summaries all
 * describe one plan, and none of them reload on their own.
 */
function clearLoadedPlanPeople() {
  const tbody = document.querySelector('#pco-people-table tbody');
  if (tbody) tbody.innerHTML = '';
  const tblWrap = document.getElementById('pco-people-table');
  if (tblWrap) tblWrap.style.display = 'none';
  const summary = document.getElementById('pco-people-summary');
  if (summary) summary.textContent = '';
  const assignBody = document.querySelector('#pco-assign-table tbody');
  if (assignBody) assignBody.innerHTML = '';
  const assignSummary = document.getElementById('pco-assign-summary');
  if (assignSummary) {
    assignSummary.textContent = 'Press Load People to read this plan from Planning Center.';
  }
}

function loadPeopleForSelectedService() {
  const planId = selectedPlanId();
  const summary = document.getElementById('pco-people-summary');
  const tblWrap = document.getElementById('pco-people-table');
  const tbody = document.querySelector('#pco-people-table tbody');
  const assignSummary = document.getElementById('pco-assign-summary');
  const blocker = planBlocker(planChoice(), nextPlanInfo);
  if (blocker) {
    appendPcoLog(`Cannot load people: ${blocker}`, 'warn');
    if (summary) summary.innerHTML = `<span class="text-warning">${escapeHtml(blocker)}</span>`;
    return;
  }
  if (summary) summary.textContent = '';
  if (tbody) tbody.innerHTML = '';
  if (tblWrap) tblWrap.style.display = 'none';
  appendPcoLog(`Loading people for plan ${planId}...`);
  // refresh=1: this is the operator asking, so it must not be answered from the
  // server's missing-plan memory. Without it a plan cached as gone kept
  // reporting gone for five minutes however many times the button was pressed.
  fetch(`api/pco/people?plan=${encodeURIComponent(planId)}&refresh=1&_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((resp) => {
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Failed to load people');
      const ppl = resp.people || [];
      ppl.forEach((p) => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        const tdTeam = document.createElement('td');
        // A row is one assignment, not one person: somebody can hold two
        // positions on the same team. Without this column those rows are
        // identical on screen and read as duplicates.
        const tdPosition = document.createElement('td');
        const tdNote = document.createElement('td');
        tdName.textContent = p.name || '';
        tdTeam.textContent = p.team || '';
        tdPosition.textContent = p.position || '';
        const notesArr = Array.isArray(p.notes) ? p.notes : [];
        tdNote.textContent = (notesArr.length ? notesArr.join(' | ') : '');
        tr.appendChild(tdName); tr.appendChild(tdTeam);
        tr.appendChild(tdPosition); tr.appendChild(tdNote);
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
  // ⛔ Two different blanks. "-- choose --" means "leave this slot as it is",
  // which is what most rows want; CLEAR_ASSIGNMENT means "take the person off
  // it". Before #135 there was only the first, so once a name was on a slot the
  // only way off was the Slot Configuration page.
  const optionsHTML = [
    '<option value="">-- choose --</option>',
    `<option value="${CLEAR_ASSIGNMENT}">— clear this slot —</option>`,
  ]
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
  if (t.classList && t.classList.contains('pco-profile-name')) {
    const profile = pcoProfiles[Number.parseInt(t.getAttribute('data-index'), 10)];
    if (profile) {
      profile.name = t.value;
      // ⚠️ The id is set once, from the first name given, and never follows a
      // rename. It is what a sync names when refusing an unknown profile, and
      // a shifting id would break a hand-pick saved anywhere else.
      if (!profile.id || /^rule-set(-\d+)?$/.test(profile.id)) {
        profile.id = uniqueId(t.value, pcoProfiles.filter((p) => p !== profile));
      }
      renderPcoProfiles();
    }
    return;
  }
  if (t.classList && t.classList.contains('pco-profile-binding')) {
    const profile = pcoProfiles[Number.parseInt(t.getAttribute('data-index'), 10)];
    if (profile) {
      delete profile.service_type_id;
      delete profile.folder_id;
      const [kind, id] = String(t.value || '').split(':');
      if (kind === 'st' && id) profile.service_type_id = id;
      if (kind === 'fo' && id) profile.folder_id = id;
      renderPcoProfiles();
    }
    return;
  }
  if (t.classList && t.classList.contains('pco-profile-override')) {
    const profile = pcoProfiles[Number.parseInt(t.getAttribute('data-index'), 10)];
    const key = t.getAttribute('data-key');
    if (profile && key) {
      profile.mapping = profile.mapping || {};
      if (t.checked) {
        // Starts from whatever the board currently says, so turning an
        // override on does not silently change the rule at the same time.
        profile.mapping[key] = currentBoardMappingValue(key);
      } else {
        delete profile.mapping[key];
      }
      renderPcoProfiles();
    }
    return;
  }
  if (t.classList && t.classList.contains('pco-profile-value')) {
    const profile = pcoProfiles[Number.parseInt(t.getAttribute('data-index'), 10)];
    const key = t.getAttribute('data-key');
    if (profile && key && profile.mapping && key in profile.mapping) {
      if (t.type === 'checkbox') {
        profile.mapping[key] = t.checked;
      } else if (key === 'team_name_filter') {
        profile.mapping[key] = t.value.split(',').map((x) => x.trim()).filter((x) => x);
      } else {
        profile.mapping[key] = t.value;
      }
    }
    return;
  }
  if (t.id === 'pco-plan-select') {
    const loadBtn = document.getElementById('pco-load-people');
    if (loadBtn) loadBtn.disabled = !selectedPlanId();
    // ⛔ Clear what the previous plan left behind before anything else. The
    // people table and the assignment list are not reloaded until the operator
    // presses Load People, so leaving them up means a new plan shows the old
    // plan's names — which reads as "the new plan loaded" when nothing has been
    // fetched at all, and as "nothing happened" when a load then fails.
    clearLoadedPlanPeople();
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
  if (t.id === 'pco-clear-assignments') {
    e.preventDefault();
    clearAllAssignments();
  }
}, { passive: false });

/**
 * Take people off slots (#135).
 *
 * ⚠️ Clears the name and keeps `extended_id`: the position is what a later sync
 * matches on and is often something the operator set deliberately. A slot keeps
 * its role when the person leaves it.
 */
function clearSlotAssignments(slotNumbers) {
  const summary = document.getElementById('pco-clear-summary');
  const updates = clearUpdates(slotNumbers);
  if (!updates.length) {
    if (summary) summary.textContent = clearedSummary(0);
    return;
  }

  appendPcoLog(`Clearing ${updates.length} slot assignment(s)...`);
  postJSON('api/slot', updates, () => {
    if (summary) summary.textContent = clearedSummary(updates.length);
    appendPcoLog(`Cleared ${updates.length} slot assignment(s).`);
    // Handles the local config, the Config page input, the assign row and the
    // dropdown; it already treats an empty name as "clear".
    try { applyExtendedNameChanges(updates); } catch (e) {
      appendPcoLog(`Unable to refresh names locally: ${formatError(e)}`, 'warn');
    }
  }, (err) => {
    appendPcoLog(`Failed to clear assignments: ${formatError(err)}`, 'error');
  });
}

function clearAllAssignments() {
  const slots = assignedSlots((micboard.config && micboard.config.slots) || []);
  const summary = document.getElementById('pco-clear-summary');
  const question = clearAllConfirmation(slots.length);
  if (!question) {
    if (summary) summary.textContent = clearedSummary(0);
    return;
  }
  if (!window.confirm(question)) {
    return;
  }
  // Lists them before clearing, so an accidental yes is recoverable by hand.
  appendPcoLog(`Clearing assignments on slot(s): ${slots.join(', ')}`);
  clearSlotAssignments(slots);
}

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
    if (!Number.isFinite(slot)) return;

    // An explicit clear is a real update; a blank is "leave it alone".
    const choice = parseSelection(sel.value);
    if (choice.action === 'skip') return;
    if (choice.action === 'clear') {
      updates.push({ slot, extended_name: '' });
      return;
    }

    const { name } = choice;
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
    if (summary) summary.innerHTML = '<span class="text-warning">Select at least one person, or choose “clear this slot”.</span>';
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
  const planId = selectedPlanId();
  const assignSummary = document.getElementById('pco-assign-summary');
  const blocker = planBlocker(planChoice(), nextPlanInfo);
  if (blocker) {
    if (assignSummary) assignSummary.innerHTML = `<span class="text-warning">${escapeHtml(blocker)}</span>`;
    appendPcoLog(`Cannot auto-fill assignments: ${blocker}`, 'warn');
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

// -- Screens ----------------------------------------------------------------
// ⭐ The sizes are global because they describe the building; which screen a
// device *is* lives on that device, in its view settings (#170).

let screenRows = [];

function renderScreenRows() {
  const host = document.getElementById('screen-list');
  if (!host) return;
  host.innerHTML = '';

  if (!screenRows.length) {
    const empty = document.createElement('div');
    empty.className = 'small text-muted';
    empty.textContent = 'No screens described. Boards will have no minimum column width.';
    host.appendChild(empty);
    return;
  }

  screenRows.forEach((row, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'row g-2 align-items-end mb-2';

    const field = (label, key, attrs, width) => {
      const col = document.createElement('div');
      col.className = width;
      const lab = document.createElement('label');
      lab.className = 'form-label small mb-0';
      lab.textContent = label;
      const input = document.createElement('input');
      input.className = 'form-control form-control-sm';
      Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
      input.value = row[key] === null || row[key] === undefined ? '' : row[key];
      input.addEventListener('input', () => {
        screenRows[index][key] = input.value;
        // ⛔ Update this row's note in place, never re-render the list. The
        // inputs would be rebuilt under the cursor and the field being typed
        // into would lose focus on every keystroke.
        refreshScreenProblem(index);
        updateScreenStatus();
      });
      col.appendChild(lab);
      col.appendChild(input);
      return col;
    };

    wrap.appendChild(field('Name', 'name', { type: 'text', placeholder: 'Auditorium wall' }, 'col-12 col-md-5'));
    wrap.appendChild(field('Diagonal (in)', 'diagonal_inches', {
      type: 'number', min: '1', step: '0.5', placeholder: '55',
    }, 'col-6 col-md-3'));
    wrap.appendChild(field('Dock position (in)', 'min_column_inches', {
      type: 'number', min: '0', step: '0.25', placeholder: 'optional',
    }, 'col-6 col-md-3'));

    const removeCol = document.createElement('div');
    removeCol.className = 'col-12 col-md-1 d-grid';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-outline-secondary btn-sm';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      screenRows.splice(index, 1);
      renderScreenRows();
      updateScreenStatus();
    });
    removeCol.appendChild(remove);
    wrap.appendChild(removeCol);

    // ⚠️ On the row it belongs to. "Something is wrong with your screens" is
    // not actionable on a Sunday morning. Always present so it can be filled
    // in as somebody types, rather than appearing and reflowing the row.
    const note = document.createElement('div');
    note.className = 'col-12 small text-warning screen-problem';
    note.textContent = screenProblem(row) || '';
    wrap.appendChild(note);

    host.appendChild(wrap);
  });
}

/** Re-state one row's problem without rebuilding the inputs. */
function refreshScreenProblem(index) {
  const host = document.getElementById('screen-list');
  const wrap = host && host.querySelectorAll('.row')[index];
  const note = wrap && wrap.querySelector('.screen-problem');
  if (note) note.textContent = screenProblem(screenRows[index]) || '';
}

function updateScreenStatus(message) {
  const status = document.getElementById('screen-status');
  if (status) status.textContent = message || '';
}

function applyScreensToForm(cfg) {
  const list = (cfg && cfg.screens) || [];
  screenRows = Array.isArray(list) ? list.map((s) => ({ ...s })) : [];
  renderScreenRows();
}

function saveScreens() {
  const payload = screensToPayload(screenRows);
  // ⛔ Worked out from what was *submitted*, before the server's answer
  // replaces the rows. Computed afterwards it compares the saved list with
  // itself, so "1 incomplete row not saved" could never appear -- which is
  // exactly the sentence somebody needs.
  const summary = screensSaveSummary(screenRows);
  // ⛔ Its own endpoint, not the configuration save: describing a screen
  // changes how a board lays itself out and nothing about the receivers, so it
  // must not drop every socket for two seconds (#116).
  postJSON('api/screens', { screens: payload }, (resp) => {
    if (resp && resp.ok) {
      // ⛔ Merged, never replaced (#180). The response holds only what was
      // stored, so assigning it over the form deleted the row somebody was
      // still filling in -- in the same breath as telling them it had not been
      // saved, and with nothing left to correct.
      screenRows = mergeSaved(screenRows, resp.screens);
      renderScreenRows();
      updateScreenStatus(summary);
    } else {
      updateScreenStatus((resp && resp.error) || 'Could not save the screens.');
    }
  });
}

export function bindScreenHandlers() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'screen-add') {
      e.preventDefault();
      screenRows.push({ name: '', diagonal_inches: '', min_column_inches: '' });
      renderScreenRows();
    } else if (t.id === 'screen-save') {
      e.preventDefault();
      saveScreens();
    }
  });
}
