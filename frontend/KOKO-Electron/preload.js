'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('koko', Object.freeze({
  openEntry: () => ipcRenderer.invoke('koko:open-entry'),
  getAppMode: () => ipcRenderer.invoke('koko:get-app-mode'),
  openWorkspace: () => ipcRenderer.invoke('koko:open-workspace'),
  closeWorkspace: () => ipcRenderer.invoke('koko:close-workspace'),
  minimizeWorkspace: () => ipcRenderer.invoke('koko:minimize-workspace'),
  chooseWorkspaceFolder: () => ipcRenderer.invoke('koko:choose-workspace-folder'),
  workspaceConnection: () => ipcRenderer.invoke('koko:workspace-connection'),
  workspaceOverview: () => ipcRenderer.invoke('koko:workspace-overview'),
  openLocalDocument: (relative) => ipcRenderer.invoke('koko:workspace-open-local', relative),
  downloadDocument: (payload) => ipcRenderer.invoke('koko:workspace-download',payload),
  workspaceUpload: (payload) => ipcRenderer.invoke('koko:workspace-upload', payload),
  workspaceStatus: () => ipcRenderer.invoke('koko:workspace-status'),
  syncStatus: () => ipcRenderer.invoke('koko:workspace-sync-status'),
  syncRescan: (folderId) => ipcRenderer.invoke('koko:workspace-sync-rescan',folderId),
  syncStop: (folderId) => ipcRenderer.invoke('koko:workspace-sync-stop',folderId),
  documentDetail: (documentId) => ipcRenderer.invoke('koko:workspace-document-detail',documentId),
  retryDocument: (input) => ipcRenderer.invoke('koko:workspace-retry-document',input),
  onSyncState: (callback) => {const h=(_event,state)=>callback(state);ipcRenderer.on('koko:sync-state',h);return ()=>ipcRenderer.removeListener('koko:sync-state',h);},
  onDocumentProgress: (callback) => {const handler = (_event,state) => callback(state);ipcRenderer.on('koko:document-progress',handler);return () => ipcRenderer.removeListener('koko:document-progress',handler);},
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
