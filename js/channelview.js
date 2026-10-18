import { micboard, updateHash } from './app.js';
import { pocketOrder, pocketFooter } from './pocket.mjs';
import { updateBackground } from './gif.js';
import { initChart, charts } from './signal-view.js';
import { seedTransmitters, autoRandom } from './demodata.js';
import { updateEditor } from './dnd.js';
import { deviceHeading } from './device-label.mjs';
import { batteryFraction, batteryDescription } from './battery-icon.mjs';

function allSlots() {
  const slot = micboard.config.slots;
  const out = [];

  if (micboard.url.demo) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }

  for (let i = 0; i < slot.length; i += 1) {
    out.push(slot[i].slot);
  }
  return out;
}

// enables info-drawer toggle for mobile clients
function infoToggle() {
  const cols = document.getElementsByClassName('col-sm');
  Array.from(cols).forEach((element) => {
    element.addEventListener('click', (e) => {
      if (window.innerWidth <= 980) {
        const id = e.currentTarget.querySelector('.info-drawer');
        if (id.style.display === 'none' || id.style.display === '') {
          id.style.display = 'block';
        } else if (id.style.display === 'block') {
          id.style.display = 'none';
        }
      }
    });
  });

  // Editing a group only means something while one is being viewed, so this
  // entry is hidden in the combined view. Hide the whole dropdown item rather
  // than just the link, or the menu keeps a blank row where it used to sit.
  // ⛔ The "Edit This Group" menu item was hidden here when the board showed
  // all channels, because editing a group needs a group selected. #188 retired
  // the menu; the administration page lists the item instead, and `openGroupEdit`
  // already refuses when `micboard.group === 0`.
  //
  // ⏳ So the page draws a row that does nothing on an all-channels board. That
  // is worse than the menu was and is noted on #188 rather than papered over --
  // it wants the same treatment as the lock's refusal: shown, with the reason.
}

function updateTXOffset(slotSelector, data) {
  if (data.tx_offset !== 255) {
    slotSelector.querySelector('.offset').innerHTML = `${data.tx_offset} dB`;
  } else {
    slotSelector.querySelector('.offset').innerHTML = '';
  }
}

function updateRuntime(slotSelector, data) {
  // ⛔ One place, not two (#195). This used to write `p.runtime` in the drawer
  // as well, on the reasoning that the drawer is the detail view and the one a
  // desk-mode board shows. That stopped being true: the band renders in both
  // modes -- measured directly while fixing #181 -- so the drawer's copy was
  // the same figure twice on every surface, written by this one function.
  //
  // ⛔ Only the text node, never the whole element -- the battery icon lives in
  // here too, and writing textContent would delete it.
  const onCard = slotSelector.querySelector('p.card-runtime .runtime-text');
  if (onCard) {
    // ⛔ An estimate is marked as one (#109). The board works the number out
    // from the battery level falling where the receiver will not say, and a
    // calculated figure shown exactly like a measured one is worse than no
    // figure -- somebody plans a service around it.
    const estimated = data.runtime_source === 'estimated';
    onCard.textContent = data.runtime ? `${estimated ? '~' : ''}${data.runtime}` : '';
    onCard.classList.toggle('is-estimated', estimated && !!data.runtime);
    if (estimated && data.runtime) {
      onCard.setAttribute('title', 'Estimated from the battery level falling; this receiver does not report a runtime.');
    } else {
      onCard.removeAttribute('title');
    }
  }
  updateCardBattery(slotSelector, data);
}

/**
 * The status chip: a glyph, a word, and the colour (#130).
 *
 * ⛔ Three signals for one state on purpose. The board is read at a glance from
 * a few feet away, often over a photograph, and "the card went red" is no use
 * to someone who cannot separate red from amber -- or to anyone whose photo is
 * red already.
 *
 * ⚠️ The vocabulary is the card's, not the protocol's: an operator wants to
 * know whether to go and swap a pack, not which enum the receiver reported.
 */
