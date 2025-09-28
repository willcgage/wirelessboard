#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const PY_VERSION_PATH = path.join(PROJECT_ROOT, 'py', 'version.py');
const RELATIVE_PY_VERSION_PATH = path.relative(PROJECT_ROOT, PY_VERSION_PATH);

function getPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  if (!packageJson.version) {
    throw new Error('package.json is missing a "version" field.');
  }
  return packageJson.version;
}

function writePythonVersion(version) {
  const header = '"""Wirelessboard version information.\n\n' +
    'This file is generated from package.json. Do not edit manually; run\n' +
    '`npm version` with the appropriate semver bump to refresh it.\n' +
    '"""\n\n__all__ = ("__version__",)\n\n';
  const body = `__version__ = "${version}"\n`;
  fs.writeFileSync(PY_VERSION_PATH, header + body, 'utf8');
}

function stagePythonVersionFile() {
  const result = spawnSync('git', ['add', RELATIVE_PY_VERSION_PATH], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
  });
  if (result.status !== 0) {
    throw new Error('Failed to stage py/version.py.');
  }
}

try {
  const version = getPackageVersion();
  writePythonVersion(version);
  stagePythonVersionFile();
  console.log(`Synchronized py/version.py to ${version}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
