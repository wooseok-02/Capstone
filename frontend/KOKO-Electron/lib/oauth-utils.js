'use strict';
const crypto = require('node:crypto');
const PROVIDERS = Object.freeze(['google', 'naver', 'kakao']);

function makeVerifier() {
  // 64 URL-safe chars, 384 bits of CSPRNG entropy.
  return crypto.randomBytes(48).toString('base64url');
}
function challengeOf(verifier) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new Error('올바르지 않은 PKCE verifier');
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
function validateBaseUrl(input) {
  if (typeof input !== 'string' || input.length > 300) throw new Error('백엔드 서버 주소를 입력해 주세요.');
  let uri;
  try { uri = new URL(input.trim()); } catch { throw new Error('올바른 서버 주소가 아닙니다.'); }
  if (uri.username || uri.password || uri.search || uri.hash) throw new Error('서버 주소에는 인증 정보·쿼리·해시를 포함할 수 없습니다.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname.toLowerCase());
  if (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && local)) {
    throw new Error('HTTPS 주소를 사용하세요. HTTP는 로컬 개발 서버에서만 허용합니다.');
  }
  if (!uri.hostname || /\s/.test(input)) throw new Error('올바른 서버 주소가 아닙니다.');
  return uri.toString().replace(/\/$/, '');
}
function endpoint(base, suffix) {
  if (!suffix.startsWith('/')) throw new Error('엔드포인트는 /로 시작해야 합니다.');
  return validateBaseUrl(base) + suffix;
}
function startUrl(base, provider, port, challenge) {
  if (!PROVIDERS.includes(provider)) throw new Error('지원하지 않는 로그인 제공자입니다.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('유효하지 않은 포트입니다.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error('유효하지 않은 PKCE challenge입니다.');
  const uri = new URL(endpoint(base, `/auth/${provider}/start`));
  uri.searchParams.set('desktop_port', String(port));
  uri.searchParams.set('desktop_challenge', challenge);
  return uri.toString();
}
function safeUser(data) {
  if (!data || typeof data !== 'object' || (typeof data.id !== 'number' && typeof data.id !== 'string')) {
    throw new Error('회원 정보 응답 형식이 올바르지 않습니다.');
  }
  return {
    id: data.id,
    provider: typeof data.provider === 'string' ? data.provider : '',
    nickname: typeof data.nickname === 'string' ? data.nickname.slice(0, 120) : '',
    created_at: typeof data.created_at === 'string' ? data.created_at : ''
  };
}
function safeTokens(data) {
  if (!data || typeof data !== 'object' || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || String(data.token_type).toLowerCase() !== 'bearer') {
    throw new Error('서버의 토큰 응답 형식이 올바르지 않습니다.');
  }
  return { access: data.access_token, refresh: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
}
module.exports = { PROVIDERS, makeVerifier, challengeOf, validateBaseUrl, endpoint, startUrl, safeTokens, safeUser };
