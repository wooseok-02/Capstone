'use strict';
const { app, BrowserWindow, Menu, Tray, screen, ipcMain, nativeImage, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { ApiClient } = require('./lib/api-client');
const { AuthService } = require('./lib/auth-service');
const { SecureTokenStore } = require('./lib/token-store');
const { validateBaseUrl } = require('./lib/oauth-utils');

const APP_ICON = path.join(__dirname, 'assets', 'koko-icon.png');
const PET_WIDTH = 270;
const PET_HEIGHT = 260;
let petWindow = null;
let authWindow = null;
let tray = null;
let apiUrl = '';
let auth;
let configFile;
let bootPromise;
let historyFile;
let hasAuthenticatedBefore = false;

function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}
function sendStatus(state) {
  for (const win of [authWindow, petWindow]) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('koko:auth-state', state);
    }
  }
}
function publicState() {
  return { ...auth.snapshot(), apiConfigured: !!apiUrl, apiBaseUrl: apiUrl, oauthEnabled: true, hasAuthenticatedBefore };
}
function recordSuccessfulAuthentication() {
  if (hasAuthenticatedBefore) return;
  hasAuthenticatedBefore = true;
  try { fs.writeFileSync(historyFile, JSON.stringify({ hasAuthenticatedBefore: true }), { mode: 0o600 }); }
  catch { /* The account is authenticated; UI-only history does not affect it. */ }
}
function loadConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config?.apiBaseUrl) apiUrl = validateBaseUrl(config.apiBaseUrl);
  } catch { apiUrl = ''; }
  if (process.env.KOKO_API_BASE_URL) {
    try { apiUrl = validateBaseUrl(process.env.KOKO_API_BASE_URL); }
    catch { apiUrl = ''; }
  }
}
function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const workArea = screen.getPrimaryDisplay().workArea;
  petWindow = new BrowserWindow({
    width: PET_WIDTH, height: PET_HEIGHT,
    x: workArea.x + workArea.width - PET_WIDTH - 30,
    y: workArea.y + workArea.height - PET_HEIGHT - 26,
    useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
    maximizable: false, minimizable: false, fullscreenable: false, resizable: false,
    show: false, icon: APP_ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  secureWindow(petWindow);
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWindow.once('ready-to-show', () => petWindow?.show());
  petWindow.on('closed', () => { petWindow = null; });
  return petWindow;
}
function createAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    if (authWindow.isMinimized()) authWindow.restore();
    authWindow.show(); authWindow.focus(); return authWindow;
  }
  authWindow = new BrowserWindow({
    width: 780, height: 830, minWidth: 620, minHeight: 640,
    frame: false, show: false, title: '코코 (KOKO)', icon: APP_ICON,
    backgroundColor: '#F2EFE7', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  secureWindow(authWindow);
  authWindow.loadFile(path.join(__dirname, 'renderer', 'auth.html'));
  authWindow.once('ready-to-show', () => authWindow?.show());
  authWindow.on('closed', () => {
    authWindow = null;
    if (auth && ['preparing', 'waiting', 'exchanging'].includes(auth.phase)) auth.cancel(true);
  });
  return authWindow;
}
function showPetMenu() {
  Menu.buildFromTemplate([
    { label: '코코 열기', click: createAuthWindow },
    { type: 'separator' },
    { label: '로그인 취소', enabled: !!auth?.pending, click: () => auth.cancel() },
    { label: '로그아웃', enabled: !!auth?.user, click: () => { void auth.logout(); } },
    { type: 'separator' },
    { label: '코코 종료', click: () => app.quit() }
  ]).popup({ window: petWindow ?? undefined });
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(APP_ICON).resize({ width: 24, height: 24 }));
  tray.setToolTip('코코 KOKO — 데스크톱 펫');
  tray.on('double-click', () => createPetWindow().show());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '코코 표시', click: () => createPetWindow().show() },
    { label: '로그인 및 계정 관리', click: createAuthWindow },
    { label: '종료', click: () => app.quit() }
  ]));
}
function checkSender(event) {
  return !!authWindow && !authWindow.isDestroyed() && event.sender === authWindow.webContents;
}
function registerIpc() {
  ipcMain.handle('koko:get-state', async () => { await bootPromise; return publicState(); });
  ipcMain.handle('koko:open-auth', () => { createAuthWindow(); return true; });
  ipcMain.handle('koko:close-auth', (event) => { if (checkSender(event)) authWindow?.close(); return true; });
  ipcMain.handle('koko:minimize-auth', (event) => { if (checkSender(event)) authWindow?.minimize(); return true; });
  ipcMain.handle('koko:set-api-base', async (event, input) => {
    if (!checkSender(event)) throw new Error('허용되지 않은 요청입니다.');
    const next = validateBaseUrl(input);
    if (auth.user || auth.pending) throw new Error('진행 중인 인증을 종료하고 서버를 변경해 주세요.');
    if (next !== apiUrl) {
      // Reset session when switching backends; never send tokens to a different backend.
      await auth.logout();
      apiUrl = next;
      fs.writeFileSync(configFile, JSON.stringify({ apiBaseUrl: apiUrl }, null, 2), { mode: 0o600 });
    }
    sendStatus(publicState());
    return publicState();
  });
  ipcMain.handle('koko:start-login', async (event, provider) => {
    if (!checkSender(event)) throw new Error('허용되지 않은 요청입니다.');
    if (!apiUrl) throw new Error('백엔드 API 서버 주소를 먼저 설정해 주세요.');
    if (auth.user) throw new Error('이미 로그인되어 있습니다.');
    await auth.start(provider);
    return publicState();
  });
  ipcMain.handle('koko:cancel-login', (event) => {
    if (!checkSender(event)) return false;
    auth.cancel(); return true;
  });
  ipcMain.handle('koko:logout', async (event) => {
    if (!checkSender(event)) throw new Error('허용되지 않은 요청입니다.');
    return auth.logout();
  });
  ipcMain.handle('koko:refresh-profile', async (event) => {
    if (!checkSender(event)) throw new Error('허용되지 않은 요청입니다.');
    await auth.getProfile(); return publicState();
  });
  ipcMain.on('koko:move-pet', (event, delta) => {
    if (event.sender !== petWindow?.webContents || !delta || !petWindow || petWindow.isDestroyed()) return;
    const [x, y] = petWindow.getPosition();
    const dx = Number.isFinite(delta.x) ? Math.max(-100, Math.min(100, delta.x)) : 0;
    const dy = Number.isFinite(delta.y) ? Math.max(-100, Math.min(100, delta.y)) : 0;
    petWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('koko:pet-menu', (event) => { if (event.sender === petWindow?.webContents) showPetMenu(); });
}

const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance', () => { createPetWindow().show(); petWindow?.focus(); });
  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    configFile = path.join(userData, 'koko-api-config.json');
    historyFile = path.join(userData, 'koko-onboarding-ui.json');
    try { hasAuthenticatedBefore = JSON.parse(fs.readFileSync(historyFile, 'utf8')).hasAuthenticatedBefore === true; }
    catch { hasAuthenticatedBefore = false; }
    loadConfig();
    const store = new SecureTokenStore({ storage: safeStorage, file: path.join(userData, 'koko-refresh-token.bin') });
    const api = new ApiClient({ getBaseUrl: () => apiUrl });
    auth = new AuthService({ api, store, getBaseUrl: () => apiUrl,
      openBrowser: (url) => {
        const uri = new URL(url);
        if (!['https:', 'http:'].includes(uri.protocol) || !url.startsWith(apiUrl + '/auth/')) throw new Error('브라우저 URL을 검증할 수 없습니다.');
        return shell.openExternal(url);
      },
      onUpdate: (state) => {
        if (state.phase === 'authenticated') recordSuccessfulAuthentication();
        sendStatus(publicState());
        if (state.phase === 'authenticated' && petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('koko:pet-message', '로그인되었어요!');
      }
    });
    bootPromise = apiUrl ? auth.restore() : (async () => { auth.emit('idle'); })();
    registerIpc();
    createPetWindow();
    createTray();
    await bootPromise;
  }).catch((error) => { console.error('[KOKO] 초기화 실패:', error?.message); });
  app.on('activate', () => { if (app.isReady()) createPetWindow().show(); });
  app.on('before-quit', () => { auth?.cancel(true); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit(); });
}
