// ⚠️ `Collapse` went with the Help overlay (#225); `Modal` is the QR dialog.
import { Modal } from 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import QRCode from 'qrcode';
import 'whatwg-fetch';

import { renderGroup } from './channelview.js';
import { initLiveData } from './data.js';
import { groupEditToggle, initEditor } from './dnd.js';
import { initSlotsTable, refreshSlotsTable } from './slots-table.js';
import { keybindings } from './kbd.js';
import {
  setBackground, setInfoDrawer, applyBoardLayout,
  setViewOption, viewOptionValue, setDisplayMode,
  isFullscreen, setFullscreen,
} from './display.js';
import { drawerBits, drawerModeWith, DRAWER_MODES } from './panel-controls.mjs';
import { registerAdminRoute } from './admin-page.mjs';
import { initAdminPage, openAdminPage } from './admin-page.js';
import { initViewPanel, toggleViewPanel } from './view-panel.js';
import { setTimeMode } from './signal-view.js';
import {
  initConfigEditor,
  bindPcoNav,
  bindPcoHandlers,
  bindScreenHandlers,
  configureConfigModule,
  scheduleBackgroundFilenameGuide,
  refreshScreensEditor,
  showLogsSection,
  hideLogsSection,
  showBackgroundsSection,
  showConfigHealth,
  fillPcoSection,
  fillPcoWeekly,
} from './config.js';
import { startTvLayoutWatchers } from './tv-layout.js';
import {
  isArrangement, isCardShape, isTypeSize, isColumnChoice,
  isWashStyle, migrateArrangement, migrateCardShape,
} from './board-layout.mjs';
import {
  resolvePref, readPref, writePref, safeStorage,
  ARRANGEMENT_KEY, CARD_SHAPE_KEY, TYPE_SIZE_KEY, COLUMNS_KEY,
  WASH_KEY,
  DISPLAY_MODE_KEY, isDisplayMode,
  LIVE_PLACEMENT_KEY,
  ROTATION_KEY,
  VIEWER_LOCK_KEY,
  SCREEN_KEY,
  STATUS_BAR_KEY, isStatusBarPlacement,
} from './view-prefs.mjs';
import { PLACEMENTS, DEFAULT_PLACEMENT } from './live-strip.mjs';
import { ROTATION_STATES } from './rotation-states.mjs';
import { LOCK_STATES, isLocked, allows } from './viewer-lock.mjs';
import { showLockRefusal } from './viewer-lock-view.js';
import { startLiveStrip } from './live-strip-view.js';
import { installSweep } from './board-sweep-run.js';
import { startRotation, noteInteraction } from './rotation-view.js';

import '../css/colors.scss';
import '../css/style.scss';
import '@ibm/plex/css/ibm-plex.css';

export const dataURL = 'data.json';

export const micboard = [];
export const wirelessboard = micboard;
micboard.MIC_MODELS = ['uhfr', 'qlxd', 'ulxd', 'axtd', 'slxd', 'slxdplus'];

micboard.IEM_MODELS = ['p10t'];
micboard.url = [];
micboard.displayMode = 'deskmode';
// These defaults are the fit-to-page, centred-text board this has always been.
// Resolved properly in readURLParameters once the hash and storage are known.
micboard.arrangement = 'fit';
micboard.cardShape = 'auto';
micboard.typeSize = 'medium';
micboard.columns = 'auto';
micboard.wash = 'band';
micboard.livePlacement = 'bottom';
micboard.rotation = 'off';
micboard.viewerLock = 'off';
micboard.screenId = '';
micboard.infoDrawerMode = 'elinfo11';
micboard.backgroundMode = 'NONE';
micboard.backgroundDefaultMode = 'NONE';
micboard.settingsMode = 'NONE';
micboard.configTab = 'devices';
micboard.chartTimeSrc = 'SERVER';

micboard.group = 0;
micboard.connectionStatus = 'CONNECTING';

micboard.transmitters = [];

micboard.displayList = [];

if (typeof window !== 'undefined') {
  window.micboard = micboard;
  window.wirelessboard = micboard;
  const legacyRoot = document.getElementById('micboard');
  if (legacyRoot) {
    legacyRoot.classList.add('wirelessboard-board');
    legacyRoot.dataset.wirelessboardRoot = 'true';
  }
}

