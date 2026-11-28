'use strict';
// UI preview and guarded Electron integration. Demo values are never advertised as real server output.
const $=id=>document.getElementById(id);
const bridge=window.koko||null;
const sampleTree={name:'캡스톤 프로젝트',kind:'folder',children:[
{name:'기획',kind:'folder',children:['MVP 기획안.md','요구사항 정의서.md','기획 초안(구버전).md','기획 범위 정리.txt','프로젝트 일정.txt','기능 명세.md','요구사항 목록.csv','작업 우선순위.md'].map(name=>({name,kind:'file'}))},
{name:'회의록',kind:'folder',children:['3차 기획 회의록.md','전체 회의록(임시).md','디자인 회의록.md','1차 킥오프.md','2차 회의록.md','회의록 요약.txt','이슈 정리.md','회의 내용.txt'].map(name=>({name,kind:'file'}))},
{name:'리서치',kind:'folder',children:['사용자 설문 결과.txt','시장 리서치 자료.pdf','경쟁 서비스 분석(초안).pdf','레퍼런스 모음.md','페르소나 모음.md','경쟁사 비교.md','설문 문항.csv','인사이트 정리.txt'].map(name=>({name,kind:'file'}))},
{name:'임시자료',kind:'folder',children:['개발 참고자료.zip','테스트 데이터(일회성).csv','API_SPEC.csv','기능 검증.txt','컴포넌트 목록.md','릴리즈 체크.txt','개발 가이드.md','README.md'].map(name=>({name,kind:'file'}))}
]};
const seedNotices=[
{id:'n1',category:'related',title:'회의록과 요구사항 정의서가 연결되었어요',desc:'회의에서 논의한 내용이 요구사항 정의서에 반영된 것으로 보여요.',time:'오늘 14:58',file:'요구사항 정의서.md',folder:'캡스톤 프로젝트 / 기획',reasons:['3차 기획 회의록의 논의 결과와 핵심 기능 요구사항이 일치해요.','회의에서 확정한 기능 범위와 우선순위가 요구사항에 구체화되어 있어요.'],evidence:[['3차 기획 회의록.md','핵심 기능은 ① 기록 연결 추천, ② 알림 요약, ③ 중복 억제로 확정한다.'],['요구사항 정의서.md','[핵심 기능] 기록 연결 추천, 알림 요약, 중복 억제 기능을 필수로 제공한다.']]},
{id:'n2',category:'related',title:'사용자 설문 결과에 핵심 인사이트가 있어요',desc:'직접 확인하고 싶은 사용자 경험과 관련된 근거예요.',time:'오늘 13:21',file:'사용자 설문 결과.txt',folder:'캡스톤 프로젝트 / 리서치',reasons:['사용자가 알림을 직접 확인하고 싶다는 응답을 발견했어요.'],evidence:[['사용자 설문 결과.txt','작업을 방해하지 않고 직접 확인하게 하려는 설계의 근거예요.']]},
{id:'n3',category:'related',title:'요구사항에서 중복 항목이 감지되었어요',desc:'중복 억제와 관련된 요구사항을 확인해 주세요.',time:'오늘 11:07',file:'요구사항 정의서.md',folder:'캡스톤 프로젝트 / 기획',reasons:['알림의 중복 방지 관련 문구가 두 군데에서 반복돼요.'],evidence:[['요구사항 정의서.md','알림 중복 방지를 위한 조건을 확인한다.']]},
{id:'n4',category:'system',title:'기록이 나중에 보관함에 저장됐어요',desc:'사용자 설문 결과.txt가 나중에 보관함에 저장됐어요.',time:'어제 17:26',file:'사용자 설문 결과.txt',folder:'캡스톤 프로젝트 / 리서치'},
{id:'n5',category:'system',title:'파일이 새로 감지되었어요',desc:'연결된 폴더에서 새로운 파일을 발견했어요.',time:'어제 11:03',file:'3차 기획 회의록.md',folder:'캡스톤 프로젝트 / 회의록'},
{id:'n6',category:'related',title:'관련 기록 연결이 업데이트되었어요',desc:'3차 기획 회의록과 관련된 기록이 추가됐어요.',time:'11월 24일 15:20',file:'3차 기획 회의록.md',folder:'캡스톤 프로젝트 / 회의록'},
{id:'n7',category:'system',title:'알림 설정이 변경되었어요',desc:'새로운 기록 발견 알림을 켰어요.',time:'11월 24일 09:17',file:'',folder:'설정'},
{id:'n8',category:'system',title:'기록 요약이 완료되었어요',desc:'MVP 기획안.md의 핵심 내용을 정리했어요.',time:'11월 23일 18:05',file:'MVP 기획안.md',folder:'캡스톤 프로젝트 / 기획'}
];
let page='home',root=structuredClone(sampleTree),folderPath='',sampleMode=true,truncated=false;
let desktopDemoMode=false;
let backendDataLoaded=false;
let backendDocs=[];
let backendFolderNames=[];
let overviewBusy=false;
let lastSeenFolderId=null;
let syncStates=[];
let syncRefreshing=false;
async function isDevDemo(){if(!bridge?.getAppMode)return false;try{return !!(await bridge.getAppMode()).demoMode}catch{return false}}
async function initAppMode(){desktopDemoMode=await isDevDemo();if(!desktopDemoMode&&bridge?.workspaceOverview){$('top-mode').textContent='실제 서버 모드 · 연결 확인 중';$('home-folders').textContent='—';$('home-label').textContent='서버 조회 전';$('home-ready').textContent='—';$('home-pending').textContent='—';$('home-failed').textContent='—';$('home-analysis').textContent='실제 API 응답을 확인 중입니다.';$('home-pct').textContent='—';$('recent-list').textContent='서버 문서 확인 중';$('sidebar-mode').textContent='실제 모드 · 서버 상태 확인 중';document.querySelector('#page-home .progress-circle').style.setProperty('--pct','0%');document.querySelector('.discovered .connection-card').textContent='실제 AI 추천 API 연동 대기 중입니다.';document.querySelector('#page-related .related-big').textContent='서버 추천 데이터 연동 대기 중입니다.';document.querySelector('.metric>p').textContent='서버 폴더 조회 대기 중';notices=[];renderNotices();}if(desktopDemoMode){$('dev-demo-banner').hidden=false;$('top-mode').textContent='개발용 시연 · 백엔드 연결 안 됨';$('sidebar-mode').textContent='개발용 UI 시연 · 실제 업로드 없음';$('progress-subtitle').textContent='실제 업로드나 AI 분석을 수행하지 않는 시뮬레이션입니다.';$('auth-open').textContent='실제 로그인은 npm start로 실행';$('auth-open').disabled=true;$('refresh-status').textContent='시연 결과 새로고침 불가';$('refresh-status').disabled=true;$('home-folders').textContent='2개 (예시)';$('home-label').textContent='샘플 분석 상태';$('home-analysis').textContent='샘플 수치 · 실제 AI 분석 없음';document.querySelector('.hero h2').textContent='기록 검색과 연결 추천 화면을 시연해 보세요.';document.querySelector('.metric>p').textContent='샘플 폴더 · 실제 감지 없음';document.querySelector('.progress-metrics>div:nth-child(2)>small').textContent='시연 처리';document.querySelector('.progress-metrics>div:nth-child(3)>small').textContent='애니메이션 진행';}}
let excluded=new Set(['기획/기획 초안(구버전).md','회의록/전체 회의록(임시).md','리서치/경쟁 서비스 분석(초안).pdf','임시자료/테스트 데이터(일회성).csv']);
let expanded=new Set(['','기획','회의록','리서치','임시자료']);
let notices=seedNotices.map((n,i)=>({...n,read:i>=3}));let noticeFilter='all',chosenNotice='n1',resultFilter='all',resultOpen=true;
let progressTimer=null,liveProgress=null,latestReal=null,realRows=[],demoDone=false,focus=false,toastTimer;
let statusTimer=null,statusCalls=0,statusRequestRunning=false;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusName=s=>({ready:'AI 분석 완료',uploaded:'업로드 완료 · 분석 대기',upload_pending:'업로드 대기',processing:'AI 분석 중',upload_failed:'업로드 실패',processing_failed:'분석 실패',demo_only:'시연 목록 · 업로드/분석 안 됨',excluded:'제외됨'}[s]||'상태 확인 중');
const isFailed=s=>['upload_failed','processing_failed'].includes(s);
const isPending=s=>['uploaded','upload_pending','processing'].includes(s);
function toast(s){const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3500)}
function saveDemo(){try{localStorage.setItem('koko-v3-ui',JSON.stringify({read:notices.filter(n=>n.read).map(n=>n.id),focus}));}catch{}}
function loadDemo(){try{const saved=JSON.parse(localStorage.getItem('koko-v3-ui'));if(Array.isArray(saved?.read))notices.forEach(n=>n.read=saved.read.includes(n.id));focus=!!saved?.focus;}catch{}}
function go(name){if(!$("page-"+name))return;page=name;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id==='page-'+name));document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===name));const label={home:'작업실',folders:'파일 감지',progress:'문서 업로드',result:'저장 결과',history:'알림 내역',detail:'알림 상세',related:'관련 기록',search:'기록 검색',settings:'설정'}; $('breadcrumb').textContent='나의 기록 공간   ›   '+label[name]; $('main').scrollTop=0;
 if(name==='folders')renderTree();if(name==='result')renderResults();if(name==='history'||name==='detail')renderNotices();if(name==='search')renderSearch();if(name==='settings'){refreshConnection();void refreshSyncStatus();}}
