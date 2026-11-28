'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const {DocumentService,getFolderRows,safeDownloadUrl,statusFrom} = require('../lib/document-service');
const {validateBaseUrl} = require('../lib/oauth-utils');

const API = 'https://capstone.nsu-coco.online';
const FOLDER = '12345678-1234-1234-1234-123456789abc';
const DOCUMENT = '11111111-1111-1111-1111-111111111111';

test('팀 API 주소는 공개 HTTPS origin만 사용하며 SSH·DB credentials는 프론트에 필요 없음',()=>{
  assert.equal(validateBaseUrl(API),API);
  assert.throws(()=>validateBaseUrl('http://203.0.113.10:8000'),/HTTPS/);
  assert.throws(()=>validateBaseUrl('https://name:password@example.com'),/인증 정보/);
});

test('서버 폴더 목록과 복원 API를 Access Token으로 조회한다',async()=>{
 const calls=[];
 const fetchImpl=async (url,opt)=>{
   calls.push({url,opt});
   if(url.endsWith('/api/v1/folders'))return new Response(JSON.stringify({folders:[{folder_id:FOLDER,folder_name:'문서'}]}),{status:200});
   if(url.endsWith('/api/v1/folders/'+FOLDER))return new Response(JSON.stringify({excluded_paths:['기획/임시.md']}),{status:200});
   throw Error('unexpected endpoint: '+url);
 };
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'koko-integrated-'));
 try{
  const svc=new DocumentService({baseUrl:API,accessToken:'fake-test-token',userData:tmp,fetchImpl});
  const folders=getFolderRows(await svc.listFolders());
  assert.equal(folders[0].folder_name,'문서');
  assert.deepEqual((await svc.getFolder(FOLDER)).excluded_paths,['기획/임시.md']);
  assert(calls.every(x=>x.opt.headers.Authorization==='Bearer fake-test-token'));
  assert(calls.every(x=>x.opt.method==='GET'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});

test('다운로드 URL 발급 요청은 백엔드에만 Bearer를 전송하고 서명 URL은 HTTPS여야 한다',async()=>{
 const seen=[];const signed='https://test-r2.r2.cloudflarestorage.com/objects/document?signature=123';
 const svc=new DocumentService({baseUrl:API,accessToken:'fake-token',userData:os.tmpdir(),fetchImpl:async(url,opt)=>{
  seen.push({url,opt});return new Response(JSON.stringify({download_url:signed}),{status:200});
 }});
 const result=await svc.getDownloadUrl(DOCUMENT);
 assert.equal(safeDownloadUrl(result,API),signed);
 assert.equal(seen[0].url,API+'/api/v1/documents/'+DOCUMENT+'/download-url');
 assert.equal(seen[0].opt.method,'POST');
 assert.equal(seen[0].opt.headers.Authorization,'Bearer fake-token');
 assert.throws(()=>safeDownloadUrl({download_url:'http://example.org/file'},API),/HTTPS/);
 assert.throws(()=>safeDownloadUrl({download_url:'https://me:pass@example.org/file'},API),/올바르지/);
 await assert.rejects(()=>svc.getDownloadUrl('invalid'),/문서 ID/);
});

test('AI processing과 uploaded는 완료로 세지 않는다',()=>{
 assert.equal(statusFrom({latest_version:{status:'processing'}}),'processing');
 assert.notEqual(statusFrom({status:'uploaded'}),'ready');
 assert.equal(statusFrom({status:'ready'}),'ready');
});
