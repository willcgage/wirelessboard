"use strict";

import { Collapse } from 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import QRCode from 'qrcode';
import 'whatwg-fetch';

import { autoRandom, seedTransmitters } from './demodata.js';
import { renderGroup, renderDisplayList, updateSlot } from './channelview.js';
import { initLiveData } from './data.js';
import { groupEditToggle, initEditor } from './dnd.js';
import { slotEditToggle } from './extended.js';
import { keybindings } from './kbd.js';
import { setBackground, setInfoDrawer } from './display.js';
import { setTimeMode } from './chart-smoothie.js';
import { initConfigEditor, bindPcoNav, bindPcoHandlers, configureConfigModule } from './config.js';

import '../css/colors.scss';
import '../css/style.scss';
import '../node_modules/@ibm/plex/scss/ibm-plex.scss';


export const dataURL = 'data.json';

export const micboard = [];
export const wirelessboard = micboard;
micboard.MIC_MODELS = ['uhfr', 'qlxd', 'ulxd', 'axtd'];

micboard.IEM_MODELS = ['p10t'];
micboard.url = [];
micboard.displayMode = 'deskmode';
micboard.infoDrawerMode = 'elinfo11';
micboard.backgroundMode = 'NONE';
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
  if (mbEl) mbEl.style.display = 'none'
  const settingsEl = document.getElementsByClassName('settings')[0];
  if (settingsEl) settingsEl.style.display = 'none';
  const eb = document.getElementsByClassName('message-board')[0];
  if (eb) {
    const h1el = eb.querySelector('h1');
    if (h1el) h1el.innerHTML = h1;
    const pel = eb.querySelector('p');
    if (pel) pel.innerHTML = p;
    eb.style.display = 'block'
  }

  micboard.connectionStatus = 'DISCONNECTED';
}

