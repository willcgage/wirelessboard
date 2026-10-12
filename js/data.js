import 'whatwg-fetch';
import { viewerCount } from './viewer-scope.mjs';
import { renderPlanChangeNotice } from './plan-change-notice.js';
import {
  dataURL, ActivateMessageBoard, micboard, updateNavLinks,
} from './app.js';
import { renderGroup, updateSlot } from './channelview.js';
import { updateChart } from './chart-smoothie.js';

export function postJSON(url, data, callback, onError) {
  fetch(url, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json',
    },
  }).then((res) => res.json())
    .then((response) => {
      console.log('Success:', JSON.stringify(response));
      if (callback) {
        callback(response);
      }
    })
    .catch((error) => {
      console.error('Error:', error);
      if (onError) {
        onError(error);
      }
    });
}

function JsonUpdate() {
  fetch(dataURL)
    .then((response) => response.json())
    .then((data) => {
      if (micboard.connectionStatus === 'DISCONNECTED') {
        window.location.reload();
      }
      data.receivers.forEach((rx) => {
        rx.tx.forEach(updateSlot);
      });
      micboard.connectionStatus = 'CONNECTED';
      micboard.config = data.config;
      // How many boards are watching this server (#116). Kept on micboard so
      // the config panes can say what a save is about to reach, and announced
      // when it changes -- the config view renders before the first payload
      // lands, so without this the note sits there saying nothing about who
      // else is connected.
      const previousViewers = micboard.viewers;
      micboard.viewers = viewerCount(data);
      if (micboard.viewers !== previousViewers
          && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          const evt = (typeof window.CustomEvent === 'function')
            ? new CustomEvent('wirelessboard:viewers', { detail: { viewers: micboard.viewers } })
            : new Event('wirelessboard:viewers');
          window.dispatchEvent(evt);
        } catch (_) {
          // A board that cannot announce the count still knows it.
        }
      }
      // Whether the plan on the board has changed in Planning Center since it
      // was synced (#140). A fact about the plan, not about this browser, so
      // it arrives with the payload every board reads.
      micboard.planChange = (data && data.plan_change) || null;
      renderPlanChangeNotice(micboard.planChange);
      micboard.discovery_status = data.discovery_status || micboard.discovery_status || null;
      micboard.discovery_scan = data.discovery_scan || micboard.discovery_scan || null;
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          const eventName = 'wirelessboard:discovery-status';
          const evt = (typeof window.CustomEvent === 'function')
            ? new CustomEvent(eventName, { detail: { status: micboard.discovery_status } })
            : new Event(eventName);
          window.dispatchEvent(evt);
        } catch (_) {}
      }
    }).catch((error) => {
      console.log(error);
      micboard.connectionStatus = 'DISCONNECTED';
    });
}

function updateGroup(data) {
  micboard.groups[data.group].title = data.title;
  micboard.groups[data.group].slots = data.slots;
  if (micboard.group === data.group) {
    renderGroup(data.group);
  }
  updateNavLinks();
}

export function initLiveData() {
  setInterval(JsonUpdate, 1000);
  wsConnect();
}

function wsConnect() {
  const loc = window.location;
  let newUri;

  if (loc.protocol === 'https:') {
    newUri = 'wss:';
  } else {
    newUri = 'ws:';
  }

  newUri += `//${loc.host}${loc.pathname}ws`;

  micboard.socket = new WebSocket(newUri);

  micboard.socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data['chart-update']) {
      data['chart-update'].forEach(updateChart);
    }
    if (data['data-update']) {
      data['data-update'].forEach(updateSlot);
    }

    if (data['group-update']) {
      data['group-update'].forEach(updateGroup);
      updateNavLinks();
    }
  };

  micboard.socket.onclose = () => {
    ActivateMessageBoard();
  };

  micboard.socket.onerror = () => {
    ActivateMessageBoard();
  };
}
