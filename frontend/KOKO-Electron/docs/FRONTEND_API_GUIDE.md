# 코코 프론트엔드 ↔ 백엔드 OAuth API 연동 가이드

## 이번 단계 기준

사용자 제공 `API_SPEC.csv`를 유일한 API 형식 기준으로 사용합니다. 약관 기능은 협의되지 않았으므로 **로그인 통합 단계에서 생략**했습니다. 서버 주소는 명세에 제공되지 않았으므로 **UI에서 설정**해야 합니다.

## 담당 구분

| 담당 | 구현 |
|---|---|
| Electron 프론트엔드 | 1번 고양이 펫, 회원가입/로그인 UI, 로컬 루프백 HTTP 리스너, PKCE verifier/challenge 생성, 브라우저 실행, 교환 코드 전송, 메모리 Access Token, OS 암호화 Refresh Token, `/me` 계정 표시, 자동 갱신/로그아웃 UI |
| 백엔드 | `/auth/{provider}/start` 302, 제공자 OAuth 302/쿠키/state 확인, `/auth/{provider}/callback` 후 Desktop loopback 302, 일회용 코드 발급·검증(2분, 1회), `/auth/exchange`, `/auth/refresh` 토큰 회전, `/auth/logout` 세션 폐기, `/me` 인증/회원 조회 |

## 프론트 요청 원형

```http
GET /auth/google/start?desktop_port=51004&desktop_challenge=<43자 SHA256 Base64URL>
```

이 요청은 Electron `fetch()`가 아니라 기본 브라우저의 탐색입니다. 쿠키 `oauth_flow`는 브라우저에서 유지합니다. Electron이 OAuth 쿠키를 직접 다루지 않습니다.

```http
POST /auth/exchange
Content-Type: application/json

{"code":"ONE_TIME_CODE","code_verifier":"ORIGINAL_VERIFIER"}
```

```http
POST /auth/refresh
Content-Type: application/json

{"refresh_token":"REFRESH_TOKEN"}
```

```http
GET /me
Authorization: Bearer ACCESS_TOKEN
```

```http
POST /auth/logout
Content-Type: application/json

{"refresh_token":"REFRESH_TOKEN"}
```

- `/auth/exchange`, `/auth/refresh`: `{access_token, refresh_token, token_type:'bearer', expires_in:900}` 형식
- `/me`: `{id, provider, nickname, created_at}` 형식
- `/auth/logout`: `204 No Content`
- 취소: `127.0.0.1:<port>/oauth/callback?error=access_denied`, 인증 실패: `error=login_failed`

## 우선 테스트 순서

1. Google 서버측 OAuth 등록, 실서비스와 구분되는 테스트 환경 확인
2. API BASE URL 설정, Google 클릭 → 브라우저 확인 → 정상 콜백 → `/auth/exchange` → `/me`
3. 닫았다가 앱 재실행 → `/auth/refresh` → `/me`, Refresh Token **회전** 확인
4. 로그아웃 → `/auth/logout` 요청(204) 및 로컬 토큰 삭제 확인
5. 실패/취소/만료 처리 확인
6. Google과 같은 Electron 흐름으로 Naver, Kakao 확인

## 백엔드 팀에 확인할 질문

- BASE URL은 정확히 무엇인가요? 경로 prefix(`/api/v1`)가 있나요?
- Desktop 리다이렉트가 정확히 `http://127.0.0.1:<desktop_port>/oauth/callback?code=...` 형태인가요?
- `desktop_challenge`는 RFC 7636 S256 방식 43자 Base64URL(=제거)로 검증하나요?
- 제공자별 로그인 실패는 `access_denied`/`login_failed`로 도착하나요?
- Access/Refresh Token 만료 및 Refresh Token 회전이 모두 구현되어 있나요?
- 오류 응답의 HTTP 상태코드(`400`, `401`, `410` 등)가 어떤가요? 명세는 성공 응답 위주입니다.
- OAuth 로그인 첫 실행 시 서버가 자동으로 회원을 생성하나요? `/me`에 `id`/`provider` 등이 항상 있나요?

## 보안 메모

실제 소셜 Client Secret을 Electron에 넣지 않습니다. `code_verifier`와 Access Token은 프로세스 메모리에만 보관하며 노출된 페이지 JS/로그에 쓰지 않습니다. 사용자가 임의 URL을 외부 브라우저로 열지 못하도록 백엔드 주소만 허용합니다.

Windows에서 `safeStorage`는 DPAPI 암호화 키를 사용하며, 암호화한 Refresh Token 바이트를 앱 데이터 폴더에 파일로 저장합니다. 일반 평문 파일보다 안전하지만 OS 사용자 계정 자체가 탈취된 상황까지 보호하는 것은 아닙니다.