export function generateQR() {
  const qrOptions = {
    width: 600,
    margin: 0,
  };

  const url = micboard.localURL + location.pathname + location.search;
  const linkEl = document.getElementById('largelink');
  if (linkEl) { linkEl.href = url; linkEl.innerHTML = url; }
  const qrCanvas = document.getElementById('qrcode');
  QRCode.toCanvas(qrCanvas, url, qrOptions, (error) => {
    if (error) console.error(error)
    console.log('success!');
  });
  const verEl = document.getElementById('wirelessboard-version') || document.getElementById('micboard-version');
  if (verEl) verEl.innerHTML = 'Wirelessboard version: ' + VERSION;
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

export function syncHudPane(target) {
  const hud = document.getElementById('hud');
  if (!hud) return 'help';
  const desired = target || hud.dataset.activePane || 'help';
  const panes = hud.querySelectorAll('[data-hud-pane]');
  panes.forEach((pane) => {
    const isActive = pane.dataset.hudPane === desired;
    pane.classList.toggle('active', isActive);
    pane.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    pane.tabIndex = isActive ? 0 : -1;
  });
  const menuButtons = hud.querySelectorAll('[data-hud-target]');
  menuButtons.forEach((button) => {
    const isActive = button.dataset.hudTarget === desired;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  hud.dataset.activePane = desired;
  const goHudBtn = document.getElementById('go-hud');
  const goBackgroundBtn = document.getElementById('go-background');
  const visible = hud.classList.contains('show');
  if (goHudBtn) goHudBtn.setAttribute('aria-expanded', visible && desired === 'help' ? 'true' : 'false');
  if (goBackgroundBtn) goBackgroundBtn.setAttribute('aria-expanded', visible && desired === 'background' ? 'true' : 'false');
  return desired;
}

export function showHudPane(target = 'help', options = {}) {
  const hud = document.getElementById('hud');
  if (!hud) return;
  const hudCollapse = Collapse.getOrCreateInstance(hud, { toggle: false });
  const wasVisible = hud.classList.contains('show');
  const current = hud.dataset.activePane || 'help';
  const desired = syncHudPane(target);
  if (options.toggleIfVisible && wasVisible && current === desired) {
    try { hudCollapse.hide(); } catch (e) {}
    return;
  }
  try { hudCollapse.show(); } catch (e) {}
}

export function hideHud() {
  const hud = document.getElementById('hud');
  if (!hud) return;
  const hudCollapse = Collapse.getOrCreateInstance(hud, { toggle: false });
  try { hudCollapse.hide(); } catch (e) {}
  syncHudPane('help');
}

function mapGroups() {
  const navbar = document.getElementById('navbarToggleExternalContent');
  const help = document.getElementById('hud');
  const goHud = document.getElementById('go-hud');
  const goBackground = document.getElementById('go-background');
  const hudCollapse = help ? Collapse.getOrCreateInstance(help, { toggle: false }) : null;
  const inlineCloseBtn = document.getElementById('close-settings-inline');

  if (help && !help.dataset.hudBound) {
    help.addEventListener('shown.bs.collapse', () => {
      syncHudPane(help.dataset.activePane);
    });
    help.addEventListener('hidden.bs.collapse', () => {
      syncHudPane(help.dataset.activePane);
      help.dataset.activePane = help.dataset.activePane || 'help';
    });
    help.dataset.hudBound = 'true';
  }
  if (help && !help.dataset.hudMenuBound) {
    const hudButtons = help.querySelectorAll('[data-hud-target]');
    hudButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        syncHudPane(button.dataset.hudTarget);
      });
    });
    help.dataset.hudMenuBound = 'true';
  }
  syncHudPane(help ? help.dataset.activePane : 'help');

  function openBackground() {
    micboard.settingsMode = 'BACKGROUND';
    micboard.url.settings = undefined;
    micboard.url.pco = undefined;
    micboard.url.background = 'true';
    updateHash();
    hideHud();
    if (goBackground) goBackground.setAttribute('aria-expanded', 'true');
    if (goHud) goHud.setAttribute('aria-expanded', 'false');
    resetViews();
    try {
      window.dispatchEvent(new Event('wirelessboard:background-view-opened'));
    } catch (e) {}
  }
  // Ensure single-view visibility helper
  function resetViews() {
    const mb = document.getElementById('micboard');
    const settings = document.querySelector('.settings');
    const pcoView = document.getElementById('pco-settings');
    const backgroundView = document.getElementById('background-settings');
    const wantPCO = (micboard.settingsMode === 'PCO' || micboard.url.pco === 'true');
    const wantBackground = (micboard.settingsMode === 'BACKGROUND' || micboard.url.background === 'true');
    const wantCFG = (micboard.settingsMode === 'CONFIG' || micboard.url.settings === 'true' || micboard.url.settings === 'logs');
    const wasConfig = micboard.settingsMode === 'CONFIG';
    if (wantPCO) {
      if (mb) mb.style.display = 'none';
      if (settings) settings.style.display = 'none';
      if (backgroundView) backgroundView.style.display = 'none';
      if (pcoView) pcoView.style.display = 'block';
    } else if (wantBackground) {
      if (mb) mb.style.display = 'none';
      if (settings) settings.style.display = 'none';
      if (pcoView) pcoView.style.display = 'none';
      if (backgroundView) backgroundView.style.display = 'block';
    } else if (wantCFG) {
      if (mb) mb.style.display = 'none';
      if (pcoView) pcoView.style.display = 'none';
      if (backgroundView) backgroundView.style.display = 'none';
      if (settings) settings.style.display = 'block';
    } else {
      if (pcoView) pcoView.style.display = 'none';
      if (settings) settings.style.display = 'none';
      if (backgroundView) backgroundView.style.display = 'none';
      if (mb) mb.style.display = 'grid';
      if (wasConfig && typeof micboard.stopLogAutoRefresh === 'function') {
        try { micboard.stopLogAutoRefresh(true); } catch (e) {}
      }
    }
  }
  if (goHud && hudCollapse) {
    goHud.addEventListener('click', (event) => {
      event.preventDefault();
      showHudPane('help', { toggleIfVisible: true });
      if (navbar) { try { new Collapse(navbar, { hide: true }); } catch (e) {} }
      resetViews();
    });
  }

  if (goBackground) {
    goBackground.addEventListener('click', (event) => {
      event.preventDefault();
      openBackground();
      if (navbar) { try { new Collapse(navbar, { hide: true }); } catch (e) {} }
    });
  }

  if (inlineCloseBtn) {
    inlineCloseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof micboard.stopLogAutoRefresh === 'function') {
        try { micboard.stopLogAutoRefresh(true); } catch (_) {}
      }
      micboard.settingsMode = 'NONE';
      micboard.url.settings = undefined;
      micboard.url.pco = undefined;
      micboard.url.background = undefined;
      updateHash();
      const mb = document.getElementById('micboard');
      const settings = document.querySelector('.settings');
      const pcoView = document.getElementById('pco-settings');
      const backgroundView = document.getElementById('background-settings');
      if (mb) mb.style.display = 'grid';
      if (settings) settings.style.display = 'none';
      if (pcoView) pcoView.style.display = 'none';
      if (backgroundView) backgroundView.style.display = 'none';
      hideHud();
      if (goBackground) goBackground.setAttribute('aria-expanded', 'false');
      resetViews();
    });
  }
  // Removed explicit HUD close handler; handled centrally via hideHud()

  const goExtended = document.getElementById('go-extended');
  if (goExtended) {
    goExtended.addEventListener('click', () => {
      slotEditToggle();
      hideHud();
      resetViews();
      if (navbar) { try { new Collapse(navbar, { hide: true }); } catch (e) {} }
    });
  }

  const goConfig = document.getElementById('go-config');
  if (goConfig) {
    goConfig.addEventListener('click', () => {
      initConfigEditor();
      micboard.url.background = undefined;
      hideHud();
      if (goBackground) goBackground.setAttribute('aria-expanded', 'false');
      resetViews();
      if (navbar) { try { new Collapse(navbar, { hide: true }); } catch (e) {} }
    });
  }

  const goGroupEdit = document.getElementById('go-groupedit');
  if (goGroupEdit) {
    goGroupEdit.addEventListener('click', () => {
      if (micboard.group !== 0) {
        groupEditToggle();
        hideHud();
        resetViews();
        if (navbar) { try { new Collapse(navbar, { hide: true }); } catch (e) {} }
      }
    });
  }

  const backgroundClose = document.getElementById('background-close');
  if (backgroundClose) {
    backgroundClose.addEventListener('click', (event) => {
      event.preventDefault();
      micboard.settingsMode = 'NONE';
      micboard.url.background = undefined;
      updateHash();
      if (goBackground) goBackground.setAttribute('aria-expanded', 'false');
      resetViews();
    });
  }

  if (typeof window !== 'undefined' && !window.__wirelessboardBackgroundBound) {
    window.addEventListener('wirelessboard:open-background', openBackground);
    window.__wirelessboardBackgroundBound = true;
  }

  const preset_links = document.getElementsByClassName('preset-link');
  if (preset_links && preset_links.length) {
    Array.from(preset_links).forEach((element) => {
      element.addEventListener('click', (e) => {
        const target = parseInt(e.target.id[9], 10);
        renderGroup(target);
        hideHud();
        resetViews();
        if (navbar) { try { new Collapse(navbar, { hide: true }); } catch (e) {} }
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

  if (micboard.url.settings === 'logs') {
    micboard.configTab = 'logs';
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
    hash += '&group=' + micboard.group;
  }
  if (micboard.displayMode === 'tvmode') {
    hash += '&tvmode=' + micboard.infoDrawerMode;
  }
  if (micboard.backgroundMode !== 'NONE') {
    hash += '&bgmode=' + micboard.backgroundMode;
  }
  if (micboard.settingsMode === 'CONFIG') {
    if (micboard.configTab === 'logs') {
      hash = '#settings=logs'
    } else {
      hash = '#settings=true'
    }
  } else if (micboard.settingsMode === 'PCO') {
    hash = '#pco=true'
  } else if (micboard.settingsMode === 'BACKGROUND') {
    hash = '#background=true'
  }
  hash = hash.replace('&', '');
  history.replaceState(undefined, undefined, hash);

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


function ensureHudVersion() {
  const hud = document.getElementById('hud');
  if (!hud) return;

  let versionRow = hud.querySelector('[data-role="hud-version"]');
  if (!versionRow) {
    versionRow = document.createElement('div');
    versionRow.className = 'row hud-version';
    versionRow.dataset.role = 'hud-version';
    const col = document.createElement('div');
    col.className = 'col';
    versionRow.appendChild(col);
    const firstRow = hud.querySelector('.row');
    if (firstRow) {
      hud.insertBefore(versionRow, firstRow);
    } else if (hud.firstChild) {
      hud.insertBefore(versionRow, hud.firstChild);
    } else {
      hud.appendChild(versionRow);
    }
  }

  let versionText = versionRow.querySelector('#hud-version-text');
  if (!versionText) {
    versionText = document.createElement('p');
    versionText.id = 'hud-version-text';
    versionText.className = 'text-muted small mb-3';
    let col = versionRow.querySelector('.col');
    if (!col) {
      col = document.createElement('div');
      col.className = 'col';
      versionRow.appendChild(col);
    }
    col.appendChild(versionText);
  }

  versionText.textContent = 'Wirelessboard version ' + VERSION;
}



function initialMap(callback) {
  fetch(dataURL)
    .then((response) => {
      setTimeMode(response.headers.get('Date'));

      response.json().then((data) => {
        micboard.discovered = data.discovered;
        micboard.mp4_list = data.mp4;
        micboard.img_list = data.jpg;
        micboard.localURL = data.url;
        try { micboard.groups = groupTableBuilder(data); } catch (e) { micboard.groups = {}; }
        micboard.config = data.config;
  micboard.discovery_status = data.discovery_status || null;
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

        if (micboard.config.slots.length < 1 && micboard.url.pco !== 'true') {
          setTimeout(function() {
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
        if (['elinfo00', 'elinfo01', 'elinfo10', 'elinfo11'].indexOf(micboard.url.tvmode) >= 0) {
          setInfoDrawer(micboard.url.tvmode);
        }
        initEditor();
      });
    });
}


document.addEventListener('DOMContentLoaded', () => {
  console.log('Starting Wirelessboard version: ' + VERSION);
  readURLParameters();
  // Early guard: hide secondary views before any rendering
  try {
    const s = document.querySelector('.settings');
    const p = document.getElementById('pco-settings');
    const b = document.getElementById('background-settings');
    const h = document.getElementById('hud');
    if (s) s.style.display = 'none';
    if (p) p.style.display = 'none';
    if (b) b.style.display = 'none';
    if (h) h.classList.remove('show');
  } catch (_) {}
  try { ensureHudVersion(); } catch (_) {}
  keybindings();
  // Bind PCO navbar and handlers
  try { bindPcoNav(); bindPcoHandlers(); } catch (e) {}

  if (micboard.url.demo === 'true' && micboard.url.settings !== 'true' && micboard.url.settings !== 'logs' && micboard.url.pco !== 'true') {
    // Show HUD only once on initial load
    setTimeout(() => {
      const hudEl = document.getElementById('hud');
      if (hudEl) { try { Collapse.getOrCreateInstance(hudEl, { toggle: false }).show(); } catch (e) {} }
    }, 100);
    initialMap();
  } else {
    initialMap(initLiveData);
  }

  if (micboard.url.settings === 'true' || micboard.url.settings === 'logs') {
    setTimeout(() => {
      initConfigEditor();
      updateHash();
      try {
        const mb = document.getElementById('micboard');
        const pcoView = document.getElementById('pco-settings');
        if (mb) mb.style.display = 'none';
        if (pcoView) pcoView.style.display = 'none';
        document.querySelector('.settings')?.style && (document.querySelector('.settings').style.display = 'block');
      } catch (_) {}
    }, 100);
  }
  if (micboard.url.pco === 'true') {
    setTimeout(() => {
      // Use the PCO nav binding; clicking will also hide HUD via config.js
      const pcoNav = document.getElementById('go-pco');
      if (pcoNav) {
        try { pcoNav.click(); } catch (e) {}
      } else {
  const ev = new Event('micboard:open-pco');
        window.dispatchEvent(ev);
  const newEv = new Event('wirelessboard:open-pco');
  window.dispatchEvent(newEv);
      }
    }, 100);
  }
  if (micboard.url.background === 'true') {
    setTimeout(() => {
      const bgNav = document.getElementById('go-background');
      if (bgNav) {
        try { bgNav.click(); } catch (e) {}
      } else {
        const bgEv = new Event('wirelessboard:open-background');
        window.dispatchEvent(bgEv);
      }
    }, 100);
  }
});