export function ActivateMessageBoard(h1, p) {
  if (!h1) {
    h1 = 'Connection Error!';
    p = 'Could not connect to the wirelessboard server. Please <a href=".">refresh</a> the page.';
  }

  const mbEl = document.getElementById('micboard');
  if (mbEl) mbEl.style.display = 'none';
  const settingsEl = document.getElementsByClassName('settings')[0];
  if (settingsEl) settingsEl.style.display = 'none';
  const eb = document.getElementsByClassName('message-board')[0];
  if (eb) {
    const h1el = eb.querySelector('h1');
    if (h1el) h1el.innerHTML = h1;
    const pel = eb.querySelector('p');
    if (pel) pel.innerHTML = p;
    eb.style.display = 'block';
  }

  micboard.connectionStatus = 'DISCONNECTED';
}

export function generateQR() {
  const qrOptions = {
    width: 600,
    margin: 0,
  };

  const url = micboard.localURL + window.location.pathname + window.location.search;
  const linkEl = document.getElementById('largelink');
  if (linkEl) { linkEl.href = url; linkEl.innerHTML = url; }
  const qrCanvas = document.getElementById('qrcode');
  QRCode.toCanvas(qrCanvas, url, qrOptions, (error) => {
    if (error) console.error(error);
  });
  const verEl = document.getElementById('wirelessboard-version') || document.getElementById('micboard-version');
  if (verEl) verEl.innerHTML = `Wirelessboard version: ${VERSION}`;
}

function groupTableBuilder(data) {
  const plist = {};

  data.config.groups.forEach((e) => {
    const entry = {
      slots: e.slots,
      title: e.title,
      hide_charts: e.hide_charts,
    };

    if (entry.hide_charts == null) {
      entry.hide_charts = false;
    }

    plist[e.group] = entry;
  });

  return plist;
}

export function updateNavLinks() {
  if (!micboard.groups) return;
  let str = '';
  for (let i = 1; i <= 9; i += 1) {
    str = '';
    if (micboard.groups[i]) {
      str = `${i}: ${micboard.groups[i].title}`;
    } else {
      str = `${i}:`;
    }
    const el = document.getElementById(`go-group-${i}`);
    if (el) el.innerHTML = str;
  }
}

// ⛔⛔ `syncHudPane`, `showHudPane` and `hideHud` were here, driving the Help
// overlay. #225 retired it, for two faults at once:
//
//   1. **Nothing closed it.** There was no control on the overlay, Escape
//      reloads the whole page, and its only toggle was the Help item in the view
//      panel -- which the panel then closed behind itself. A full-width overlay
//      that cannot be dismissed is what the maintainer found during testing.
//   2. **Its content was stale, and one line of it was dangerous.** Three of its
//      four Quick Start items pointed at a `Menu` #188 had removed, and the last
//      told an operator to keep Config open in another tab during a service --
//      which is exactly what blanks the wall, since a save rebuilds every
//      receiver socket.
//
// Help is a section of the administration page now, drawn inside the overlay, so
// it has a Back control and the overlay’s close. Its text is data in
// `help-content.mjs`, which is what lets a test fail if it goes stale again.
//
// ⚠️ The `hideHud()` calls that sat in every route went with it: there is no
// overlay left to hide.

/**
 * Refuse an action on a locked device, and say so (#116).
 *
 * ⛔ Every pointer route to an editor goes through here. The menu items are
 * hidden when locked, but hiding is presentation -- a stale menu, a keyboard,
 * or a `#settings=true` link would all still reach them.
 */
/**
 * The live board controls behind the panel (#160).
 *
 * ⛔ Not preferences. Nothing here is written to storage: backgrounds and the
 * info drawer live in the hash, and fullscreen lives in the browser. They are
 * read back off the board every time the panel renders, which is why a window
 * that leaves fullscreen by itself does not leave a switch claiming otherwise.
 */
function boardOptionValue(id) {
  switch (id) {
    case 'background':
      return micboard.backgroundMode;
    case 'drawer':
      return drawerBits(micboard.infoDrawerMode).drawer;
    case 'statusStripe':
      return drawerBits(micboard.infoDrawerMode).stripe;
    case 'fullscreen':
      return isFullscreen() ? 'on' : 'off';
    default:
      return undefined;
  }
}

