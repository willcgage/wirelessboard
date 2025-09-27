const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
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

function toUnpacked(p) {
  return p.replace('app.asar', 'app.asar.unpacked');
}

function resolveServiceBinary() {
  for (const [folder, filename] of SERVICE_CANDIDATES) {
    const candidate = toUnpacked(path.join(__dirname, 'dist', folder, filename));
    if (fs.existsSync(candidate)) {
      return candidate;
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
  pyProc.kill();
  pyProc = null;
};

function restartWirelessboardServer() {
  pyProc.kill();
  pyProc = null;
  setTimeout(createPyProc, 250);
}


app.on('ready', () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.wirelessboard.app');
  }
  const icon = path.join(__dirname, 'build', 'trayTemplate.png').replace('app.asar', 'app.asar.unpacked');
  tray = new Tray(icon);
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
