#!/usr/bin/env node
/**
 * Run the Python test suite with the project's interpreter.
 *
 * `python3 -m pytest` picks whichever python is on PATH, which on a developer
 * machine is the system one -- not the .venv that `npm install` provisions and
 * where the dependencies actually live. `npm test` therefore failed locally
 * with ModuleNotFoundError while passing in CI, where the dependencies are
 * installed into the system interpreter.
 *
 * Prefers the virtualenv, falls back to PATH so CI keeps working unchanged.
 * Mirrors the resolution order in run-pyinstaller.js.
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
const args = ['-m', 'pytest', 'py/tests', '-q', ...process.argv.slice(2)];
const result = spawnSync(python, args, { cwd: projectRoot, stdio: 'inherit' });

if (result.error) {
  console.error(`Could not run ${python}: ${result.error.message}`);
  console.error('Install dependencies with "npm install" (which runs setup:venv).');
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
