'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {AutoSyncManager,capture,retryable}=require('../lib/auto-sync');
const {DocumentService}=require('../lib/document-service');
const FOLDER='12345678-1234-1234-1234-123456789abc', DEVICE='a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
const silentWatch=()=>({on(){},close(){}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function create(tmp,uploads,fail=null){
 return new AutoSyncManager({userData:tmp,accountKey:'google:user1',apiOrigin:'https://public-api.example',watchImpl:silentWatch,pollMs:0,debounceMs:60000,
  serviceFactory:()=>({uploadOne:async ({relative})=>{uploads.push(relative);if(fail)return fail(relative);return {status:'processing',document_id:DEVICE,version:1}}})});
}
test('동기화는 사용자 동의 전에는 저장/시작하지 않으며 명시적 활성화만 유지한다',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'koko-sync-opt-'));const calls=[];
 try{const manager=create(tmp,calls);await manager.load();manager.start();assert.deepEqual(manager.status(),[]);assert.deepEqual(calls,[]);manager.stop();}
 finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('자동 동기화는 신규·변경을 전송하고 삭제는 표시만 하며 클라우드 DELETE를 호출하지 않는다',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'koko-sync-'));const root=path.join(tmp,'records');fs.mkdirSync(root);
 const calls=[];fs.writeFileSync(path.join(root,'a.txt'),'first');fs.writeFileSync(path.join(root,'skip.txt'),'excluded');
 let manager;
 try{
  manager=create(tmp,calls);await manager.load();await manager.enable({root,folderId:FOLDER,deviceId:DEVICE,exclusions:['skip.txt'],successful:['a.txt']});
  await delay(30);assert.deepEqual(calls,[]);
  fs.writeFileSync(path.join(root,'new.txt'),'added');
  const first=await manager.rescan(FOLDER);assert.equal(first.uploaded,1);assert.deepEqual(calls,['new.txt']);
  fs.writeFileSync(path.join(root,'a.txt'),'a changed version');
  await manager.rescan(FOLDER);assert.deepEqual(calls,['new.txt','a.txt']);
  fs.unlinkSync(path.join(root,'a.txt'));
  const removed=await manager.rescan(FOLDER);assert.equal(removed.missing,1);assert.equal(manager.status()[0].missing[0],'a.txt');assert.equal(calls.length,2);
  manager.stop();
  manager=create(tmp,calls);await manager.load();assert.equal(manager.status().length,1);manager.start();await delay(30);
  assert.equal(manager.status()[0].missing.length,1);
  fs.renameSync(path.join(root,'new.txt'),path.join(root,'renamed.txt'));
  await manager.rescan(FOLDER);
  assert.equal(calls.at(-1),'renamed.txt');assert(manager.status()[0].missing.includes('new.txt'));
 }finally{manager?.stop();fs.rmSync(tmp,{recursive:true,force:true});}
});
test('일시적 API 오류는 기록 후 재시도, 영구적 422는 자동 반복하지 않음',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'koko-sync-errors-'));const root=path.join(tmp,'records');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'a.txt'),'first');
 const calls=[];let tries=0;let manager;
 try{
  manager=create(tmp,calls,async()=>{tries++;if(tries===1){const e=new Error('API busy');e.status=503;throw e;}return {status:'processing'};});
  await manager.load();await manager.enable({root,folderId:FOLDER,deviceId:DEVICE,successful:['a.txt']});await delay(30);
  fs.writeFileSync(path.join(root,'a.txt'),'first changed');
  await manager.rescan(FOLDER);assert.equal(manager.status()[0].failed.length,1);
  await manager.rescan(FOLDER);assert.equal(manager.status()[0].failed.length,0);assert.equal(tries,2);
  manager.stop();
  const bad=create(tmp,calls,async()=>{const e=new Error('검증 오류');e.status=422;throw e;});
  manager=bad;await manager.load();manager.start();await delay(30);fs.writeFileSync(path.join(root,'a.txt'),'third');
  await manager.rescan(FOLDER);await manager.rescan(FOLDER);assert.equal(calls.filter(x=>x==='a.txt').length,3);
  assert.equal(manager.status()[0].failed.length,1);
  assert.equal(retryable({status:422}),false);assert.equal(retryable({status:503}),true);
 }finally{manager?.stop();fs.rmSync(tmp,{recursive:true,force:true});}
});
test('서버 상세 조회 및 실패 분석 재시도는 기존 API를 사용하며 원본은 삭제하지 않는다',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'koko-detail-'));const calls=[];
 try{
  const service=new DocumentService({baseUrl:'https://public-api.example',accessToken:'dummy-token',userData:tmp,fetchImpl:async (url,options)=>{
    calls.push({url,options});return new Response(JSON.stringify(options.method==='GET'?{document_id:DEVICE,latest_version:{status:'processing_failed',version:2}}:{status:'processing',version:2}),{status:200});
  }});
  assert.equal((await service.getDocument(DEVICE)).latest_version.status,'processing_failed');
  assert.equal((await service.retryProcessing(DEVICE,2)).status,'processing');
  assert(calls.some(c=>c.url.endsWith('/upload-complete')&&JSON.parse(c.options.body).version===2));
  assert(calls.every(c=>c.options.method!=='DELETE'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
