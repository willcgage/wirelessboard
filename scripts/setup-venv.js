#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const venvPath = path.join(projectRoot, '.venv');
const requirementsPath = path.join(projectRoot, 'py', 'requirements.txt');

const envOverride = process.env.WIRELESSBOARD_PYTHON && process.env.WIRELESSBOARD_PYTHON.trim();
const pythonCandidates = process.platform === 'win32'
  ? ['py', 'python3', 'python']
  : ['python3.12', 'python3', 'python'];

function run(cmd, args, options = {}) {
  console.log(`Running: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: projectRoot,
    ...options,
  });

  if (result.status !== 0) {
    console.error(`Command failed with exit code ${result.status}: ${cmd} ${args.join(' ')}`);
    if (result.error) {
      console.error(`Error details: ${result.error.message}`);
    }
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function resolvePython() {
  if (envOverride) {
    const parts = envOverride.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1).length ? parts.slice(1) : [];
    const check = spawnSync(cmd, [...args, '--version'], { cwd: projectRoot, stdio: 'ignore' });
    if (check.status === 0) {
      return { cmd, args, label: envOverride };
    }
    console.warn(`WIRELESSBOARD_PYTHON=${envOverride} did not respond to --version; falling back to search.`);
  }

  for (const cmd of pythonCandidates) {
    const check = spawnSync(cmd, ['--version'], { cwd: projectRoot, stdio: 'ignore' });
    if (check.status === 0) {
      return { cmd, args: [], label: cmd };
    }
  }
  throw new Error('Unable to locate a usable Python interpreter. Install Python 3.12+ and ensure it is on your PATH.');
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
  try {
  const { cmd: python, args: pythonArgs, label } = resolvePython();
  console.log(`Using Python interpreter: ${label}`);

    console.log('Creating virtual environment...');
  run(python, [...pythonArgs, '-m', 'venv', '.venv']);

    const venvPython = resolveVenvPython();
    console.log(`Bootstrapping virtual environment via: ${venvPython}`);
    
    if (!existsSync(venvPython)) {
      console.error(`Virtual environment Python not found at: ${venvPython}`);
      console.error('Available files in .venv:');
      const { readdirSync } = require('fs');
      try {
        const venvContents = readdirSync(venvPath);
        console.error(venvContents.join(', '));
        if (process.platform === 'win32' && existsSync(path.join(venvPath, 'Scripts'))) {
          console.error('Contents of Scripts directory:');
          const scriptsContents = readdirSync(path.join(venvPath, 'Scripts'));
          console.error(scriptsContents.join(', '));
        } else if (existsSync(path.join(venvPath, 'bin'))) {
          console.error('Contents of bin directory:');
          const binContents = readdirSync(path.join(venvPath, 'bin'));
          console.error(binContents.join(', '));
        }
      } catch (err) {
        console.error(`Could not read .venv directory: ${err.message}`);
      }
      throw new Error(`Virtual environment setup failed: Python executable not found at ${venvPython}`);
    }

    console.log('Upgrading pip, setuptools, and wheel...');
    run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel']);
    
    console.log('Installing project dependencies...');
    run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);

    console.log('Virtual environment ready.');
  } catch (error) {
    console.error('Virtual environment setup failed:', error.message);
    process.exit(1);
  }
})();
