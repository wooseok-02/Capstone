'use strict';
const api = window.koko;
const $ = (id) => document.getElementById(id);
const loginView = $('login-view');
const profileView = $('profile-view');
const status = $('auth-status');
const cancel = $('cancel-login');
const providerButtons = [...document.querySelectorAll('[data-provider]')];
let configured = false;
let previousUrl = '';
let isBusy = false;

function showMessage(message, type = 'normal') {
  status.textContent = message;
  status.dataset.type = type;
}
function render(state) {
  if (!state || typeof state !== 'object') return;
  if (typeof state.apiConfigured === 'boolean') configured = state.apiConfigured;
  if (typeof state.apiBaseUrl === 'string' && state.apiBaseUrl !== previousUrl) {
    previousUrl = state.apiBaseUrl;
    $('api-base').value = previousUrl;
  }
  const loggedIn = !!state.loggedIn && !!state.user;
  loginView.hidden = loggedIn;
  profileView.hidden = !loggedIn;
  if (loggedIn) {
    const user = state.user;
    $('profile-nickname').textContent = user.nickname || '(이름 없음)';
    $('profile-provider').textContent = user.provider || '알 수 없음';
    $('profile-id').textContent = String(user.id);
    $('profile-created').textContent = user.created_at || '정보 없음';
    document.title = '코코 (KOKO) — 내 계정';
    return;
  }
  const firstTime = !state.hasAuthenticatedBefore;
  $('mode-tag').textContent = firstTime ? '간편 가입' : '로그인';
  $('headline').textContent = firstTime ? '회원가입 방식을 선택하세요' : '코코에 로그인하세요';
  $('subtitle').textContent = firstTime ? '처음 연결하는 계정은 로그인할 때 자동으로 가입돼요.' : '연결했던 계정으로 다시 시작해요.';
  $('naver-text').textContent = firstTime ? '네이버로 간편가입' : '네이버 로그인';
  $('google-text').textContent = firstTime ? 'Google 계정으로 가입' : 'Google 로그인';
  document.title = `코코 (KOKO) — ${firstTime ? '회원가입' : '로그인'}`;
  const phase = state.phase;
  isBusy = ['preparing', 'waiting', 'exchanging', 'restoring'].includes(phase);
  providerButtons.forEach((button) => { button.disabled = isBusy || !configured; });
  $('api-base').disabled = isBusy;
  document.querySelector('.save-config').disabled = isBusy;
  $('server-state').textContent = configured ? '연결 주소 설정됨' : '주소 설정 필요';
  cancel.hidden = !['preparing', 'waiting'].includes(phase);
  if (phase === 'error') showMessage(state.message || '로그인에 실패했습니다.', 'error');
  else if (phase === 'cancelled') showMessage(state.message || '로그인을 취소했습니다.');
  else if (isBusy) showMessage(state.message || '처리 중…');
  else if (state.message) showMessage(state.message);
  else if (!configured) showMessage('팀 백엔드 서버 주소를 저장해 주세요.');
  else showMessage('소셜 로그인 버튼을 누르면 기본 브라우저가 열려요.');
}

$('minimize').addEventListener('click', () => api.minimizeAuth());
$('close').addEventListener('click', () => api.closeAuth());
$('api-config-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const next = await api.setApiBase($('api-base').value);
    render(next);
    showMessage('백엔드 서버 주소를 저장했어요.');
  } catch (error) { showMessage(error.message || '서버 주소 저장 실패', 'error'); }
});
providerButtons.forEach(button => button.addEventListener('click', async () => {
  if (isBusy || !configured) return;
  providerButtons.forEach(btn => btn.disabled = true);
  try { await api.startLogin(button.dataset.provider); }
  catch (error) {
    showMessage(error.message || '로그인 시작에 실패했습니다.', 'error');
    providerButtons.forEach(btn => btn.disabled = !configured);
  }
}));
cancel.addEventListener('click', () => api.cancelLogin());
$('reload-profile').addEventListener('click', async () => {
  $('reload-profile').disabled = true;
  try { render(await api.refreshProfile()); }
  catch { /* failure state is announced via auth-state */ }
  finally { $('reload-profile').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  $('logout').disabled = true;
  try {
    await api.logout();
    render(await api.getState());
  } catch (error) { showMessage(error.message || '로그아웃 실패', 'error'); }
  finally { $('logout').disabled = false; }
});
api.onAuthState(render);
api.getState().then(render).catch(() => showMessage('앱 상태를 불러올 수 없습니다.', 'error'));
