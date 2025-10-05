#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync, mkdirSync, rmSync } = require('fs');
const path = require('path');
const {
  resolvePythonInterpreter,
  runPython,
} = require('./run-pyinstaller');

const projectRoot = path.resolve(__dirname, '..');

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
  return result;
}

function buildPythonBinary() {
  console.log('Building Python binary...');

  let interpreter;
  try {
    interpreter = resolvePythonInterpreter();
  } catch (error) {
    console.error(error.message);
    console.error('Ensure dependencies are installed via "npm install" or provide WIRELESSBOARD_PYTHON.');
    throw error;
  }

  const interpreterDisplay = interpreter.label || interpreter.command;

  // Verify PyInstaller is available
  console.log('Verifying PyInstaller installation...');
  try {
    const checkResult = runPython(interpreter, ['-m', 'PyInstaller', '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (checkResult.status !== 0) {
      console.error('PyInstaller not found. Installing PyInstaller...');
      const installResult = runPython(interpreter, ['-m', 'pip', 'install', 'pyinstaller'], { stdio: 'inherit' });
      if (installResult.status !== 0 || installResult.error) {
        throw new Error('Failed to install PyInstaller');
      }
    } else {
      const versionOutput = checkResult.stdout.toString().trim() || checkResult.stderr.toString().trim();
      if (versionOutput) {
        console.log(`PyInstaller version: ${versionOutput}`);
      }
    }
  } catch (err) {
    console.warn(`Could not verify PyInstaller using ${interpreterDisplay}: ${err.message}. Attempting to install...`);
    const installResult = runPython(interpreter, ['-m', 'pip', 'install', 'pyinstaller'], { stdio: 'inherit' });
    if (installResult.status !== 0 || installResult.error) {
      throw new Error('Failed to install PyInstaller');
    }
  }

  // Build with PyInstaller
  const buildResult = runPython(interpreter, ['-m', 'PyInstaller', '--noconfirm', '--clean', 'py/wirelessboard.spec'], {
    stdio: 'inherit',
  });

  if (buildResult.status !== 0 || buildResult.error) {
    throw new Error(`PyInstaller build failed using ${interpreterDisplay}`);
  }

  console.log('Python binary build complete.');
}

function main() {
  console.log(`Building Python binary for universal macOS app (platform: ${process.platform})`);
  
  // Create dist directory if it doesn't exist
  const distPath = path.join(projectRoot, 'dist');
  if (!existsSync(distPath)) {
    console.log('Creating dist directory...');
    mkdirSync(distPath, { recursive: true });
  }

  // Build the Python binary
  // On macOS, electron-builder will create a universal Electron wrapper
  // The Python binary will run via Rosetta on Apple Silicon if needed
  buildPythonBinary();
  
  // Verify the build output exists
  const expectedOutput = path.join(distPath, 'wirelessboard-service');
  if (existsSync(expectedOutput)) {
    console.log(`✓ Python binary successfully created at: ${expectedOutput}`);
  } else {
    console.error(`✗ Expected output not found at: ${expectedOutput}`);
    console.error('Contents of dist directory:');
    const { readdirSync } = require('fs');
    try {
      const distContents = readdirSync(distPath);
      console.error(distContents.join(', '));
    } catch (err) {
      console.error(`Could not read dist directory: ${err.message}`);
    }
    throw new Error('PyInstaller build completed but expected output was not found');
  }

  const venvPath = path.join(projectRoot, '.venv');
  const shouldRemoveVenv = process.env.CI && !process.env.WIRELESSBOARD_KEEP_VENV;
  if (shouldRemoveVenv && existsSync(venvPath)) {
    console.log('CI environment detected; removing .venv before packaging to avoid external Python symlinks.');
    try {
      rmSync(venvPath, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to remove ${venvPath}: ${err.message}`);
    }
  }
  
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