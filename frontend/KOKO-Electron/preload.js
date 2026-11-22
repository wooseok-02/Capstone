'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('koko', Object.freeze({
  getState: () => ipcRenderer.invoke('koko:get-state'),
  openAuth: () => ipcRenderer.invoke('koko:open-auth'),
  closeAuth: () => ipcRenderer.invoke('koko:close-auth'),
  minimizeAuth: () => ipcRenderer.invoke('koko:minimize-auth'),
  setApiBase: (url) => ipcRenderer.invoke('koko:set-api-base', url),
  startLogin: (provider) => ipcRenderer.invoke('koko:start-login', provider),
  cancelLogin: () => ipcRenderer.invoke('koko:cancel-login'),
  logout: () => ipcRenderer.invoke('koko:logout'),
  refreshProfile: () => ipcRenderer.invoke('koko:refresh-profile'),
  movePet: (x, y) => ipcRenderer.send('koko:move-pet', { x, y }),
  showPetMenu: () => ipcRenderer.send('koko:pet-menu'),
  onAuthState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('koko:auth-state', handler);
    return () => ipcRenderer.removeListener('koko:auth-state', handler);
  },
  onPetMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('koko:pet-message', listener);
    return () => ipcRenderer.removeListener('koko:pet-message', listener);
  }
}));
