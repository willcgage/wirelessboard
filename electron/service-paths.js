/**
 * Where the bundled service keeps its configuration and logs.
 *
 * This has to mirror `os_config_path()` in py/config.py, because the service
 * writes there and the Electron process only reads. Electron's
 * `app.getPath('appData')` is NOT that directory on two of three platforms:
 *
 *   platform  service writes (python)         electron appData
 *   win32     %LOCALAPPDATA%   AppData\Local  AppData\Roaming
 *   linux     $XDG_DATA_HOME   ~/.local/share ~/.config
 *   darwin    ~/Library/Application Support   same
 *
 * Reading appData meant that on Windows and Linux the tray searched a tree the
 * service never writes to, found nothing, and fell through to whatever stale
 * legacy file happened to exist -- "Open log file" showing something old that
 * did not match the Logs tab, and "Open Configuration Directory" landing
 * somewhere unrelated.
 *
 * Kept out of main.js and free of any electron import so the platform rules
 * can be exercised directly, which is the part that was wrong.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const APP_DIR = 'wirelessboard';
const LEGACY_APP_DIR = 'micboard';
const LOGS_DIR = 'logs';

/**
 * @param {object} [env] process.env, injectable for testing
 * @param {string} [platform] process.platform, injectable for testing
 * @param {string} [homedir] os.homedir(), injectable for testing
 * @param {string} [fallback] used only if the platform's variable is unset
 */
function osConfigBase({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  fallback = null,
} = {}) {
  if (platform === 'win32') {
    return env.LOCALAPPDATA || fallback || path.join(homedir, 'AppData', 'Local');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support');
  }
  return env.XDG_DATA_HOME || path.join(homedir, '.local', 'share');
}

/**
 * The `wirelessboard` directory if it exists, else the pre-rename `micboard`
 * one -- matching config_path()'s own preference order.
 */
function resolveAppDataPath(file, opts = {}) {
  const exists = opts.exists || fs.existsSync;
  const base = osConfigBase(opts);
  const primary = path.join(base, APP_DIR, file);
  if (exists(primary)) {
    return primary;
  }
  return path.join(base, LEGACY_APP_DIR, file);
}

function resolveLogDirectory(opts = {}) {
  const exists = opts.exists || fs.existsSync;
  const isDirectory = opts.isDirectory || (p => fs.statSync(p).isDirectory());
  const base = osConfigBase(opts);
  for (const appDir of [APP_DIR, LEGACY_APP_DIR]) {
    const candidate = path.join(base, appDir, LOGS_DIR);
    if (exists(candidate) && isDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

function expectedLogDirectory(opts = {}) {
  return path.join(osConfigBase(opts), APP_DIR, LOGS_DIR);
}

module.exports = {
  APP_DIR,
  LEGACY_APP_DIR,
  LOGS_DIR,
  osConfigBase,
  resolveAppDataPath,
  resolveLogDirectory,
  expectedLogDirectory,
};