const STATUS_CHIP = {
  GOOD: null,
  PREV_GOOD: null,
  REPLACE: { glyph: '▲', word: 'Replace' },
  PREV_REPLACE: { glyph: '▲', word: 'Replace' },
  CRITICAL: { glyph: '■', word: 'Low' },
  PREV_CRITICAL: { glyph: '■', word: 'Low' },
  AUDIO_PEAK: { glyph: '●', word: 'Peak' },
  RX_COM_ERROR: { glyph: '✕', word: 'RX error' },
  TX_COM_ERROR: { glyph: '○', word: 'No TX' },
  UNASSIGNED: null,
};

function updateStatusChip(slotSelector, data) {
  const chip = slotSelector.querySelector('.status-chip');
  if (!chip) {
    return;
  }
  const shown = STATUS_CHIP[data.status];
  const glyph = chip.querySelector('.chip-glyph');
  const word = chip.querySelector('.chip-word');

  // A chip for every state would be a row of badges saying nothing. Only the
  // states worth walking across a room for get one.
  chip.classList.toggle('is-quiet', !shown);
  if (glyph) glyph.textContent = shown ? shown.glyph : '';
  if (word) word.textContent = shown ? shown.word : '';
}

function updatePowerlock(slotSelector, data) {
  if (data.power_lock === 'ON') {
    slotSelector.querySelector('.powerlock').style.display = 'block';
  } else {
    slotSelector.querySelector('.powerlock').style.display = 'none';
  }
}

function updateQuality(slotSelector, data) {
  const QualityTable = {
    0: '&#9675;&#9675;&#9675;&#9675;&#9675;',
    1: '&#9679;&#9675;&#9675;&#9675;&#9675;',
    2: '&#9679;&#9679;&#9675;&#9675;&#9675;',
    3: '&#9679;&#9679;&#9679;&#9675;&#9675;',
    4: '&#9679;&#9679;&#9679;&#9679;&#9675;',
    5: '&#9679;&#9679;&#9679;&#9679;&#9679;',
    255: '',
  };
  slotSelector.querySelector('.quality').innerHTML = QualityTable[data.quality];
}

function updateFrequency(slotSelector, data) {
  // ⛔ Megahertz. `py/channel.py` `set_frequency` turns the receiver's `528850`
  // into `528.850`, and `demodata.js` generates 474-597 -- the UHF band these
  // systems work in. Printing a bare "Hz" was wrong by six orders of magnitude
  // and shipped on every card, in every photograph taken of the wall.
  slotSelector.querySelector('.frequency').innerHTML = `${data.frequency} MHz`;
  if (data.frequency === '000000') {
    slotSelector.querySelector('.frequency').style.display = 'none';
  } else {
    slotSelector.querySelector('.frequency').style.display = 'block';
  }
}

// ⛔ No updateID. `data.id` used to be written into `p.mic_id` inside the band,
// where it printed the same string the column heading already shows -- the
// device name, twice on every card (#206). `updateDeviceName` writes the one
// that remains, and it reads `device_id` rather than `id` because the heading
// wants the equipment with the person's name stripped off.

function updateName(slotSelector, data) {
  slotSelector.querySelector('p.name').innerHTML = data.name;
  updateBackground(slotSelector.querySelector('.mic_name'));
  // There used to be a second line here reading extended_name straight out of
  // the config. It always printed what `p.name` had just printed: get_chan_name
  // resolves chan_name *from* extended_name, so `data.name` is that same string
  // on every assigned slot. The device line below carries the information that
  // was actually missing.
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const detail = { slot: data && data.slot, name: data && data.name };
      const evt = (typeof window.CustomEvent === 'function')
        ? new CustomEvent('wirelessboard:slot-name-updated', { detail })
        : new Event('wirelessboard:slot-name-updated');
      window.dispatchEvent(evt);
    }
  } catch (_) {}
}

function updateDeviceName(slotSelector, data) {
  const el = slotSelector.querySelector('p.device-name');
  if (el) {
    // ⭐ The column heading answers one question: which handheld or bodypack is
    // this? So it takes the hardware's own id, never the raw channel label --
    // "HH-1 Dave" carries the person's name, who is already named on the card.
    el.textContent = deviceHeading(data && data.device_id, data && data.slot);
  }
  updateRole(slotSelector, data);
}