function entries(){const all=[];function rec(node,rel='',depth=0){all.push({node,rel,depth});for(const child of node.children||[])rec(child,rel?rel+'/'+child.name:child.name,depth+1)}rec(root);return all}
function isOff(rel){return Array.from(excluded).some(p=>rel===p||rel.startsWith(p+'/'))}
function totals(){const files=entries().filter(e=>e.node.kind==='file');return{included:files.filter(e=>!isOff(e.rel)).length,excluded:files.filter(e=>isOff(e.rel)).length,total:files.length}}
function setFolderCounts(){const c=totals();$('included-count').textContent=c.included;$('excluded-count').textContent=c.excluded;$('summary-total').textContent=c.included+'개 파일';$('summary-excluded').textContent=c.excluded+'개 파일';}
function toggleExclusion(rel){if(!rel)return;if(isOff(rel)){
  for(const e of [...excluded])if(e===rel||rel.startsWith(e+'/')||e.startsWith(rel+'/'))excluded.delete(e);
}else{for(const e of [...excluded])if(e.startsWith(rel+'/'))excluded.delete(e);excluded.add(rel);}renderTree();}
function renderTree(){const only=$('only-excluded').checked;const el=$('file-tree');el.replaceChildren();for(const {node,rel,depth} of entries()){
  if(depth&&(!expanded.has(rel.split('/').slice(0,-1).join('/'))))continue;
  const off=isOff(rel);if(only&&!off)continue;
  const row=document.createElement('div');row.className='tree-row'+(off?' excluded':'');row.style.setProperty('--indent',depth);row.title=rel||node.name;
  const ex=document.createElement('button');ex.className='expand-btn';ex.textContent=node.kind==='folder'?(expanded.has(rel)?'⌄':'›'):' ';ex.disabled=node.kind!=='folder';ex.setAttribute('aria-label','폴더 펼치기/접기');ex.onclick=()=>{expanded.has(rel)?expanded.delete(rel):expanded.add(rel);renderTree()};
  const icon=document.createElement('span');icon.className='file-dot';icon.textContent=node.kind==='folder'?'▱':'▤';
  const name=document.createElement('span');name.className='row-name';name.textContent=node.name;
  row.append(ex,icon,name);if(depth){const btn=document.createElement('button');btn.className='tree-action'+(off?'':' remove');btn.textContent=off?'↶ 복구':'× 제외';btn.onclick=()=>toggleExclusion(rel);row.append(btn);}el.append(row);
}setFolderCounts();}
function sampleResults(){const files=entries().filter(e=>e.node.kind==='file');let idx=0;return files.map(e=>({relative_path:e.rel,status:isOff(e.rel)?'excluded':(!sampleMode&&desktopDemoMode?'demo_only':(idx++<18?'ready':idx<=26?'processing':'processing_failed'))}))}
function currentResults(){return latestReal?realRows:backendDataLoaded?backendDocs:sampleResults()}
function summarizeRows(rows){return{ready:rows.filter(r=>r.status==='ready').length,pending:rows.filter(r=>isPending(r.status)).length,failed:rows.filter(r=>isFailed(r.status)).length,excluded:rows.filter(r=>r.status==='excluded').length,total:rows.length}}
function fromServerRows(rows){return rows.map(r=>({document_id:r.document_id||r.id||null,relative_path:r.relative_path||r.file_name||r.name||'(파일명 없음)',status:r.status||r.latest_version?.status||r.current_version?.status||'',error:r.error_code||r.latest_version?.error_code||'',modified_at:r.modified_at||r.updated_at||r.created_at||''}))}
function renderResults(){const rows=currentResults();const c=summarizeRows(rows);$('result-ready').textContent=c.ready+'개';$('result-processing').textContent=c.pending+'개';$('result-failed').textContent=c.failed+'개';$('result-title').textContent=(latestReal||backendDataLoaded)?'서버 문서의 처리 결과를 확인하세요':desktopDemoMode&&!sampleMode?'폴더 내 파일 목록 확인 완료 (전송 없음)':'저장 처리 결과를 확인하세요 (시연)';$('result-subtitle').textContent=(latestReal||backendDataLoaded)?'업로드 완료 후에도 서버 AI 분석은 계속 진행될 수 있습니다.':desktopDemoMode&&!sampleMode?'실제 파일 이름만 확인했습니다. 서버 전송과 AI 분석은 일어나지 않았습니다.':'예시 데이터입니다. 실제 업로드나 AI 분석을 수행하지 않았습니다.';
  document.querySelectorAll('[data-result-filter]').forEach(b=>b.classList.toggle('active',b.dataset.resultFilter===resultFilter));const list=$('result-list');list.replaceChildren();const view=rows.filter(r=>resultFilter==='all'||resultFilter==='ready'&&r.status==='ready'||resultFilter==='pending'&&isPending(r.status)||resultFilter==='failed'&&isFailed(r.status)||resultFilter==='excluded'&&r.status==='excluded');if(!view.length){list.innerHTML='<p style="padding:20px;color:#8294a7">해당 조건의 문서가 없어요.</p>';return;}
for(const r of view){const row=document.createElement('div');row.className='result-row';const icon=document.createElement('span');icon.textContent=r.status==='ready'?'✓':isFailed(r.status)?'!':r.status==='excluded'?'×':r.status==='demo_only'?'○':'◷';icon.style.color=isFailed(r.status)?'#C65B63':'#337CB3';const name=document.createElement('span');name.textContent=r.relative_path;const label=document.createElement('small');label.textContent=statusName(r.status)+(r.error?' · '+r.error:'');if(isFailed(r.status))label.classList.add('bad');row.append(icon,name,label);
 if((latestReal||backendDataLoaded)&&r.document_id&&r.status==='ready'&&bridge?.downloadDocument){
   const actions=document.createElement('span');actions.className='doc-actions';
   if(!sampleMode&&folderPath&&bridge?.openLocalDocument){const open=document.createElement('button');open.textContent='내 PC에서 열기';open.onclick=async()=>{try{const result=await bridge.openLocalDocument(r.relative_path);if(result?.error)toast('파일 열기 실패: '+result.error)}catch(e){toast('파일 열기 실패: '+(e.message||e))}};actions.append(open)}
   const download=document.createElement('button');download.textContent='원본 내려받기';download.onclick=async()=>{try{const result=await bridge.downloadDocument({documentId:r.document_id,fileName:r.relative_path.split('/').pop()});if(result?.saved)toast('다운로드 완료: '+result.fileName)}catch(e){toast('다운로드 실패: '+(e.message||e))}};actions.append(download);row.append(actions);
 }
 if((latestReal||backendDataLoaded)&&r.document_id&&bridge?.documentDetail){
   let actions=row.querySelector('.doc-actions');if(!actions){actions=document.createElement('span');actions.className='doc-actions';row.append(actions)}
   const inspect=document.createElement('button');inspect.textContent='상세 상태';inspect.onclick=()=>showDocumentDetail(r);actions.append(inspect);
   if(isFailed(r.status)&&bridge?.retryDocument){const retry=document.createElement('button');retry.textContent='재시도';retry.onclick=()=>retryServerDocument(r);actions.append(retry)}
 }
 list.append(row);}}
