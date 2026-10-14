import { micboard } from './app.js';
import { updateSlot } from './channelview.js';
import { updateChart } from './chart-smoothie.js';

let timers = {};

const batterySample = {
  0: {
    battery: 255,
    status: ['CRITICAL', 'UNASSIGNED', 'RX_COM_ERROR', 'TX_COM_ERROR'],
    runtime_min_max: [0, 0],
  },
  1: {
    battery: 1,
    status: ['CRITICAL', 'PREV_CRITICAL'],
    runtime_min_max: [0, 1],
  },
  2: {
    battery: 2,
    status: ['CRITICAL', 'PREV_CRITICAL'],
    runtime_min_max: [1, 2],
  },
  3: {
    battery: 3,
    status: ['REPLACE', 'PREV_REPLACE'],
    runtime_min_max: [3, 4],
  },
  4: {
    battery: 4,
    status: ['GOOD', 'GOOD', 'PREV_GOOD', 'UNASSIGNED'],
    runtime_min_max: [5, 6],
  },
  5: {
    battery: 5,
    status: ['GOOD', 'GOOD', 'PREV_GOOD'],
    runtime_min_max: [7, 9],
  },
};

const rfSample = ['AX', 'XB', 'XX', 'BRXX', 'XRXB', 'XXBR'];

const name_sample = [
  'Fatai', 'Marsh', 'Delwin', 'Tracy', 'Backup', 'Steve', 'J.E.', 'Lonnie',
  'Sharon', 'Del ACU', 'Troy', 'Matt', 'Karl', 'Anders', 'Mikey', 'Dan',
  'Jordan', 'Josue', 'Ashlee', 'Shawn c', 'James', 'Hallie', 'Rebekah', 'Jazmine',
  'Stephen', 'Aaron', 'Tom', 'Nick', 'Eugene', 'Brittani', 'MattW', 'Natrice',
  'Mollie', 'Albert', 'Gillen', 'Steph', '',
];

// ⛔ Every receiver type the board supports, not the four it shipped with.
// `slxd` and `slxdplus` arrived in 1.16.0 and `p10t` is the IEM transmitter;
// leaving them out meant the demo could not show the newest hardware, and
// `device_class()` never returned 'IEM' on a demo board at all.
const type_sample = ['uhfr', 'qlxd', 'ulxd', 'axtd', 'slxd', 'slxdplus', 'p10t'];

// Which types go in a pack on somebody's belt rather than in their hand. Only
// used to pick a plausible label -- the board does not ask this question.
const bodypack_types = ['ulxd', 'axtd', 'slxdplus'];

// https://gist.github.com/kerimdzhanov/7529623
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function randomTypeGenerator() {
  return type_sample[getRandomInt(0, type_sample.length - 1)];
}

/**
 * The label a receiver carries, which is how a board tells a handheld from a
 * bodypack from an IEM.
 *
 * ⛔ Every demo slot used to be `HH##`, so a demo board was twelve handhelds
 * however many types were in the sample. The kind is the first thing somebody
 * reads off the rack, and it was the one thing the demo could not show.
 *
 * ⚠️ The hyphen is deliberate. `device_id()` documents the convention as
 * "HH-1 Dave" or "BP-9", and `get_chan_name` matches `([A-Za-z]+)?([-]?)([0-9])+`
 * on the first token -- so the hyphenated form goes down the ordinary path.
 * The space form `IEM 1` has its own branch that only fires while the number is
 * a single character, so `IEM 10` would fall through and put the whole label
 * where the person's name belongs. Not a case worth demonstrating.
 */
function deviceLabel(type, slot) {
  const n = slot.toString().padStart(2, '0');
  if (type === 'p10t') {
    return `IEM-${n}`;
  }
  if (bodypack_types.includes(type)) {
    return `BP-${n}`;
  }
  return `HH-${n}`;
}

function randomNameGenerator() {
  // getRandomInt is inclusive of max, so passing the length reached one index
  // past the end and put a literal "undefined" on the board where a person's
  // name belongs.
  return name_sample[getRandomInt(0, name_sample.length - 1)];
}

function randomIPGenerator() {
  return `192.168.103.${getRandomInt(50, 150)}`;
}

function current_names() {
  const names = [];

  micboard.displayList.forEach((e) => {
    if (e !== 0) {
      // This used to assign to the bare `name`, i.e. the global window.name,
      // and computed a prefix and number that were never read.
      const transmitterName = micboard.transmitters[e].name;
      names.push(transmitterName.substring(5));
    }
  });

  return names;
}

function uniqueRandomNameGenerator() {
  const used_names = current_names();
  const namebank = name_sample.filter((el) => !used_names.includes(el));

  const len = namebank.length;
  const index = getRandomInt(0, len - 1);
  const name = namebank[index];
  return name;

  // const channel = slot.toString().padStart(2, '0');
  // const output = 'HH' + channel + ' ' + name;
  // return output;
}

function randomRfSampleGenerator() {
  return rfSample[getRandomInt(0, 5)];
}

function randomAudioGenerator() {
  return getRandomInt(0, 30);
}

function randomTXOffsetGenerator() {
  const rand = getRandomInt(0, 27);
  if (rand > 21) {
    return 255;
  }
  return rand;
}

function randomQualityGenerator() {
  let quality = getRandomInt(0, 8);
  if (quality > 5) {
    quality = 255;
  }
  return quality;
}

function randomFrequencyGenerator() {
  const frequency = getRandomInt(474, 597) + (getRandomInt(0, 40) * 0.025);
  return frequency.toFixed(3);
}