/**
 * The slot's **role**, under the device heading (#267).
 *
 * ⛔ This is the slot's own role (`extended_id`) -- what it is *for*, week to
 * week -- and NOT the plan position, which is what Planning Center scheduled
 * somebody under this week. #206 removed an invented role line from the card,
 * and a guard in `slots-table.test.mjs` keeps the plan field off it; this is
 * the other one, added on the maintainer's decision: "placing under the
 * Device's Name at the top would be best."
 *
 * ⚠️ That guard is a plain substring check over this whole file, comments
 * included, so the plan field's name is deliberately not spelled out here.
 *
 * ⚠️ `data.id` falls back to the device's own prefix when no role is set, so a
 * slot with no role would print `BP-10` twice, once as the heading and once
 * underneath. Measured on the venue board: slots 10 and 12 do exactly that.
 * Drawn only when it says something the heading does not.
 */
function updateRole(slotSelector, data) {
  const el = slotSelector.querySelector('p.card-role');
  if (!el) {
    return;
  }
  const role = ((data && data.id) || '').trim();
  const device = ((data && data.device_id) || '').trim();
  el.textContent = (role && role !== device) ? role : '';
}

function updateStatus(slotSelector, data) {
  slotSelector.querySelector('div.mic_name').className = 'mic_name';
  slotSelector.querySelector('div.mic_name').classList.add(data.status);

  updateStatusChip(slotSelector, data);

  slotSelector.querySelector('div.electrode').className = 'electrode';
  slotSelector.querySelector('div.electrode').classList.add(data.status);

  // ⛔ `hidden`, not an inline `display`. Setting `display: block` here wrote
  // an inline style that beats every stylesheet rule, so a mode wanting the
  // chartzone laid out differently -- Rack lays it along the strip -- could
  // never have it. The attribute says "not shown" and leaves *how* it is shown
  // to CSS, which is the whole distinction.
  //
  // ⭐ Unconditional now. This used to be skipped while `settingsMode` was
  // `'EXTENDED'`, because the slot-name editor drew two text boxes inside each
  // card and needed the zones left as it had set them. That editor is gone --
  // slot names are a table in the administration page and the board is never
  // borrowed (`slots-table.js`) -- so there is no mode in which a card should
  // not say whether its receiver is answering.
  const quiet = data.status === 'RX_COM_ERROR';
  slotSelector.querySelector('.chartzone').hidden = quiet;
  slotSelector.querySelector('.errorzone').hidden = !quiet;
}

function updateIP(slotSelector, data) {
  slotSelector.querySelector('p.ip').innerHTML = data.ip;
  slotSelector.querySelector('p.rxinfo').innerHTML = `${data.type} CH ${data.channel}`;
}

/**
 * The battery icon in the band (#130).
 *
 * A time on its own does not say what it measures, and on the vendors that
 * report a level but no runtime the icon is the only thing there is to show.
 */
function updateCardBattery(slotSelector, data) {
  const holder = slotSelector.querySelector('p.card-runtime');
  if (!holder) {
    return;
  }
  const fraction = batteryFraction(data && data.battery);

  // ⛔ Unknown is not empty. An empty fill reads as "about to die"; the outline
  // on its own reads as "nothing has told us", which is what 255 means.
  holder.classList.toggle('batt-unknown', fraction === null);

  // ⭐⭐ The icon wears the state the SERVER already decided, never its own
  // copy of the thresholds. `py/mic.py` draws the lines -- 4-5 bars is GOOD,
  // 3 is REPLACE, 0-2 is CRITICAL -- and they reach us as `data.status`. A
  // second set of boundaries in here is how a board ends up amber on the card
  // and green on the icon, which is worse than no colour at all.
  //
  // ⚠️ The `PREV_` states are the same battery reading after the transmitter
  // stopped reporting, so they keep the same colour. They are not a different
  // level; they are the last level we were told.
  const status = (data && data.status) || '';
  holder.classList.toggle('batt-replace', /^(PREV_)?REPLACE$/.test(status));
  holder.classList.toggle('batt-critical', /^(PREV_)?CRITICAL$/.test(status));
  holder.style.setProperty('--batt', fraction === null ? '0' : String(fraction));
  holder.setAttribute('title', batteryDescription(data && data.battery, data && data.runtime));
}

