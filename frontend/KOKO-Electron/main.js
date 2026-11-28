'use strict';
const { app, BrowserWindow, Menu, Tray, screen, ipcMain, nativeImage, safeStorage, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { ApiClient } = require('./lib/api-client');
const { AuthService } = require('./lib/auth-service');
const { SecureTokenStore } = require('./lib/token-store');
const { validateBaseUrl } = require('./lib/oauth-utils');
const { DocumentService, scanFolder, safeFilePath, safeDownloadUrl, getFolderRows, statusFrom } = require('./lib/document-service');
const { AutoSyncManager } = require('./lib/auto-sync');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { entryDestination, shouldOpenAfterLogin } = require('./lib/entry-route');
const { demoEnabled, petDestination, workspaceConnection } = require('./lib/demo-mode');
const DEMO_MODE = demoEnabled({ isPackaged: app.isPackaged, argv: process.argv });

const APP_ICON = path.join(__dirname, 'assets', 'koko-icon.png');
const PET_WIDTH = 270;
const PET_HEIGHT = 260;
let petWindow = null;
let authWindow = null;
let workspaceWindow = null;
let tray = null;
let apiUrl = '';
let auth;
let configFile;
let bootPromise;
let historyFile;
let hasAuthenticatedBefore = false;
let selectedScan = null;
let latestFolderId = null;
let isUploading = false;
let folderRegistryPath;
let interactiveLoginPending = false;
let autoSync = null;
let autoSyncInitialization = null;
const DEFAULT_API_URL = 'https://capstone.nsu-coco.online'; // public API origin only; never put secrets here
let lastFolderPath;
let knownLastFolderId = null;
const accountScope = () => [apiUrl, auth?.user?.provider, auth?.user?.id].join('|');
const deviceService = (onProgress = () => {}) => new DocumentService({
  baseUrl: apiUrl, accessToken: auth.access,
  getAccessToken: async () => { if (Date.now() > auth.expiresAt - 30000) await auth.refreshSession(); return auth.access; },
  userData: app.getPath('userData'), accountKey: accountScope(), onProgress
});
const lastFolderFilename = () => path.join(app.getPath('userData'),'koko-last-folder-' + crypto.createHash('sha256').update(accountScope()).digest('hex').slice(0,20) + '.json');

function notifySync(status) {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) workspaceWindow.webContents.send('koko:sync-state',status);
}
async function ensureAutoSync() {
  if (DEMO_MODE || !auth?.user || !auth?.access || !apiUrl) return null;
  if (autoSync && autoSync.currentScope === accountScope()) return autoSync;
  if (autoSyncInitialization) return autoSyncInitialization;
  const scope=accountScope();
  autoSyncInitialization=(async()=>{
    autoSync?.stop();autoSync=null;
    const candidate=new AutoSyncManager({userData:app.getPath('userData'),accountKey:scope,apiOrigin:apiUrl,
      serviceFactory:()=>deviceService(),onUpdate:notifySync});
    await candidate.load();
    if (!auth?.user || !auth?.access || accountScope()!==scope) {candidate.stop();return null;}
    candidate.currentScope=scope;autoSync=candidate;candidate.start();return candidate;
  })();
  try{return await autoSyncInitialization;}finally{autoSyncInitialization=null;}
}
function stopAutoSync(){autoSync?.stop();autoSync=null;}

function restoreLastFolderId() {
  if (knownLastFolderId) return knownLastFolderId;
  try { const s=JSON.parse(fs.readFileSync(lastFolderFilename(),'utf8')); if (typeof s.folderId === 'string' && /^[0-9a-f-]{36}$/i.test(s.folderId)) knownLastFolderId=s.folderId; } catch {}
  return knownLastFolderId;
}

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
  if (DEMO_MODE) return { phase: 'demo', user: null, apiConfigured: false, apiBaseUrl: '', oauthEnabled: false, hasAuthenticatedBefore: false, demoMode: true };
  return { ...auth.snapshot(), apiConfigured: !!apiUrl, apiBaseUrl: apiUrl, oauthEnabled: true, hasAuthenticatedBefore, demoMode: false };
}
function recordSuccessfulAuthentication() {
  if (hasAuthenticatedBefore) return;
  hasAuthenticatedBefore = true;
  try { fs.writeFileSync(historyFile, JSON.stringify({ hasAuthenticatedBefore: true }), { mode: 0o600 }); }
  catch { /* The account is authenticated; UI-only history does not affect it. */ }
}
function loadConfig() {
  apiUrl = DEFAULT_API_URL;
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config?.apiBaseUrl) apiUrl = validateBaseUrl(config.apiBaseUrl);
  } catch { apiUrl = DEFAULT_API_URL; }
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
    if (auth && ['preparing', 'waiting', 'exchanging'].includes(auth.phase)) {
      interactiveLoginPending = false;
      auth.cancel(true);
    }
  });
  return authWindow;
}

