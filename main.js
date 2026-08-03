const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
  dialog,
} = require('electron');
const path = require('path');
const child = require('child_process');
const fs = require('fs');
const http = require('http');
const servicePaths = require('./electron/service-paths');

let win;
let tray;
let pyProc = null;
let serviceState = 'starting';
let rebuildTrayMenu = () => {};
// Bumped on every start so a superseded readiness poll cannot report on the
// attempt that replaced it.
let startGeneration = 0;

const SERVICE_CANDIDATES = [
  ['wirelessboard-service', 'wirelessboard-service'],
  ['micboard-service', 'micboard-service'],
];

function resolveServiceBinary() {
  const resourcesRoot = process.resourcesPath ? path.join(process.resourcesPath, 'dist') : null;
  const unpackedRoot = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'dist');
  const localRoot = path.join(__dirname, 'dist');
  const devRoot = path.join(__dirname, '..', 'dist');

  const searchRoots = [resourcesRoot, unpackedRoot, localRoot, devRoot]
    .filter(Boolean)
    .map(root => path.normalize(root));

  for (const root of searchRoots) {
    for (const [folder, filename] of SERVICE_CANDIDATES) {
      const candidate = path.join(root, folder, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

// Path rules live in electron/service-paths.js so they can be exercised
// without booting Electron; see the comment there for why appData was wrong.
function resolveAppDataPath(file) {
  return servicePaths.resolveAppDataPath(file, { fallback: app.getPath('appData') });
}

function resolveLogDirectory() {
  return servicePaths.resolveLogDirectory({ fallback: app.getPath('appData') });
}

function collectLogSegments(logDir) {
  let entries;
  try {
    entries = fs.readdirSync(logDir, { withFileTypes: true });
  } catch (err) {
    console.error('Unable to read log directory', err);
    return [];
  }
  const rotated = [];
  let baseExists = false;
  entries.forEach((entry) => {
    if (!entry.isFile()) return;
    if (entry.name === 'application.log') {
      baseExists = true;
      return;
    }
    const match = entry.name.match(/^application\.log\.(\d+)$/);
    if (match) {
      rotated.push({ name: entry.name, index: parseInt(match[1], 10) });
    }
  });

  rotated.sort((a, b) => b.index - a.index);
  const segments = rotated.map(item => path.join(logDir, item.name));
  if (baseExists) segments.push(path.join(logDir, 'application.log'));
  return segments;
}

function consolidateLogs(logDir) {
  const segments = collectLogSegments(logDir);
  if (segments.length === 0) {
    return null;
  }
  if (segments.length === 1) {
    return segments[0];
  }

  const bundlePath = path.join(logDir, 'wirelessboard-logs.txt');
  try {
    fs.writeFileSync(bundlePath, '', 'utf8');
    segments.forEach((segment) => {
      const header = `\n===== ${path.basename(segment)} =====\n`;
      fs.appendFileSync(bundlePath, header, 'utf8');
      fs.appendFileSync(bundlePath, fs.readFileSync(segment, 'utf8'), 'utf8');
      fs.appendFileSync(bundlePath, '\n', 'utf8');
    });
    return bundlePath;
  } catch (err) {
    console.error('Failed to consolidate log files', err);
    return segments[segments.length - 1];
  }
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 400,
    height: 600,
    // frame: false,
  });

  win.loadURL(url);
  // win.webContents.on('did-finish-load', function() {
 	//   win.webContents.insertCSS('.sidebar-nav{ display: none !important; }');
  // });
  win.on('closed', () => {
    win = null;
  });
}

function openConfigFolder(file) {
  const configFile = resolveAppDataPath(file);
  shell.showItemInFolder(configFile);
}

function openLogFile() {
  const logDir = resolveLogDirectory();
  if (logDir) {
    const target = consolidateLogs(logDir);
    if (target) {
      shell.openPath(target);
      return;
    }
  }

  // Pre-1.4 layouts kept a single flat log beside config.json rather than a
  // logs/ directory. Only fall back to one that is actually there: opening a
  // path that does not exist fails silently, and opening a stale micboard-era
  // file is worse than saying nothing, because it looks like current output.
  const flatCandidates = ['wirelessboard.log', 'micboard.log']
    .map(name => resolveAppDataPath(name))
    .filter(candidate => fs.existsSync(candidate));

  if (flatCandidates.length > 0) {
    shell.openPath(flatCandidates[0]);
    return;
  }

  dialog.showMessageBox({
    type: 'info',
    title: 'No log file yet',
    message: 'Wirelessboard has not written a log file yet.',
    detail: `Expected it under:\n${servicePaths.expectedLogDirectory({ fallback: app.getPath('appData') })}\n\n`
      + 'The Logs tab in the interface shows live output in the meantime.',
    buttons: ['OK'],
  });
}


// The service resolves its port from WIRELESSBOARD_PORT / MICBOARD_PORT before
// falling back to config.json (see config.web_port), so honour at least the
// environment here rather than hard-coding 8058 in both processes.
// NOTE: a port set only in config.json is still not picked up here.
const SERVICE_PORT = process.env.WIRELESSBOARD_PORT || process.env.MICBOARD_PORT || '8058';
const SERVICE_URL = `http://localhost:${SERVICE_PORT}`;
const STARTUP_TIMEOUT_MS = 60000;
const STARTUP_POLL_MS = 400;

const STATE_LABELS = {
  starting: 'Starting the server…',
  running: 'Server running',
  failed: 'Server failed to start',
  stopped: 'Server stopped',
};

/** The menu-bar icon is the only surface this app has, so it carries the state. */
function setServiceState(state) {
  serviceState = state;
  const label = STATE_LABELS[state] || '';
  if (tray) {
    tray.setToolTip(label ? `Wirelessboard — ${label}` : 'Wirelessboard');
  }
  rebuildTrayMenu();
}

/** Resolves true once the service answers, false on any error or timeout. */
function probeService() {
  return new Promise((resolve) => {
    const req = http.get(SERVICE_URL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for the service to answer rather than guessing at how long it takes.
 *
 * This used to be a flat `setTimeout(..., 5000)` before opening the browser,
 * which is wrong in both directions: a slow start opened a connection-refused
 * page, and a fast one made the user wait for nothing. Neither said anything
 * about what was happening, which is the substance of #14.
 */
async function waitForService(generation) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (generation !== startGeneration) return false;
    // eslint-disable-next-line no-await-in-loop
    if (await probeService()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, STARTUP_POLL_MS));
  }
  return false;
}

const createPyProc = () => {
  const script = resolveServiceBinary();
  if (!script) {
    console.error('Unable to locate wirelessboard service binary.');
    setServiceState('failed');
    return;
  }

  setServiceState('starting');
  pyProc = child.spawn(script, [], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  // An exit while still starting means it never came up; after that it is a
  // crash or a deliberate restart, and exitPyProc has already said which.
  pyProc.on('exit', (code) => {
    if (serviceState === 'starting' || serviceState === 'running') {
      console.error(`wirelessboard service exited with code ${code}`);
      setServiceState('failed');
    }
  });
};

const exitPyProc = () => {
  if (pyProc) {
    setServiceState('stopped');
    pyProc.kill();
    pyProc = null;
  }
};

function startServiceAndOpen({ openBrowser }) {
  // Restarting while a previous attempt is still polling would otherwise let
  // the stale waiter resolve against the new attempt and report it failed --
  // the old one returns false the moment it is superseded, and without this
  // guard its `.then` would still be holding the tray state.
  startGeneration += 1;
  const generation = startGeneration;

  createPyProc();
  if (serviceState === 'failed') return;

  waitForService(generation).then((ready) => {
    if (generation !== startGeneration) return;
    setServiceState(ready ? 'running' : 'failed');
    if (ready && openBrowser) {
      shell.openExternal(SERVICE_URL);
      return;
    }
    if (!ready) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Wirelessboard did not start',
        message: `The server did not answer within ${STARTUP_TIMEOUT_MS / 1000} seconds.`,
        detail: 'Open the log file from this menu for details.',
        buttons: ['OK'],
      });
    }
  });
}

