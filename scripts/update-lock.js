#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync, writeFileSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const venvPath = path.join(projectRoot, '.venv');
const lockPath = path.join(projectRoot, 'py', 'requirements.lock');

function resolveVenvPython() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(venvPath, 'Scripts', 'python.exe'),
        path.join(venvPath, 'Scripts', 'python'),
      ]
    : [
        path.join(venvPath, 'bin', 'python3'),
        path.join(venvPath, 'bin', 'python'),
      ];

  return candidates.find((candidate) => existsSync(candidate));
}

(function main() {
  const python = resolveVenvPython();
  if (!python) {
    console.error('Unable to locate .venv Python interpreter. Run "npm run setup:venv" first.');
    process.exit(1);
  }

  const result = spawnSync(
    python,
    ['-m', 'pip', 'freeze', '--exclude-editable'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

  if (result.status !== 0) {
    console.error('pip freeze failed.');
    process.exit(result.status ?? 1);
  }

  const normalizedOutput = `${result.stdout.replace(/\r\n/g, '\n').trim()}\n`;
  writeFileSync(lockPath, normalizedOutput, 'utf8');
  console.log(`Wrote ${lockPath}`);
})();
