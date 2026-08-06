const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
  dialog,
  ipcMain,
} = require('electron');
const path = require('path');
const child = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const servicePaths = require('./electron/service-paths');
const updateCheck = require('./electron/update-check');
const updatePrompt = require('./electron/update-prompt');

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


// -- Updates ----------------------------------------------------------------
// Nothing is downloaded or installed without the operator asking. This runs
// during live services, so an update that helped itself to the moment could
// take a board down mid-service; what changed is that the offer is no longer
// buried in a menu nobody opens.
//
// Two pieces on purpose:
//   * electron/update-check.js decides whether a newer release exists. It works
//     in a dev checkout and is tested without a network, and it reads
//     /releases/latest, which excludes drafts -- releases are published by hand
//     from a draft (#45), so a check that saw drafts would announce versions
//     nobody can download.
//   * electron-updater does the downloading and installing, and only once the
//     operator has pressed the button. It refuses to run unpackaged, which is
//     why it is not also used for the check.

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_CHECK_DELAY_MS = 30 * 1000;
const UPDATE_STATE_FILE = 'update-state.json';

let updateWindow = null;
// 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' |
// 'unsupported'
let updatePhase = 'checking';
let updateInfo = { latestVersion: null, url: null, notes: '', percent: 0, message: '', warning: '' };

function updateStatePath() {
  return resolveAppDataPath(UPDATE_STATE_FILE);
}

function readDismissedVersion() {
  try {
    const raw = fs.readFileSync(updateStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return updatePrompt.normalizeVersion(parsed && parsed.dismissedVersion);
  } catch (err) {
    // Absent or unreadable both mean "nothing dismissed". Never fatal: failing
    // to remember a dismissal costs one extra prompt, which is the safe way to
    // be wrong.
    return null;
  }
}

function writeDismissedVersion(version) {
  try {
    fs.writeFileSync(updateStatePath(), JSON.stringify({ dismissedVersion: version }, null, 2));
  } catch (err) {
    console.warn(`Could not remember the dismissed update version: ${err.message}`);
  }
}

function pushUpdateState() {
  rebuildTrayMenu();
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update:state', currentUpdateState());
  }
}

function currentUpdateState() {
  return {
    phase: updatePhase,
    currentVersion: app.getVersion(),
    latestVersion: updateInfo.latestVersion,
    notes: updateInfo.notes,
    percent: updateInfo.percent,
    message: updateInfo.message,
    warning: updateInfo.warning,
  };
}

function setUpdatePhase(phase, patch = {}) {
  updatePhase = phase;
  updateInfo = { ...updateInfo, ...patch };
  pushUpdateState();
}

function showUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.show();
    updateWindow.focus();
    return;
  }

  updateWindow = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Wirelessboard Update',
    // The requirement is that it stays until it is acted on. A native
    // notification will not do that -- on macOS a banner auto-dismisses after a
    // few seconds unless the user has set this app to Alerts, which is not
    // something to depend on for the one message that matters.
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'update-window-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  updateWindow.setMenuBarVisibility(false);
  updateWindow.loadFile(path.join(__dirname, 'static', 'update.html'));
  updateWindow.once('ready-to-show', () => updateWindow.show());

  // Closing the window is a dismissal. Not while a download is running, though
  // -- that would leave it going with nothing left to report on it.
  updateWindow.on('close', (event) => {
    if (updatePhase === 'downloading') {
      event.preventDefault();
      return;
    }
    if (updatePhase === 'available' && updateInfo.latestVersion) {
      writeDismissedVersion(updateInfo.latestVersion);
    }
  });

  updateWindow.on('closed', () => { updateWindow = null; });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        // GitHub rejects requests with no user agent.
        'User-Agent': `wirelessboard/${app.getVersion()}`,
        Accept: 'application/vnd.github+json',
      },
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('timed out'));
    });
  });
}

let updaterWired = false;

function wireUpdater() {
  if (updaterWired) return autoUpdater;
  updaterWired = true;

  // Never on its own initiative. checkForUpdates() is only called from the
  // download handler, and this makes sure that even then it does not start
  // pulling ~190 MB the moment it finds something.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;

  autoUpdater.on('download-progress', (progress) => {
    const { percent, label } = updatePrompt.formatProgress(progress);
    setUpdatePhase('downloading', { percent, message: label });
  });

  autoUpdater.on('update-downloaded', () => {
    setUpdatePhase('ready', {
      percent: 100,
      message: 'Downloaded. Installing will stop the board briefly and restart it.',
    });
  });

  autoUpdater.on('error', (err) => {
    setUpdatePhase('error', {
      message: `Update failed: ${err && err.message ? err.message : String(err)}`,
    });
  });

  return autoUpdater;
}