function setBoardOption(id, value) {
  switch (id) {
    case 'background':
      setBackground(value);
      return value;
    case 'drawer':
    case 'statusStripe':
      // ⚠️ One bit at a time, through the pure helper. Writing the four-state
      // code by hand here is how the two halves would come to disagree.
      setInfoDrawer(
        drawerModeWith(
          micboard.infoDrawerMode,
          id === 'drawer' ? 'drawer' : 'stripe',
          value,
        ),
        { switchToTv: false },
      );
      return value;
    case 'fullscreen':
      setFullscreen(value === 'on');
      return value;
    default:
      return null;
  }
}

function refuseWhenLocked(action) {
  if (allows(micboard.viewerLock, action)) {
    return false;
  }
  showLockRefusal(action);
  return true;
}

function mapGroups() {
  // ⛔ The Help overlay's bindings were here: a `shown.bs.collapse` pair, the
  // pane-switching buttons, and an initial `syncHudPane`. All of it belonged to
  // an overlay nothing could close (#225). Help is a section of the
  // administration page now.

  // Ensure single-view visibility helper
  /**
   * ⛔ ONE view now, not two. #222 retired the configuration pane and the
   * weekly Planning Center surface is a pane on the administration page, so
   * every secondary surface is an overlay that hides nothing underneath it.
   * There is nothing left to choose between: the board is always the view.
   *
   * ⚠️ Kept rather than deleted because the callers are about *returning* to
   * the board — picking a preset, and start-up — and a named "show the board"
   * is clearer at those call sites than an inlined property write.
   *
   * ⚠️ The log auto-refresh stop that used to live in the `wasConfig` branch
   * is not lost: the administration page releases a section when it closes,
   * which is what actually stops that timer now.
   */
  function resetViews() {
    const mb = document.getElementById('micboard');
    // ⛔ `hidden`, not an inline `display`. Writing `display: grid` here put an
    // inline style on the board that beat every stylesheet rule -- so Rack
    // could not lay its channels out as a list however the stylesheet asked
    // (#233). The base rule already says `grid`; what this has to decide is
    // whether the board is on screen, not how it is arranged.
    if (mb) mb.hidden = false;
  }

  /**
   * The configuration pane, on a given tab.
   *
   * ⭐ Extracted so the menu item and the administration page run the *same*
   * function rather than two that drift (#188). It keeps the lock refusal, so
   * the new route cannot be the one that forgets it. The registration below
   * stays when the menu item goes.
   */

  function toggleDemoMode() {
    if (refuseWhenLocked('demo')) return;
    micboard.url.demo = micboard.url.demo === 'true' ? undefined : 'true';
    updateHash();
    window.location.reload();
  }

  // ⛔ One registration per rail item (#188). `admin-page.test.mjs` fails if a
  // guarded action has no item, and the page itself says so if an item has no
  // route -- a button that draws and does nothing is the same failure as a
  // missing one, and harder to notice.
  // ⭐ No route for `slots`: it is drawn in the content pane like Screens and
  // Logs, so the rail renders it in place rather than handing over. The editor
  // that used to take the whole board is gone with it (`slots-table.js`).
  registerAdminRoute('demo', toggleDemoMode);
  // ⛔⛔ No route for `pco` any more. It is in `IN_PAGE_ITEMS`, so the rail
  // draws it as a pane; a registered route would be unreachable, and
  // `admin-page.test.mjs` fails on a route with no item.
  //
  // ⭐ The legacy events still open it, for the `#pco=true` deep link and the
  // plan-change notice. They ask the PAGE to show the section rather than
  // drawing anything themselves.
  const openWeeklyPlan = () => openAdminPage('pco');
  window.addEventListener('micboard:open-pco', openWeeklyPlan);
  window.addEventListener('wirelessboard:open-pco', openWeeklyPlan);

  // ⛔ The one control a board can always reach (#110, #111). It opens the view
  // panel, which carries the switch for the bar itself -- so hiding the bar can
  // no longer leave a keyboard-less display with nothing to press. Bound
  // unconditionally: it must not depend on any pane above having rendered.
  initViewPanel({
    setViewOption,
    viewOptionValue,
    setBoardOption,
    boardOptionValue,
    setDisplayMode,
    getDisplayMode: () => micboard.displayMode,
    // ⛔ So the panel can say why Page through is not doing what it says.
    getPagingState: () => ({
      reason: micboard.pagingReason || null,
      shown: micboard.pagingScope && micboard.pagingScope.shown,
      total: micboard.pagingScope && micboard.pagingScope.total,
    }),
    getGroups: () => micboard.groups || {},
    getGroup: () => micboard.group || 0,
    setGroup: (n) => renderGroup(n),
    // ⛔ So the door at the foot of the panel can be drawn refused rather than
    // hidden when the board is locked to display only (#188).
    getLockState: () => micboard.viewerLock,
    openAdmin: openAdminPage,
    getScreens: () => (micboard.config && micboard.config.screens) || [],
    getDocks: () => (micboard.config && micboard.config.docks) || [],
    getScreenId: () => micboard.screenId || '',
    setScreenId: (id) => {
      micboard.screenId = String(id || '');
      writePref({ storage: safeStorage(), key: SCREEN_KEY, value: micboard.screenId });
      applyBoardLayout();
    },
  });
  // ⛔ Something other than the panel can leave fullscreen -- Escape, the
  // window manager, the Electron menu -- and the switch reads the browser
  // rather than a stored flag, so it only needs telling to look again.
  if (typeof document !== 'undefined' && !document.body.dataset.fullscreenBound) {
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((name) => {
      document.addEventListener(name, () => {
        try {
          window.dispatchEvent(new Event('wirelessboard:view-changed'));
        } catch (_) {
          // A board that cannot announce the change still leaves it correct
          // the next time the panel opens.
        }
      });
    });
    document.body.dataset.fullscreenBound = 'true';
  }

  const viewPanelButton = document.getElementById('topbar-restore');
  if (viewPanelButton && !viewPanelButton.dataset.bound) {
    viewPanelButton.addEventListener('click', () => {
      toggleViewPanel();
    });
    viewPanelButton.dataset.bound = 'true';
  }

  // ⛔ The `#go-qr` binding was here. The scannable URL moved onto the
  // administration page with Help (#225), where it is a button the overlay
  // draws and `showScannableUrl` opens the dialog for. The dialog itself
  // (`#qr-modal`) is unchanged.

  // ⛔ The old view's own Close button went with the view (#222). The
  // administration page has one close, at the top right, and Escape -- and a
  // section that closed itself while the page stayed open was one of the ways
  // #216 left a board with no editor and no way back.
  // ⚠️ Still an event, because anything may dispatch it, but it opens the
  // administration page on the section rather than a view of its own (#222).
  if (typeof window !== 'undefined' && !window.__wirelessboardBackgroundBound) {
    window.addEventListener('wirelessboard:open-background', () => openAdminPage('backgrounds'));
    window.__wirelessboardBackgroundBound = true;
  }

  const preset_links = document.getElementsByClassName('preset-link');
  if (preset_links && preset_links.length) {
    Array.from(preset_links).forEach((element) => {
      element.addEventListener('click', (e) => {
        const target = parseInt(e.target.id[9], 10);
        renderGroup(target);
        resetViews();
      });
    });
  }

  updateNavLinks();
  // Enforce initial view state when mapping nav
  resetViews();
}

