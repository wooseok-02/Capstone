'use strict';
// Opt-in per-folder, non-destructive local-to-R2 synchronization.
// Do not enable by inference from a previously registered folder.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {scanFolder, fileListFromTree, cleanRelative, safeFilePath} = require('./document-service');

const POLL_MS = 60000;
const DEBOUNCE_MS = 1600;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [0, 5000, 15000, 45000];
function retryable(error) {
  const code = Number(error?.status || 0);
  if (code) return code === 408 || code === 429 || code === 502 || code === 503 || code === 504 || code >= 500;
  const message = String(error?.message || error || '');
  return /fetch failed|timeout|timed out|abort|network|ECONNRESET|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket|스토리지 업로드 실패 \(HTTP 5\d\d\)/i.test(message);
}
function cleanExclusions(values) {
  if (!Array.isArray(values)) throw Error('제외 경로가 배열이 아닙니다.');
  return [...new Set(values.map(cleanRelative))];
}
function fileSignature(stat) {return `${stat.size}|${stat.mtimeMs}`;}
function scopeId(accountKey, origin) {
  return crypto.createHash('sha256').update(String(accountKey)+'|'+String(origin)).digest('hex').slice(0,24);
}
async function atomicWrite(file, content) {
  await fsp.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.tmp-'+crypto.randomBytes(4).toString('hex');
  try { await fsp.writeFile(temporary, JSON.stringify(content,null,2), {mode:0o600}); await fsp.rename(temporary,file); }
  finally { await fsp.rm(temporary,{force:true}).catch(()=>{}); }
}
function capture(root, exclusions, scanImpl=scanFolder) {
  const scan=scanImpl(root,{limit:5000,maxDepth:12});
  if (scan.truncated) throw Error('폴더가 너무 크거나 깊습니다. 자동 동기화를 중단했습니다.');
  const corrupted=(node)=>node.error || (node.children||[]).some(corrupted);
  if (corrupted(scan.tree)) throw Error('일부 파일을 읽을 수 없어 삭제 여부를 판단할 수 없습니다.');
  const files=new Map();
  for (const relative of fileListFromTree(scan.tree,exclusions)) {
    try {
      const file=safeFilePath(scan.root,relative);
      files.set(relative,fileSignature(file.stat));
    } catch (error) {
      // A vanishing file or inaccessible directory should not be treated as deletion.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return files;
}
class AutoSyncManager {
  constructor({userData, accountKey, apiOrigin, serviceFactory, onUpdate=()=>{}, scanImpl=scanFolder,
    pollMs=POLL_MS, debounceMs=DEBOUNCE_MS, watchImpl=fs.watch, now=()=>Date.now()}={}) {
    this.file=path.join(userData,'koko-sync-'+scopeId(accountKey,apiOrigin)+'.json');
    this.serviceFactory=serviceFactory;this.onUpdate=onUpdate;this.scanImpl=scanImpl;
    this.pollMs=pollMs;this.debounceMs=debounceMs;this.watchImpl=watchImpl;this.now=now;
    this.records=new Map();this.running=new Map();this.active=true;
  }
  async load() {
    let state={};try{state=JSON.parse(await fsp.readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('동기화 기록을 읽을 수 없습니다. 자동 업로드를 시작하지 않습니다.');}
    if(state.version && state.version!==1)throw Error('지원하지 않는 동기화 기록 버전입니다.');
    for(const record of state.folders||[]) {
      if(record?.enabled && typeof record.root==='string' && typeof record.folderId==='string' && typeof record.deviceId==='string') {
        const cleaned=cleanExclusions(record.exclusions||[]);
        this.records.set(record.folderId,{...record,exclusions:cleaned,manifest:record.manifest||{},missing:record.missing||[],errors:record.errors||{},lastError:record.lastError||''});
      }
    }
    return this.status();
  }
  async persist(){await atomicWrite(this.file,{version:1,folders:[...this.records.values()]});}
  status(){return [...this.records.values()].map(r=>({folderId:r.folderId,name:path.basename(r.root),enabled:!!r.enabled,watching:!!this.running.get(r.folderId)?.watcher, lastScan:r.lastScan||null,lastError:r.lastError||'',missing:r.missing||[],failed:Object.entries(r.errors||{}).map(([relative,error])=>({relative,error})),synced:Object.keys(r.manifest||{}).length,autoUploads:r.autoUploads||0}));}
  notify(){try{this.onUpdate(this.status());}catch{}}
  async enable({root,folderId,deviceId,deviceName,exclusions=[],successful=[],failed=[]}) {
    if(!this.active)throw Error('동기화 관리자가 종료되었습니다.');
    if(!/^[0-9a-f-]{36}$/i.test(folderId)||!/^[0-9a-f-]{36}$/i.test(deviceId))throw Error('폴더 또는 기기 ID가 올바르지 않습니다.');
    const clean=cleanExclusions(exclusions), previous=this.records.get(folderId);
    const current=capture(root,clean,this.scanImpl);
    const succeeded=new Set(successful.map(v=>typeof v==='string'?v:v.relative_path));
    const manifest={...(previous?.manifest||{})};
    for(const [rel,signature] of current) if(succeeded.has(rel)) manifest[rel]=signature;
    const errors={...(previous?.errors||{})};
    for(const rel of succeeded)delete errors[rel];
    for(const problem of failed)if(typeof problem.relative_path==='string')errors[problem.relative_path]=String(problem.error||'업로드 실패');
    const record={...previous,root:path.resolve(root),folderId,deviceId,deviceName:String(deviceName||'내 PC'),enabled:true,exclusions:clean,manifest,errors,missing:[],lastError:'',lastScan:this.now(),autoUploads:previous?.autoUploads||0};
    this.records.set(folderId,record);
    await this.persist();this.startOne(folderId);this.notify();return this.status();
  }
  async disable(folderId){this.stopOne(folderId);this.records.delete(folderId);await this.persist();this.notify();}
  async updateExclusions(folderId, exclusions){const r=this.records.get(folderId);if(!r)return false;r.exclusions=cleanExclusions(exclusions);await this.persist();this.schedule(folderId);return true;}
  start(){for(const id of this.records.keys())this.startOne(id);this.notify();}
  startOne(id){
    if(!this.active||this.running.has(id)||!this.records.has(id))return;
    const r=this.records.get(id), job={working:false,requested:false,attempts:{},closed:false,watcher:null,debounce:null,interval:null};
    this.running.set(id,job);
    try {job.watcher=this.watchImpl(r.root,{recursive:true},()=>this.schedule(id));job.watcher.on?.('error',()=>{job.watcher?.close();job.watcher=null;});}catch{/* polling fallback on platforms without recursive fs.watch */}
    if(this.pollMs>0){job.interval=setInterval(()=>this.schedule(id),this.pollMs);job.interval.unref?.();}
    this.schedule(id,0);
  }
  stopOne(id){const job=this.running.get(id);if(!job)return;job.closed=true;clearTimeout(job.debounce);clearInterval(job.interval);try{job.watcher?.close()}catch{}this.running.delete(id);}
  stop(){this.active=false;for(const id of [...this.running.keys()])this.stopOne(id);}
  schedule(id,delay=this.debounceMs){const job=this.running.get(id);if(!this.active||!job||job.closed)return;
    clearTimeout(job.debounce);job.debounce=setTimeout(()=>{void this.rescan(id).catch(()=>{});},delay);job.debounce.unref?.();}
  async rescan(id,{force=false}={}){
    const job=this.running.get(id),r=this.records.get(id);
    if(!job||job.closed||!r||!this.active)return {skipped:true};
    if(job.working){job.requested=true;return {queued:true};}
    job.working=true;
    try{
      const current=capture(r.root,r.exclusions,this.scanImpl);
      // Absence on local disk never triggers a destructive server delete.
      r.missing=Object.keys(r.manifest).filter(rel=>!current.has(rel)).slice(0,1000);
      let uploaded=0;
      const service=this.serviceFactory();
      for(const [rel,signature] of current){
        if(job.closed||!this.active)break;
        if(r.manifest[rel]===signature){delete r.errors[rel];continue;}
        if((job.attempts[rel]?.count||0)>=MAX_RETRIES&&!force)continue;
        try{
          const result=await service.uploadOne({root:r.root,relative:rel,folderId:r.folderId,deviceId:r.deviceId});
          // Capture again to avoid marking a mid-upload change as synced.
          const latest=safeFilePath(r.root,rel);
          if(fileSignature(latest.stat)!==signature)throw Error('업로드 중 파일이 변경되어 다시 확인합니다.');
          if(result.status==='upload_failed'||result.status==='processing_failed')throw Error('서버가 실패 상태를 반환했습니다.');
          r.manifest[rel]=signature;delete r.errors[rel];delete job.attempts[rel];uploaded++;r.autoUploads++;
        }catch(error){
          const message=String(error?.message||error).slice(0,180);
          r.errors[rel]=message;
          const count=(job.attempts[rel]?.count||0)+1;
          const transient=retryable(error)||/업로드 중 파일이 변경/.test(message);
          job.attempts[rel]={count:transient?count:MAX_RETRIES};
          if(transient&&count<MAX_RETRIES)this.schedule(id,RETRY_DELAYS[count]);
        }
        await this.persist();this.notify();
      }
      r.lastScan=this.now();r.lastError='';await this.persist();this.notify();return {uploaded,missing:r.missing.length,errors:Object.keys(r.errors).length};
    }catch(error){r.lastError=String(error?.message||error).slice(0,250);r.lastScan=this.now();await this.persist().catch(()=>{});this.notify();return {error:r.lastError};}
    finally{job.working=false;if(job.requested&&!job.closed){job.requested=false;this.schedule(id,200);}}
  }
  async retryLocal(id,rel){const job=this.running.get(id),r=this.records.get(id);if(!job||!r)throw Error('자동 동기화를 먼저 활성화하세요.');const pathValue=cleanRelative(rel);delete r.manifest[pathValue];delete job.attempts[pathValue];await this.persist();return this.rescan(id,{force:true});}
}
module.exports={AutoSyncManager,capture,retryable,cleanExclusions,fileSignature};
