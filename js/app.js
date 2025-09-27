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
import { initConfigEditor } from './config.js';
import { bindPcoNav, bindPcoHandlers } from './config.js';

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

function mapGroups() {
  const navbar = document.getElementById('navbarToggleExternalContent');
  const help = document.getElementById('hud');
  const goHud = document.getElementById('go-hud');
  const hudCollapse = help ? Collapse.getOrCreateInstance(help, { toggle: false }) : null;

  if (help && !help.dataset.hudBound) {
    help.addEventListener('shown.bs.collapse', () => {
      if (goHud) goHud.setAttribute('aria-expanded', 'true');
    });
    help.addEventListener('hidden.bs.collapse', () => {
      if (goHud) goHud.setAttribute('aria-expanded', 'false');
    });
    help.dataset.hudBound = 'true';
  }
  // Ensure single-view visibility helper
  function resetViews() {
    const mb = document.getElementById('micboard');
    const settings = document.querySelector('.settings');
    const pcoView = document.getElementById('pco-settings');
    const wantPCO = (micboard.settingsMode === 'PCO' || micboard.url.pco === 'true');
    const wantCFG = (micboard.settingsMode === 'CONFIG' || micboard.url.settings === 'true');
    if (wantPCO) {
      if (mb) mb.style.display = 'none';
      if (settings) settings.style.display = 'none';
      if (pcoView) pcoView.style.display = 'block';
    } else if (wantCFG) {
      if (mb) mb.style.display = 'none';
      if (pcoView) pcoView.style.display = 'none';
      if (settings) settings.style.display = 'block';
    } else {
      if (pcoView) pcoView.style.display = 'none';
      if (settings) settings.style.display = 'none';
      if (mb) mb.style.display = 'grid';
    }
  }
  if (goHud && hudCollapse) {
    goHud.addEventListener('click', (event) => {
      event.preventDefault();
      try { hudCollapse.toggle(); } catch (e) {}
      if (navbar) { try { new Collapse(navbar, { hide: true }); } catch (e) {} }
      resetViews();
    });
  }

  // Helper to hide HUD if visible
  function hideHud() {
    if (!hudCollapse) return;
    try { hudCollapse.hide(); } catch (e) {}
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
      hideHud();
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
  micboard.url.tvmode = getUrlParameter('tvmode');
  micboard.url.bgmode = getUrlParameter('bgmode');

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
    hash = '#settings=true'
  } else if (micboard.settingsMode === 'PCO') {
    hash = '#pco=true'
  }
  hash = hash.replace('&', '');
  history.replaceState(undefined, undefined, hash);

}

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
    const h = document.getElementById('hud');
    if (s) s.style.display = 'none';
    if (p) p.style.display = 'none';
    if (h) h.classList.remove('show');
  } catch (_) {}
  try { ensureHudVersion(); } catch (_) {}
  keybindings();
  // Bind PCO navbar and handlers
  try { bindPcoNav(); bindPcoHandlers(); } catch (e) {}

  if (micboard.url.demo === 'true' && micboard.url.settings !== 'true' && micboard.url.pco !== 'true') {
    // Show HUD only once on initial load
    setTimeout(() => {
      const hudEl = document.getElementById('hud');
      if (hudEl) { try { Collapse.getOrCreateInstance(hudEl, { toggle: false }).show(); } catch (e) {} }
    }, 100);
    initialMap();
  } else {
    initialMap(initLiveData);
  }

  if (micboard.url.settings === 'true') {
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
});
