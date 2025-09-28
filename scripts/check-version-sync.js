#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const PY_VERSION_PATH = path.join(PROJECT_ROOT, 'py', 'version.py');

function readPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  return packageJson.version;
}

function readPythonVersion() {
  const contents = fs.readFileSync(PY_VERSION_PATH, 'utf8');
  const match = contents.match(/__version__\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('Unable to find __version__ in py/version.py.');
  }
  return match[1];
}

function main() {
  const packageVersion = readPackageVersion();
  const pythonVersion = readPythonVersion();

  if (packageVersion !== pythonVersion) {
    console.error('Version mismatch detected:');
    console.error(`  package.json: ${packageVersion}`);
    console.error(`  py/version.py: ${pythonVersion}`);
    console.error('\nRun "npm version <bump>" to resync the versions.');
    process.exit(1);
  }

  console.log(`Versions are in sync (${packageVersion}).`);
}

main();
