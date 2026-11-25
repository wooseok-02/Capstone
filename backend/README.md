# Knowledge Pet 백엔드

> PC 폴더의 문서를 클라우드에서 분석해 **의미 기반으로 검색**하게 해 주는 데스크톱 앱 **Knowledge Pet**의 API 서버

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](#로컬-실행)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](#로컬-실행)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-DB-4169E1?logo=postgresql&logoColor=white)](sql/001_initial.sql)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white)](#기술-스택)
[![Electron](https://img.shields.io/badge/Client-Electron-47848F?logo=electron&logoColor=white)](#electron-앱-연결)

<br>

> **"서버는 사용자의 디스크를 보지 않는다."**
>
> 폴더 탐색, 로컬 파일 확인과 열기는 모두 **Electron이 사용자 PC에서** 수행합니다.
> 서버는 인증과 소유권 검사, ID 발급, URL 서명, 검색 데이터 관리만 맡습니다.
> 제외한 폴더의 파일은 업로드와 임베딩 **전에** 걸러지며 서버로 전송되지 않습니다.

---

## 목차

- [폴더 구조](#폴더-구조)
- [빠른 시작](#빠른-시작)
- [서비스 개요](#서비스-개요)
- [기술 스택](#기술-스택)
- [API 요약](#api-요약)
- [로컬 실행](#로컬-실행)
- [가입과 로그인 확인](#가입과-로그인-확인)
- [Electron 앱 연결](#electron-앱-연결)
- [토큰 갱신과 로그아웃 확인](#토큰-갱신과-로그아웃-확인)
- [문서 지도](#문서-지도)
- [협업 규칙](#협업-규칙)

---

## 폴더 구조

```
backend/
├── app/
│   ├── main.py          # FastAPI 앱, 라우터 등록
│   ├── config.py        # 환경 변수 로드
│   ├── database.py      # PostgreSQL 연결
│   ├── core/            # 토큰, 인증 의존성, 경로 검증, R2 서명(storage), AI 호출(ai_client)
│   ├── models/          # 내부 데이터 구조
│   ├── routers/         # API 엔드포인트 (auth, users, devices, folders, documents)
│   ├── schemas/         # 요청·응답 모델
│   └── services/        # 비즈니스 로직과 SQL
├── docs/
│   └── API.md           # 기기·폴더·문서·검색 API 명세
├── sql/
│   └── 001_initial.sql  # 초기 DB 스키마
├── .env.example         # 환경 변수 예시
├── Dockerfile           # API 서버 이미지
├── docker-compose.yml   # 로컬용 API + PostgreSQL + Adminer 구성
└── requirements.txt
```

---

## 빠른 시작

<table>
<tr>
<th>🐳 Docker (권장)</th>
<th>🐍 Python 직접 실행</th>
</tr>
<tr>
<td valign="top">

```powershell
cd backend
Copy-Item .env.example .env
docker compose up --build
```

→ [Docker로 실행](#docker로-실행)

</td>
<td valign="top">

```powershell
.\backend\.venv\Scripts\python.exe `
  -m uvicorn backend.app.main:app `
  --port 8000 --no-access-log
```

→ [Python으로 실행](#python으로-실행)

</td>
</tr>
</table>

Docker를 쓰면 PostgreSQL 설치와 스키마 실행이 자동으로 처리됩니다. 두 방법 모두 `.env`의 `JWT_SECRET`은 직접 입력해야 합니다.

서버가 켜지면 `http://localhost:8000/docs`에서 Swagger 문서로 API를 바로 호출할 수 있습니다.

---

## 서비스 개요

| 항목 | 내용 |
| --- | --- |
| 서비스명 | Knowledge Pet (2026-2 캡스톤디자인) |
| 클라이언트 | Electron 데스크톱 앱 |
| 로컬 Base URL | `http://localhost:8000` |
| 구현된 기능 | 소셜 로그인(Google · Naver · Kakao), Electron 로그인 연동, 토큰 갱신·로그아웃, 기기 등록, 폴더 등록·조회·연결 해제, 제외 폴더 설정, 재탐색 요청, 문서 업로드(R2 Presigned URL), AI 분석 연동, 의미 기반 검색, 기기별 문서 경로, 다운로드 |
| 연동 상태 | 원본 저장은 Cloudflare R2, 문서 분석은 Modal AI 서버(`/upload`)와 실제 연결 확인. 검색은 AI 서버에 검색어 임베딩 API가 추가되면 사용 가능 |

---

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 백엔드 | FastAPI · Python 3.11+ · PyJWT · httpx · boto3 |
| DB | PostgreSQL (psycopg 3) · pgvector |
| 원본 저장 | Cloudflare R2 비공개 버킷 (S3 호환 Presigned URL) |
| 인증 | 소셜 OAuth · Access/Refresh Token · Electron 루프백 + PKCE 방식 코드 교환 |
| 문서 처리 | LangChain · Unstructured · 외부 임베딩 API (AI 담당) |
| 데스크톱 | Electron · React · TypeScript (프론트엔드 담당) |

---

## API 요약

### 회원가입 및 로그인

| API | 역할 |
| --- | --- |
| `GET /auth/{provider}/start` | `google`, `naver`, `kakao` 중 선택한 제공자의 로그인 화면으로 이동합니다. |
| `GET /auth/{provider}/callback` | 소셜 인증을 확인합니다. 브라우저 로그인에는 토큰을 반환하고, Electron 로그인에는 루프백 주소로 일회용 코드를 보냅니다. |
| `POST /auth/exchange` | Electron이 일회용 코드와 검증값을 보내면 로그인 토큰을 반환합니다. 첫 로그인이라면 회원을 생성합니다. |
| `POST /auth/refresh` | Refresh Token을 보내면 새 Access Token과 Refresh Token을 반환합니다. |
| `POST /auth/logout` | Refresh Token을 보낸 현재 세션을 종료하고 `204`를 반환합니다. |
| `GET /me` | Access Token과 로그인 세션을 확인하고 회원 ID, 소셜 로그인 제공자, 닉네임, 가입 시각을 반환합니다. |

### 기기 및 폴더

요청 형식, 응답 예시, 오류 코드는 [API 명세서](docs/API.md)에 정리되어 있습니다.

| API | 역할 |
| --- | --- |
| `POST /api/v1/devices` | 앱 첫 실행 시 기기 ID를 발급해 계정과 연결합니다. |
| `POST /api/v1/folders` | 내 기기의 폴더를 등록하고 `folder_id`를 발급합니다. |
| `GET /api/v1/folders` | 내 폴더 목록을 조회합니다. |
| `GET /api/v1/folders/{folder_id}` | 폴더 정보, 기기별 위치, 제외 경로를 조회합니다. |
| `PUT /api/v1/folders/{folder_id}/exclusions` | 제외 폴더 목록 전체를 교체합니다. |
| `GET /api/v1/folders/{folder_id}/exclusions` | 저장된 제외 폴더를 조회합니다. |
| `POST /api/v1/folders/{folder_id}/rescan` | 재탐색 요청 식별자를 발급합니다. |
| `DELETE /api/v1/folders/{folder_id}` | 폴더와 기기의 연결을 해제합니다. |
| `GET /api/v1/folders/{folder_id}/documents` | 폴더의 문서와 최신 버전 상태를 조회합니다. |

### 문서·검색

| API | 역할 |
| --- | --- |
| `POST /api/v1/documents` | 파일을 문서로 등록하고 R2 업로드 URL을 발급합니다. 같은 파일을 다시 보내면 기존 버전을 돌려줍니다. |
| `POST /api/v1/documents/{document_id}/upload-complete` | R2 업로드를 확인하고 AI 분석을 시작합니다. |
| `GET /api/v1/documents/{document_id}` | 문서와 버전별 상태(분석 진행 상황)를 조회합니다. |
| `POST /api/v1/search` | 검색어와 의미가 가까운 청크를 찾습니다. |
| `GET`·`PUT /api/v1/documents/{document_id}/locations/{device_id}` | 기기별 문서 경로를 조회·갱신합니다. |
| `POST /api/v1/documents/{document_id}/download-url` | 원본을 받을 R2 다운로드 URL을 발급합니다. |
| `DELETE /api/v1/documents/{document_id}` | 문서와 버전·청크·경로, R2 원본을 모두 지웁니다. 파일 삭제·이동·이름 변경 시 호출합니다. |

---

## 로컬 실행

Docker와 Python 직접 실행 중 하나를 고릅니다. 소셜 로그인 설정은 두 방법이 같습니다.

### Docker로 실행

[Docker Desktop](https://www.docker.com/products/docker-desktop/)을 설치하고 실행해 둡니다. 아래 명령은 `backend` 폴더의 PowerShell에서 실행합니다.

```powershell
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

출력된 난수를 `.env`의 `JWT_SECRET`에 입력한 뒤 서버와 DB를 함께 켭니다.

```powershell
docker compose up --build
```

| 서비스 | 주소 | 설명 |
| --- | --- | --- |
| `api` | `http://localhost:8000` | FastAPI 서버 |
| `db` | `127.0.0.1:5432` | PostgreSQL 17 (pgvector 포함) |
| `adminer` | `http://localhost:8080` | 브라우저에서 DB를 보는 관리 도구 |

compose 프로젝트 이름은 `knowledge-pet`으로 고정되어 있어, 컨테이너는 `knowledge-pet-api-1`, `knowledge-pet-db-1`로 만들어집니다. 다른 프로젝트의 `backend` 폴더와 이름이 겹치지 않습니다.

- **DB 주소:** 컨테이너 안에서는 `DATABASE_URL`이 자동으로 `db` 컨테이너를 가리킵니다. `.env`의 `DATABASE_URL`은 바꾸지 않아도 됩니다.
- **스키마:** `sql/001_initial.sql`은 DB 볼륨이 **처음 만들어질 때만** 자동 실행됩니다. 이미 만든 DB에 새 테이블을 추가하려면 데이터를 지우지 않는 아래 명령을 한 번 실행합니다.

  ```powershell
  Get-Content sql/001_initial.sql -Raw -Encoding utf8 | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U pet -d knowledge_pet
  ```
- **포트 충돌:** PC에 이미 PostgreSQL이 `5432`에서 실행 중이면 `db` 컨테이너가 켜지지 않습니다. 기존 PostgreSQL을 끄고 다시 실행하세요.
- **코드 변경:** 코드를 고친 뒤에는 `docker compose up --build`로 이미지를 다시 만들어야 반영됩니다.

#### DB를 화면으로 보기

`http://localhost:8080`을 열고 아래 값으로 로그인하면 테이블 목록과 데이터를 클릭해서 볼 수 있습니다. 왼쪽 메뉴에서 테이블 이름 옆의 **선택**을 누르면 행이 표시되고, **SQL 명령**에서 직접 쿼리를 실행할 수 있습니다.

| 항목 | 값 |
| --- | --- |
| 데이터베이스 형식 | PostgreSQL |
| 서버 | `db` |
| 사용자이름 | `pet` (`POSTGRES_USER`) |
| 비밀번호 | `local-dev-password` (`POSTGRES_PASSWORD`) |
| 데이터베이스 | `knowledge_pet` (`POSTGRES_DB`) |

괄호 안의 환경 변수를 `.env`에 지정했다면 그 값을 사용합니다. 서버 칸에는 `localhost`가 아니라 compose 서비스 이름인 `db`를 입력해야 합니다. Adminer에서 데이터를 수정하면 실제 DB가 바뀌므로 조회 용도로 쓰는 것을 권장합니다.

DBeaver 같은 데스크톱 DB 도구를 쓴다면 호스트 `127.0.0.1`, 포트 `5432`에 같은 계정으로 접속하면 됩니다.

#### 자주 쓰는 명령

자주 쓰는 명령은 다음과 같습니다.

```powershell
docker compose down
```

```powershell
docker compose down -v
```

`down`은 컨테이너만 끄고 DB 데이터는 보존합니다. `down -v`는 **DB 데이터를 모두 삭제**하며, 다음 실행 때 최신 `001_initial.sql`로 DB가 새로 만들어집니다. 스키마가 바뀌었을 때 사용합니다.

### Python으로 실행

아래 명령은 프로젝트 최상위 폴더의 PowerShell에서 실행합니다. Python 3.11 이상과 PostgreSQL 13 이상이 필요합니다.

```powershell
py -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
.\backend\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
```

`backend/.env`의 `DATABASE_URL`을 로컬 PostgreSQL의 접속 주소로 바꾸고, 위 명령이 출력한 난수를 `JWT_SECRET`에 입력합니다. `.env`는 Git에서 제외됩니다. DB 준비는 아래 [DB 준비와 서버 실행](#db-준비와-서버-실행)을 따릅니다.

### R2·AI 서버 설정

문서 API를 쓰려면 `.env`에 아래 값을 채우고 서버를 다시 켭니다. 비어 있으면 문서 업로드·다운로드는 `503`, 검색은 `503`을 반환하고, AI 서버만 비어 있으면 업로드는 `uploaded` 상태에서 멈춥니다.

| 변수 | 값 |
| --- | --- |
| `R2_ENDPOINT_URL` | `https://<계정ID>.r2.cloudflarestorage.com` (R2 Overview의 Account ID) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 → Manage R2 API Tokens에서 **Object Read & Write**, 사용할 버킷 하나로 범위를 정해 만든 키 |
| `R2_BUCKET` | 버킷 이름. 버킷은 **비공개**로 둡니다. |
| `AI_PROCESS_URL` | AI 서버 주소 뒤에 `/upload`를 붙인 문서 처리 주소 (예: `https://<AI 서버>.modal.run/upload`). 주소는 AI 담당에게 받습니다 |
| `AI_EMBED_URL` | 검색어 임베딩 주소. AI 서버에 아직 없어 비워 두면 검색만 `503`입니다 |
| `AI_INTERNAL_TOKEN` | 백엔드와 AI 서버가 함께 쓰는 내부 토큰 (`secrets.token_urlsafe(32)`로 생성). 비어 있으면 AI를 호출하지 않습니다. 현재 AI 서버는 토큰을 검사하지 않으므로 임의 값으로도 동작합니다 |

업로드 후 `uploaded`에서 멈춘 문서는 AI 설정을 넣고 서버를 다시 켠 뒤 `upload-complete`를 다시 보내면 분석됩니다. Docker는 `.env`를 컨테이너를 만들 때 읽으므로 값을 바꾼 뒤 `docker compose up -d --force-recreate api`로 다시 만듭니다.

URL 유효 시간과 업로드 크기 제한은 `.env.example`의 임시 기본값을 따릅니다. Electron 렌더러에서 `fetch`로 R2에 직접 PUT·GET한다면 버킷 Settings → CORS Policy에서 해당 메서드를 허용해야 합니다.

### 소셜 로그인 설정

테스트할 제공자의 설정만 채워도 됩니다. 해당 제공자의 설정이 비어 있다면 로그인 시작 API에서 `503`을 반환합니다.

<details>
<summary><b>Google</b></summary>

Google Cloud에서 **웹 애플리케이션** 유형의 OAuth 클라이언트를 만들고 `http://localhost:8000/auth/google/callback`을 승인된 리디렉션 URI로 등록합니다. 클라이언트 ID와 비밀번호를 `.env`의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 각각 입력합니다. 테스트 모드라면 로그인에 쓸 Google 계정을 테스트 사용자로 추가합니다. [Google 설정 안내](https://developers.google.com/identity/openid-connect/openid-connect)

</details>

<details>
<summary><b>Naver</b></summary>

Naver Developers에서 **네이버 로그인**을 사용하는 애플리케이션을 등록합니다. 웹 서비스 주소로 `http://localhost:8000`을, 콜백 URL로 `http://localhost:8000/auth/naver/callback`을 설정합니다. `.env`에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_REDIRECT_URI`를 입력하고 서버를 다시 켭니다. 개발 중이라면 테스트에 사용할 계정에 로그인 권한이 있는지 확인합니다. [네이버 애플리케이션 설정 안내](https://developers.naver.com/docs/login/devguide/devguide.md)

</details>

<details>
<summary><b>Kakao</b></summary>

Kakao Developers에서 앱을 등록하고 **카카오 로그인** 사용 설정을 켭니다. 앱의 REST API 키에 리다이렉트 URI `http://localhost:8000/auth/kakao/callback`을 등록합니다. `.env`의 `KAKAO_CLIENT_ID`에는 REST API 키를, `KAKAO_CLIENT_SECRET`에는 활성화된 클라이언트 시크릿을, `KAKAO_REDIRECT_URI`에는 등록한 주소를 넣고 서버를 다시 켭니다. 프로필 닉네임을 쓰려면 카카오 로그인 동의항목에서 닉네임 조회를 설정합니다. 닉네임을 받지 못하면 `null`로 저장됩니다. [카카오 로그인 설정 안내](https://developers.kakao.com/docs/ko/kakaologin/prerequisite)

</details>

### DB 준비와 서버 실행

Docker로 실행한다면 이 과정은 자동으로 처리되므로 건너뜁니다. 테이블 구성은 Docker도 같습니다.

새 로컬 DB에서는 `001_initial.sql` 하나를 실행합니다. 배포 전에는 DB 구조 변경을 이 파일에 모읍니다. `psql` 대신 PostgreSQL 관리 도구에서 같은 파일을 실행해도 됩니다.

| 테이블 | 용도 |
| --- | --- |
| `users`, `refresh_token`, `used_refresh_tokens` | 회원과 로그인 세션 |
| `desktop_login_codes` | Electron 로그인 일회용 코드 |
| `devices` | 사용자가 앱을 설치한 기기 |
| `folders`, `folder_locations` | 등록한 폴더와 기기별 폴더 위치 |
| `folder_exclusions` | 폴더 루트 기준 제외 경로 |
| `documents`, `document_versions` | 문서와 버전별 R2 위치(`object_key`)·처리 상태 |
| `document_locations` | 기기별 문서 경로 |
| `chunks` | 청크 텍스트와 임베딩 벡터 (pgvector) |

기존 DB에도 같은 파일을 다시 실행하면 없는 테이블만 추가됩니다. `chunks`는 pgvector 확장이 필요하므로, Docker를 쓰지 않는다면 PostgreSQL에 pgvector를 먼저 설치합니다.

```powershell
psql -h 127.0.0.1 -U pet -d knowledge_pet -v ON_ERROR_STOP=1 -f backend/sql/001_initial.sql
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --port 8000 --no-access-log
```

`psql` 예시는 `pet` 사용자와 `knowledge_pet` DB가 이미 만들어져 있다고 가정합니다. 요청 로그를 끄는 옵션은 인증 콜백 URL에 들어오는 코드를 로그에 남기지 않기 위해 사용합니다. 브라우저 주소에는 `localhost`를 사용해야 로그인 시작과 콜백에서 같은 쿠키를 사용할 수 있습니다.

`001_initial.sql`은 새 DB의 기본 구조를 만드는 파일입니다. 이전 구조의 DB에서 최신 구조로 테스트해야 한다면 새 이름으로 DB를 만들고 `DATABASE_URL`을 그 주소로 바꾸세요. 예를 들어 기존 `knowledge_pet` DB를 보존하면서 `knowledge_pet_dev`를 새로 만들 수 있습니다.

---

## 가입과 로그인 확인

1. 브라우저 주소창에서 `http://localhost:8000/auth/{provider}/start`의 `{provider}`를 `google`, `naver`, `kakao` 중 하나로 바꿔 열고 로그인합니다. 처음 로그인한 계정은 자동으로 가입되며, 인증이 끝나면 화면에 `access_token`과 `refresh_token`이 표시됩니다.
2. `http://localhost:8000/docs`를 열고 위쪽의 **Authorize**에 `access_token` 값만 넣습니다. `GET /me`를 실행해 응답의 `id`를 확인합니다. 테스트 토큰은 다른 사람과 공유하지 않습니다.
3. 같은 소셜 계정으로 다시 로그인하고, 새 Access Token으로 `GET /me`를 실행했을 때 같은 `id`가 나오는지 확인합니다. Kakao로 로그인했다면 `provider`는 `KAKAO`로 표시됩니다.

같은 방식으로 **Authorize**를 마친 뒤 `/docs`에서 기기와 폴더 API도 호출할 수 있습니다.

---

## Electron 앱 연결

1. Electron은 `127.0.0.1`에서 운영체제가 배정한 포트를 열고 `GET /oauth/callback`을 기다립니다. 이 리스너는 로그인 결과를 받거나 로그인 시도가 끝나면 닫습니다.
2. Electron은 로그인할 때마다 임의의 검증값을 만듭니다. 예를 들어 32바이트 난수를 Base64URL로 인코딩하면 43자리 검증값이 됩니다. 이 문자열을 SHA-256으로 해시하고, 결과를 끝의 `=` 없이 Base64URL로 인코딩해 `desktop_challenge`로 사용합니다. 원래 검증값은 앱에서 보관합니다.
3. 기본 브라우저에서 `http://localhost:8000/auth/{provider}/start?desktop_port=<포트>&desktop_challenge=<해시>`를 엽니다. `{provider}`에는 `google`, `naver`, `kakao` 중 하나를 넣습니다. 소셜 인증이 끝나면 FastAPI가 브라우저를 `http://127.0.0.1:<포트>/oauth/callback?code=<일회용 코드>`로 보냅니다. 사용자가 동의를 취소하면 `error=access_denied`를 받고, 인증에 실패하면 `error=login_failed`를 받습니다.
4. Electron의 백엔드 요청에서 `POST /auth/exchange`에 `{"code":"받은 코드","code_verifier":"보관한 원래 검증값"}`을 JSON으로 보냅니다. 백엔드는 코드에 저장해 둔 제공자와 소셜 계정 ID로 회원을 찾아 토큰 두 개를 발급합니다. 코드는 2분 동안 유효하며 한 번만 교환할 수 있습니다.
5. 로그인한 뒤 앱 첫 실행이라면 `POST /api/v1/devices`로 기기 ID를 발급받아 보관합니다. 이후 폴더 등록과 재탐색 요청에 이 `device_id`를 사용합니다.
6. 제외 규칙을 적용한 파일마다 `POST /api/v1/documents` → 응답의 `upload_url`로 PUT(`upload_headers` 그대로) → `upload-complete` 순으로 호출합니다. 자세한 흐름은 [API 명세서](docs/API.md#문서)에 있습니다.

여기서 루프백은 사용자의 PC에서 브라우저와 Electron이 통신하는 주소입니다. 배포 환경에서는 Electron이 HTTPS 백엔드에 코드 교환을 요청합니다.

---

## 토큰 갱신과 로그아웃 확인

로그인하면 `access_token`과 `refresh_token`을 받습니다. Access Token은 보호된 API에 쓰고, Refresh Token은 로그인 상태를 이어가거나 종료할 때 씁니다. Access Token의 유효기간은 15분이고, 세션 자체는 최초 로그인부터 최대 14일 동안 유지됩니다. 이전 버전에서 발급받은 Access Token이 있다면 다시 로그인해 세션이 연결된 토큰을 받으세요.

1. `/docs`에서 `POST /auth/refresh`를 열고 로그인 응답의 `refresh_token`을 아래 형식으로 전송합니다. 응답으로 받은 새 토큰 두 개를 사용하세요. 갱신 요청은 한 번에 하나씩 보냅니다. 이미 교체된 Refresh Token으로 다시 갱신을 요청하면 그 세션이 종료되어 다시 로그인해야 합니다. [토큰 교체와 재사용 처리](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)

   ```json
   {
     "refresh_token": "로그인_또는_직전_갱신에서_받은_값"
   }
   ```

2. `POST /auth/logout`에 같은 형식으로 현재 Refresh Token을 전송합니다. `204`가 나오면 해당 세션은 종료된 상태입니다. 같은 요청을 다시 보내도 `204`가 반환됩니다.
3. 방금 로그아웃한 세션의 Access Token으로 `/me`나 기기·폴더 API를 호출하면 `401`이 나옵니다. 같은 회원으로 따로 로그인해 둔 다른 세션의 Access Token은 계속 사용할 수 있습니다.

---

## 문서 지도

| 문서 | 설명 |
| --- | --- |
| [docs/API.md](docs/API.md) | 기기·폴더·문서·검색 API 명세 (요청, 응답, 오류, 상태 흐름, AI 연동 형식) |
| [sql/001_initial.sql](sql/001_initial.sql) | 전체 DB 스키마 |
| [.env.example](.env.example) | 필요한 환경 변수 목록 |
| [docker-compose.yml](docker-compose.yml) | 로컬 Docker 구성 (API + PostgreSQL + Adminer) |
| `http://localhost:8080` | 서버 실행 중 DB를 화면으로 보는 Adminer |
| `http://localhost:8000/docs` | 서버 실행 중 확인하는 Swagger 문서 |

아키텍처·워크플로, 백엔드 ↔ AI 연동 설계는 팀 노션 문서에 있습니다.

---

## 협업 규칙

- **브랜치:** `main`은 최종 배포, `dev`는 개발자 공유 브랜치입니다. 각자 `feature/*` 브랜치를 만들어 작업합니다.
- **커밋 메시지:** `타입: 설명` 형식으로 쓰며 괄호 범위는 붙이지 않습니다. 예: `feat: 폴더 등록 API 추가`, `fix: 토큰 갱신 오류 수정`, `docs: 실행 방법 정리`
- **비밀값:** R2 키, DB 접속 정보, 내부 토큰은 `.env`에만 둡니다. 코드, 커밋, Electron 번들에 넣지 않습니다.
- **보안:** `user_id`는 요청 본문이 아니라 Access Token에서 꺼내고, 모든 요청에서 기기·폴더·문서 소유권을 검사합니다.
- **로그:** Presigned URL, 문서 본문, 전체 로컬 경로를 로그에 남기지 않습니다.
- **문서화:** 실행 방법이나 설정이 바뀌면 이 README를, API가 바뀌면 [docs/API.md](docs/API.md)를 함께 갱신합니다.