async function runUpdateCheck() {
  const result = await updateCheck.checkForUpdate({
    currentVersion: app.getVersion(),
    getJson,
  });

  if (!result.ok) {
    // A failed check is not worth interrupting anyone over; it is recorded and
    // the menu keeps whatever it last knew.
    console.warn(`Update check failed (${result.reason}): ${result.error || ''}`.trim());
    if (updatePhase === 'checking') setUpdatePhase('error');
    return;
  }

  if (!result.updateAvailable) {
    setUpdatePhase('current', { latestVersion: result.latestVersion, url: result.url });
    return;
  }

  // A download or a finished download outranks a fresh check: re-reporting
  // "available" would reset a window the operator is watching.
  if (updatePhase === 'downloading' || updatePhase === 'ready') return;

  setUpdatePhase('available', {
    latestVersion: result.latestVersion,
    url: result.url,
    percent: 0,
    message: '',
    // Windows installers are not signed yet, and SmartScreen will say so. Better
    // to warn here than to have an update the operator started look like malware.
    warning: process.platform === 'win32'
      ? 'Windows may show a SmartScreen warning during installation; the installers are not yet code-signed.'
      : '',
  });

  const dismissed = readDismissedVersion();
  if (updatePrompt.shouldPrompt({
    currentVersion: app.getVersion(),
    latestVersion: result.latestVersion,
    dismissedVersion: dismissed,
  })) {
    showUpdateWindow();
  }
}

function registerUpdateIpc() {
  ipcMain.handle('update:get-state', () => currentUpdateState());

  ipcMain.on('update:open-release-page', () => {
    if (updateInfo.url) shell.openExternal(updateInfo.url);
  });

  ipcMain.on('update:dismiss', () => {
    if (updatePhase === 'available' && updateInfo.latestVersion) {
      writeDismissedVersion(updateInfo.latestVersion);
    }
    if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
  });

  ipcMain.on('update:download', async () => {
    // Second press once it is downloaded means install, not download again.
    if (updatePhase === 'ready') {
      installDownloadedUpdate();
      return;
    }

    if (!app.isPackaged) {
      setUpdatePhase('unsupported', {
        message: 'Updates can only be installed from a packaged build, not a dev checkout.',
      });
      return;
    }

    setUpdatePhase('downloading', { percent: 0, message: 'Starting download…' });
    try {
      const updater = wireUpdater();
      // electron-updater will not download anything it has not itself found,
      // so this check has to happen even though update-check.js already did one.
      await updater.checkForUpdates();
      await updater.downloadUpdate();
    } catch (err) {
      setUpdatePhase('error', {
        message: `Update failed: ${err && err.message ? err.message : String(err)}`,
      });
    }
  });
}

function installDownloadedUpdate() {
  setUpdatePhase('ready', { message: 'Stopping the board and installing…' });

  // The service is a separate binary beside the app, and on Windows a running
  // executable cannot be replaced. Stop it and give it a moment to actually go
  // before handing over to the installer -- will-quit would also stop it, but
  // not early enough to be sure it has exited first.
  exitPyProc();

  setTimeout(() => {
    // isSilent false so the operator sees the installer doing something;
    // isForceRunAfter true so the board comes back on its own, which is the
    // whole point of restarting it here rather than leaving it down.
    autoUpdater.quitAndInstall(false, true);
  }, 1000);
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
      // Keeps reporting the update after the prompt has been dismissed --
      // dismissing means "stop interrupting me", not "forget this exists", and
      // this is the only always-visible surface a menu-bar app has. Clicking
      // reopens the prompt rather than sending the operator to a browser to
      // install by hand.
      {
        label: updatePrompt.trayLabel({
          state: updatePhase,
          currentVersion: app.getVersion(),
          latestVersion: updateInfo.latestVersion,
        }),
        enabled: ['available', 'downloading', 'ready'].includes(updatePhase),
        click() { showUpdateWindow(); },
      },
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

  registerUpdateIpc();

  setServiceState('starting');
  startServiceAndOpen({ openBrowser: true });

  // Deliberately not at launch: startup is the one moment the operator is
  // waiting on the server, and an update check has no business competing with
  // it. Six-hourly thereafter keeps this far inside GitHub's unauthenticated
  // rate limit.
  setTimeout(runUpdateCheck, UPDATE_CHECK_DELAY_MS);
  setInterval(runUpdateCheck, UPDATE_CHECK_INTERVAL_MS);
});


// app.on('ready', createPyProc);

app.on('window-all-closed', e => e.preventDefault());

app.on('will-quit', exitPyProc);