// https://stackoverflow.com/questions/19491336/get-url-parameter-jquery-or-how-to-get-query-string-values-in-js
// var getUrlParameter = function getUrlParameter(sParam) {
function getUrlParameter(sParam) {
  // const sPageURL = decodeURIComponent(window.location.search.substring(1));
  const sPageURL = decodeURIComponent(window.location.hash.substring(1));
  const sURLVariables = sPageURL.split('&');
  let sParameterName;
  let i;

  for (i = 0; i < sURLVariables.length; i += 1) {
    sParameterName = sURLVariables[i].split('=');

    if (sParameterName[0] === sParam) {
      return sParameterName[1] === undefined ? true : sParameterName[1];
    }
  }
  return undefined;
}

function readURLParameters() {
  micboard.url.group = getUrlParameter('group');
  micboard.url.demo = getUrlParameter('demo');
  micboard.url.settings = getUrlParameter('settings');
  micboard.url.pco = getUrlParameter('pco');
  micboard.url.background = getUrlParameter('background');
  micboard.url.tvmode = getUrlParameter('tvmode');
  micboard.url.bgmode = getUrlParameter('bgmode');
  micboard.url.layout = getUrlParameter('layout');
  micboard.url.aspect = getUrlParameter('aspect');
  micboard.url.text = getUrlParameter('text');
  micboard.url.type = getUrlParameter('type');
  micboard.url.columns = getUrlParameter('columns');
  micboard.url.statusbar = getUrlParameter('statusbar');
  micboard.url.wash = getUrlParameter('wash');

  // hash beats what the device remembers, which beats the default. A wall
  // display that has just come back from a power cut has no hash and nobody
  // present to press a key, so the stored value is what puts it back the way
  // it was left.
  const storage = safeStorage();
  micboard.arrangement = resolvePref({
    hashValue: micboard.url.layout,
    storage,
    key: ARRANGEMENT_KEY,
    isValid: isArrangement,
    migrate: migrateArrangement,
    fallback: 'fit',
  });
  micboard.cardShape = resolvePref({
    hashValue: micboard.url.aspect,
    storage,
    key: CARD_SHAPE_KEY,
    isValid: isCardShape,
    migrate: migrateCardShape,
    fallback: 'auto',
  });
  // ⛔ `middle` retired in #130 and boards have it stored, so this one migrates
  // now: a remembered `middle` becomes `bottom` rather than silently resetting.
  micboard.typeSize = resolvePref({
    hashValue: micboard.url.type,
    storage,
    key: TYPE_SIZE_KEY,
    isValid: isTypeSize,
    fallback: 'medium',
  });
  micboard.columns = resolvePref({
    hashValue: micboard.url.columns,
    storage,
    key: COLUMNS_KEY,
    isValid: isColumnChoice,
    fallback: 'auto',
  });
  micboard.wash = resolvePref({
    hashValue: micboard.url.wash,
    storage,
    key: WASH_KEY,
    isValid: isWashStyle,
    fallback: 'band',
  });
  // ⭐⭐ Desk or TV, remembered at last (#216). The hash carries it as
  // `tvmode=<elinfo>` rather than as a mode of its own, so its *presence* is
  // the opinion: a board in TV mode writes the parameter and a desk board
  // writes nothing. An absent parameter therefore means "no opinion" and the
  // stored value stands, which is the same rule every preference above follows.
  //
  // ⛔ Why this matters more than it looks: `displayMode` was the only view
  // preference never stored, so TV mode lived in the hash alone -- and the hash
  // is lost when the slot-name editor opens, while Escape is a full page
  // reload. A wall display came back from a power cut, from Escape, or from
  // editing a slot name showing the desk layout.
  micboard.displayMode = resolvePref({
    hashValue: DRAWER_MODES.includes(micboard.url.tvmode) ? 'tvmode' : undefined,
    storage,
    key: DISPLAY_MODE_KEY,
    isValid: isDisplayMode,
    fallback: 'deskmode',
  });
  micboard.rotation = resolvePref({
    hashValue: micboard.url.rotate,
    storage,
    key: ROTATION_KEY,
    isValid: (v) => ROTATION_STATES.includes(v),
    fallback: 'off',
  });
  // ⛔ No hashValue. Every other preference here can come from a link, because
  // every other preference is a look. A link that switched the lock off would
  // leave it guarding nothing (#116, `viewer-lock.mjs`).
  micboard.viewerLock = readPref({
    storage,
    key: VIEWER_LOCK_KEY,
    isValid: (v) => LOCK_STATES.includes(v),
    fallback: 'off',
  });
  // ⛔ No hash parameter and no validation against the list: the screens are
  // configured globally and may not have loaded yet, and a device being told
  // "that screen does not exist" on the first payload would silently forget
  // which screen it is. An id that matches nothing simply yields no minimum.
  micboard.screenId = readPref({
    storage,
    key: SCREEN_KEY,
    isValid: (v) => typeof v === 'string',
    fallback: '',
  });
  // ⭐ The strip the retired menu bar freed (#188). Per device, like the rest:
  // the wall wants it, the laptop at front of house may not.
  micboard.statusBar = resolvePref({
    hashValue: micboard.url.statusbar,
    storage,
    key: STATUS_BAR_KEY,
    isValid: isStatusBarPlacement,
    fallback: 'bottom',
  });
  micboard.livePlacement = resolvePref({
    hashValue: micboard.url.live,
    storage,
    key: LIVE_PLACEMENT_KEY,
    isValid: (v) => PLACEMENTS.includes(v),
    fallback: DEFAULT_PLACEMENT,
  });

  // ⚠️ `#settings=logs` is an existing link and the tab it named is gone (#222).
  // Left alone it would open the configuration page showing nothing, so it is
  // answered where the logs actually are now.
  if (micboard.url.settings === 'logs') {
    micboard.url.settings = undefined;
    micboard.openLogsOnLoad = true;
  }

  if (window.location.pathname.includes('demo')) {
    micboard.url.demo = 'true';
  }
}

