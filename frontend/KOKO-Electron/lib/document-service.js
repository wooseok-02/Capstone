'use strict';
// KOKO document APIs — desktop/main-process only. Never expose tokens or signed URLs to renderer.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { finished } = require('node:stream/promises');
const { validateBaseUrl } = require('./oauth-utils');
const MAX_SIZE = 100 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules','.git','.next','dist','.venv','venv']);

function cleanRelative(input) {
  if (typeof input !== 'string' || !input || input.startsWith('/') || input.includes('\\') || input.includes('\0')) throw Error('잘못된 제외 경로입니다.');
  const parts = input.split('/');
  if (parts.some(p=>!p || p === '.' || p === '..' || /[<>:"|?*]/.test(p) || /[. ]$/.test(p))) throw Error('잘못된 제외 경로입니다.');
  return parts.join('/').normalize('NFC');
}
function isExcluded(relative, exclusions) { return exclusions.some(e => relative === e || relative.startsWith(e+'/')); }
function scanFolder(root, { limit = 5000, maxDepth = 12 } = {}) {
  const absolute = path.resolve(root); let count=0, truncated=false;
  function scan(dir, depth) {
    const node = { name:path.basename(dir), kind:'folder', children:[] };
    if (depth >= maxDepth) { truncated=true; return node; }
    let entries; try { entries=fs.readdirSync(dir,{withFileTypes:true}); }
    catch { node.error='읽기 권한이 없습니다'; return node; }
    entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name,'ko'));
    for(const entry of entries) {
      if(count>=limit) {truncated=true;break;}
      if(entry.isSymbolicLink() || entry.name.startsWith('.') || (entry.isDirectory() && SKIP_DIRS.has(entry.name)))continue;
      if(!entry.isDirectory() && !entry.isFile())continue;
      count++;
      if(entry.isDirectory())node.children.push(scan(path.join(dir,entry.name),depth+1));
      else node.children.push({name:entry.name,kind:'file'});
    }
    return node;
  }
  const tree=scan(absolute,0); return {root:absolute,tree,count,truncated};
}
function fileListFromTree(tree, exclusions) {
  const out=[];
  const walk=(node,parents=[])=>{
    const names=[...parents,node.name]; const relative=names.slice(1).join('/');
    if(relative && isExcluded(relative, exclusions))return;
    if(node.kind==='file')out.push(relative);
    for(const child of node.children||[])walk(child,names);
  }; walk(tree);return out;
}
function safeFilePath(root,relative) {
  const cleaned=cleanRelative(relative); const abs=path.resolve(root,...cleaned.split('/'));
  if(!abs.startsWith(path.resolve(root)+path.sep))throw Error('폴더 범위를 벗어난 파일입니다.');
  const stat=fs.lstatSync(abs); if(!stat.isFile()||stat.isSymbolicLink())throw Error('파일이 없거나 심볼릭 링크입니다.');
  // Ensure no ancestor was replaced with a symlink after scanning.
  let curr=path.resolve(root); for(const segment of cleaned.split('/').slice(0,-1)){curr=path.join(curr,segment);if(fs.lstatSync(curr).isSymbolicLink())throw Error('심볼릭 링크 경로는 업로드할 수 없습니다.');}
  return {abs,stat,relative:cleaned};
}
async function sha256File(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function statusFrom(item){return item.status || item.latest_version?.status || item.latest?.status || item.current_version?.status || ''}
function getFolderRows(data){if(Array.isArray(data))return data;for(const key of ['folders','items','results'])if(Array.isArray(data?.[key]))return data[key];throw Error('서버의 폴더 목록 응답 구조를 확인해야 합니다.');}
function safeDownloadUrl(data,baseUrl){const raw=typeof data==='string'?data:(data?.download_url||data?.url);if(typeof raw!=='string')throw Error('서버가 원본 다운로드 URL을 반환하지 않았습니다.');const url=new URL(raw);const api=new URL(validateBaseUrl(baseUrl));const local=['127.0.0.1','localhost'].includes(url.hostname)&&api.hostname===url.hostname&&api.protocol==='http:';if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw Error('HTTPS 다운로드 URL만 허용합니다.');if(url.username||url.password)throw Error('올바르지 않은 다운로드 URL입니다.');return url.toString();}
function getRows(data){if(Array.isArray(data))return data;for(const key of ['documents','items','results'])if(Array.isArray(data?.[key]))return data[key];throw Error('서버의 문서 목록 응답 구조를 확인해야 합니다.');}

class DocumentService {
  constructor({baseUrl,accessToken,getAccessToken=null,fetchImpl=globalThis.fetch,userData,accountKey='default',onProgress=()=>{}}) {
    this.baseUrl=validateBaseUrl(baseUrl);this.accessToken=accessToken;this.getAccessToken=getAccessToken;
    this.fetch=fetchImpl;this.userData=userData;this.onProgress=onProgress;
    this.devicePath=path.join(userData,'koko-device-'+crypto.createHash('sha256').update(String(accountKey)).digest('hex').slice(0,18)+'.json');
  }
  async json(method,suffix,data) {
    const url=this.baseUrl+suffix; const bearer=this.getAccessToken?await this.getAccessToken():this.accessToken; const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await this.fetch(url,{method,headers:{'Accept':'application/json','Authorization':'Bearer '+bearer,...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data!==undefined?JSON.stringify(data):undefined,signal:controller.signal,redirect:'error'});
      const content=response.status===204?null:await response.json().catch(()=>null);
      if(!response.ok){const detail=content?.detail;const message=typeof detail==='string'?detail:typeof detail?.message==='string'?detail.message:`서버 오류 HTTP ${response.status}`;const error=new Error(message);error.status=response.status;error.detail=detail;throw error;}
      return content;
    }finally{clearTimeout(timeout)}
  }
  async ensureDevice(deviceName='내 Windows PC') {
    try {const obj=JSON.parse(await fsp.readFile(this.devicePath,'utf8'));if(typeof obj.device_id==='string'&&obj.device_id)return obj.device_id;} catch{}
    const data=await this.json('POST','/api/v1/devices',{device_name:deviceName});
    if(typeof data?.device_id!=='string')throw Error('기기 ID 응답이 없습니다.');
    // atomic-ish: write a temporary file then rename, avoid losing ID in normal restarts
    const temp=this.devicePath+'.tmp';await fsp.writeFile(temp,JSON.stringify({device_id:data.device_id}),{mode:0o600});await fsp.rename(temp,this.devicePath);return data.device_id;
  }
  async registerFolder(root,deviceId){
    try {return await this.json('POST','/api/v1/folders',{device_id:deviceId,folder_name:path.basename(root),local_path:root});}
    catch(e){if(e.status===409&&typeof e.detail?.folder_id==='string')return{folder_id:e.detail.folder_id,duplicate:true};throw e;}
  }
  async setExclusions(folderId,excludedPaths){return this.json('PUT',`/api/v1/folders/${encodeURIComponent(folderId)}/exclusions`,{excluded_paths:excludedPaths});}
  async uploadOne({root,relative,folderId,deviceId}){
    const {abs,stat}=safeFilePath(root,relative);
    if(stat.size>MAX_SIZE)throw Error('100MB 초과 파일은 업로드할 수 없습니다.');
    const hash=await sha256File(abs);
    const reg=await this.json('POST','/api/v1/documents',{folder_id:folderId,device_id:deviceId,relative_path:relative,file_name:path.basename(abs),file_size:stat.size,sha256:hash,modified_at:stat.mtime.toISOString()});
    if(!reg?.document_id || !reg?.version)throw Error('문서 등록 응답에 ID 또는 version이 없습니다.');
    if(reg.upload_url===null)return{document_id:reg.document_id,version:reg.version,status:reg.status||'uploaded',skipped:true};
    if(typeof reg.upload_url!=='string')throw Error('업로드 URL이 없습니다.');
    const url=new URL(reg.upload_url);
    const base=new URL(this.baseUrl);
    const local=['127.0.0.1','localhost'].includes(url.hostname);
    const allowDev=base.protocol==='http:'&&local&&url.hostname===base.hostname;
    if(url.protocol!=='https:'&&!allowDev)throw Error('보안 연결(HTTPS) 업로드 URL만 허용합니다.');
    if(url.username||url.password)throw Error('올바르지 않은 업로드 URL입니다.');
    const headers=reg.upload_headers||{};
    if(Object.keys(headers).some(k=>k.toLowerCase()==='authorization'))throw Error('업로드 헤더에 인증 토큰이 포함되어 있습니다.');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),120000);
    try {
      const upload=await this.fetch(url.toString(),{method:'PUT',headers,body:Readable.toWeb(fs.createReadStream(abs)),duplex:'half',signal:controller.signal,redirect:'error'});
      if(!upload.ok)throw Error(`스토리지 업로드 실패 (HTTP ${upload.status})`);
    }finally{clearTimeout(timeout)}
    const complete=await this.json('POST',`/api/v1/documents/${encodeURIComponent(reg.document_id)}/upload-complete`,{version:reg.version});
    return{document_id:reg.document_id,version:reg.version,status:complete?.status||'uploaded',skipped:false};
  }
  async getDocument(documentId){
    if(!/^[0-9a-f-]{36}$/i.test(String(documentId)))throw Error('문서 ID 오류');
    return this.json('GET',`/api/v1/documents/${encodeURIComponent(documentId)}`);
  }
  async retryProcessing(documentId,version){
    if(!/^[0-9a-f-]{36}$/i.test(String(documentId)) || !Number.isInteger(Number(version)) || Number(version)<1)throw Error('문서 버전 또는 ID 오류');
    return this.json('POST',`/api/v1/documents/${encodeURIComponent(documentId)}/upload-complete`,{version:Number(version)});
  }
  async listFolders(){return this.json('GET','/api/v1/folders');}
  async getFolder(folderId){if(!/^[0-9a-f-]{36}$/i.test(String(folderId)))throw Error('folder_id 오류');return this.json('GET',`/api/v1/folders/${encodeURIComponent(folderId)}`);}
  async getDownloadUrl(documentId){if(!/^[0-9a-f-]{36}$/i.test(String(documentId)))throw Error('문서 ID 오류');return this.json('POST',`/api/v1/documents/${encodeURIComponent(documentId)}/download-url`);}
  async listDocuments(folderId){
    const all=[];let offset=0;
    for(let page=0;page<30;page++){
      const result=await this.json('GET',`/api/v1/folders/${encodeURIComponent(folderId)}/documents?limit=100&offset=${offset}`);
      const rows=getRows(result);all.push(...rows);if(rows.length<100)break;offset+=rows.length;
    }
    return all;
  }
  async run({root,tree,exclusions,deviceName}){
    const clean=[...new Set(exclusions.map(cleanRelative))];const selected=fileListFromTree(tree,clean);
    const errors=[];const successful=[];let sent=0;let uploaded=0;this.onProgress({stage:'device',sent,selected:selected.length,failed:0});
    const deviceId=await this.ensureDevice(deviceName);
    const folder=await this.registerFolder(root,deviceId);const folderId=folder.folder_id;
    if(!folderId)throw Error('folder_id가 없습니다.');
    await this.setExclusions(folderId,clean);
    for(const relative of selected){
      this.onProgress({stage:'uploading',relative,sent,selected:selected.length,failed:errors.length});
      try{const result=await this.uploadOne({root,relative,folderId,deviceId});if(!result.skipped)uploaded++;successful.push({relative_path:relative,document_id:result.document_id,version:result.version,status:result.status});}
      catch(e){errors.push({relative_path:relative,error:String(e.message||e).slice(0,200)})}
      sent++;this.onProgress({stage:'uploading',relative,sent,selected:selected.length,failed:errors.length});
    }
    let documents=[];let statusError=null;
    try{documents=await this.listDocuments(folderId)}catch(e){statusError=e.message}
    const ready=documents.filter(x=>statusFrom(x)==='ready').length;
    const failed=documents.filter(x=>['upload_failed','processing_failed'].includes(statusFrom(x))).length;
    const pending=documents.filter(x=>['upload_pending','uploaded','processing'].includes(statusFrom(x))).length;
    return {folderId,deviceId,selected:selected.length,excluded:exclusions.length,sent,uploaded,successful,uploadErrors:errors,documents,ready,failed,pending,statusError};
  }
}
module.exports={DocumentService,scanFolder,fileListFromTree,cleanRelative,isExcluded,safeFilePath,statusFrom,getRows,getFolderRows,safeDownloadUrl};
