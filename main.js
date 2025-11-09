const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
} = require('electron');
const path = require('path');
const child = require('child_process');
const fs = require('fs');

let win;
let tray;
let pyProc = null;

const SERVICE_CANDIDATES = [
  ['wirelessboard-service', 'wirelessboard-service'],
  ['micboard-service', 'micboard-service'],
];

const LOG_DIR_CANDIDATES = [
  ['wirelessboard', 'logs'],
  ['micboard', 'logs'],
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

function resolveAppDataPath(file) {
  const base = app.getPath('appData');
  const primary = path.join(base, 'wirelessboard', file);
  if (fs.existsSync(primary)) {
    return primary;
  }
  return path.join(base, 'micboard', file);
}

function resolveLogDirectory() {
  const base = app.getPath('appData');
  for (const segments of LOG_DIR_CANDIDATES) {
    const candidate = path.join(base, ...segments);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
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

  const newLog = resolveAppDataPath('wirelessboard.log');
  if (fs.existsSync(newLog)) {
    shell.openPath(newLog);
    return;
  }

  const legacyLog = resolveAppDataPath('micboard.log');
  shell.openPath(legacyLog);
}


const createPyProc = () => {
  const script = resolveServiceBinary();
  if (!script) {
    console.error('Unable to locate wirelessboard service binary.');
    return;
  }

  pyProc = child.spawn(script, [], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  if (pyProc != null) {
    console.log('child process success');
  }
};

const exitPyProc = () => {
  if (pyProc) {
    pyProc.kill();
    pyProc = null;
  }
};

function restartWirelessboardServer() {
  exitPyProc();
  setTimeout(createPyProc, 250);
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
  const contextMenu = Menu.buildFromTemplate([
    { label: 'About', click() { createWindow('http://localhost:8058/about'); } },
    { type: 'separator' },
    { label: 'Launch Wirelessboard', click() { shell.openExternal('http://localhost:8058'); } },
    { label: 'Edit Configuration', click() { shell.openExternal('http://localhost:8058/#settings=true'); } },
    { label: 'Open Configuration Directory', click() { openConfigFolder('config.json'); } },
    { type: 'separator' },
    { label: 'Restart Wirelessboard Server', click() { restartWirelessboardServer(); } },
    { label: 'Open log file', click() { openLogFile(); } },
    { role: 'quit' },
  ]);

  tray.setToolTip('Wirelessboard');
  tray.setContextMenu(contextMenu);

  createPyProc();
  setTimeout(() => {
    shell.openExternal('http://localhost:8058');
  }, 5000);
});


// app.on('ready', createPyProc);

app.on('window-all-closed', e => e.preventDefault());

app.on('will-quit', exitPyProc);
