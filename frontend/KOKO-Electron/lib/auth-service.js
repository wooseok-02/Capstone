'use strict';
const { PROVIDERS, makeVerifier, challengeOf, startUrl, safeTokens, safeUser } = require('./oauth-utils');
const { createLoopback } = require('./loopback');

const USER_ERRORS = Object.freeze({
  access_denied: '로그인이 취소되었습니다. 다른 계정으로 다시 시도할 수 있어요.',
  login_failed: '소셜 인증에 실패했습니다. 다시 시도해 주세요.',
  timeout: '인증 대기 시간이 초과되었습니다. 다시 로그인해 주세요.'
});

class AuthService {
  constructor({ api, store, getBaseUrl, openBrowser, onUpdate = () => {}, listen = createLoopback }) {
    this.api = api; this.store = store; this.getBaseUrl = getBaseUrl;
    this.openBrowser = openBrowser; this.onUpdate = onUpdate; this.listen = listen;
    this.phase = 'idle'; this.user = null; this.access = null; this.refreshToken = null;
    this.expiresAt = 0; this.pending = null; this.generation = 0;
    this.refreshPromise = null;
    this.refreshTimer = null;
    this.message = '';
  }
  snapshot() { return { phase: this.phase, user: this.user, message: this.message, loggedIn: !!this.user }; }
  emit(phase, message = '') { this.phase = phase; this.message = message; this.onUpdate(this.snapshot()); }
  dropMemory() { clearTimeout(this.refreshTimer); this.refreshTimer = null; this.access = null; this.refreshToken = null; this.expiresAt = 0; this.user = null; }
  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    const remaining = Math.max(1000, this.expiresAt - Date.now() - 30000);
    const generation = this.generation;
    this.refreshTimer = setTimeout(() => {
      void this.refreshSession().catch(async () => {
        if (generation !== this.generation) return;
        this.dropMemory();
        await this.store.clear().catch(() => {});
        this.emit('error', '세션 갱신에 실패했습니다. 다시 로그인해 주세요.');
      });
    }, remaining);
    this.refreshTimer.unref?.();
  }
  cancel(silent = false) {
    this.generation++;
    if (this.pending) { this.pending.listener?.close(); this.pending = null; }
    if (!this.user) this.emit(silent ? 'idle' : 'cancelled', silent ? '' : '로그인 요청을 취소했습니다.');
  }
  async start(provider) {
    if (!PROVIDERS.includes(provider)) throw new Error('지원하지 않는 로그인 제공자입니다.');
    const base = this.getBaseUrl(); // validated by config layer
    this.cancel(true);
    const generation = ++this.generation;
    const verifier = makeVerifier();
    const attempt = { provider, verifier, generation, listener: null };
    this.pending = attempt;
    this.emit('preparing', '인증 준비 중…');
    try {
      attempt.listener = await this.listen({ onCallback: (response) => {
        void this.receive(attempt, response).catch((err) => {
          if (generation === this.generation) this.emit('error', err.message);
        });
      }});
      if (this.pending !== attempt) { attempt.listener.close(); return; }
      const url = startUrl(base, provider, attempt.listener.port, challengeOf(verifier));
      this.emit('waiting', '기본 브라우저에서 로그인을 완료하세요.');
      await this.openBrowser(url);
    } catch (error) {
      if (this.pending === attempt) { attempt.listener?.close(); this.pending = null; this.emit('error', error.message || '브라우저를 열 수 없습니다.'); }
      throw error;
    }
  }
  async receive(attempt, { code, error }) {
    if (this.pending !== attempt || attempt.generation !== this.generation) return;
    attempt.listener.close(); this.pending = null;
    if (error) { this.emit('error', USER_ERRORS[error] || '소셜 로그인에 실패했습니다. 다시 시도해 주세요.'); return; }
    if (!code) { this.emit('error', '로그인 코드가 전달되지 않았습니다.'); return; }
    this.emit('exchanging', '인증 코드를 교환하고 있어요…');
    const generation = attempt.generation;
    try {
      // One-time code MUST be exchanged immediately (within backend 2min TTL).
      const tokens = safeTokens(await this.api.exchange(code, attempt.verifier));
      if (generation !== this.generation) return;
      const user = safeUser(await this.api.me(tokens.access));
      if (generation !== this.generation) return;
      await this.store.set(tokens.refresh);
      if (generation !== this.generation) { await this.store.clear(); return; }
      this.access = tokens.access; this.refreshToken = tokens.refresh;
      this.expiresAt = tokens.expiresAt; this.user = user; this.scheduleRefresh();
      this.emit('authenticated', '로그인되었습니다.');
    } catch (e) {
      if (generation !== this.generation) return;
      this.dropMemory();
      this.emit('error', e.message || '로그인에 실패했습니다. 다시 시도해 주세요.');
    }
  }
  async restore() {
    if (this.pending) return;
    this.emit('restoring', '저장된 로그인 정보를 확인하고 있어요…');
    try {
      const refresh = await this.store.get();
      if (!refresh) { this.dropMemory(); this.emit('idle'); return; }
      this.refreshToken = refresh;
      await this.refreshSession();
      const user = await this.fetchUser();
      this.user = user;
      this.emit('authenticated', '자동 로그인되었습니다.');
    } catch (e) {
      this.dropMemory();
      try { await this.store.clear(); } catch { /* no token exposed */ }
      this.emit('error', '자동 로그인에 실패했습니다. 다시 로그인해 주세요.');
    }
  }
  async refreshSession() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const old = this.refreshToken || await this.store.get();
      if (!old) throw new Error('갱신할 세션이 없습니다.');
      const tokens = safeTokens(await this.api.refresh(old));
      // Persist rotated Refresh Token before replacing the active in-memory access token.
      await this.store.set(tokens.refresh);
      this.refreshToken = tokens.refresh; this.access = tokens.access; this.expiresAt = tokens.expiresAt; this.scheduleRefresh();
    })();
    try { return await this.refreshPromise; } finally { this.refreshPromise = null; }
  }
  async fetchUser() {
    if (!this.access) throw new Error('로그인이 필요합니다.');
    if (Date.now() > this.expiresAt - 30000) await this.refreshSession();
    try { return safeUser(await this.api.me(this.access)); }
    catch (err) {
      if (err.status !== 401) throw err;
      await this.refreshSession();
      return safeUser(await this.api.me(this.access));
    }
  }
  async getProfile() {
    if (!this.user) return null;
    const generation = this.generation;
    try {
      const user = await this.fetchUser();
      if (generation !== this.generation) return null;
      this.user = user; this.emit('authenticated'); return this.user;
    }
    catch (e) {
      if (generation !== this.generation) return null;
      this.dropMemory(); await this.store.clear().catch(() => {});
      this.emit('error', '세션이 만료되었습니다. 다시 로그인해 주세요.'); return null;
    }
  }
  async logout() {
    this.cancel(true);
    // Serialize against in-flight refresh to prevent old rotations being persisted after logout.
    if (this.refreshPromise) await this.refreshPromise.catch(() => {});
    const refresh = this.refreshToken || await this.store.get().catch(() => null);
    let remote = true;
    try { if (refresh) await this.api.logout(refresh); }
    catch { remote = false; }
    // Clear local tokens regardless of network response; do not silently claim server logout worked.
    try { await this.store.clear(); } catch { /* OS storage can fail; surface status below */ remote = false; }
    this.dropMemory();
    this.emit('idle', remote ? '로그아웃했습니다.' : '로컬 세션을 종료했습니다. 서버 로그아웃은 확인되지 않았습니다.');
    return { ok: true, serverConfirmed: remote };
  }
}
module.exports = { AuthService };
