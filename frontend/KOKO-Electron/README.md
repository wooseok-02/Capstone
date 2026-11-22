# KOKO 코코 — Electron 데스크톱 펫 + 실제 소셜 OAuth API 연동 (v0.2.0)

사용자가 선택한 **코코 앱 심볼**, **1번 고양이 펫**을 사용한 Electron 앱입니다. 고양이를 클릭하면 회원가입/로그인 화면이 열리며, 팀의 `API_SPEC.csv` 명세에 맞춰 소셜 인증을 진행합니다.

> **중요:** 첨부된 API 명세에는 서버의 **BASE URL이 없습니다.** 실제 로그인 테스트를 하려면 백엔드 주소와 서버에 등록된 소셜 OAuth 제공자 설정이 필요합니다. 코드에는 가상의 서버 URL이나 가짜 로그인 성공 로직이 포함되어 있지 않습니다. 모의 백엔드 통합 테스트만 통과했습니다.

## 1. Windows에서 실행

1. Node.js LTS를 설치합니다. (PowerShell 또는 CMD: `node -v`, `npm -v`)
2. ZIP을 풀어 **`package.json`이 보이는 `KOKO_Electron_OAuth_v1` 폴더**를 엽니다.
3. 폴더 주소 표시줄에 `cmd`를 입력해 터미널을 엽니다.
4. 아래 명령어를 차례대로 실행합니다.

```bat
npm install
npm test
npm start
```

또는 프로젝트 폴더의 `실행하기.cmd`를 실행하면 의존성이 없을 때 설치 후 시작합니다.

5. 바탕화면 오른쪽 아래에 나타나는 **1번 고양이 코코**를 클릭합니다.
6. 로그인 화면의 **백엔드 서버** 칸에 팀에서 받은 API BASE URL을 입력하고 **저장**을 누릅니다. 예: `https://api.team-example.com` (이는 형식 예시일 뿐, 실제 주소가 아닙니다.)
7. 처음 시작하면 **회원가입** UI가 나오며, 이미 OAuth 로그인을 성공한 이 컴퓨터에서는 **로그인** UI가 나옵니다.
8. Google부터 시도합니다. 버튼을 누르면 Windows 기본 브라우저가 열립니다. 인증을 마치면 KOKO로 자동 복귀해 `/me` 회원 정보를 표시합니다.
9. 같은 구조로 네이버와 카카오도 테스트합니다.

**주의:** `file://` 또는 임의 HTTP 사이트를 백엔드로 입력할 수 없습니다. HTTPS만 허용하며 예외로 개발용 `http://localhost:PORT` / `http://127.0.0.1:PORT`를 지원합니다.

## 2. 백엔드 팀이 제공해야 하는 정보

- **필수:** API BASE URL (`https://...`)
- 해당 서버에 정상 구현된 `GET /auth/{provider}/start`, `POST /auth/exchange`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`
- 소셜 제공자 콘솔의 등록 정보(백엔드 설정), Google/Naver/Kakao 서버측 redirect URI
- 서버에서 Electron 로그인 완료 시 반드시 아래처럼 돌아오는지 확인:

```http
HTTP/1.1 302 Found
Location: http://127.0.0.1:<desktop_port>/oauth/callback?code=<ONE_TIME_CODE>
```

- 실패 시 `error=access_denied` 또는 `error=login_failed` 전달
- 웹 기본 인증 흐름과 Desktop 인증 흐름을 구분하여, Desktop에서는 원래 `code_verifier`로 PKCE 검증 후 교환하도록 구현

**인증 후 회신은 127.0.0.1로만 합니다.** 사용자에게 고정 callback 포트나 제공자별 Client Secret을 전달할 필요가 없습니다.

## 3. 인증 흐름 (첨부 API_SPEC.csv 반영)

```text
코코 고양이 클릭 → UI 버튼 Google 로그인
    ↓
64자 code_verifier 난수 생성 (CSPRNG)
SHA256(code_verifier) → Base64URL(패딩 없음) → 43자 desktop_challenge
    ↓
127.0.0.1:0 에 서버 바인딩 → OS가 빈 임시 포트 지정
    ↓
Windows 기본 브라우저로 접속
GET {BASE_URL}/auth/google/start?desktop_port=포트&desktop_challenge=챌린지
    ↓
백엔드 302 → Google 로그인 → 백엔드 /auth/google/callback
    ↓
백엔드 302 → http://127.0.0.1:임시포트/oauth/callback?code=ONE_TIME_CODE
    ↓
Electron에서 수신 후 로컬 HTTP 서버 즉시 종료
POST /auth/exchange {code, code_verifier}
    ↓
받은 Access Token은 앱 메모리에 보관
Refresh Token은 Electron safeStorage를 통해 Windows DPAPI로 보호하여 저장
    ↓
GET /me, Header Authorization: Bearer ACCESS_TOKEN
    ↓