export function updateHash() {
  let hash = '#';
  if (micboard.url.demo) {
    hash += '&demo=true';
  }
  if (micboard.group !== 0) {
    hash += `&group=${micboard.group}`;
  }
  if (micboard.displayMode === 'tvmode') {
    hash += `&tvmode=${micboard.infoDrawerMode}`;
  }
  if (micboard.backgroundMode !== 'NONE') {
    hash += `&bgmode=${micboard.backgroundMode}`;
  }
  // Only when they say something, so a default board still has a clean URL.
  if (micboard.arrangement && micboard.arrangement !== 'fit') {
    hash += `&layout=${micboard.arrangement}`;
  }
  if (micboard.cardShape && micboard.cardShape !== 'auto') {
    hash += `&aspect=${micboard.cardShape}`;
  }
  if (micboard.typeSize && micboard.typeSize !== 'medium') {
    hash += `&type=${micboard.typeSize}`;
  }
  if (micboard.wash && micboard.wash !== 'band') {
    hash += `&wash=${micboard.wash}`;
  }
  if (micboard.statusBar && micboard.statusBar !== 'bottom') {
    hash += `&statusbar=${micboard.statusBar}`;
  }
  if (micboard.columns && micboard.columns !== 'auto') {
    hash += `&columns=${micboard.columns}`;
  }
  if (micboard.settingsMode === 'CONFIG') {
    if (micboard.configTab === 'logs') {
      hash = '#settings=logs';
    } else {
      hash = '#settings=true';
    }
  }
  hash = hash.replace('&', '');
  window.history.replaceState(undefined, undefined, hash);
}

