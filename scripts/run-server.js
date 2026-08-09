#!/usr/bin/env node
/**
 * Run the Tornado service with the project's interpreter.
 *
 * `npm run server` used to name ./.venv/bin/python directly, which is the
 * POSIX venv layout. Windows puts the interpreter in .venv/Scripts/python.exe,
 * so the script could not start there at all -- and a hardcoded relative path
 * also silently ignores the WIRELESSBOARD_PYTHON override the other entry
 * points honour.
 *
 * Prefers the virtualenv, falls back to PATH so a system-installed set of
 * dependencies keeps working. Mirrors the resolution order in run-pytest.js.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

function venvPython() {
  const candidates = process.platform === 'win32'
    ? [path.join('.venv', 'Scripts', 'python.exe'), path.join('.venv', 'Scripts', 'python')]
    : [path.join('.venv', 'bin', 'python'), path.join('.venv', 'bin', 'python3')];

  for (const relative of candidates) {
    const absolute = path.join(projectRoot, relative);
    if (fs.existsSync(absolute)) return absolute;
  }
  return null;
}

function resolveInterpreter() {
  const override = process.env.WIRELESSBOARD_PYTHON && process.env.WIRELESSBOARD_PYTHON.trim();
  if (override) return override;

  const venv = venvPython();
  if (venv) return venv;

  return process.platform === 'win32' ? 'python' : 'python3';
}

const python = resolveInterpreter();
const args = [path.join('py', 'wirelessboard.py'), ...process.argv.slice(2)];
const result = spawnSync(python, args, { cwd: projectRoot, stdio: 'inherit' });

if (result.error) {
  console.error(`Could not run ${python}: ${result.error.message}`);
  console.error('Install dependencies with "npm install" (which runs setup:venv).');
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
