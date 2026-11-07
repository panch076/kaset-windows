'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('kaset', {
  api: async (method, args) => {
    const r = await ipcRenderer.invoke('api', method, args);
    if (!r.ok) {
      const e = new Error(r.error);
      e.code = r.code;
      throw e;
    }
    return r.data;
  },
  player: (cmd, arg) => ipcRenderer.invoke('player', cmd, arg),
  yt: (cmd, arg) => ipcRenderer.invoke('yt', cmd, arg),
  onYtEvent: on('yt:event'),
  onYtVisible: on('yt:visible'),
  onYtFullscreen: on('yt:fullscreen'),
  command: (cmd, arg) => ipcRenderer.send('command', cmd, arg),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setTheme: (appearance) => ipcRenderer.invoke('theme:set', appearance),
  version: () => ipcRenderer.invoke('app:version'),
  ready: () => ipcRenderer.invoke('app:ready'),
  toggleFullscreen: () => ipcRenderer.invoke('app:fullscreen'),
  checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onPlayerEvent: on('player:event'),
  onCommand: on('command'),
  onMeta: on('meta'),
  onOpenUrl: on('open-url'),
  onAuthChanged: on('auth:changed'),
  onVideoVisible: on('video:visible'),
});