configureConfigModule({
  micboard,
  getMicboard: () => micboard,
  updateHash,
});

function dataFilterFromList(data) {
  data.receivers.forEach((rx) => {
    rx.tx.forEach((t) => {
      const tx = t;
      tx.ip = rx.ip;
      tx.type = rx.type;
      micboard.transmitters[tx.slot] = tx;
    });
  });
}

function displayListChooser() {
  if (micboard.url.group) {
    renderGroup(micboard.url.group);
  } else {
    renderGroup(0);
  }
}

// ⛔ `ensureHudVersion` was here. It wrote the build number into the Help
// overlay, which #225 retired. The version is still shown -- Help renders it
// from `getVersion`, passed to `initAdminPage` -- so the figure did not go with
// the function.

function initialMap(callback) {
  fetch(dataURL)
    .then((response) => {
      setTimeMode(response.headers.get('Date'));

      response.json().then((data) => {
        micboard.discovered = data.discovered;
        // Every accepted format for each, not just the one each list used to
        // hold. `jpg` and `mp4` are the older, narrower keys and are still
        // sent; preferring them here would quietly drop png, webp and mov
        // backgrounds.
        micboard.mp4_list = data.video || data.mp4;
        micboard.img_list = data.image || data.jpg;
        micboard.localURL = data.url;
        try { micboard.groups = groupTableBuilder(data); } catch (e) { micboard.groups = {}; }
        micboard.config = data.config;
        announceConfigLoaded();
        const defaultBackground = data.background_defaults && typeof data.background_defaults.mode === 'string'
          ? String(data.background_defaults.mode).trim().toUpperCase()
          : 'NONE';
        if (defaultBackground === 'IMG' || defaultBackground === 'MP4') {
          micboard.backgroundDefaultMode = defaultBackground;
        } else {
          micboard.backgroundDefaultMode = 'NONE';
        }
        micboard.discovery_status = data.discovery_status || null;
        micboard.discovery_scan = data.discovery_scan || null;
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          try {
            const eventName = 'wirelessboard:discovery-status';
            const evt = (typeof window.CustomEvent === 'function')
              ? new CustomEvent(eventName, { detail: { status: micboard.discovery_status } })
              : new Event(eventName);
            window.dispatchEvent(evt);
          } catch (_) {}
        }
        mapGroups();

        // ⚠️ Not on a locked device. A board with nothing configured is
        // exactly the case where config should open itself -- but a locked
        // wall tablet is also the case where it must not, and the lock is
        // deliberate where the empty config is not.
        if (micboard.config.slots.length < 1 && micboard.url.pco !== 'true'
            && !isLocked(micboard.viewerLock)) {
          setTimeout(() => {
            initConfigEditor();
          }, 125);
        }

        if (micboard.url.demo !== 'true') {
          dataFilterFromList(data);
        }
        try { displayListChooser(); } catch (e) {}

        if (callback) {
          callback();
        }
        if (['MP4', 'IMG'].indexOf(micboard.url.bgmode) >= 0) {
          setBackground(micboard.url.bgmode);
        }
        // ⚠️ `DRAWER_MODES`, not a fourth copy of the list. `readURLParameters`
        // now reads the same parameter to resolve the display mode (#216), and
        // two hand-written copies of the same four strings would drift.
        //
        // ⛔ `switchToTv: false`. The display mode is resolved from hash-beats-
        // stored-beats-default above and already on the container; letting this
        // force TV mode would override a board that had a *stored* desk mode
        // and a hash from some older link.
        if (DRAWER_MODES.includes(micboard.url.tvmode)) {
          setInfoDrawer(micboard.url.tvmode, { switchToTv: false });
        }
        initEditor();
        try { scheduleBackgroundFilenameGuide(); } catch (_) {}
        try {
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            const evt = (typeof window.CustomEvent === 'function')
              ? new CustomEvent('wirelessboard:background-library-updated')
              : new Event('wirelessboard:background-library-updated');
            window.dispatchEvent(evt);
          }
        } catch (_) {}
      });
    });
}