function updateBattery(slotSelector, data) {
  // ⛔ No battery bars (#195). Five segments in the drawer painted the same
  // `data.battery` the band already draws as an icon -- one number, two shapes,
  // one card. The icon is the one that stays: it is on the never-shed list, it
  // reads at every card width, and it is beside the runtime it is a measure of.
  //
  // ⚠️ `BatteryTable` went with them. It mapped a battery level to five CSS
  // classes and nothing else ever read it -- the band's icon is drawn from
  // `batteryFraction` in `battery-icon.mjs`, which is a different and finer
  // mapping. Keeping the table "just in case" would have left a second, stale
  // answer to "how full is this battery" sitting next to the real one.

  if (micboard.group !== 0) {
    let hideChart = false;

    if (micboard.groups[micboard.group]) {
      hideChart = micboard.groups[micboard.group].hide_charts;
    }

    // ⭐ A group that hides charts hides the signal lines, not a canvas. The
    // rows carry the whole line -- label, trend and value -- so hiding them
    // leaves the figures underneath, which is what somebody turning charts off
    // is asking for.
    if (hideChart) {
      const hidden = data.battery === 255;
      slotSelector.querySelectorAll('.spark-row').forEach((row) => {
        row.style.display = hidden ? 'none' : '';
      });
    }
  }
}

function updateDiversity(slotSelector, data) {
  const div = slotSelector.querySelector('.diversity');
  let newBar = '';
  for (let i = 0; i < data.antenna.length; i += 1) {
    const char = data.antenna.charAt(i);
    switch (char) {
      case 'A':
      case 'B': newBar += '<div class="diversity-bar diversity-bar-blue"></div>';
        break;
      case 'R': newBar += '<div class="diversity-bar diversity-bar-red"></div>';
        break;
      case 'X': newBar += '<div class="diversity-bar diversity-bar-off"></div>';
        break;
      default:
        break;
    }
  }
  div.innerHTML = newBar;
}

function updateCheck(data, key, callback) {
  if (key in data) {
    if (micboard.transmitters[data.slot][key] !== data[key]) {
      if (callback) {
        callback();
      }
      micboard.transmitters[data.slot][key] = data[key];
    }
  }
}

function updateSelector(slotSelector, data) {
  updateCheck(data, 'name', () => {
    updateName(slotSelector, data);
  });
  updateCheck(data, 'name_raw', () => {
    updateDeviceName(slotSelector, data);
  });
  // ⚠️ Its own check. The role is `data.id`, which an operator can change
  // without the transmitter's own label moving at all.
  updateCheck(data, 'id', () => {
    updateRole(slotSelector, data);
  });
  updateCheck(data, 'status', () => {
    updateStatus(slotSelector, data);
  });
  updateCheck(data, 'battery', () => {
    updateBattery(slotSelector, data);
  });
  updateCheck(data, 'runtime', () => {
    updateRuntime(slotSelector, data);
  });
  // ⚠️ Its own check: a runtime can stop being reported and start being
  // estimated without the number itself changing, and the card has to stop
  // claiming it was measured.
  updateCheck(data, 'runtime_source', () => {
    updateRuntime(slotSelector, data);
  });
  updateCheck(data, 'antenna', () => {
    updateDiversity(slotSelector, data);
  });
  updateCheck(data, 'tx_offset', () => {
    updateTXOffset(slotSelector, data);
  });
  updateCheck(data, 'quality', () => {
    updateQuality(slotSelector, data);
  });
  updateCheck(data, 'frequency', () => {
    updateFrequency(slotSelector, data);
  });
  updateCheck(data, 'power_lock', () => {
    updatePowerlock(slotSelector, data);
  });
}

export function updateViewOnly(slotSelector, data) {
  if ('status' in data) {
    updateStatus(slotSelector, data);
  }
  if ('name' in data) {
    updateName(slotSelector, data);
  }
  if ('name_raw' in data) {
    updateDeviceName(slotSelector, data);
  }
  if ('id' in data) {
    updateRole(slotSelector, data);
  }
  if ('tx_offset' in data) {
    updateTXOffset(slotSelector, data);
  }
  if ('battery' in data) {
    updateBattery(slotSelector, data);
  }
  if ('runtime' in data) {
    updateRuntime(slotSelector, data);
  }
  if ('quality' in data) {
    updateQuality(slotSelector, data);
  }
  if ('frequency' in data) {
    updateFrequency(slotSelector, data);
  }
  if ('antenna' in data) {
    updateDiversity(slotSelector, data);
  }
  if ('ip' in data) {
    updateIP(slotSelector, data);
  }
  if ('power_lock' in data) {
    updatePowerlock(slotSelector, data);
  }
}

