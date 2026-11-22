'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { makeVerifier, challengeOf, validateBaseUrl, startUrl } = require('../lib/oauth-utils');
const { createLoopback } = require('../lib/loopback');
const { ApiClient } = require('../lib/api-client');
const { AuthService } = require('../lib/auth-service');
const { SecureTokenStore } = require('../lib/token-store');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function until(check, maxMs = 3500) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > maxMs) throw new Error('상태 변경 시간 초과'); await sleep(15); }
}
function mockBackend() {
  const record = { start: [], exchanges: [], refreshes: 0, logouts: 0, profiles: 0, codeUsed: false };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const sendJson = (body, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && /^\/auth\/(google|naver|kakao)\/start$/.test(url.pathname)) {
      const port = Number(url.searchParams.get('desktop_port'));
      const challenge = url.searchParams.get('desktop_challenge');
      record.start.push({ port, challenge, provider: url.pathname.split('/')[2] });
      res.writeHead(302, { 'Location': `/provider?port=${port}`, 'Set-Cookie': 'oauth_flow=flow-ok; HttpOnly; SameSite=Lax' }); return res.end();
    }
    if (url.pathname === '/provider') {
      res.writeHead(302, { Location: `/auth/mock/callback?state=state123&port=${url.searchParams.get('port')}&code=social` }); return res.end();
    }
    if (url.pathname === '/auth/mock/callback') {
      if (!(req.headers.cookie || '').includes('oauth_flow=flow-ok')) return sendJson({ error: 'missing cookie' }, 400);
      const port = url.searchParams.get('port');
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/oauth/callback?code=single-use-code-XYZ` }); return res.end();
    }
    if (req.method === 'POST' && ['/auth/exchange', '/auth/refresh', '/auth/logout'].includes(url.pathname)) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      if (url.pathname === '/auth/exchange') {
        record.exchanges.push(data);
        if (data.code !== 'single-use-code-XYZ' || record.codeUsed || challengeOf(data.code_verifier) !== record.start.at(-1).challenge) return sendJson({ code: 'invalid_code' }, 400);
        record.codeUsed = true;
        return sendJson({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 900 });
      }
      if (url.pathname === '/auth/refresh') {
        record.refreshes++;
        if (data.refresh_token !== `refresh-${record.refreshes}`) return sendJson({ code: 'invalid_token' }, 401);
        return sendJson({ access_token: `access-${record.refreshes + 1}`, refresh_token: `refresh-${record.refreshes + 1}`, token_type: 'bearer', expires_in: 900 });
      }
      if (url.pathname === '/auth/logout') {
        record.logouts++;
        if (!data.refresh_token?.startsWith('refresh-')) return sendJson({ code: 'bad_logout' }, 400);
        res.writeHead(204); return res.end();
      }
    }
    if (req.method === 'GET' && url.pathname === '/me') {
      record.profiles++;
      if (!/^Bearer access-\d+$/.test(req.headers.authorization || '')) return sendJson({ code: 'unauthorized' }, 401);
      return sendJson({ id: 42, provider: record.start.at(-1).provider.toUpperCase(), nickname: '코코 사용자', created_at: '2026-11-22T10:00:00+09:00' });
    }
    sendJson({ error: 'not_found' }, 404);
  });
  return { record, server };
}
async function browserSimulation(target) {
  const initial = await fetch(target, { redirect: 'manual' });
  assert.equal(initial.status, 302);
  const cookie = initial.headers.get('set-cookie')?.split(';')[0];
  const next = new URL(initial.headers.get('location'), target);
  const provider = await fetch(next, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(provider.status, 302);
  const callback = await fetch(new URL(provider.headers.get('location'), target), { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(callback.status, 302);
  const loopback = await fetch(callback.headers.get('location'));
  assert.equal(loopback.status, 200);
}
function fakeStorage() {
  let value = null;
  return { get: async () => value, set: async next => { value = next; }, clear: async () => { value = null; } };
}

test('PKCE code_verifier 및 43자 Base64URL SHA256 challenge', () => {
  const one = makeVerifier(), two = makeVerifier();
  assert.notEqual(one, two);
  assert.match(one, /^[A-Za-z0-9_-]{64}$/);
  assert.match(challengeOf(one), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challengeOf('a'.repeat(43)), require('node:crypto').createHash('sha256').update('a'.repeat(43)).digest('base64url'));
});

test('보안 URL 검증 및 3개 provider start 쿼리', () => {
  assert.equal(validateBaseUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.throws(() => validateBaseUrl('http://example.com'), /HTTPS/);
  assert.throws(() => validateBaseUrl('file:///tmp/hack'), /HTTPS/);
  assert.throws(() => validateBaseUrl('https://user:pw@example.com'), /인증 정보/);
  assert.throws(() => startUrl('https://api.example.com', 'bad', 12, 'x'.repeat(43)));
  for (const provider of ['google', 'naver', 'kakao']) {
    const uri = new URL(startUrl('https://api.example.com', provider, 51004, 'x'.repeat(43)));
    assert.equal(uri.pathname, `/auth/${provider}/start`);
    assert.equal(uri.searchParams.get('desktop_port'), '51004');
    assert.equal(uri.searchParams.get('desktop_challenge'), 'x'.repeat(43));
  }
});

test('실제 127.0.0.1 callback은 /oauth/callback만 받고 한 번만 완료한다', async () => {
  let received = [];
  const listener = await createLoopback({ onCallback: result => received.push(result) });
  const root = `http://127.0.0.1:${listener.port}`;
  assert.equal((await fetch(root + '/bad')).status, 404);
  assert.equal((await fetch(root + '/oauth/callback')).status, 400);
  assert.equal((await fetch(root + '/oauth/callback?code=abc_42')).status, 200);
  await until(() => received.length === 1);
  assert.deepEqual(received, [{ code: 'abc_42', error: null }]);
  listener.close();
});

