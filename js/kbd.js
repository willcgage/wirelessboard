import { Modal } from 'bootstrap';
import {
  micboard, updateHash, generateQR, showHudPane,
} from './app.js';
import {
  toggleInfoDrawer, toggleImageBackground, toggleVideoBackground, toggleDisplayMode,
  cycleArrangement, cycleCardShape, cycleTextPosition, cycleTypeSize,
} from './display.js';
import { renderGroup } from './channelview.js';
import { groupEditToggle } from './dnd.js';
import { slotEditToggle } from './extended.js';
import { initConfigEditor } from './config.js';
import { hudRows, findBinding } from './keybindings.mjs';

// https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API
function toggleFullScreen() {
  if (!document.webkitFullscreenElement) {
    document.documentElement.webkitRequestFullscreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  }
}

function activeDiv(querySelector) {
  const div = document.querySelector(querySelector);
  if (div) {
    if (window.getComputedStyle(div).getPropertyValue('display') === 'block') {
      return true;
    }
  }
  return false;
}

const GROUP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Every keybinding, and the text the help overlay shows for it.
 *
 * ⛔ One table on purpose. The overlay used to be separate markup in
 * demo.html, and it had fallen behind: T and D were bound and undocumented,
 * T being the display-mode toggle and so the main view control on the board.
 * Adding a binding here documents it; there is no second place to forget.
 *
 * `hud` omitted means deliberately not listed -- the nine group keys are one
 * row, not nine.
 */
function bindingTable() {
  return [
    {
      keys: ['Escape'],
      hud: 'Return to the main board.',
      // Ahead of the guards below: this is how you get out of a pane that
      // would otherwise swallow every key, so it cannot be gated on one.
      beforeGuards: true,
      run: () => {
        micboard.settingsMode = 'NONE';
        updateHash();
        window.location.reload();
      },
    },
    {
      keys: ['?'],
      hud: 'Toggle this menu.',
      run: () => showHudPane('help', { toggleIfVisible: true }),
    },
    {
      keys: GROUP_KEYS,
      label: ['1-9'],
      hud: 'Jump to saved groups.',
      run: (e) => renderGroup(parseInt(e.key, 10)),
    },
    {
      keys: ['0'],
      hud: 'Return to the combined view of every channel.',
      run: () => renderGroup(0),
    },
    {
      keys: ['t'],
      hud: 'Switch between desk and TV display modes.',
      run: () => toggleDisplayMode(),
    },
    {
      // Two controls, two vocabularies. They previously offered the same three
      // words -- fit to page, landscape, portrait -- differing only by the noun
      // in front, which read as one control listed twice (#75).
      keys: ['o'],
      hud: 'Arrangement: fit to page, one row, one column, balanced grid (TV mode).',
      run: () => cycleArrangement(),
    },
    {
      keys: ['a'],
      hud: 'Card shape: auto, 16:9, 3:4 (TV mode).',
      run: () => cycleCardShape(),
    },
    {
      // "Placement", not "position": the card's third line *is* a position --
      // the person's in the service (#69) -- and the overlay would read as one
      // control if both used the word.
      keys: ['p'],
      hud: 'Text placement: over the photo, or in a band above or below it (TV mode).',
      run: () => cycleTextPosition(),
    },
    {
      keys: ['z'],
      hud: 'Text size: medium, small, large (TV mode).',
      run: () => cycleTypeSize(),
    },
    {
      keys: ['f'],
      hud: 'Enter or exit fullscreen.',
      run: () => toggleFullScreen(),
    },
    {
      keys: ['i'],
      hud: 'Toggle the info drawer.',
      run: () => toggleInfoDrawer(),
    },
    {
      keys: ['g'],
      hud: 'Cycle image backgrounds (TV mode).',
      run: () => toggleImageBackground(),
    },
    {
      keys: ['v'],
      hud: 'Cycle video backgrounds (TV mode).',
      run: () => toggleVideoBackground(),
    },
    {
      keys: ['n'],
      hud: 'Toggle slot editing.',
      run: () => slotEditToggle(),
    },
    {
      keys: ['N'],
      label: ['Shift+N'],
      hud: 'Toggle slot editing and show the paste box.',
      run: () => {
        slotEditToggle();
        document.getElementById('paste-box').style.display = 'block';
      },
    },
    {
      keys: ['e'],
      hud: 'Edit the current group (when viewing groups 1-9).',
      run: () => {
        if (micboard.group !== 0) {
          groupEditToggle();
        }
      },
    },
    {
      keys: ['s'],
      hud: 'Open the Config view.',
      run: () => initConfigEditor(),
    },
    {
      keys: ['q'],
      hud: 'Show the scannable URL.',
      run: () => {
        generateQR();
        Modal.getOrCreateInstance('#qr-modal').toggle();
      },
    },
    {
      keys: ['d'],
      hud: 'Toggle demo mode.',
      run: () => {
        micboard.url.demo = !micboard.url.demo;
        updateHash();
        window.location.reload();
      },
    },
  ];
}

/**
 * Fill the help overlay from the table above. The markup used to be written
 * out by hand in demo.html, which is how it came to disagree with the code.
 */
export function renderShortcutHud(bindings = bindingTable()) {
  const list = document.querySelector('#hud .hud-shortcuts');
  if (!list) {
    return;
  }
  list.textContent = '';
  hudRows(bindings).forEach((row) => {
    const li = document.createElement('li');
    row.keys.forEach((k) => {
      const chip = document.createElement('span');
      chip.className = 'hud-key';
      chip.textContent = k;
      li.appendChild(chip);
    });
    // textContent rather than innerHTML: these strings are ours, but the list
    // is built at runtime now and there is no reason for it to parse markup.
    li.appendChild(document.createTextNode(` ${row.description}`));
    list.appendChild(li);
  });
}

export function keybindings() {
  const bindings = bindingTable();
  renderShortcutHud(bindings);

  document.addEventListener('keydown', (e) => {
    const { target } = e;
    const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) {
      return;
    }

    const binding = findBinding(bindings, e.key);

    if (binding && binding.beforeGuards) {
      binding.run(e);
      return;
    }

    if (activeDiv('.settings') || activeDiv('.editzone') || activeDiv('.sidebar-nav')) {
      return;
    }

    if (binding) {
      binding.run(e);
    }
  }, false);
}
