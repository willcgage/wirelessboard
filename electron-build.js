'use strict';

const builder = require('electron-builder');

const TARGET_MAP = {
  mac: builder.Platform.MAC,
  win: builder.Platform.WINDOWS,
  linux: builder.Platform.LINUX,
};

function resolveTarget() {
  const input = process.env.BUILD_TARGET ? process.env.BUILD_TARGET.toLowerCase() : 'mac';
  return TARGET_MAP[input] || TARGET_MAP.mac;
}

builder.build({
  targets: resolveTarget().createTarget(),
  config: 'electron-builder.yml',
}).catch((error) => {
  console.error('Electron Builder failed', error);
  process.exitCode = 1;
});