async function showDocumentDetail(row){
 const box=$('document-detail-body'),dialog=$('document-details');box.textContent='서버에서 상태를 확인하고 있습니다…';dialog.showModal();
 try{
   const info=await bridge.documentDetail(row.document_id);
   const detail=info?.latest_version||info?.current_version||info?.versions?.[0]||{};
   const state=detail.status||info.status||row.status;
   const version=detail.version||info.version||row.version||'—';
   box.textContent=`파일: ${row.relative_path}\n문서 ID: ${row.document_id}\n상태: ${statusName(state)} (${state||'정보 없음'})\n버전: ${version}\n오류 코드: ${detail.error_code||info.error_code||row.error||'없음'}\n\nAI 분석 완료는 서버가 ready 상태를 반환한 경우에만 표시됩니다.`;
 }catch(e){box.textContent='상세 상태 조회 실패: '+(e.message||e)}
}
async function retryServerDocument(row){
 const folderId=latestReal?.folderId||lastSeenFolderId;
 if(!folderId){toast('먼저 폴더를 다시 선택한 후 상태를 새로고침해 주세요.');return;}
 try{const result=await bridge.retryDocument({folderId,documentId:row.document_id});
  if(result?.cancelled)return;
  toast(result?.mode==='reprocess'?'AI 재분석 요청을 보냈습니다.':'파일 재업로드 요청이 완료됐습니다.');
  await refreshStatus();
 }catch(e){toast('재시도 실패: '+(e.message||e));}
}
function renderSyncStatus(){
 const panel=$('auto-sync-status');if(!panel)return;panel.replaceChildren();
 if(desktopDemoMode){panel.textContent='개발용 시연: 자동 감지와 실제 서버 업로드를 실행하지 않습니다.';return;}
 if(!syncStates.length){panel.textContent='자동 동기화 중인 폴더가 없습니다. 파일 감지 → 저장 시작 → "업로드 + 이 폴더 자동 동기화"를 선택하면 활성화됩니다.';return;}
 for(const item of syncStates){
  const card=document.createElement('div');card.className='sync-folder';
  const heading=document.createElement('strong');heading.textContent='▱ '+item.name+' · '+(item.watching?'실시간 감시 + 주기 확인':'주기 확인');card.append(heading);
  const meta=document.createElement('small');meta.textContent=`동기화 기록 ${item.synced}개 · 자동 업로드 ${item.autoUploads}개 · 마지막 검사 ${item.lastScan?new Date(item.lastScan).toLocaleString('ko-KR'):'시작 전'}`;card.append(meta);
  if(item.lastError){const e=document.createElement('small');e.className='sync-warning';e.textContent='검사 실패: '+item.lastError;card.append(e)}
  if(item.failed?.length){const e=document.createElement('small');e.className='sync-warning';e.textContent='실패 '+item.failed.length+'개: '+item.failed.slice(0,2).map(x=>x.relative).join(', ')+' · 다시 검사 버튼으로 재시도 가능';card.append(e)}
  if(item.missing?.length){const m=document.createElement('small');m.className='sync-missing';m.textContent=`로컬에서 사라진 파일 ${item.missing.length}개 — 클라우드 원본은 삭제하지 않았습니다. 예: ${item.missing.slice(0,2).join(', ')}`;card.append(m)}
  const actions=document.createElement('div');actions.className='sync-actions';
  const rescan=document.createElement('button');rescan.textContent='변경 사항 다시 검사';rescan.onclick=async()=>{rescan.disabled=true;try{await bridge.syncRescan(item.folderId);toast('변경 파일 확인 요청을 처리했습니다.');await refreshSyncStatus()}catch(e){toast('재탐색 실패: '+(e.message||e))}finally{rescan.disabled=false}};
  const stop=document.createElement('button');stop.textContent='자동 동기화 중지';stop.onclick=async()=>{try{const result=await bridge.syncStop(item.folderId);if(result?.stopped){toast('자동 동기화를 중지했습니다. 서버 원본은 유지됩니다.');await refreshSyncStatus()}}catch(e){toast('동기화 중지 실패: '+(e.message||e))}};
  actions.append(rescan,stop);card.append(actions);panel.append(card);
 }
}
async function refreshSyncStatus(){
 if(!bridge?.syncStatus||syncRefreshing)return;
 syncRefreshing=true;try{const response=await bridge.syncStatus();syncStates=response.folders||[];renderSyncStatus();}
 catch(e){$('auto-sync-status').textContent='자동 동기화 상태 조회 실패: '+(e.message||e)}finally{syncRefreshing=false;}
}
function openNotice(id){chosenNotice=id;const n=notices.find(n=>n.id===id);if(n){n.read=true;saveDemo()}renderNotices();go('detail')}
function renderNotices(){const unread=notices.filter(n=>!n.read).length;$('notice-unread').textContent=unread+'개';$('home-unread').textContent=unread;document.querySelectorAll('.unread-badge').forEach(n=>{n.textContent=unread;n.hidden=!unread});$('all-count').textContent=notices.length;
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===noticeFilter));const list=$('notice-list');list.replaceChildren();
  for(const n of notices.filter(n=>noticeFilter==='all'||noticeFilter==='unread'&&!n.read||noticeFilter==='related'&&n.category==='related'||noticeFilter==='system'&&n.category==='system')){
    const row=document.createElement('div');row.className='notice-row';const ico=document.createElement('div');ico.className='notice-icon';const bellImg=document.createElement('img');bellImg.className='koko-bell bell-list';bellImg.src='../assets/koko-notification-bell.png';bellImg.alt='';bellImg.setAttribute('aria-hidden','true');ico.append(bellImg);const body=document.createElement('div');body.className='notice-text';const title=document.createElement('strong');title.textContent=n.title;const descr=document.createElement('small');descr.textContent=n.desc;body.append(title,descr);const tm=document.createElement('span');tm.className='notice-time';tm.textContent=n.time;row.append(ico,body,tm);if(!n.read){const dot=document.createElement('span');dot.className='notice-new';row.append(dot)}const btn=document.createElement('button');btn.className='outline';btn.textContent='상세 보기 →';btn.onclick=()=>openNotice(n.id);row.append(btn);row.onclick=e=>{if(e.target!==btn)openNotice(n.id)};list.append(row);
  }
  const mini=$('detail-list');mini.replaceChildren();for(const n of notices){const b=document.createElement('button');b.className='mini-notice'+(n.id===chosenNotice?' selected':'');b.innerHTML='<b>'+escapeHtml(n.title)+'</b><span>'+escapeHtml(n.desc)+'</span>';b.onclick=()=>openNotice(n.id);mini.append(b)}
  const n=notices.find(n=>n.id===chosenNotice)||notices[0];if(!n){$('detail-heading').textContent='알림 API 연결 대기';$('detail-desc').textContent='팀 백엔드의 최신 알림 명세가 필요합니다.';$('detail-date').textContent='—';$('detail-baseline').textContent='—';$('detail-path').textContent='—';$('detail-count').textContent=0;$('detail-reasons').textContent='실제 알림은 아직 로드하지 않았습니다.';$('detail-evidence').textContent='서버 추천 근거 없음';return;}$('detail-heading').textContent=n.title;$('detail-desc').textContent=n.desc;$('detail-date').textContent=n.time;$('detail-baseline').textContent=n.file||'없음';$('detail-path').textContent=n.folder;$('detail-count').textContent=notices.length;$('detail-reasons').replaceChildren();for(const s of n.reasons||['이 알림은 파일 저장이나 변경 상태를 안내하는 예시예요.']){const p=document.createElement('p');p.textContent='• '+s;$('detail-reasons').append(p)}$('detail-evidence').replaceChildren();for(const [file,quote] of n.evidence||[]){const d=document.createElement('div');const title=document.createElement('b');title.textContent=file;const t=document.createElement('span');t.textContent='“'+quote+'”';d.append(title,t);$('detail-evidence').append(d)}if(!n.evidence)$('detail-evidence').textContent='현재 이 알림에는 인용 구절이 없습니다.';}