function createWorkspaceWindow() {
  // The explicit dev-only demo never constitutes authentication. Production requires OAuth.
  if (!DEMO_MODE && entryDestination(auth) !== 'workspace') return createAuthWindow();
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    if (workspaceWindow.isMinimized()) workspaceWindow.restore();
    workspaceWindow.show(); workspaceWindow.focus(); return workspaceWindow;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1440, area.width);
  const height = Math.min(900, area.height);
  workspaceWindow = new BrowserWindow({
    width, height, x: Math.round(area.x+(area.width-width)/2), y: Math.round(area.y+(area.height-height)/2),
    minWidth: Math.min(800, area.width), minHeight: Math.min(600, area.height),
    maxWidth: 1920, maxHeight: 1080, resizable: true, maximizable: true,
    frame: false, show: false, title: '코코 (KOKO) — 나의 작업실',
    backgroundColor: '#F2EFE7', icon: APP_ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname,'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  secureWindow(workspaceWindow);
  workspaceWindow.loadFile(path.join(__dirname, 'renderer', 'workspace.html'));
  workspaceWindow.once('ready-to-show', () => workspaceWindow?.show());
  workspaceWindow.on('closed', () => { workspaceWindow = null; });
  return workspaceWindow;
}
// Pet click is the single entry point: login when signed out, workspace when signed in.
async function openKokoFromPet() {
  if (DEMO_MODE) return createWorkspaceWindow();
  try { await bootPromise; } catch { /* show the login UI if restore failed */ }
  if (petDestination({demoMode:DEMO_MODE, session:auth}) === 'workspace') {
    // Avoid leaving a redundant account window above the workspace.
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    return createWorkspaceWindow();
  }
  return createAuthWindow();
}
function checkWorkspaceSender(event) {
  return !!workspaceWindow && !workspaceWindow.isDestroyed() && event.sender === workspaceWindow.webContents;
}

function showPetMenu() {
  Menu.buildFromTemplate([
    { label: '코코 열기', click: () => { void openKokoFromPet(); } },
    { label: DEMO_MODE ? '개발용 시연 중 · 로그인 없음' : '로그인 및 계정 관리', enabled: !DEMO_MODE, click: createAuthWindow },
    { label: '작업실 열기', click: () => { void openKokoFromPet(); } },
    { type: 'separator' },
    { label: '로그인 취소', enabled: !!auth?.pending, click: () => { interactiveLoginPending = false; auth.cancel(); } },
    { label: '로그아웃', enabled: !!auth?.user, click: () => { interactiveLoginPending = false; void auth.logout(); } },
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
    { label: DEMO_MODE ? '개발용 시연 중 · 서버 미연결' : '로그인 및 계정 관리', enabled: !DEMO_MODE, click: createAuthWindow },
    { label: '작업실 열기', click: () => { void openKokoFromPet(); } },
    { label: '종료', click: () => app.quit() }
  ]));
}
function checkSender(event) {
  return !!authWindow && !authWindow.isDestroyed() && event.sender === authWindow.webContents;
}
function registerIpc() {
  ipcMain.handle('koko:get-app-mode', () => ({ demoMode: DEMO_MODE, canUseBackend: !DEMO_MODE }));
  ipcMain.handle('koko:open-entry', async (event) => {
    if (event.sender !== petWindow?.webContents) throw new Error('허용되지 않은 요청입니다.');
    await openKokoFromPet();
    return true;
  });
  ipcMain.handle('koko:open-workspace', (event) => {
    if (event.sender !== authWindow?.webContents && event.sender !== petWindow?.webContents) return false;
    if (!DEMO_MODE && entryDestination(auth) !== 'workspace') { createAuthWindow(); return false; }
    createWorkspaceWindow(); return true;
  });
  ipcMain.handle('koko:close-workspace', (event) => { if (checkWorkspaceSender(event)) workspaceWindow?.close(); return true; });
  ipcMain.handle('koko:minimize-workspace', (event) => { if (checkWorkspaceSender(event)) workspaceWindow?.minimize(); return true; });
  ipcMain.handle('koko:choose-workspace-folder', async (event) => {
    if (!checkWorkspaceSender(event)) throw new Error('허용되지 않은 요청입니다.');
    const result = await dialog.showOpenDialog(workspaceWindow, {
      title: DEMO_MODE ? '시연용 폴더 트리 확인 (전송 없음)' : '코코가 살펴볼 폴더를 선택하세요', properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    const chosen = result.filePaths[0];
    const scan = scanFolder(chosen, { limit: 5000, maxDepth: 12 });
    let known = [];
    const account=String(auth?.user?.provider)+':'+String(auth?.user?.id);
    if (!DEMO_MODE) try { known = JSON.parse(fs.readFileSync(folderRegistryPath, 'utf8')).filter(x => x.account === account && (!x.apiOrigin || x.apiOrigin === apiUrl)); } catch {}
    const normalized = p => path.resolve(p).replace(/[\\/]+$/, '').toLocaleLowerCase();
    if (known.some(x => normalized(x.path) !== normalized(scan.root) && (normalized(x.path).startsWith(normalized(scan.root)+path.sep) || normalized(scan.root).startsWith(normalized(x.path)+path.sep)))) {
      throw new Error('이미 등록한 상위·하위 폴더와 중복됩니다. 다른 폴더를 선택해 주세요.');
    }
    selectedScan = scan;
    latestFolderId = null;
    let existingExclusions=[];let exclusionsWarning=null;
    const match=known.find(x=>normalized(x.path)===normalized(scan.root));
    if (!DEMO_MODE && match?.folderId) {
      try {
        await auth.fetchUser();
        const info=await deviceService().getFolder(match.folderId);
        existingExclusions=Array.isArray(info.excluded_paths)?info.excluded_paths:[];
        latestFolderId=match.folderId;
      } catch(e) {exclusionsWarning='이전 제외 설정을 불러오지 못했습니다: '+e.message;}
    }
    return { path: scan.root, tree: scan.tree, truncated: scan.truncated, count: scan.count, excludedPaths:existingExclusions, exclusionsWarning };
  });
  ipcMain.handle('koko:workspace-connection', async (event) => {
    if (!checkWorkspaceSender(event)) throw new Error('허용되지 않은 요청입니다.');
    await bootPromise;
    return workspaceConnection({ demoMode: DEMO_MODE, session: auth, apiUrl });
  });
  ipcMain.handle('koko:workspace-overview', async (event) => {
    if (!checkWorkspaceSender(event)) throw new Error('허용되지 않은 요청입니다.');
    if (DEMO_MODE) return {demoMode:true,folders:[],documents:[],hasActualData:false};
    if (!auth?.user || !apiUrl) return {connected:false,folders:[],documents:[]};
    await auth.fetchUser();
    const service=deviceService();
    const folderResponse=await service.listFolders();
    const folders=getFolderRows(folderResponse);
    const folderId=latestFolderId || restoreLastFolderId();
    let documents=[], documentError=null;
    if (folderId) {
      try { documents=await service.listDocuments(folderId); }
      catch (err) { documentError=String(err.message||err).slice(0,150); }
    }
    return {connected:true,folders:folders.map(x=>({id:x.folder_id||x.id||'',name:x.folder_name||x.name||'연결한 폴더',status:x.status||''})), folderId:folderId||null,documents,documentError,hasActualData:true};
  });
  ipcMain.handle('koko:workspace-open-local', async (event, relative) => {
    if (!checkWorkspaceSender(event) || DEMO_MODE || !auth?.user) throw new Error('로그인이 필요합니다.');
    if (!selectedScan) throw new Error('먼저 폴더를 다시 선택해 주세요.');
    if (typeof relative !== 'string') throw new Error('파일 경로가 올바르지 않습니다.');
    const file=safeFilePath(selectedScan.root,relative);
    return {error:await shell.openPath(file.abs)};
  });
  ipcMain.handle('koko:workspace-download', async (event, input) => {
    if (!checkWorkspaceSender(event) || DEMO_MODE || !auth?.user || !apiUrl) throw new Error('로그인과 서버 연결이 필요합니다.');
    const documentId=input?.documentId;
    if (typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(documentId)) throw new Error('문서 ID가 올바르지 않습니다.');
    await auth.fetchUser();
    const service=deviceService();
    const response=await service.getDownloadUrl(documentId);
    const remote=safeDownloadUrl(response,apiUrl);
    const rawName=String(input?.fileName||'download').replace(/[\/\\:*?"<>|\x00-\x1f]/g,'_').slice(0,120);
    const file=await dialog.showSaveDialog(workspaceWindow,{title:'R2 원본 파일 저장',defaultPath:rawName});
    if (file.canceled || !file.filePath) return {cancelled:true};
    const pending=file.filePath+'.koko-part-'+crypto.randomBytes(6).toString('hex');
    try {
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),120000);
      try {
        const result=await fetch(remote,{method:'GET',redirect:'error',signal:controller.signal});
        if (!result.ok || !result.body) throw Error('원본 다운로드 실패 (HTTP '+result.status+')');
        const size=Number(result.headers.get('content-length')||0);
        if (size>100*1024*1024)throw Error('100MB를 초과한 파일을 받지 않습니다.');
        let bytes=0;
        const {Transform}=require('node:stream');
        const limit=new Transform({transform(chunk,_,cb){bytes+=chunk.length;cb(bytes>100*1024*1024?Error('다운로드 크기 제한 초과'):null,chunk)}});
        await pipeline(Readable.fromWeb(result.body),limit,fs.createWriteStream(pending,{flags:'wx'}));
      }finally{clearTimeout(timeout)}
      await fs.promises.rename(pending,file.filePath);
      return {saved:true,fileName:path.basename(file.filePath)};
    }catch(err){await fs.promises.unlink(pending).catch(()=>{});throw err;}
  });
  ipcMain.handle('koko:workspace-upload', async (event, payload) => {
    if (!checkWorkspaceSender(event)) throw new Error('허용되지 않은 요청입니다.');
    if (DEMO_MODE) throw new Error('개발용 시연 모드에서는 실제 업로드를 수행하지 않습니다.');
    if (isUploading) throw new Error('이미 업로드가 진행 중입니다.');
    if (!selectedScan || !payload || payload.path !== selectedScan.root) throw new Error('폴더 선택을 다시 확인해 주세요.');
    if (selectedScan.truncated) throw new Error('파일이 너무 많거나 깊어 전체 목록을 확인할 수 없습니다. 더 작은 폴더를 선택해 주세요.');
    if (!auth?.user || !apiUrl) throw new Error('실제 업로드는 백엔드 서버 설정과 소셜 로그인이 필요합니다.');
    const confirm = await dialog.showMessageBox(workspaceWindow, {
      type:'warning', buttons:['취소','이번에만 업로드','업로드 + 이 폴더 자동 동기화'], defaultId:0, cancelId:0,
      title:'원본 문서 클라우드 업로드 동의',
      message:'선택한 파일을 클라우드 저장소(R2)에 업로드합니다.',
      detail:'자동 동기화를 허용하면 이후 파일 추가·수정과 재시작 후 변경분도 서버로 전송합니다. 파일 삭제·이동은 서버 원본을 자동 삭제하지 않습니다. 동기화는 설정에서 언제든 중지할 수 있습니다.'
    });
    if (confirm.response === 0) return {cancelled:true};
    const autoSyncOptIn = confirm.response === 2;
    // Pause an existing watcher for the same folder during the foreground batch.
    // It is resumed below only if the user still opted into background uploads.
    const pausedSyncIds=autoSync?[...autoSync.records.values()].filter(r=>path.resolve(r.root)===path.resolve(selectedScan.root)).map(r=>r.folderId):[];
    for(const id of pausedSyncIds)autoSync.stopOne(id);
    isUploading=true;
    try {
      await auth.fetchUser(); // refresh access token when necessary
      const service=deviceService(state => { if (workspaceWindow && !workspaceWindow.isDestroyed()) workspaceWindow.webContents.send('koko:document-progress',state); });
      const deviceName=typeof payload.deviceName==='string'?payload.deviceName.trim():'';
      if(!deviceName || deviceName.length>64)throw Error('PC 이름을 1~64자로 입력해 주세요.');
      const result = await service.run({root:selectedScan.root, tree:selectedScan.tree,exclusions:Array.isArray(payload.exclusions)?payload.exclusions:[],deviceName});
      latestFolderId=result.folderId;
      knownLastFolderId=result.folderId;
      try { fs.writeFileSync(lastFolderFilename(),JSON.stringify({folderId:result.folderId}),{mode:0o600}); } catch { result.lastFolderWarning='마지막 폴더 정보를 저장하지 못했습니다.'; }
      let registry=[];try{registry=JSON.parse(fs.readFileSync(folderRegistryPath,'utf8'));if(!Array.isArray(registry))registry=[];}catch{}
      const account=String(auth.user.provider)+':'+String(auth.user.id);
      if(!registry.some(x=>x.account===account&&x.path===selectedScan.root&&x.apiOrigin===apiUrl))registry.push({account,path:selectedScan.root,apiOrigin:apiUrl,folderId:result.folderId});
      else registry=registry.map(x=>x.account===account&&x.path===selectedScan.root&&x.apiOrigin===apiUrl?{...x,folderId:result.folderId}:x);
      try { fs.writeFileSync(folderRegistryPath,JSON.stringify(registry),{mode:0o600}); } catch { result.registryWarning='폴더 목록을 로컬에 저장하지 못했습니다.'; }
      if (autoSyncOptIn) {
        try {
          const manager=await ensureAutoSync();
          if (!manager)throw Error('동기화 관리자를 시작할 수 없습니다.');
          await manager.enable({root:selectedScan.root,folderId:result.folderId,deviceId:result.deviceId,
            deviceName,exclusions:Array.isArray(payload.exclusions)?payload.exclusions:[],
            successful:result.successful||[],failed:result.uploadErrors||[]});
          result.autoSyncEnabled=true;
        } catch(error) {result.autoSyncWarning='파일은 전송됐지만 자동 동기화 설정 저장에 실패했습니다: '+String(error.message||error).slice(0,170);}
      } else {
        // Explicit one-time upload also disables any previously opted-in sync on this folder.
        const manager=await ensureAutoSync();
        if(manager?.records.has(result.folderId))await manager.disable(result.folderId);
        result.autoSyncEnabled=false;
      }
      return result;
    }finally{
      isUploading=false;
      for(const id of pausedSyncIds)if(autoSync?.records.has(id))autoSync.startOne(id);
    }
  });
  ipcMain.handle('koko:workspace-status', async (event) => {
    if (!checkWorkspaceSender(event)) throw new Error('허용되지 않은 요청입니다.');
    if (DEMO_MODE) return { documents: [], configured: false, demoMode: true };
    if (!(latestFolderId || restoreLastFolderId()) || !auth?.user || !apiUrl) return {documents:[],configured:false};
    await auth.fetchUser();
    const service=deviceService();
    const documents=await service.listDocuments(latestFolderId || restoreLastFolderId());
    return {documents,configured:true,folderId:latestFolderId || restoreLastFolderId()};
  });
  ipcMain.handle('koko:workspace-sync-status', async event => {
    if (!checkWorkspaceSender(event)) throw Error('허용되지 않은 요청입니다.');
    if(DEMO_MODE)return {demoMode:true,folders:[]};
    const manager=await ensureAutoSync();return {demoMode:false,folders:manager?.status()||[]};
  });
  ipcMain.handle('koko:workspace-sync-rescan', async (event, folderId) => {
    if (!checkWorkspaceSender(event)||DEMO_MODE||!auth?.user)throw Error('실제 로그인과 작업실이 필요합니다.');
    const manager=await ensureAutoSync();if(!manager?.records.has(folderId))throw Error('자동 동기화에 동의한 폴더를 선택해 주세요.');
    const result=await manager.rescan(folderId,{force:true});return {result,folders:manager.status()};
  });
  ipcMain.handle('koko:workspace-sync-stop', async (event, folderId) => {
    if (!checkWorkspaceSender(event)||DEMO_MODE||!auth?.user)throw Error('허용되지 않은 요청입니다.');
    const manager=await ensureAutoSync();if(!manager?.records.has(folderId))return {stopped:true};
    const confirm=await dialog.showMessageBox(workspaceWindow,{type:'question',buttons:['취소','자동 동기화 중지'],defaultId:0,cancelId:0,
      message:'이 폴더의 자동 업로드를 중지할까요?',detail:'로컬 파일 및 이미 업로드된 서버 원본은 삭제하지 않습니다.'});
    if(confirm.response!==1)return {cancelled:true};
    await manager.disable(folderId);return {stopped:true};
  });
  ipcMain.handle('koko:workspace-document-detail', async (event,documentId)=>{
    if(!checkWorkspaceSender(event)||DEMO_MODE||!auth?.user)throw Error('실제 로그인이 필요합니다.');
    await auth.fetchUser();return deviceService().getDocument(documentId);
  });
  ipcMain.handle('koko:workspace-retry-document', async (event, input)=>{
    if(!checkWorkspaceSender(event)||DEMO_MODE||!auth?.user)throw Error('실제 로그인이 필요합니다.');
    const documentId=input?.documentId,folderId=input?.folderId||latestFolderId||restoreLastFolderId();
    if(!/^[0-9a-f-]{36}$/i.test(String(documentId))||!/^[0-9a-f-]{36}$/i.test(String(folderId)))throw Error('문서 또는 폴더 ID 오류');
    await auth.fetchUser();
    const service=deviceService();
    const rows=await service.listDocuments(folderId);
    const row=rows.find(x=>(x.document_id||x.id)===documentId);
    if(!row)throw Error('해당 폴더의 문서를 찾지 못했습니다.');
    const status=statusFrom(row);
    if(!['upload_failed','processing_failed'].includes(status))throw Error('실패 상태의 문서만 다시 시도할 수 있습니다.');
    const detail=await service.getDocument(documentId);
    const latest=detail?.latest_version||detail?.current_version||detail?.versions?.[0]||{};
    if(status==='processing_failed'){
      const version=latest.version||row.latest_version?.version||detail.version||row.version;
      if(!Number.isInteger(Number(version))||Number(version)<1)throw Error('서버가 문서 버전 정보를 반환하지 않아 재분석을 시작할 수 없습니다.');
      return {mode:'reprocess',result:await service.retryProcessing(documentId,version)};
    }
    const relative=String(row.relative_path||'');
    let registry=[];try{registry=JSON.parse(fs.readFileSync(folderRegistryPath,'utf8'));}catch{}
    const account=String(auth.user.provider)+':'+String(auth.user.id);
    const found=registry.find(x=>x.account===account&&x.apiOrigin===apiUrl&&x.folderId===folderId);
    if(!found)throw Error('해당 폴더의 로컬 경로를 찾을 수 없습니다. 폴더를 다시 등록해 주세요.');
    const info=await service.getFolder(folderId);
    const exclusions=Array.isArray(info.excluded_paths)?info.excluded_paths:[];
    const {isExcluded,cleanRelative}=require('./lib/document-service');
    const clean=cleanRelative(relative);
    if(isExcluded(clean,exclusions))throw Error('제외된 파일은 업로드할 수 없습니다.');
    const file=safeFilePath(found.path,clean);
    if(!file.stat.isFile())throw Error('로컬 파일이 존재하지 않습니다.');
    const confirm=await dialog.showMessageBox(workspaceWindow,{type:'question',buttons:['취소','다시 업로드'],defaultId:0,cancelId:0,
      title:'실패한 문서 재전송',message:'이 파일을 R2에 다시 업로드할까요?',detail:'서버가 제공한 업로드 URL로 원본이 재전송됩니다.'});
    if(confirm.response!==1)return {cancelled:true};
    const deviceId=await service.ensureDevice();
    const result=await service.uploadOne({root:found.path,relative:clean,folderId,deviceId});
    if(result.status==='upload_failed')throw Error('서버가 여전히 업로드 실패 상태를 반환했습니다.');
    return {mode:'reupload',result};
  });
  ipcMain.handle('koko:get-state', async () => { await bootPromise; return publicState(); });
  ipcMain.handle('koko:open-auth', () => { if (DEMO_MODE) return false; createAuthWindow(); return true; });
  ipcMain.handle('koko:close-auth', (event) => { if (checkSender(event)) authWindow?.close(); return true; });
  ipcMain.handle('koko:minimize-auth', (event) => { if (checkSender(event)) authWindow?.minimize(); return true; });
  ipcMain.handle('koko:set-api-base', async (event, input) => {
    if (DEMO_MODE) throw new Error('시연 모드에서 서버 설정을 변경할 수 없습니다.');
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
    if (DEMO_MODE) throw new Error('시연 모드는 실제 로그인에 연결되지 않습니다.');
    if (!checkSender(event)) throw new Error('허용되지 않은 요청입니다.');
    if (!apiUrl) throw new Error('백엔드 API 서버 주소를 먼저 설정해 주세요.');
    if (auth.user) throw new Error('이미 로그인되어 있습니다.');
    interactiveLoginPending = true;
    try { await auth.start(provider); }
    catch (error) { interactiveLoginPending = false; throw error; }
    return publicState();
  });
  ipcMain.handle('koko:cancel-login', (event) => {
    if (!checkSender(event)) return false;
    interactiveLoginPending = false;
    auth.cancel(); return true;
  });
  ipcMain.handle('koko:logout', async (event) => {
    if (!checkSender(event)) throw new Error('허용되지 않은 요청입니다.');
    interactiveLoginPending = false;
    stopAutoSync();knownLastFolderId=null;latestFolderId=null;selectedScan=null;
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
    folderRegistryPath = path.join(userData, 'koko-folders.json');
    try { hasAuthenticatedBefore = JSON.parse(fs.readFileSync(historyFile, 'utf8')).hasAuthenticatedBefore === true; }
    catch { hasAuthenticatedBefore = false; }
    if (!DEMO_MODE) loadConfig();
    const store = new SecureTokenStore({ storage: safeStorage, file: path.join(userData, 'koko-refresh-token.bin') });
    const api = new ApiClient({ getBaseUrl: () => apiUrl });
    auth = new AuthService({ api, store, getBaseUrl: () => apiUrl,
      openBrowser: (url) => {
        const uri = new URL(url);
        if (!['https:', 'http:'].includes(uri.protocol) || !url.startsWith(apiUrl + '/auth/')) throw new Error('브라우저 URL을 검증할 수 없습니다.');
        return shell.openExternal(url);
      },
      onUpdate: (state) => {
        if (state.phase === 'authenticated') { recordSuccessfulAuthentication(); void ensureAutoSync().catch(error=>console.error('[KOKO] 동기화 시작 실패:', error?.message)); }
        if (!DEMO_MODE && !auth?.user) stopAutoSync();
        sendStatus(publicState());
        if (state.phase === 'authenticated' && petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.send('koko:pet-message', '로그인되었어요!');
        }
        if (shouldOpenAfterLogin({ phase: state.phase, interactive: interactiveLoginPending, session: auth })) {
          interactiveLoginPending = false;
          createWorkspaceWindow();
          if (authWindow && !authWindow.isDestroyed()) authWindow.close();
        } else if (['error', 'cancelled'].includes(state.phase)) {
          interactiveLoginPending = false;
        }
        // A revoked/expired session must not leave authenticated workspace data visible.
        if (!DEMO_MODE && !auth?.user && workspaceWindow && !workspaceWindow.isDestroyed()) workspaceWindow.close();
      }
    });
    // Demo must never restore tokens or initiate background requests to a configured server.
    bootPromise = DEMO_MODE ? Promise.resolve() : (apiUrl ? auth.restore() : (async () => { auth.emit('idle'); })());
    registerIpc();
    createPetWindow();
    createTray();
    await bootPromise;
  }).catch((error) => { console.error('[KOKO] 초기화 실패:', error?.message); });
  app.on('activate', () => { if (app.isReady()) createPetWindow().show(); });
  app.on('before-quit', () => { stopAutoSync(); auth?.cancel(true); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit(); });
}
