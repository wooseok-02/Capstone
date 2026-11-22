'use strict';
const { endpoint } = require('./oauth-utils');

class ApiError extends Error {
  constructor(message, status, code) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}
class ApiClient {
  constructor({ getBaseUrl, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    this.getBaseUrl = getBaseUrl; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async request(method, path, { data, access, timeoutMs } = {}) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs ?? this.timeoutMs);
    try {
      const headers = { 'Accept': 'application/json', 'Cache-Control': 'no-store' };
      if (data !== undefined) headers['Content-Type'] = 'application/json';
      if (access) headers.Authorization = `Bearer ${access}`;
      const response = await this.fetchImpl(endpoint(this.getBaseUrl(), path), {
        method, headers, body: data !== undefined ? JSON.stringify(data) : undefined,
        signal: ctrl.signal, cache: 'no-store', redirect: 'error'
      });
      if (response.status === 204) return null;
      const raw = await response.text();
      let result = null;
      if (raw) { try { result = JSON.parse(raw); } catch { throw new ApiError('서버가 올바른 JSON 응답을 보내지 않았습니다.', response.status, 'invalid_json'); } }
      if (!response.ok) {
        const code = typeof result?.code === 'string' ? result.code : undefined;
        const message = response.status === 401 ? '인증이 만료되었거나 유효하지 않습니다.'
          : response.status === 400 || response.status === 410 ? '인증 코드가 유효하지 않거나 만료되었습니다. 다시 로그인해 주세요.'
          : response.status >= 500 ? '백엔드 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.'
          : `서버 요청에 실패했습니다. (HTTP ${response.status})`;
        throw new ApiError(message, response.status, code);
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new ApiError('서버 응답 시간이 초과되었습니다.', 0, 'timeout');
      if (error instanceof ApiError) throw error;
      // Never embed URLs/token-bearing messages from transport into UI/errors.
      throw new ApiError('서버에 연결할 수 없습니다. 주소와 네트워크 연결을 확인해 주세요.', 0, 'network');
    } finally { clearTimeout(timeout); }
  }
  exchange(code, code_verifier) { return this.request('POST', '/auth/exchange', { data: { code, code_verifier }, timeoutMs: 12000 }); }
  refresh(refresh_token) { return this.request('POST', '/auth/refresh', { data: { refresh_token } }); }
  logout(refresh_token) { return this.request('POST', '/auth/logout', { data: { refresh_token } }); }
  me(access) { return this.request('GET', '/me', { access }); }
}
module.exports = { ApiClient, ApiError };
