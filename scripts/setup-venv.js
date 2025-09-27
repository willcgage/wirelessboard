#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const venvPath = path.join(projectRoot, '.venv');
const requirementsPath = path.join(projectRoot, 'py', 'requirements.txt');

const pythonCandidates = process.platform === 'win32'
  ? ['py', 'python3', 'python']
  : ['python3', 'python'];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: projectRoot,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function resolvePython() {
  for (const cmd of pythonCandidates) {
    const check = spawnSync(cmd, ['--version'], { cwd: projectRoot, stdio: 'ignore' });
    if (check.status === 0) {
      return cmd;
    }
  }
  throw new Error('Unable to locate a usable Python interpreter. Install Python 3.9+ and ensure it is on your PATH.');
}

function resolveVenvPython() {
  if (process.platform === 'win32') {
    const exe = path.join(venvPath, 'Scripts', 'python.exe');
    if (existsSync(exe)) {
      return exe;
    }
    return path.join(venvPath, 'Scripts', 'python');
  }
  return path.join(venvPath, 'bin', 'python');
}

(async () => {
  const python = resolvePython();
  console.log(`Using Python interpreter: ${python}`);

  run(python, ['-m', 'venv', '.venv']);

  const venvPython = resolveVenvPython();
  console.log(`Bootstrapping virtual environment via: ${venvPython}`);

  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel']);
  run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);

  console.log('Virtual environment ready.');
})();
