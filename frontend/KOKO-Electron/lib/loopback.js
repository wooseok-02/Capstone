'use strict';
const http = require('node:http');
const { URL } = require('node:url');

/** Bound strictly to IPv4 localhost. The callback returns only an ephemeral code. */
async function createLoopback({ onCallback, lifetimeMs = 180000 } = {}) {
  if (typeof onCallback !== 'function') throw new Error('onCallback is required');
  let finished = false;
  let timer;
  const server = http.createServer((req, res) => {
    const reply = (status, message) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Connection': 'close'
      });
      res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>코코 로그인</title><body style="font:16px sans-serif;padding:3rem;background:#F2EFE7;color:#23527a"><h2>${message}</h2><p>이 탭을 닫고 코코 앱으로 돌아가세요.</p></body></html>`);
    };
    if (finished) return reply(410, '로그인 요청이 종료됐습니다.');
    if (req.method !== 'GET') return reply(405, '허용되지 않는 요청입니다.');
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) return reply(400, '잘못된 요청입니다.');
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return reply(400, '잘못된 요청입니다.'); }
    if (url.pathname !== '/oauth/callback') return reply(404, '페이지를 찾을 수 없습니다.');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if ((!code && !error) || (code && error) || (code && (code.length > 4096 || !/^[A-Za-z0-9_~.\-+/=]+$/.test(code))) || (error && error.length > 150)) {
      return reply(400, '인증 응답을 확인할 수 없습니다.');
    }
    finished = true;
    // Respond immediately, then exchange code. No token is shown in the browser.
    reply(200, error ? '인증이 취소되었거나 실패했습니다.' : '인증 결과가 코코 앱으로 전달됐습니다.');
    close();
    queueMicrotask(() => onCallback({ code, error }));
  });
  server.on('clientError', (_err, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = server.address().port;
  function close() {
    clearTimeout(timer);
    if (server.listening) server.close();
  }
  timer = setTimeout(() => {
    if (!finished) {
      finished = true; close(); onCallback({ error: 'timeout' });
    }
  }, lifetimeMs);
  timer.unref?.();
  return { port, close };
}
module.exports = { createLoopback };