test('Google→Naver→Kakao 브라우저 302, 일회용 코드 교환, /me, refresh 재기동, logout 전체', async () => {
  const mock = mockBackend();
  await new Promise(resolve => mock.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${mock.server.address().port}`;
  try {
    for (const provider of ['google', 'naver', 'kakao']) {
      mock.record.codeUsed = false;
      const store = fakeStorage();
      const session = new AuthService({ api: new ApiClient({ getBaseUrl: () => base }), store,
        getBaseUrl: () => base, openBrowser: browserSimulation });
      await session.start(provider);
      await until(() => session.phase === 'authenticated' || session.phase === 'error');
      assert.equal(session.phase, 'authenticated', session.message);
      assert.equal(session.user.provider, provider.toUpperCase());
      assert.equal(session.user.id, 42);
      assert.equal(await store.get(), 'refresh-1');
      assert.match(mock.record.start.at(-1).challenge, /^[a-zA-Z0-9_-]{43}$/);
      assert.equal(mock.record.exchanges.at(-1).code, 'single-use-code-XYZ');
      assert.equal(challengeOf(mock.record.exchanges.at(-1).code_verifier), mock.record.start.at(-1).challenge);
      // First startup with saved rotating Refresh Token. The access token is not persistent.
      mock.record.refreshes = 0;
      const restarted = new AuthService({ api: new ApiClient({ getBaseUrl: () => base }), store,
        getBaseUrl: () => base, openBrowser: browserSimulation });
      await restarted.restore();
      assert.equal(restarted.user.id, 42);
      assert.equal(await store.get(), 'refresh-2');
      assert.equal(restarted.access, 'access-2');
      assert.equal(mock.record.refreshes, 1);
      await restarted.logout();
      assert.equal(restarted.phase, 'idle');
      assert.equal(await store.get(), null);
      assert.equal(restarted.user, null);
      assert.equal(restarted.access, null);
      session.dropMemory();
    }
    assert.equal(mock.record.logouts, 3);
  } finally { await new Promise(resolve => mock.server.close(resolve)); }
});

test('로그인 취소 및 인증 실패 시 임시 서버 종료·토큰 미저장', async () => {
  const store = fakeStorage();
  const auth = new AuthService({ api: new ApiClient({ getBaseUrl: () => 'http://127.0.0.1:1' }), store,
    getBaseUrl: () => 'http://127.0.0.1:1', openBrowser: async () => {} });
  await auth.start('google');
  const port = auth.pending.listener.port;
  auth.cancel();
  assert.equal(auth.phase, 'cancelled');
  assert.equal(auth.pending, null);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/oauth/callback?code=should-not-accept`));
  await auth.start('kakao');
  const response = await fetch(`http://127.0.0.1:${auth.pending.listener.port}/oauth/callback?error=access_denied`);
  assert.equal(response.status, 200);
  await until(() => auth.phase === 'error');
  assert.match(auth.message, /취소/);
  assert.equal(await store.get(), null);
});

test('OS 암호화 어댑터를 통해 암호문만 파일에 보관', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'koko-token-test-'));
  const fakeSafeStorage = { isEncryptionAvailable: () => true,
    encryptString: token => Buffer.from(token.split('').reverse().join(''), 'utf8'),
    decryptString: buffer => buffer.toString('utf8').split('').reverse().join('') };
  const store = new SecureTokenStore({ storage: fakeSafeStorage, file: path.join(root, 'secret.bin') });
  try {
    await store.set('refresh-secret-xyz');
    assert.equal(await store.get(), 'refresh-secret-xyz');
    assert.notEqual((await readFile(path.join(root, 'secret.bin'))).toString('utf8'), 'refresh-secret-xyz');
    await store.clear();
    assert.equal(await store.get(), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('만료된 일회용 코드: 410 오류 후 로그인 실패 및 로컬 토큰 없음', async () => {
  const store = fakeStorage();
  const auth = new AuthService({
    api: { exchange: async () => { const err = new Error('인증 코드가 유효하지 않거나 만료되었습니다. 다시 로그인해 주세요.'); err.status = 410; throw err; } },
    store, getBaseUrl: () => 'http://127.0.0.1:12345',
    openBrowser: async (url) => {
      const port = Number(new URL(url).searchParams.get('desktop_port'));
      const result = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=expired-code-123`);
      assert.equal(result.status, 200);
    }
  });
  await auth.start('google');
  await until(() => auth.phase === 'error');
  assert.match(auth.message, /만료/);
  assert.equal(await store.get(), null);
  assert.equal(auth.pending, null);
});

test('Refresh Token 갱신 실패: 자동 로그인 중단 및 저장 토큰 삭제', async () => {
  const store = fakeStorage();
  await store.set('bad-refresh');
  const auth = new AuthService({
    api: { refresh: async () => { const err = new Error('401'); err.status = 401; throw err; } },
    store, getBaseUrl: () => 'http://127.0.0.1:12345', openBrowser: async () => {}
  });
  await auth.restore();
  assert.equal(auth.phase, 'error');
  assert.equal(await store.get(), null);
  assert.equal(auth.access, null);
  assert.equal(auth.user, null);
});
