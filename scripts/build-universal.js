#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync, mkdirSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function run(cmd, args, options = {}) {
  console.log(`Running: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: projectRoot,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
  return result;
}

function buildPythonBinary() {
  console.log('Building Python binary...');
  
  // Determine the correct Python executable
  const pythonExe = process.platform === 'win32' 
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
  
  if (!existsSync(pythonExe)) {
    throw new Error(`Python executable not found at ${pythonExe}. Run 'npm run setup:venv' first.`);
  }
  
  // Build with PyInstaller using the virtual environment
  run(pythonExe, ['-m', 'PyInstaller', '--noconfirm', '--clean', 'py/wirelessboard.spec']);
  
  console.log('Python binary build complete.');
}

function main() {
  console.log(`Building Python binary for universal macOS app (platform: ${process.platform})`);
  
  // Create dist directory if it doesn't exist
  const distPath = path.join(projectRoot, 'dist');
  if (!existsSync(distPath)) {
    mkdirSync(distPath, { recursive: true });
  }

  // Build the Python binary
  // On macOS, electron-builder will create a universal Electron wrapper
  // The Python binary will run via Rosetta on Apple Silicon if needed
  buildPythonBinary();
  
  console.log('Universal binary build preparation complete.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

module.exports = { buildPythonBinary, main };