function restartWirelessboardServer() {
  exitPyProc();
  setTimeout(() => startServiceAndOpen({ openBrowser: false }), 250);
}


app.on('ready', () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.wirelessboard.app');
  }
  const iconPath = path.join(__dirname, 'static', 'favicon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 18, height: 18, quality: 'best' });
  }
  tray = new Tray(trayIcon);

  // Rebuilt on every state change: a menu item is the only place a menu-bar
  // app can show status where someone will actually look for it. The tooltip
  // carries the same text for anyone who hovers instead of clicking.
  rebuildTrayMenu = () => {
    if (!tray) return;
    const ready = serviceState === 'running';
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: STATE_LABELS[serviceState] || 'Wirelessboard', enabled: false },
      { type: 'separator' },
      { label: 'About', click() { createWindow(`${SERVICE_URL}/about`); } },
      { type: 'separator' },
      { label: 'Launch Wirelessboard', enabled: ready, click() { shell.openExternal(SERVICE_URL); } },
      { label: 'Edit Configuration', enabled: ready, click() { shell.openExternal(`${SERVICE_URL}/#settings=true`); } },
      { label: 'Open Configuration Directory', click() { openConfigFolder('config.json'); } },
      { type: 'separator' },
      { label: 'Restart Wirelessboard Server', click() { restartWirelessboardServer(); } },
      { label: 'Open log file', click() { openLogFile(); } },
      { role: 'quit' },
    ]));
  };

  setServiceState('starting');
  startServiceAndOpen({ openBrowser: true });
});


// app.on('ready', createPyProc);

app.on('window-all-closed', e => e.preventDefault());

app.on('will-quit', exitPyProc);
