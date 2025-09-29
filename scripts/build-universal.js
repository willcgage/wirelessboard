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
  
  // Determine the correct Python executable
  const pythonExe = process.platform === 'win32' 
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
  
  console.log(`Checking for Python executable at: ${pythonExe}`);
  if (!existsSync(pythonExe)) {
    console.error(`Python executable not found at ${pythonExe}`);
    console.error('Available files in .venv directory:');
    const venvDir = path.join(projectRoot, '.venv');
    if (existsSync(venvDir)) {
      const { readdirSync } = require('fs');
      try {
        const contents = readdirSync(venvDir);
        console.error(contents.join(', '));
        if (process.platform === 'win32' && existsSync(path.join(venvDir, 'Scripts'))) {
          console.error('Contents of Scripts directory:');
          const scriptsContents = readdirSync(path.join(venvDir, 'Scripts'));
          console.error(scriptsContents.join(', '));
        } else if (existsSync(path.join(venvDir, 'bin'))) {
          console.error('Contents of bin directory:');
          const binContents = readdirSync(path.join(venvDir, 'bin'));
          console.error(binContents.join(', '));
        }
      } catch (err) {
        console.error(`Could not read .venv directory: ${err.message}`);
      }
    } else {
      console.error('.venv directory does not exist');
    }
    throw new Error(`Python executable not found at ${pythonExe}. Run 'npm run setup:venv' first.`);
  }
  
  // Verify PyInstaller is available
  console.log('Verifying PyInstaller installation...');
  try {
    const checkResult = spawnSync(pythonExe, ['-m', 'PyInstaller', '--version'], { 
      cwd: projectRoot,
      stdio: 'pipe'
    });
    if (checkResult.status !== 0) {
      console.error('PyInstaller not found. Installing PyInstaller...');
      run(pythonExe, ['-m', 'pip', 'install', 'pyinstaller']);
    } else {
      console.log(`PyInstaller version: ${checkResult.stdout.toString().trim()}`);
    }
  } catch (err) {
    console.warn(`Could not verify PyInstaller: ${err.message}. Attempting to install...`);
    run(pythonExe, ['-m', 'pip', 'install', 'pyinstaller']);
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