'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {DocumentService,scanFolder,fileListFromTree,cleanRelative,isExcluded,statusFrom,getRows}=require('../lib/document-service');
const uuid='c7d778e4-a17b-4d07-a941-0975249f0a34';
test('폴더 트리, 상대 경로, 제외·복구 조건',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'koko-doc-'));try{fs.mkdirSync(path.join(base,'자료'));fs.writeFileSync(path.join(base,'자료','보고서.txt'),'KOKO');fs.writeFileSync(path.join(base,'안내.txt'),'hi');
  const {tree,truncated}=scanFolder(base);assert.equal(truncated,false);assert.equal(fileListFromTree(tree,[]).length,2);assert.deepEqual(fileListFromTree(tree,['자료']),['안내.txt']);assert.equal(isExcluded('자료/보고서.txt',['자료']),true);assert.equal(cleanRelative('자료/보고서.txt'),'자료/보고서.txt');assert.throws(()=>cleanRelative('../secret'));assert.throws(()=>cleanRelative('/etc/passwd'));}finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('기기 등록 → 폴더 등록 → 제외 저장 → 문서 등록 → R2 PUT → 완료 → 상태 조회',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'koko-flow-'));const store=fs.mkdtempSync(path.join(os.tmpdir(),'koko-store-'));const ops=[];
 try{fs.writeFileSync(path.join(dir,'note.txt'),'hello');fs.writeFileSync(path.join(dir,'skip.txt'),'ignore');
 const mock=async(url,opts={})=>{const u=new URL(url);ops.push({path:u.pathname,method:opts.method,headers:opts.headers});const reply=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json'}});
 if(u.pathname==='/api/v1/devices')return reply({device_id:uuid});
 if(u.pathname==='/api/v1/folders'&&opts.method==='POST')return reply({folder_id:uuid});
 if(u.pathname.endsWith('/exclusions')){assert.deepEqual(JSON.parse(opts.body).excluded_paths,['skip.txt']);return reply({folder_id:uuid,status:'saved'})}
 if(u.pathname==='/api/v1/documents'&&opts.method==='POST'){const data=JSON.parse(opts.body);assert.equal(data.relative_path,'note.txt');assert.equal(data.file_size,5);assert.match(data.sha256,/^[0-9a-f]{64}$/);return reply({document_id:uuid,version:1,upload_url:'http://127.0.0.1:9876/r2/demo',upload_headers:{'Content-Type':'text/plain'}})}
 if(u.pathname==='/r2/demo'&&opts.method==='PUT'){assert.equal(opts.headers['Content-Type'],'text/plain');assert.ok(!Object.keys(opts.headers).some(k=>k.toLowerCase()==='authorization'));const body=await new Response(opts.body).text();assert.equal(body,'hello');return new Response('',{status:200})}
 if(u.pathname.endsWith('/upload-complete'))return reply({document_id:uuid,version:1,status:'processing'});
 if(u.pathname.endsWith('/documents')&&opts.method==='GET')return reply({documents:[{relative_path:'note.txt',status:'ready'}]});
 throw new Error('unexpected: '+u.pathname);
 };
 const scan=scanFolder(dir);const job=new DocumentService({baseUrl:'http://127.0.0.1:9876',accessToken:'fake_for_test_only',fetchImpl:mock,userData:store});const result=await job.run({root:scan.root,tree:scan.tree,exclusions:['skip.txt']});assert.equal(result.sent,1);assert.equal(result.uploaded,1);assert.equal(result.ready,1);assert.equal(result.uploadErrors.length,0);assert.deepEqual(ops.map(x=>x.method),['POST','POST','PUT','POST','PUT','POST','GET']);
 assert.equal(await job.ensureDevice(),uuid);assert.equal(ops.filter(x=>x.path==='/api/v1/devices').length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(store,{recursive:true,force:true})}
});
test('상태 분류 및 응답 구조',()=>{assert.equal(statusFrom({latest_version:{status:'processing'}}),'processing');assert.equal(getRows({documents:[{status:'ready'}]}).length,1);assert.throws(()=>getRows({foo:1}))});