function renderSearch(){const term=$('search-input').value.trim().toLowerCase();const panel=$('search-results');panel.replaceChildren();const source=backendDataLoaded?backendDocs.map(r=>({node:{name:r.relative_path.split('/').pop()},rel:r.relative_path})):entries().filter(e=>e.node.kind==='file');for(const row of source.filter(e=>!term||e.node.name.toLowerCase().includes(term)).slice(0,30)) {const item=document.createElement('div');item.className='recent-row';item.innerHTML='<span class="file-icon">FILE</span><div class="filename">'+escapeHtml(row.node.name)+'<small>'+escapeHtml(row.rel)+'</small></div>';panel.append(item)}if(!panel.children.length)panel.textContent=backendDataLoaded?'서버에 일치하는 파일명이 없습니다.':'일치하는 샘플 문서가 없어요.';}
function renderRecent(){if(backendDataLoaded){const el=$('recent-list');el.replaceChildren();const rows=[...backendDocs].slice(0,4);if(!rows.length){el.textContent='최근 등록된 서버 문서가 없습니다. 먼저 폴더를 등록해 주세요.';return;}for(const r of rows){const div=document.createElement('div');div.className='recent-row';const icon=document.createElement('span');icon.className='file-icon';icon.textContent='FILE';const name=document.createElement('div');name.className='filename';name.textContent=r.relative_path;const sub=document.createElement('small');sub.textContent=statusName(r.status);name.append(sub);div.append(icon,name);el.append(div)}return;}const names=['MVP 기획안.md','사용자 설문 결과.txt','요구사항 정의서.md'];const times=['오늘 14:58','오늘 13:42','어제 17:26'];$('recent-list').innerHTML=names.map((n,i)=>'<div class="recent-row"><span class="file-icon">'+(n.endsWith('txt')?'TXT':'MD')+'</span><div class="filename">'+escapeHtml(n)+'<small>캡스톤 프로젝트 / '+(i===1?'리서치':'기획')+'</small></div><time>'+times[i]+'</time></div>').join('')}
function renderProgress(info){const n=Math.max(0,Number(info?.selected||totals().included)),done=Math.max(0,Math.min(n,Number(info?.sent||0))),pct=n?Math.round(done/n*100):100;$('progress-number').textContent=pct+'%';document.querySelector('#page-progress .progress-circle').style.setProperty('--pct',pct+'%');$('progress-total').textContent=n+'개';$('progress-done').textContent=done+'개';$('progress-active').textContent=Math.max(0,n-done)+'개';$('progress-waiting').textContent=Math.max(0,n-done)+'개';$('progress-title').textContent=desktopDemoMode?'시연용 진행 화면 (실제 전송 없음)':info?.stage==='device'?'기기와 폴더를 등록하고 있어요':'문서를 업로드하고 있어요';if(info?.relative){const list=$('progress-files');const row=document.createElement('div');row.className='process-row';const label=document.createElement('span');label.textContent=info.relative;const tag=document.createElement('em');tag.textContent=done+' / '+n;row.append(label,tag);list.prepend(row);while(list.children.length>5)list.lastChild.remove()}}
function stopPolling(){if(statusTimer)clearInterval(statusTimer);statusTimer=null;}
function startPolling(){stopPolling();statusCalls=0;statusTimer=setInterval(()=>{if(++statusCalls>60){stopPolling();return;}refreshStatus({silent:true}).catch(()=>{});},5000);}
function demoUpload(){let sent=0;const n=totals().included;if(n<1){toast('포함된 파일이 없습니다. 제외 설정을 변경해 주세요.');return;}$('progress-files').replaceChildren();go('progress');$('progress-mode').textContent='UI 시연 · 서버 업로드 없음';$('progress-title').textContent='파일 목록 처리 애니메이션 (실제 전송 없음)';const files=entries().filter(e=>e.node.kind==='file'&&!isOff(e.rel));renderProgress({stage:'uploading',selected:n,sent:0});if(progressTimer)clearInterval(progressTimer);progressTimer=setInterval(()=>{sent=Math.min(n,sent+Math.max(1,Math.ceil(n/14)));renderProgress({stage:'uploading',selected:n,sent,relative:files[Math.max(0,sent-1)]?.rel||''});if(sent===n){clearInterval(progressTimer);progressTimer=null;demoDone=true;$('progress-title').textContent='UI 시연이 완료되었어요 (업로드 없음)';$('stage-ai').classList.add('selected');$('stage-finish').classList.add('selected');toast('UI 시연이 완료되었습니다. 실제 서버 업로드는 수행하지 않았어요.');if(page==='progress')go('result')}},220)}
async function realUpload(){const c=totals();if(c.included===0){toast('하나 이상의 파일을 포함해 주세요.');return;}if(truncated){toast('전체 파일을 표시할 수 없어 전송을 막았습니다. 작은 폴더를 선택해 주세요.');return;}try{go('progress');$('progress-files').replaceChildren();$('progress-mode').textContent='실제 서버 업로드';$('progress-title').textContent='서버 연결 중';renderProgress({stage:'device',selected:c.included,sent:0});const result=await bridge.workspaceUpload({path:folderPath,exclusions:[...excluded],deviceName:$('device-name').value.trim()});if(result?.cancelled){toast('업로드를 취소했습니다.');go('folders');return;}latestReal=result;lastSeenFolderId=result.folderId||lastSeenFolderId;realRows=fromServerRows(result.documents||[]);startPolling();for(const f of result.uploadErrors||[])realRows.push({relative_path:f.relative_path,status:'upload_failed',error:f.error});for(const f of entries().filter(e=>e.node.kind==='file'&&isOff(e.rel)))realRows.push({relative_path:f.rel,status:'excluded'});$('stage-ai').classList.add('selected');$('stage-finish').classList.add('selected');if(page==='progress')go('result');if(result.autoSyncWarning)toast(result.autoSyncWarning);else if(result.statusError)toast('문서 상태 조회 실패: '+result.statusError);else toast(result.autoSyncEnabled?'업로드 후 이 폴더 자동 동기화를 시작했어요.':'업로드 요청을 마쳤습니다. AI 분석은 계속될 수 있어요.');void refreshSyncStatus();}catch(e){toast('업로드를 완료하지 못했습니다: '+(e.message||e));go('folders')}}
async function refreshConnection(){if(desktopDemoMode){$('connection-label').textContent='개발용 시연 · 서버 연결 / 소셜 로그인 / 실제 업로드 모두 사용 안 함';$('sidebar-mode').textContent='개발용 UI 시연 · 서버 전송 없음';return;}if(!bridge?.workspaceConnection){$('connection-label').textContent='HTML 시연 모드: 실제 서버 연결 없음';$('sidebar-mode').textContent='시연 데이터 · 백엔드 미연결';return;}try{const c=await bridge.workspaceConnection();$('connection-label').textContent=c.connected?'팀 백엔드 로그인 연결됨 · 문서 업로드 사용 가능':c.serverConfigured?'서버 설정 있음 · 실제 로그인 필요':'백엔드 주소 설정과 로그인이 필요합니다';$('sidebar-mode').textContent=c.connected?'서버 연결 가능 · 선택할 때만 업로드':'시연 데이터 · 로그인 필요'}catch(e){$('connection-label').textContent='서버 상태 확인 실패'}}
async function refreshOverview({quiet=false}={}){
 if(desktopDemoMode||!bridge?.workspaceOverview||overviewBusy)return;
 overviewBusy=true;
 try{
   const res=await bridge.workspaceOverview();
   if(!res?.connected)return;
   backendDataLoaded=true;lastSeenFolderId=res.folderId||lastSeenFolderId;
   backendFolderNames=(res.folders||[]).map(x=>x.name||'이름 없는 폴더');
   backendDocs=fromServerRows(res.documents||[]);
   if(!latestReal)realRows=[];
   $('home-folders').textContent=backendFolderNames.length+'개';
   const folderTags=document.querySelector('.folder-tags');folderTags.replaceChildren();
   for(const name of backendFolderNames.slice(0,3)){const badge=document.createElement('span');badge.textContent='▱ '+name;folderTags.append(badge)}
   if(!backendFolderNames.length)folderTags.textContent='연결된 서버 폴더 없음';
   document.querySelector('.metric>p').textContent='서버에 등록된 폴더 수';
   const count=summarizeRows(backendDocs);
   $('home-ready').textContent=count.ready;
   $('home-pending').textContent=count.pending;
   $('home-failed').textContent=count.failed;
   $('home-pct').textContent=count.ready+count.pending+count.failed?Math.round(count.ready/(count.ready+count.pending+count.failed)*100)+'%':'0%';
   $('home-analysis').textContent=`AI 분석 완료 ${count.ready}개 · 진행 ${count.pending}개 · 실패 ${count.failed}개`;
   $('home-label').textContent=count.pending?'AI 분석 진행 중':'최근 폴더의 AI 처리 상태';
   document.querySelector('#page-home .progress-circle').style.setProperty('--pct',$('home-pct').textContent);
   $('top-mode').textContent='팀 서버 연결 · 실제 폴더/문서 상태';
   $('backend-summary').textContent='연결된 폴더 '+backendFolderNames.length+'개 · 최근 확인 폴더 문서 '+backendDocs.length+'개'+(res.documentError?' · 상태 조회 실패: '+res.documentError:'')+' · 알림/추천은 미연동';
   const sidebar=$('sidebar-folders');sidebar.replaceChildren();
   for(const name of backendFolderNames.slice(0,4)){const div=document.createElement('div');div.textContent='▱ '+name;sidebar.append(div)}
   if(!backendFolderNames.length)sidebar.textContent='등록된 폴더 없음';
   const discovered=document.querySelector('.discovered .connection-card');
   discovered.textContent='AI 관련 기록 추천은 실제 알림 API 명세 확인 후 연결됩니다. 현재 임의의 연결 이유를 서버 결과처럼 표시하지 않습니다.';
   document.querySelector('#page-related .related-big').textContent='실제 관련 기록 추천 API 연결 대기 중입니다. 임의의 예시를 실제 추천으로 표시하지 않습니다.';
   document.querySelector('#page-history .page-topline p').textContent='알림 조회 API 명세를 받으면 여기에 서버 알림을 표시합니다. 현재 실제 알림은 미연동입니다.';
   notices=[];renderNotices();renderRecent();renderSearch();if(page==='result')renderResults();
   if(!quiet)toast('서버 폴더·문서 정보를 확인했습니다.');
 }catch(e){$('backend-summary').textContent='API 조회 실패: '+(e.message||e)+' — 로그인/네트워크/명세를 확인해 주세요.';if(!quiet)toast('서버 조회 실패: '+(e.message||e));}
 finally{overviewBusy=false;}
}
async function refreshStatus({silent=false}={}){if(statusRequestRunning)return;if(!bridge?.workspaceStatus){toast('Electron 앱에서만 서버 상태를 조회할 수 있어요.');return;}try{statusRequestRunning=true;const result=await bridge.workspaceStatus();realRows=fromServerRows(result.documents||[]);lastSeenFolderId=result.folderId||lastSeenFolderId;backendDataLoaded=true;backendDocs=realRows.slice();renderRecent();for(const f of latestReal?.uploadErrors||[])realRows.push({relative_path:f.relative_path,status:'upload_failed',error:f.error});for(const f of entries().filter(e=>e.node.kind==='file'&&isOff(e.rel)))realRows.push({relative_path:f.rel,status:'excluded'});renderResults();const c=summarizeRows(realRows);$('home-ready').textContent=c.ready;$('home-pending').textContent=c.pending;$('home-failed').textContent=c.failed;$('home-analysis').textContent=`완료 ${c.ready}개 · 진행 ${c.pending}개 · 실패 ${c.failed}개`;const pct=(c.ready+c.pending+c.failed)?Math.round(c.ready/(c.ready+c.pending+c.failed)*100):0;$('home-pct').textContent=pct+'%';document.querySelector('#page-home .progress-circle').style.setProperty('--pct',pct+'%');if(!silent)toast('서버 문서 상태를 다시 확인했어요.');if(!c.pending&&c.ready+c.failed>0)stopPolling()}catch(e){if(!silent)toast('상태 조회 실패: '+(e.message||e))}finally{statusRequestRunning=false}}
function resetDemo(){stopPolling();notices=seedNotices.map((n,i)=>({...n,read:i>=3}));focus=false;latestReal=null;realRows=[];demoDone=false;folderPath='';sampleMode=true;root=structuredClone(sampleTree);excluded=new Set(['기획/기획 초안(구버전).md','회의록/전체 회의록(임시).md','리서치/경쟁 서비스 분석(초안).pdf','임시자료/테스트 데이터(일회성).csv']);expanded=new Set(['','기획','회의록','리서치','임시자료']);$('current-folder-name').textContent=root.name;$('current-folder-path').textContent='샘플 폴더 · 실제 파일 접근 없음';$('folder-mode').textContent='시연 폴더';saveDemo();renderTree();renderNotices();toast('UI 시연 상태를 초기화했어요.');go('home')}
// Events
for(const b of document.querySelectorAll('[data-page]'))b.addEventListener('click',()=>go(b.dataset.page));
$('side-search').onclick=()=>{go('search');$('search-input').focus()};$('main-search').onkeydown=e=>{if(e.key==='Enter'){go('search');$('search-input').value=e.target.value;renderSearch()}};
$('search-input').oninput=renderSearch;$('search-clear').onclick=()=>{$('search-input').value='';renderSearch()};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();go('search');$('search-input').focus()}});
$('only-excluded').onchange=renderTree;$('restore-all').onclick=()=>{excluded.clear();renderTree();toast('모든 파일을 다시 포함했어요.')};
$('choose-folder').onclick=async()=>{if(!bridge?.chooseWorkspaceFolder){toast('브라우저 시연에서는 Windows 폴더 선택 창을 열 수 없어요. Electron 앱을 사용해 주세요.');return;}try{const result=await bridge.chooseWorkspaceFolder();if(!result)return;root=result.tree;folderPath=result.path;sampleMode=false;truncated=!!result.truncated;latestReal=null;expanded=new Set(['']);for(const child of root.children||[])if(child.kind==='folder')expanded.add(child.name);excluded=new Set(Array.isArray(result.excludedPaths)?result.excludedPaths:[]);$('current-folder-name').textContent=root.name;$('current-folder-path').textContent=folderPath;$('folder-mode').textContent=desktopDemoMode?'로컬 파일명 확인 · 전송 없음':'로컬 폴더 확인 중';$('folder-warning').textContent=truncated?'파일 5,000개 또는 최대 깊이를 초과하여 저장을 막았어요. 더 작은 폴더를 선택해 주세요.':'';$('sidebar-folders').innerHTML='<div>▱ &nbsp; '+escapeHtml(root.name)+'</div><small>직접 선택한 로컬 폴더</small>';renderTree();toast(result.exclusionsWarning||'실제 폴더를 선택했습니다. 제외할 파일을 점검해 주세요.');}catch(e){toast('폴더 선택 실패: '+(e.message||e))}};
$('save-start').onclick=async()=>{if(desktopDemoMode){demoUpload();return;}if(!sampleMode&&bridge?.workspaceConnection){const c=await bridge.workspaceConnection().catch(()=>({connected:false}));if(!c.connected){toast('팀 백엔드 연결과 OAuth 로그인 후 실제 업로드가 가능해요.');go('settings');return;}await realUpload();}else{toast('실제 모드에서는 먼저 Windows 폴더를 선택하세요. 개발용 UI 시연은 npm run demo에서 이용할 수 있습니다.');go('folders')}};
$('progress-result').onclick=()=>go('result');$('refresh-status').onclick=refreshStatus;$('toggle-result').onclick=()=>{resultOpen=!resultOpen;const el=$('result-list');el.style.display=resultOpen?'':'none';toast(resultOpen?'상세 목록 표시':'상세 목록 접기')};document.querySelectorAll('[data-result-filter]').forEach(b=>b.onclick=()=>{resultFilter=b.dataset.resultFilter;renderResults()});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{noticeFilter=b.dataset.filter;renderNotices()});$('mark-read').onclick=()=>{notices.forEach(n=>n.read=true);saveDemo();renderNotices();toast('모든 알림을 읽음으로 표시했어요.')};
$('original-open').onclick=()=>toast('실제 문서 바로 가기 API와 로컬 원본 경로 연결이 필요합니다.');$('document-download').onclick=()=>toast('원본 다운로드 API가 없어 비활성 상태입니다.');$('later-save').onclick=()=>toast('보관함은 UI 시연 단계입니다. 서버 저장 API가 필요합니다.');
$('focus-btn').onclick=()=>{focus=!focus;$('focus-checkbox').checked=focus;saveDemo();toast(focus?'집중 모드를 켰어요. (UI 시연)':'집중 모드를 껐어요. (UI 시연)')};$('focus-checkbox').onchange=e=>{focus=e.target.checked;saveDemo()};$('reset-demo').onclick=resetDemo;
$('refresh-overview').onclick=()=>refreshOverview();
$('refresh-sync').onclick=()=>refreshSyncStatus();
$('close-document-detail').onclick=()=>$('document-details').close();
bridge?.onSyncState?.(items=>{syncStates=items;renderSyncStatus();});
$('auth-open').onclick=()=>desktopDemoMode?toast('시연 모드는 로그인 기능을 사용하지 않습니다. 앱을 종료하고 npm start로 실행해 주세요.'):bridge?.openAuth?bridge.openAuth():toast('Electron 앱에서 소셜 로그인을 사용할 수 있습니다.');
$('min-window').onclick=()=>bridge?.minimizeWorkspace?.();$('close-window').onclick=()=>bridge?.closeWorkspace?.();$('minimize-main').onclick=()=>bridge?.minimizeWorkspace?bridge.minimizeWorkspace():toast('Electron 환경에서만 최소화할 수 있어요.');
bridge?.onDocumentProgress?.(data=>{liveProgress=data;renderProgress(data)});
loadDemo();$('focus-checkbox').checked=focus;renderRecent();renderTree();renderNotices();renderResults();initAppMode().then(async()=>{renderResults();await refreshConnection();if(!desktopDemoMode&&bridge?.workspaceOverview)await refreshOverview({quiet:true});await refreshSyncStatus();}).catch(()=>{});go('home');
