'use strict';

const builder = require("electron-builder");
const Platform = builder.Platform

// Promise is returned
builder.build({
  targets: Platform.MAC.createTarget(),
  config: {
  appId: 'com.wirelessboard.app',
  productName: 'Wirelessboard Server',
    asar: true,
    asarUnpack: [
  'dist/wirelessboard-service',
      'build/trayTemplate.png',
      'build/trayTemplate@2x.png',
    ],
    mac: {
      identity: null,
      category: 'public.app-category.utilities',
      extendInfo: {
        LSBackgroundOnly: 1,
        LSUIElement: 1,
      },
    },
    files: [
  'dist/wirelessboard-service',
      'main.js',
      'build/trayTemplate.png',
      'build/trayTemplate@2x.png',
    ],
  },
})
  .then(() => {
    // handle result
  })
  .catch((error) => {
    // handle error
  })