/**
 * Say that the board's configuration has arrived (#150).
 *
 * ⛔ A DOM event rather than a direct call, because the configuration editor
 * lives in `config.js`, which already imports from here -- calling into it
 * would close the loop, and an import cycle in this codebase has produced a
 * TDZ error that only showed up on a click (#111).
 */
export function announceConfigLoaded() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  try {
    window.dispatchEvent(new Event('wirelessboard:config-loaded'));
  } catch (_) {
    // A board that cannot announce it still has the config.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log(`Starting Wirelessboard version: ${VERSION}`);
  readURLParameters();
  // Early guard: hide secondary views before any rendering
  try {
    const s = document.querySelector('.settings');
    if (s) s.style.display = 'none';
  } catch (_) {}
  keybindings();
  // Bind PCO navbar and handlers
  try { bindPcoNav(); bindPcoHandlers(); bindScreenHandlers(); } catch (e) {}
  // Put the resolved view choices on the container before the first layout
  // pass, so a remembered portrait board does not paint as fit-to-page first.
  // ⛔ The administration overlay (#188). Bound before the first layout pass
  // for the same reason the gear is: it must not depend on any pane above
  // having rendered, because it is the route to all of them.
  try {
    initAdminPage({
      // ⭐ #222: a section whose markup moved into the administration page is
      // filled by the module that still owns its logic. The page knows what is
      // on screen; `config.js` knows what goes in it.
      fillSection: (id) => {
        if (id === 'screens') refreshScreensEditor();
        if (id === 'slots') refreshSlotsTable();
        if (id === 'logs') showLogsSection();
        if (id === 'backgrounds') showBackgroundsSection();
        // ⚠️ Both fill the same editors: the discovered list, the slot rows and
        // the group summary are rendered together by one pass.
        if (id === 'receivers' || id === 'groups') initConfigEditor(true);
        // ⭐ #179: five Planning Center sections, each filled from the stored
        // configuration when it is opened and each saving only its own keys.
        if (id.startsWith('pco-')) fillPcoSection(id);
        // ⭐ The weekly surface, filled the same way the other eleven are. It
        // used to fill itself as a side effect of switching the whole view.
        if (id === 'pco') fillPcoWeekly();
      },
      // ⛔ The other edge, and the reason it exists: the log viewer follows the
      // file on a timer. A section that is hidden, or a page that is closed,
      // must stop whatever it had running.
      releaseSection: (id) => {
        if (id === 'logs') hideLogsSection();
      },
      onPageOpen: () => showConfigHealth(),
      getLockState: () => micboard.viewerLock,
      getViewers: () => micboard.viewers,
      // ⚠️ Help shows the build number, which the retired overlay used to carry.
      getVersion: () => `Wirelessboard ${VERSION}`,
      // The QR dialog is not part of the overlay; Help only asks for it.
      showScannableUrl: () => {
        generateQR();
        Modal.getOrCreateInstance('#qr-modal').show();
      },
      getFacts: () => ({
        config: micboard.config,
        discovered: micboard.discovered,
        images: micboard.img_list,
        videos: micboard.mp4_list,
      }),
    });

    // ⚠️ `#settings=logs` resolved here. The link named a configuration tab
    // that no longer exists (#222); it now opens the page where the logs are.
    if (micboard.openLogsOnLoad) {
      micboard.openLogsOnLoad = false;
      openAdminPage('logs');
    }
  } catch (_) {}
  try { applyBoardLayout(); } catch (_) {}
  try { startTvLayoutWatchers(); } catch (_) {}
  // ⚠️ Its own slow timer, not the board payload's. The Live position changes
  // every few minutes; the board's data arrives several times a second (#121).
  try { startLiveStrip(() => micboard.livePlacement); } catch (_) {}
  // ⭐ The configuration sweep (#273, #274, #276). Attaching it costs
  // nothing until it is called, and it has to live on a real board
  // because that is the whole point of it -- every wrong diagnosis it
  // answers came from measuring a card built by hand instead.
  try { installSweep(); } catch (_) {}
  // ⚠️ Always started: the driver itself decides each tick whether there is
  // anything to page, so turning rotation on needs no restart and a board
  // where everything fits pays one cheap check a second.
  // ⛔ Unconditional, which is what the line above has claimed since #113 while
  // the code read `if (micboard.rotation === 'on')`. With that gate the driver
  // never started on a board with rotation off, so it never got to notice that
  // the layout cannot show every channel -- the whole `required` path was
  // unreachable (#202). Caught on a running board; no unit test could see it.
  try { startRotation(); } catch (_) {}
  // Somebody using the board stops the page moving under their hand.
  try {
    ['keydown', 'pointerdown', 'wheel'].forEach((evt) => {
      window.addEventListener(evt, noteInteraction, { passive: true });
    });
  } catch (_) {}
  try { scheduleBackgroundFilenameGuide(); } catch (_) {}
  // ⭐ Bound once, like the other moved sections: the markup is static and sits
  // in the document whether or not it is on screen, so binding per fill would
  // stack a handler per visit (the 1.7.0 listener fault).
  try { initSlotsTable(); } catch (_) {}

  if (micboard.url.demo === 'true' && micboard.url.settings !== 'true' && micboard.url.settings !== 'logs' && micboard.url.pco !== 'true') {
    // ⛔ Demo mode used to pop the Help overlay open on the first load, to
    // explain itself. #225 retired that overlay -- nothing closed it, so the
    // demo board opened with a panel the viewer could not dismiss. Help is on
    // the administration page now, which is one tap from the gear.
    initialMap();
  } else {
    initialMap(initLiveData);
  }

  if ((micboard.url.settings === 'true' || micboard.url.settings === 'logs')
      && !isLocked(micboard.viewerLock)) {
    setTimeout(() => {
      initConfigEditor();
      updateHash();
      try {
        const mb = document.getElementById('micboard');
        if (mb) mb.style.display = 'none';
        const settings = document.querySelector('.settings');
        if (settings?.style) settings.style.display = 'block';
      } catch (_) {}
    }, 100);
  }
  if (micboard.url.pco === 'true' && !isLocked(micboard.viewerLock)) {
    // ⭐ `#pco=true` opens the administration page straight onto the weekly
    // pane, the same as `#settings=logs` does for Logs. It used to run a
    // route that replaced the whole view.
    setTimeout(() => openAdminPage('pco'), 100);
  }
  // ⚠️ `#background=true` named a view of its own until #222 moved the pane
  // into the administration page. Answered where it now lives, rather than
  // left pointing at a view that no longer exists.
  if (micboard.url.background === 'true') {
    micboard.url.background = undefined;
    setTimeout(() => {
      openAdminPage('backgrounds');
    }, 100);
  }
});
