#!/usr/bin/env node

/**
 * Helpers to locate a Python interpreter and invoke PyInstaller.
 *
 * Interpreter resolution order:
 *   1. WIRELESSBOARD_PYTHON environment variable
 *   2. Virtualenv interpreters under ./venv
 *   3. Common system commands (python3, python, py -3)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function buildCandidates() {
  const candidates = [];

  function addCandidate(command, args = [], label = command) {
    if (!command) {
      return;
    }
    candidates.push({ command, args, label });
  }

  function addExecutableCandidate(relativePath, label) {
    const resolved = path.join(projectRoot, relativePath);
    if (fs.existsSync(resolved)) {
      addCandidate(resolved, [], label ?? resolved);
    }
  }

  if (process.env.WIRELESSBOARD_PYTHON) {
    const custom = process.env.WIRELESSBOARD_PYTHON.trim();
    if (custom) {
      const parts = custom.split(/\s+/);
      addCandidate(parts[0], parts.slice(1), custom);
    }
  }

  if (process.platform === 'win32') {
    addExecutableCandidate(path.join('.venv', 'Scripts', 'python.exe'), '.venv/Scripts/python.exe');
    addExecutableCandidate(path.join('.venv', 'Scripts', 'python3.exe'), '.venv/Scripts/python3.exe');
  } else {
    addExecutableCandidate(path.join('.venv', 'bin', 'python'), '.venv/bin/python');
    addExecutableCandidate(path.join('.venv', 'bin', 'python3'), '.venv/bin/python3');
  }

  if (process.platform === 'win32') {
    addCandidate('py', ['-3'], 'py -3');
    addCandidate('python', [], 'python');
    addCandidate('python3', [], 'python3');
  } else {
    addCandidate('python3', [], 'python3');
    addCandidate('python', [], 'python');
  }

  return candidates;
}

function resolvePythonInterpreter(options = {}) {
  const { verbose = true } = options;
  const candidates = buildCandidates();

  for (const candidate of candidates) {
    const versionProbe = spawnSync(candidate.command, [...candidate.args, '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
    });

    if (versionProbe.error) {
      continue;
    }

    if (versionProbe.status === 0) {
      const versionOutput = versionProbe.stdout.trim() || versionProbe.stderr.trim();
      if (verbose) {
        console.log(`Using Python interpreter ${candidate.label} (${versionOutput})`);
      }
      return candidate;
    }
  }

  const error = new Error('Unable to locate a Python interpreter.');
  if (verbose) {
    console.error(error.message);
    console.error('Install dependencies with "npm install" (which runs setup:venv) or set WIRELESSBOARD_PYTHON to a valid interpreter.');
  }
  throw error;
}

function runPython(interpreter, extraArgs, spawnOptions = {}) {
  return spawnSync(interpreter.command, [...interpreter.args, ...extraArgs], {
    cwd: projectRoot,
    ...spawnOptions,
  });
}

function runPyInstaller(options = {}) {
  const {
    interpreter = resolvePythonInterpreter(options),
    specPath = path.join('py', 'wirelessboard.spec'),
    pyInstallerArgs = [],
    spawnOptions = {},
  } = options;

  const args = ['-m', 'PyInstaller', '--noconfirm', '--clean', specPath, ...pyInstallerArgs];
  return runPython(interpreter, args, spawnOptions);
}

if (require.main === module) {
  try {
    const result = runPyInstaller({ spawnOptions: { stdio: 'inherit' } });
    if (result.error) {
      console.error(`Failed to run PyInstaller: ${result.error.message}`);
      process.exit(result.status ?? 1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  resolvePythonInterpreter,
  runPython,
  runPyInstaller,
};