코코 계정 화면에 provider/id/nickname/created_at 표시
```

- API의 `/auth/{provider}/start`는 **JSON API가 아닌 HTTP 302 브라우저 리다이렉트**입니다. `fetch()`로 로그인 URL을 받는 방식으로 구현하면 안 됩니다. 앱은 `shell.openExternal()`로 OS 기본 브라우저를 엽니다.
- 코드는 **2분 동안 일회용**이므로 콜백 직후 즉시 `/auth/exchange`를 호출합니다.
- `POST /auth/refresh` 호출 시 새 Access/Refresh Token을 **둘 다** 적용하고 저장합니다.
- 앱 재시작 시 저장한 Refresh Token으로 자동 로그인을 시도합니다. 앱 사용 중 Access Token 만료 전에도 백그라운드 갱신합니다.
- `POST /auth/logout`에 Refresh Token을 JSON으로 전달합니다. 서버 오류가 발생해도 사용자 기기의 로컬 토큰은 삭제합니다. 이 경우 서버 로그아웃을 확인하지 못했다고 안내합니다.
- 인증 취소/실패/시간 초과 시 루프백 리스너를 닫고 로그인 화면의 상태 안내를 갱신합니다.

## 4. 테스트

```bat
npm test
```

테스트 내용: PKCE 검증값, 서버 주소 검증, 세 제공자의 요청 URL, localhost 콜백 검증, 실제 HTTP 302 흐름을 흉내 내는 백엔드와의 인증 코드 교환, `/me`, 재시작 후 Refresh Token 갱신/회전, 로그아웃, 인증 취소, 코드 만료, Refresh 실패, 암호화 저장 어댑터.

> **테스트 통과 = 팀 서버 인증 성공은 아닙니다.** 로컬 테스트는 실제 Google/Naver/Kakao 계정이나 팀 서버를 호출하지 않습니다.

## 5. 개발 및 보안 유의사항

- **Windows 안전한 저장:** Electron `safeStorage`는 Windows DPAPI 기반 암호화를 사용합니다. 암호문은 사용자별 앱 데이터 디렉터리의 `koko-refresh-token.bin`에 저장됩니다. Access Token, OAuth verifier, one-time code는 파일이나 렌더러에 저장하지 않습니다. OS 안전 저장 사용 불가능 시 평문으로 내려가지 않고 로그인 오류로 처리합니다.
- **루프백:** 서버는 IPv4 `127.0.0.1`의 자동 할당 포트에만 바인딩합니다. 정확한 `/oauth/callback` 경로를 검증하고 완료/취소/시간 초과 후 닫습니다.
- **Electron:** `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`. Renderer에는 토큰을 넘기지 않고 최소한의 IPC만 노출합니다.
- **실제 회원가입:** 백엔드 API 명세에 따르면 `/auth/exchange`가 첫 로그인 시 자동 가입합니다. Electron의 최초 회원가입 화면은 **표시용 진입 안내**일 뿐, 사용자 계정을 로컬에서 직접 생성하지 않습니다. 최초 로그인 성공 기록은 화면 분기용일 뿐 인증 판정에 사용하지 않습니다.
- **약관 동의:** 팀에서 아직 확정되지 않았으므로 이번 OAuth 통합에서는 생략했습니다. 실제 출시 전에 개인정보 처리방침·수집/이용 동의에 관한 법적·제품 검토가 필요합니다.
- **알 수 없는 에러:** 백엔드 응답 형식이나 실제 엔드포인트 구현이 다르다면 `docs/API_SPEC.csv`를 기준으로 백엔드 팀과 조정하세요.
- **로그인 URL:** 소셜 제공자의 Client Secret은 앱에 포함하지 않습니다. 서버에서만 보관해야 합니다.
- **소셜 제공자 로그인 버튼:** 공급자 브랜드 컬러는 유지합니다.

## 6. Windows 설치 프로그램 만들기

Windows 컴퓨터에서:

```bat
npm install
npm run dist:win
```

성공하면 `dist/`에 NSIS Windows 설치 파일이 생성됩니다. 설치 후 바탕화면 바로가기 **코코 KOKO**를 실행하면 펫이 표시됩니다. 이 ZIP에는 **실행 파일(.exe)이 아니라 소스 프로젝트**가 들어 있습니다. 코드 서명되지 않은 설치 파일은 Windows 보안 경고가 나타날 수 있습니다.

## 7. 프로젝트 파일

```text
KOKO_Electron_OAuth_v1/
├─ assets/                    사용자 앱 심볼(.png/.ico), 1번 고양이(.png)
├─ renderer/                  데스크톱 펫, 회원가입·로그인·회원정보 화면
├─ lib/oauth-utils.js        PKCE·API URL 검증·응답 검증
├─ lib/loopback.js           127.0.0.1 임시 서버 및 콜백
├─ lib/api-client.js         /auth/exchange, /auth/refresh, /auth/logout, /me
├─ lib/token-store.js        OS 암호화 Refresh Token 저장
├─ lib/auth-service.js       OAuth 전체 상태 관리·자동 갱신·로그아웃
├─ docs/API_SPEC.csv         사용자가 첨부한 API 명세
├─ docs/FRONTEND_API_GUIDE.md 프론트엔드/백엔드 연동 협업 가이드
├─ test/oauth.test.js        테스트
├─ main.js                   Electron 메인 프로세스
├─ preload.js                최소 IPC 브리지
├─ package.json
└─ 실행하기.cmd
```
