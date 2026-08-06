/**
 * The only bridge between the update window and the main process.
 *
 * contextIsolation stays on and nodeIntegration stays off, so the page gets
 * this narrow surface and nothing else. It is our own local HTML, but a window
 * that can start a download and quit the application is not the place to relax
 * that.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wirelessboardUpdate', {
  // Pull rather than push for the initial paint: the window may finish loading
  // before or after main sends anything, and asking removes the race.
  getState: () => ipcRenderer.invoke('update:get-state'),

  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },

  download: () => ipcRenderer.send('update:download'),
  dismiss: () => ipcRenderer.send('update:dismiss'),
  openReleasePage: () => ipcRenderer.send('update:open-release-page'),
});