function randomRfGenerator() {
  return getRandomInt(0, 50);
}

function randomRuntimeGenerator(battery_minmax) {
  const hours = getRandomInt(battery_minmax[0], battery_minmax[1]);
  const mins = getRandomInt(0, 59).toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

function randomBatteryGenerator() {
  const batt_index = getRandomInt(0, 5);
  const battery = batterySample[batt_index];
  const len = battery.status.length;
  const status_index = getRandomInt(0, len - 1);

  const res = {
    battery: battery.battery,
    status: battery.status[status_index],
    runtime: randomRuntimeGenerator(battery.runtime_min_max),
  };
  return res;
}

function randomDataGenerator() {
  const battery = randomBatteryGenerator();

  const res = {
    name: randomNameGenerator(),
    antenna: randomRfSampleGenerator(),
    audio_level: randomAudioGenerator(),
    rf_level: randomRfGenerator(),
    tx_offset: randomTXOffsetGenerator(),
    frequency: randomFrequencyGenerator(),
    battery: battery.battery,
    status: battery.status,
    ip: randomIPGenerator(),
    channel: getRandomInt(1, 4),
    type: randomTypeGenerator(),
  };
  return res;
}

function unixtimestamp() {
  return new Date() / 1000;
}

function randomNameListGenerator(length) {
  const indexList = [];
  const outputList = [];
  while (indexList.length < length) {
    const r = getRandomInt(0, name_sample.length - 1);
    if (indexList.indexOf(r) < 0) {
      indexList.push(r);
    }
  }
  for (let i = 0; i < length; i += 1) {
    outputList[i] = name_sample[indexList[i]];
  }
  return outputList;
}

export function seedTransmitters(dl) {
  const len = dl.length;
  const names = randomNameListGenerator(len);
  for (let i = 0; i < len; i += 1) {
    const slot = dl[i];
    if (slot !== 0) {
      const r = randomDataGenerator();
      r.slot = slot;
      // const n = 'HH' + slot.toString().padStart(2, '0') + ' ' + names[i];
      const n = names[i];
      r.name = n;
      r.id = deviceLabel(r.type, slot);
      // The device line, which the demo would otherwise leave permanently
      // blank. Deliberately a different name from the person: a transmitter
      // keeps whatever label the last person to hold it left on it, and that
      // gap between the hardware's label and who is actually on the channel is
      // the reason the board shows both.
      r.name_raw = `${r.id} ${names[(i + 1) % len] || 'SPARE'}`;
      // ⛔ The receiver column heading reads this, not `id`. The demo never set
      // it, so `deviceHeading` fell back to "Slot N" on every card -- which is
      // the exact symptom of #186, reproduced by the demo for a completely
      // different reason. A demo that fakes a known fault is worse than one
      // that shows nothing.
      r.device_id = r.id;
      micboard.transmitters[slot] = r;
    }
  }
}

function meteteredRandomDataGenerator(update) {
  if (micboard.displayList.length === 0) {
    return { slot: 0 };
  }
  const battery = randomBatteryGenerator();
  let slot = 0;
  while (slot === 0) {
    slot = micboard.displayList[getRandomInt(0, micboard.displayList.length - 1)];
  }
  const data = JSON.parse(JSON.stringify(micboard.transmitters[slot]));

  // ⛔ No `data.id` here. It used to be rewritten to `HH##` on every tick, which
  // would undo the seeded label within a second or two and turn every bodypack
  // and IEM back into a handheld. The clone above already carries the right one.

  data.timestamp = unixtimestamp();
  switch (update) {
    case 'name': data.name = uniqueRandomNameGenerator(slot);
      break;
    case 'antenna': data.antenna = randomRfSampleGenerator();
      break;
    case 'tx_offset': data.tx_offset = randomTXOffsetGenerator();
      break;
    case 'quality': data.quality = randomQualityGenerator();
      break;
    case 'frequency': data.frequency = randomFrequencyGenerator();
      break;
    case 'battery':
    case 'status': data.battery = battery.battery;
      data.status = battery.status;
      data.runtime = battery.runtime;
      break;
    default:
      break;
  }
  return data;
}

function randomCharts() {
  micboard.displayList.forEach((n) => {
    if (n !== 0) {
      const data = JSON.parse(JSON.stringify(micboard.transmitters[n]));
      data.audio_level = randomAudioGenerator();
      data.rf_level = randomRfGenerator();
      data.timestamp = unixtimestamp();
      updateChart(data);
    }
  });
}

export function autoRandom() {
  Object.keys(timers).forEach((key) => {
    clearInterval(timers[key]);
  });

  timers = {};

  const len = micboard.displayList.length;

  timers.name = setInterval(() => {
    updateSlot(meteteredRandomDataGenerator('name'));
  }, 750 * (12 / len));

  timers.antenna = setInterval(() => {
    updateSlot(meteteredRandomDataGenerator('antenna'));
  }, 90 * (12 / len));

  timers.battery = setInterval(() => {
    updateSlot(meteteredRandomDataGenerator('battery'));
  }, 890 * (12 / len));

  timers.tx_offset = setInterval(() => {
    updateSlot(meteteredRandomDataGenerator('tx_offset'));
  }, 1000 * (12 / len));

  timers.quality = setInterval(() => {
    updateSlot(meteteredRandomDataGenerator('quality'));
  }, 500 * (12 / len));

  timers.frequeny = setInterval(() => {
    updateSlot(meteteredRandomDataGenerator('frequency'));
  }, 750 * (12 / len));
  timers.charts = setInterval(randomCharts, 300);
}
