# Knowledge Pet 백엔드

Google, Naver, Kakao 계정으로 가입하거나 로그인할 수 있습니다. 로그인한 뒤에는 토큰을 갱신하거나 현재 세션을 종료할 수 있습니다.

| API | 역할 |
| --- | --- |
| `GET /auth/{provider}/start` | `google`, `naver`, `kakao` 중 선택한 제공자의 로그인 화면으로 이동합니다. |
| `GET /auth/{provider}/callback` | 소셜 인증을 확인합니다. 브라우저 로그인에는 토큰을 반환하고, Electron 로그인에는 루프백 주소로 일회용 코드를 보냅니다. |
| `POST /auth/exchange` | Electron이 일회용 코드와 검증값을 보내면 로그인 토큰을 반환합니다. 첫 로그인이라면 회원을 생성합니다. |
| `POST /auth/refresh` | Refresh Token을 보내면 새 Access Token과 Refresh Token을 반환합니다. |
| `POST /auth/logout` | Refresh Token을 보낸 현재 세션을 종료하고 `204`를 반환합니다. |
| `GET /me` | Access Token과 로그인 세션을 확인하고 회원 ID, 소셜 로그인 제공자, 닉네임, 가입 시각을 반환합니다. |
| `/api/v1/devices`, `/api/v1/folders` | 기기와 폴더를 등록하고 제외 폴더를 관리합니다. 자세한 내용은 [API 명세서](docs/API.md)를 참고하세요. |

## 로컬 실행

아래 명령은 프로젝트 최상위 폴더의 PowerShell에서 실행합니다. Python 3.11 이상과 로컬 PostgreSQL이 필요합니다.

```powershell
py -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
.\backend\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
```

`backend/.env`의 `DATABASE_URL`을 로컬 PostgreSQL의 접속 주소로 바꾸고, 위 명령이 출력한 난수를 `JWT_SECRET`에 입력합니다. `.env`는 Git에서 제외됩니다.

