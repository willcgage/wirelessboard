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
 *
 * Pass --system to skip the virtualenv deliberately, which is what server:sys
 * wants. It used to name `python3`, but on Windows that reaches the Store alias
 * stub rather than an interpreter, so the script opened the Microsoft Store
 * instead of starting anything.
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

// `python3` is not a safe name for this on Windows: the Store alias stub
// answers to it whether or not an interpreter is installed. `python` is what
// resolves to a real one, which is why the platforms differ here.
function systemPython() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function resolveInterpreter({ system }) {
  // An explicit interpreter stays the most specific instruction, so it wins
  // over --system rather than the other way round.
  const override = process.env.WIRELESSBOARD_PYTHON && process.env.WIRELESSBOARD_PYTHON.trim();
  if (override) return override;

  if (system) return systemPython();

  const venv = venvPython();
  if (venv) return venv;

  return systemPython();
}

// --system is ours; everything else belongs to wirelessboard.py.
const passthrough = process.argv.slice(2);
const systemIndex = passthrough.indexOf('--system');
const system = systemIndex !== -1;
if (system) passthrough.splice(systemIndex, 1);

const python = resolveInterpreter({ system });
const args = [path.join('py', 'wirelessboard.py'), ...passthrough];
const result = spawnSync(python, args, { cwd: projectRoot, stdio: 'inherit' });

if (result.error) {
  console.error(`Could not run ${python}: ${result.error.message}`);
  console.error('Install dependencies with "npm install" (which runs setup:venv).');
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