export function updateSlot(data) {
  if (document.getElementById('micboard').classList.contains('uploadmode')) {
    return;
  }

  if (data.slot === 0) {
    return;
  }
  const slot = `slot-${data.slot}`;
  const slotSelector = document.getElementById(slot);
  if (slotSelector) {
    updateSelector(slotSelector, data);
  }
}

export function renderDisplayList(dl) {
  document.getElementById('micboard').innerHTML = '';

  if (micboard.url.demo) {
    seedTransmitters(dl);
    autoRandom();
  }

  const tx = micboard.transmitters;

  // ⭐⭐ Pocket is an ORDER, not a skin. Rack and Board show the display list
  // as it is given; Pocket puts whatever needs somebody at the top, because
  // its reader is already walking. ⛔ Nothing is filtered -- the calm channels
  // follow in slot order under a divider, so the list never lies about how
  // many channels there are.
  //
  // ⚠️ `micboard.displayList` is NOT reordered. Paging, the rotation and the
  // "what is this board showing" count all read it, and #215 was exactly the
  // fault of one of those reading a different list from the one on screen.
  // This orders the render, and only the render.
  const pocket = micboard.displayMode === 'pocketmode';
  const order = pocket ? pocketOrder(dl, tx) : null;
  const sequence = pocket ? [...order.urgent, ...order.rest] : dl;
  const dividerAfter = pocket && order.urgent.length && order.rest.length
    ? order.urgent.length
    : -1;

  sequence.forEach((e, index) => {
    if (index === dividerAfter) {
      const divider = document.createElement('p');
      divider.className = 'pocket-divider';
      divider.textContent = 'Everything else';
      document.getElementById('micboard').appendChild(divider);
    }
    let t;
    if (e !== 0) {
      if (typeof tx[e] !== 'undefined') {
        t = document.getElementById('column-template').content.cloneNode(true);
        t.querySelector('div.col-sm').id = `slot-${tx[e].slot}`;
        updateViewOnly(t, tx[e]);
        charts[tx[e].slot] = initChart(t, tx[e]);
        document.getElementById('micboard').appendChild(t);
      }
    } else {
      t = document.getElementById('column-template').content.cloneNode(true);
      t.querySelector('p.name').innerHTML = 'BLANK';
      t.querySelector('.col-sm').classList.add('blank');
      document.getElementById('micboard').appendChild(t);
    }
  });

  // ⛔ Counts what is SHOWN, never what the board has. #215 came out of a bar
  // whose count was built from `config.groups` whatever was actually on
  // screen, so it said "12 channels" over a page of four.
  if (pocket) {
    const footer = document.createElement('p');
    footer.className = 'pocket-footer';
    footer.textContent = pocketFooter({
      shown: sequence.filter((s) => s !== 0).length,
      total: Object.keys(tx || {}).length,
    });
    document.getElementById('micboard').appendChild(footer);
  }

  infoToggle();
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const evt = (typeof window.CustomEvent === 'function')
        ? new CustomEvent('wirelessboard:background-library-updated')
        : new Event('wirelessboard:background-library-updated');
      window.dispatchEvent(evt);
    }
  } catch (_) {}
}

export function renderGroup(group) {
  // ⛔ A branch for `settingsMode === 'CONFIG'` was here, showing the board and
  // hiding `.settings`. #222 retired the configuration page: `.settings` no
  // longer exists, so `getElementsByClassName('settings')[0].style` would have
  // thrown the moment anything set that mode again. Dead and dangerous, not
  // dead and harmless.
  micboard.group = group;
  updateHash();
  if (group === 0) {
    micboard.displayList = allSlots();
    renderDisplayList(micboard.displayList);
    updateEditor(group);
    return;
  }
  const out = micboard.groups[group];
  if (out) {
    micboard.displayList = out.slots;
    renderDisplayList(micboard.displayList);
    updateEditor(group);
  } else {
    micboard.displayList = [];
    renderDisplayList(micboard.displayList);
    updateEditor(group);
  }
}