Google Cloud에서 **웹 애플리케이션** 유형의 OAuth 클라이언트를 만들고 `http://localhost:8000/auth/google/callback`을 승인된 리디렉션 URI로 등록합니다. 클라이언트 ID와 비밀번호를 `.env`의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 각각 입력합니다. 테스트 모드라면 로그인에 쓸 Google 계정을 테스트 사용자로 추가합니다. [Google 설정 안내](https://developers.google.com/identity/openid-connect/openid-connect)

Naver Developers에서 **네이버 로그인**을 사용하는 애플리케이션을 등록합니다. 웹 서비스 주소로 `http://localhost:8000`을, 콜백 URL로 `http://localhost:8000/auth/naver/callback`을 설정합니다. `.env`에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_REDIRECT_URI`를 입력하고 서버를 다시 켭니다. 개발 중이라면 테스트에 사용할 계정에 로그인 권한이 있는지 확인합니다. [네이버 애플리케이션 설정 안내](https://developers.naver.com/docs/login/devguide/devguide.md)

Kakao Developers에서 앱을 등록하고 **카카오 로그인** 사용 설정을 켭니다. 앱의 REST API 키에 리다이렉트 URI `http://localhost:8000/auth/kakao/callback`을 등록합니다. `.env`의 `KAKAO_CLIENT_ID`에는 REST API 키를, `KAKAO_CLIENT_SECRET`에는 활성화된 클라이언트 시크릿을, `KAKAO_REDIRECT_URI`에는 등록한 주소를 넣고 서버를 다시 켭니다. 프로필 닉네임을 쓰려면 카카오 로그인 동의항목에서 닉네임 조회를 설정합니다. 닉네임을 받지 못하면 `null`로 저장됩니다. [카카오 로그인 설정 안내](https://developers.kakao.com/docs/ko/kakaologin/prerequisite)

테스트할 제공자의 설정만 채워도 됩니다. 해당 제공자의 설정이 비어 있다면 로그인 시작 API에서 `503`을 반환합니다.

새 로컬 DB에서는 `001_initial.sql` 하나를 실행합니다. 배포 전에는 DB 구조 변경을 이 파일에 모읍니다. `psql` 대신 PostgreSQL 관리 도구에서 같은 파일을 실행해도 됩니다.

새 DB에는 회원과 세션을 저장하는 `users`, `refresh_token`, `used_refresh_tokens`, Electron 일회용 코드를 관리하는 `desktop_login_codes`, 기기와 폴더를 관리하는 `devices`, `folders`, `folder_locations`, `folder_exclusions`가 생성됩니다. 기존 DB에도 같은 파일을 다시 실행하면 없는 테이블만 추가됩니다.

```powershell
psql -h 127.0.0.1 -U pet -d knowledge_pet -v ON_ERROR_STOP=1 -f backend/sql/001_initial.sql
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --port 8000 --no-access-log
```

`psql` 예시는 `pet` 사용자와 `knowledge_pet` DB가 이미 만들어져 있다고 가정합니다. 요청 로그를 끄는 옵션은 인증 콜백 URL에 들어오는 코드를 로그에 남기지 않기 위해 사용합니다. 브라우저 주소에는 `localhost`를 사용해야 로그인 시작과 콜백에서 같은 쿠키를 사용할 수 있습니다.

`001_initial.sql`은 새 DB의 기본 구조를 만드는 파일입니다. 이전 구조의 DB에서 최신 구조로 테스트해야 한다면 새 이름으로 DB를 만들고 `DATABASE_URL`을 그 주소로 바꾸세요. 예를 들어 기존 `knowledge_pet` DB를 보존하면서 `knowledge_pet_dev`를 새로 만들 수 있습니다.

## 가입과 로그인 확인

1. 브라우저 주소창에서 `http://localhost:8000/auth/{provider}/start`의 `{provider}`를 `google`, `naver`, `kakao` 중 하나로 바꿔 열고 로그인합니다. 처음 로그인한 계정은 자동으로 가입되며, 인증이 끝나면 화면에 `access_token`과 `refresh_token`이 표시됩니다.
2. `http://localhost:8000/docs`를 열고 위쪽의 **Authorize**에 `access_token` 값만 넣습니다. `GET /me`를 실행해 응답의 `id`를 확인합니다. 테스트 토큰은 다른 사람과 공유하지 않습니다.
3. 같은 소셜 계정으로 다시 로그인하고, 새 Access Token으로 `GET /me`를 실행했을 때 같은 `id`가 나오는지 확인합니다. Kakao로 로그인했다면 `provider`는 `KAKAO`로 표시됩니다.

## Electron 앱 연결

1. Electron은 `127.0.0.1`에서 운영체제가 배정한 포트를 열고 `GET /oauth/callback`을 기다립니다. 이 리스너는 로그인 결과를 받거나 로그인 시도가 끝나면 닫습니다.
2. Electron은 로그인할 때마다 임의의 검증값을 만듭니다. 예를 들어 32바이트 난수를 Base64URL로 인코딩하면 43자리 검증값이 됩니다. 이 문자열을 SHA-256으로 해시하고, 결과를 끝의 `=` 없이 Base64URL로 인코딩해 `desktop_challenge`로 사용합니다. 원래 검증값은 앱에서 보관합니다.
3. 기본 브라우저에서 `http://localhost:8000/auth/{provider}/start?desktop_port=<포트>&desktop_challenge=<해시>`를 엽니다. `{provider}`에는 `google`, `naver`, `kakao` 중 하나를 넣습니다. 소셜 인증이 끝나면 FastAPI가 브라우저를 `http://127.0.0.1:<포트>/oauth/callback?code=<일회용 코드>`로 보냅니다. 사용자가 동의를 취소하면 `error=access_denied`를 받고, 인증에 실패하면 `error=login_failed`를 받습니다.
4. Electron의 백엔드 요청에서 `POST /auth/exchange`에 `{"code":"받은 코드","code_verifier":"보관한 원래 검증값"}`을 JSON으로 보냅니다. 백엔드는 코드에 저장해 둔 제공자와 소셜 계정 ID로 회원을 찾아 토큰 두 개를 발급합니다. 코드는 2분 동안 유효하며 한 번만 교환할 수 있습니다.

여기서 루프백은 사용자의 PC에서 브라우저와 Electron이 통신하는 주소입니다. 배포 환경에서는 Electron이 HTTPS 백엔드에 코드 교환을 요청합니다.

## 토큰 갱신과 로그아웃 확인

로그인하면 `access_token`과 `refresh_token`을 받습니다. Access Token은 `/me`에 쓰고, Refresh Token은 로그인 상태를 이어가거나 종료할 때 씁니다. Access Token의 유효기간은 15분이고, 세션 자체는 최초 로그인부터 최대 14일 동안 유지됩니다. 이전 버전에서 발급받은 Access Token이 있다면 다시 로그인해 세션이 연결된 토큰을 받으세요.

1. `/docs`에서 `POST /auth/refresh`를 열고 로그인 응답의 `refresh_token`을 아래 형식으로 전송합니다. 응답으로 받은 새 토큰 두 개를 사용하세요. 갱신 요청은 한 번에 하나씩 보냅니다. 이미 교체된 Refresh Token으로 다시 갱신을 요청하면 그 세션이 종료되어 다시 로그인해야 합니다. [토큰 교체와 재사용 처리](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)

   ```json
   {
     "refresh_token": "로그인_또는_직전_갱신에서_받은_값"
   }
   ```

2. `POST /auth/logout`에 같은 형식으로 현재 Refresh Token을 전송합니다. `204`가 나오면 해당 세션은 종료된 상태입니다. 같은 요청을 다시 보내도 `204`가 반환됩니다.
3. 방금 로그아웃한 세션의 Access Token으로 `/me`를 호출하면 `401`이 나옵니다. 같은 회원으로 따로 로그인해 둔 다른 세션의 Access Token은 계속 사용할 수 있습니다.
