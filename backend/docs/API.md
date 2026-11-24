# Knowledge Pet API 명세서

기기 등록, 폴더 지정, 문서 업로드·검색·다운로드 API의 명세입니다. 소셜 로그인 API는 [백엔드 README](../README.md)를 참고하세요.

## 공통 규칙

| 항목 | 내용 |
| --- | --- |
| 로컬 Base URL | `http://localhost:8000` |
| 인증 | 모든 API에 `Authorization: Bearer <access_token>` 필요 |
| 형식 | 요청과 응답 본문은 `application/json` |
| ID | `device_id`, `folder_id`, `scan_id`, `document_id`, `chunk_id`는 UUID |
| 시각 | ISO 8601 형식이며 시간대를 포함 |
| 캐시 | 응답에 `Cache-Control: no-store` 포함 |

`user_id`는 요청 본문으로 받지 않고 Access Token에서 꺼냅니다. 로그아웃했거나 만료된 세션의 토큰은 거부합니다.

### 공통 오류

| 상태 | 의미 |
| --- | --- |
| `401` | Access Token이 없거나, 유효하지 않거나, 세션이 종료됨 |
| `404` | 대상이 없거나 **다른 계정의 소유**임 |
| `409` | 같은 기기에 이미 등록된 폴더, 업로드가 확인되지 않은 버전 다운로드 |
| `413` | 업로드 크기 제한 초과 |
| `422` | 요청 형식 또는 경로 검증 실패, 제외된 폴더의 파일 등록 |
| `502` | R2 또는 AI 서버 응답 실패 |
| `503` | R2 또는 AI 서버 설정이 비어 있음 |

다른 계정의 기기·폴더·문서는 존재 여부가 드러나지 않도록 `403` 대신 `404`로 응답합니다. 검색은 내 문서만 대상으로 하므로 다른 계정의 문서는 결과에 나오지 않습니다.

```json
{ "detail": "폴더를 찾을 수 없습니다." }
```

## API 목록

| 기능 | 메서드 | 경로 | 성공 |
| --- | --- | --- | --- |
| 기기 등록 | `POST` | `/api/v1/devices` | `201` |
| 폴더 등록 | `POST` | `/api/v1/folders` | `201` |
| 폴더 목록 조회 | `GET` | `/api/v1/folders` | `200` |
| 폴더 상세 조회 | `GET` | `/api/v1/folders/{folder_id}` | `200` |
| 제외 폴더 저장 | `PUT` | `/api/v1/folders/{folder_id}/exclusions` | `200` |
| 제외 폴더 조회 | `GET` | `/api/v1/folders/{folder_id}/exclusions` | `200` |
| 재탐색 요청 | `POST` | `/api/v1/folders/{folder_id}/rescan` | `202` |
| 폴더 연결 해제 | `DELETE` | `/api/v1/folders/{folder_id}` | `204` |
| 폴더 내 문서 목록 | `GET` | `/api/v1/folders/{folder_id}/documents` | `200` |
| 문서 등록·업로드 URL | `POST` | `/api/v1/documents` | `201` |
| 원본 업로드 | `PUT` | 응답의 `upload_url` (R2 직접) | `200` |
| 업로드 완료 통지 | `POST` | `/api/v1/documents/{document_id}/upload-complete` | `200` |
| 문서 상세 조회 | `GET` | `/api/v1/documents/{document_id}` | `200` |
| 문서 검색 | `POST` | `/api/v1/search` | `200` |
| 기기별 문서 경로 조회 | `GET` | `/api/v1/documents/{document_id}/locations/{device_id}` | `200` |
| 기기별 문서 경로 갱신 | `PUT` | `/api/v1/documents/{document_id}/locations/{device_id}` | `200` |
| 다운로드 URL | `POST` | `/api/v1/documents/{document_id}/download-url` | `200` |
| 원본 다운로드 | `GET` | 응답의 `download_url` (R2 직접) | `200` |

## 기기

### 기기 등록

`POST /api/v1/devices`

앱 첫 실행 시 호출합니다. Electron은 응답의 `device_id`를 보관해 재사용해야 합니다. 호출할 때마다 새 기기가 만들어집니다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `device_name` | string | O | 앞뒤 공백 제거 후 1~100자, 제어 문자 불가 |

```json
{ "device_name": "내 노트북" }
```

응답 `201`

```json
{
  "device_id": "3f0c6f0e-7f43-4a56-9f55-0a4f3f1f8a11",
  "device_name": "내 노트북",
  "created_at": "2026-11-23T06:00:00Z"
}
```

## 폴더

### 폴더 등록

`POST /api/v1/folders`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `device_id` | UUID | O | 내 기기 ID |
| `folder_name` | string | O | 앞뒤 공백 제거 후 1~255자, 제어 문자 불가 |
| `local_path` | string | O | 해당 기기의 폴더 루트 절대 경로, 최대 4096자 |

```json
{
  "device_id": "3f0c6f0e-7f43-4a56-9f55-0a4f3f1f8a11",
  "folder_name": "notes",
  "local_path": "C:\\Users\\me\\Documents\\notes"
}
```

응답 `201`

```json
{
  "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
  "folder_name": "notes",
  "status": "registered",
  "created_at": "2026-11-23T06:01:00Z"
}
```

같은 기기에 같은 폴더가 있으면 `409`와 기존 `folder_id`를 반환합니다. Windows 경로는 대소문자, 구분자(`/`, `\`), 끝의 구분자 차이를 같은 경로로 봅니다. macOS·Linux 경로는 대소문자를 구분합니다.

```json
{
  "detail": {
    "message": "이 기기에 이미 등록된 폴더입니다.",
    "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a"
  }
}
```

### 폴더 목록 조회

`GET /api/v1/folders`

연결 해제되지 않은 내 폴더를 최근 등록 순으로 반환합니다.

```json
{
  "folders": [
    {
      "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
      "folder_name": "notes",
      "status": "registered",
      "created_at": "2026-11-23T06:01:00Z"
    }
  ]
}
```

### 폴더 상세 조회

`GET /api/v1/folders/{folder_id}`

```json
{
  "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
  "folder_name": "notes",
  "status": "registered",
  "created_at": "2026-11-23T06:01:00Z",
  "locations": [
    {
      "device_id": "3f0c6f0e-7f43-4a56-9f55-0a4f3f1f8a11",
      "local_path": "C:\\Users\\me\\Documents\\notes",
      "last_seen_at": "2026-11-23T06:01:00Z"
    }
  ],
  "excluded_paths": [".git", "node_modules", "study/개인자료"]
}
```

### 제외 폴더 저장

`PUT /api/v1/folders/{folder_id}/exclusions`

목록 **전체를 교체**합니다. 빈 배열을 보내면 제외 설정을 모두 해제합니다. 임베딩 이후에도 변경할 수 있으며, 이미 업로드된 원본과 벡터는 이 API가 삭제하지 않습니다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `excluded_paths` | string[] | O | 폴더 루트 기준 상대 경로, 최대 1000개, 각 1024자 이하 |

```json
{ "excluded_paths": ["study/개인자료", "node_modules", ".git"] }
```

응답 `200`. 경로는 문자 코드 순으로 정렬되어 반환됩니다. `.git`처럼 기호로 시작하는 경로가 앞에 옵니다.

```json
{
  "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
  "excluded_paths": [".git", "node_modules", "study/개인자료"],
  "status": "saved"
}
```

경로 검증 규칙은 다음과 같습니다. 하나라도 어긋나면 목록 전체를 `422`로 거부합니다.

- `\`는 `/`로 바꿔 저장하고, 중복 경로는 하나로 합칩니다.
- 빈 값, 절대 경로(`/a`, `C:\a`), 빈 폴더 이름(`a//b`, `a/`)을 거부합니다.
- `.`, `..` 경로 조각을 거부합니다.
- 제어 문자, 보이지 않는 서식 문자, `< > : " | ? *`를 거부합니다.
- 공백이나 점으로 끝나는 폴더 이름과 Windows 예약 이름(`CON`, `NUL`, `COM1` 등)을 거부합니다.

Electron은 파일 경로가 제외 경로와 같거나 `제외 경로/`로 시작하면 업로드 전에 제외합니다.

### 제외 폴더 조회

`GET /api/v1/folders/{folder_id}/exclusions`

```json
{
  "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
  "excluded_paths": [".git", "node_modules", "study/개인자료"]
}
```

### 재탐색 요청

`POST /api/v1/folders/{folder_id}/rescan`

재탐색 식별자만 발급합니다. 실제 디스크 탐색은 Electron이 수행합니다. 폴더가 해당 기기에 연결되어 있지 않으면 `404`를 반환합니다.

```json
{ "device_id": "3f0c6f0e-7f43-4a56-9f55-0a4f3f1f8a11" }
```

응답 `202`

```json
{
  "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
  "scan_id": "c2a7d7a0-1a53-4f0e-9a51-7f6f8f1f2e3d",
  "status": "awaiting_client_scan"
}
```

`scan_id`는 아직 DB에 저장되지 않습니다. 재탐색 결과 제출 방식이 정해지면 연결합니다.

### 폴더 연결 해제

`DELETE /api/v1/folders/{folder_id}`

모든 기기와의 연결을 해제하고 `204`를 반환합니다. 기기별 폴더 경로(`folder_locations`)와 문서 경로(`document_locations`)는 삭제하고, 폴더는 `disconnected` 상태로 바꿉니다. 제외 규칙, 문서·버전·청크, R2 원본은 삭제하지 않고 보존합니다. 해제한 폴더는 조회·검색되지 않으며, 같은 경로를 다시 등록하면 새 `folder_id`가 발급됩니다.

### 폴더 내 문서 목록

`GET /api/v1/folders/{folder_id}/documents?limit=100&offset=0`

폴더의 문서를 경로의 문자 코드 순으로 반환합니다. `limit`은 1~500(기본 100), `offset`은 0 이상입니다. `status`는 최신 버전의 상태입니다.

응답 `200`

```json
{
  "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
  "documents": [
    {
      "document_id": "5d2e8c1a-2b7f-4f3a-9c61-1e0d3a4b5c6d",
      "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
      "relative_path": "study/운영체제/프로세스.md",
      "file_name": "프로세스.md",
      "latest_version": 1,
      "status": "ready",
      "created_at": "2026-11-24T06:00:00Z"
    }
  ]
}
```

## 문서

### 처리 흐름

```txt
POST /documents ─→ PUT upload_url (R2) ─→ POST upload-complete ─→ (AI 분석) ─→ GET /documents/{id}로 상태 확인
```

버전 상태는 다음 순서로 바뀝니다. `registered`는 예약된 값이며 현재 등록 즉시 `upload_pending`이 됩니다.

```txt
upload_pending → uploaded → processing → ready
       ↘ upload_failed          ↘ processing_failed
```

| 상태 | 의미 | 앱이 할 일 |
| --- | --- | --- |
| `upload_pending` | 업로드 URL 발급됨 | `upload_url`로 PUT 후 `upload-complete` |
| `upload_failed` | 객체가 없거나 크기가 다름 | `POST /documents`를 다시 보내 새 URL을 받아 재업로드 |
| `uploaded` | 업로드 확인됨, AI 서버 미설정 | AI 설정 후 `upload-complete`를 다시 보내면 분석 시작 |
| `processing` | AI 분석 중 | 상태 조회 |
| `ready` | 검색 가능 | 없음 |
| `processing_failed` | 분석 실패 (`error_code` 참고) | `upload-complete`를 다시 보내면 재처리 |

R2 업로드·다운로드 URL은 응답으로만 주고 DB나 로그에 남기지 않습니다. DB에는 `object_key`만 저장합니다.

### 문서 등록·업로드 URL 발급

`POST /api/v1/documents`

제외 규칙을 적용해 포함하기로 한 파일마다 호출합니다. 폴더가 해당 기기에 연결되어 있어야 합니다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `folder_id` | UUID | O | 내 폴더 |
| `device_id` | UUID | O | 파일이 있는 내 기기 |
| `relative_path` | string | O | 폴더 루트 기준 경로. `\`는 `/`로, 한글은 NFC로 바뀜. 검증 규칙은 제외 경로와 같음 |
| `file_name` | string | O | `relative_path`의 마지막 이름과 같아야 함 |
| `file_size` | integer | O | byte. `MAX_UPLOAD_BYTES`(기본 100MB) 이하 |
| `modified_at` | string | | 파일 수정 시각 |
| `sha256` | string | O | 64자리 16진수 |

```json
{
  "folder_id": "9b1d2f64-52c1-4c7e-8a43-6f1e2d3c4b5a",
  "device_id": "3f0c6f0e-7f43-4a56-9f55-0a4f3f1f8a11",
  "relative_path": "study/운영체제/프로세스.md",
  "file_name": "프로세스.md",
  "file_size": 1024,
  "modified_at": "2026-11-19T09:00:00+09:00",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

응답 `201`

```json
{
  "document_id": "5d2e8c1a-2b7f-4f3a-9c61-1e0d3a4b5c6d",
  "document_version_id": "0e5c7a1b-4d2f-4b8e-9a3c-2f1e0d9c8b7a",
  "version": 1,
  "object_key": "12/5d2e8c1a-2b7f-4f3a-9c61-1e0d3a4b5c6d/v1.md",
  "status": "upload_pending",
  "upload_url": "https://<계정ID>.r2.cloudflarestorage.com/<버킷>/<object_key>?X-Amz-...",
  "upload_headers": { "Content-Type": "text/markdown" },
  "expires_in": 1800
}
```

- **원본 업로드:** `PUT {upload_url}`에 파일 바이트를 보냅니다. `upload_headers`의 헤더를 **그대로** 보내야 합니다. `Content-Type`이 서명에 포함되어 다르면 R2가 거부합니다.
- **같은 파일 재요청 (멱등성):** 최신 버전과 `sha256`·`file_size`가 같으면 새 버전을 만들지 않고 기존 버전을 돌려줍니다. 아직 업로드 전이면 새 URL을, 이미 올라간 버전이면 `upload_url: null`을 줍니다.
- **내용 변경:** 해시가 다르면 같은 `document_id`에 `version`이 1 늘어납니다.
- **기기별 경로:** 등록 시 `폴더 루트 경로 + relative_path`를 그 기기의 문서 경로로 기록합니다.
- **오류:** 폴더가 그 기기에 연결되지 않음 `404`, 제외된 폴더 안의 파일 `422`, 크기 초과 `413`, R2 미설정 `503`.
- `object_key`에는 파일 이름 대신 확장자만 넣습니다.

### 업로드 완료 통지

`POST /api/v1/documents/{document_id}/upload-complete`

```json
{ "version": 1 }
```

서버가 R2에 객체가 있고 크기가 `file_size`와 같은지 확인합니다. 통과하면 응답 후 AI 분석을 시작합니다. 같은 통지를 여러 번 보내도 결과가 같습니다.

응답 `200`

```json
{ "document_id": "5d2e8c1a-...", "version": 1, "status": "processing", "error_code": null }
```

검증에 실패해도 `200`으로 `status: "upload_failed"`와 `error_code`(`OBJECT_NOT_FOUND`, `SIZE_MISMATCH`)를 돌려줍니다.

### 문서 상세 조회

`GET /api/v1/documents/{document_id}`

업로드 후 분석 진행 상태를 확인할 때 씁니다. `versions`는 최신 버전부터 옵니다.

```json
{
  "document_id": "5d2e8c1a-...",
  "folder_id": "9b1d2f64-...",
  "relative_path": "study/운영체제/프로세스.md",
  "file_name": "프로세스.md",
  "latest_version": 1,
  "status": "ready",
  "created_at": "2026-11-24T06:00:00Z",
  "versions": [
    {
      "version": 1, "status": "ready", "file_size": 1024, "sha256": "9f86...",
      "error_code": null, "created_at": "...", "uploaded_at": "...", "processed_at": "..."
    }
  ]
}
```

`error_code` 값은 다음과 같습니다.

| 코드 | 원인 |
| --- | --- |
| `AI_PROCESSING_FAILED` | AI가 `status: "failed"`만 보냄. 현재 AI 서버의 실패는 모두 이 값 (예: `.hwp` 미지원) |
| `EXTRACTION_FAILED`, `DOWNLOAD_FAILED`, `EMBEDDING_API_ERROR`, `EMPTY_TEXT` | AI가 `error_code`를 보낸 경우 그대로 저장 (노션 설계의 후보 값) |
| `AI_UNREACHABLE`, `AI_HTTP_<상태>` | AI 서버에 연결하지 못함, AI 서버가 200이 아닌 응답 |
| `AI_INVALID_RESPONSE`, `AI_INVALID_CHUNKS`, `AI_INVALID_EMBEDDING`, `AI_VERSION_MISMATCH` | AI 응답 형식 검증 실패 |
| `STORE_FAILED`, `PROCESSING_ERROR` | 백엔드에서 청크 저장 또는 처리 중 오류 |

### 문서 검색

`POST /api/v1/search`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `query` | string | O | 1~2000자 |
| `top_k` | integer | | 1~50, 기본 5 |

```json
{ "query": "CPU가 여러 프로그램에 실행 시간을 나누어 준다.", "top_k": 5 }
```

응답 `200`

```json
{
  "results": [
    {
      "document_id": "5d2e8c1a-...",
      "folder_id": "9b1d2f64-...",
      "file_name": "프로세스.md",
      "relative_path": "study/운영체제/프로세스.md",
      "version": 1,
      "chunk_id": "7a6b5c4d-...",
      "snippet": "운영체제는 CPU 시간을 배분한다.",
      "score": 0.92
    }
  ]
}
```

- 검색어를 AI 서버에서 벡터로 바꾼 뒤, **문서와 같은 임베딩 모델·차원**의 청크에서 코사인 거리 순으로 찾습니다. `score`는 `1 - 코사인 거리`입니다.
- 검색 대상: 내 폴더(연결 해제 제외), 문서별 `ready`인 최신 버전, 제외 경로 밖의 문서. 제외 경로를 새로 추가하면 바로 검색에서 빠집니다.
- `snippet`은 청크 앞 300자입니다. AI 서버 미설정 `503`, 검색어 변환 실패 `502`.
- **현재 상태:** AI 서버에 검색어 임베딩 엔드포인트가 아직 없어 `AI_EMBED_URL`이 비어 있으므로 `503`을 반환합니다. 백엔드 쪽 검색 로직은 구현·테스트되어 있습니다.

### 기기별 문서 경로 조회

`GET /api/v1/documents/{document_id}/locations/{device_id}`

서버가 **마지막으로 기록한** 경로입니다. 실제로 파일이 있는지는 Electron이 확인합니다. 기록이 없으면 `404`입니다.

```json
{
  "document_id": "5d2e8c1a-...",
  "device_id": "3f0c6f0e-...",
  "local_path": "D:\\Test_Docs\\study\\운영체제\\프로세스.md",
  "version": 1,
  "sha256": "9f86...",
  "last_verified_at": "2026-11-24T06:00:00Z"
}
```

### 기기별 문서 경로 갱신

`PUT /api/v1/documents/{document_id}/locations/{device_id}`

다운로드 후 저장한 위치나 확인한 위치를 기록합니다. `local_path`는 폴더 등록과 같은 절대 경로 규칙을 따릅니다. 없는 `version`이면 `404`입니다.

```json
{ "local_path": "D:\\다운로드\\프로세스.md", "version": 1, "sha256": "9f86..." }
```

응답 `200`

```json
{ "document_id": "5d2e8c1a-...", "device_id": "3f0c6f0e-...", "status": "updated" }
```

### 다운로드 URL 발급

`POST /api/v1/documents/{document_id}/download-url`

```json
{ "version": 1 }
```

`version`을 생략(`{}`)하면 업로드가 확인된 최신 버전입니다. 업로드가 확인되지 않은 버전은 `409`입니다.

```json
{
  "document_id": "5d2e8c1a-...",
  "version": 1,
  "file_name": "프로세스.md",
  "download_url": "https://<계정ID>.r2.cloudflarestorage.com/...?X-Amz-...",
  "expires_in": 1800
}
```

Electron이 `GET {download_url}`로 받아 저장하고 해시를 확인한 뒤 경로를 갱신합니다.

## 백엔드 ↔ AI 서버

AI 서버는 백엔드만 호출하며 `Authorization: Bearer <AI_INTERNAL_TOKEN>`으로 인증합니다. 사용자 ID와 로컬 경로는 보내지 않습니다.

**문서 처리** `POST {AI_PROCESS_URL}`: 노션 "백엔드 → AI" 문서 형식 그대로입니다. 현재 AI 서버(Modal)에서는 `/upload` 엔드포인트이며, 같은 형식으로 동작하는 것을 확인했습니다. AI 서버는 아직 토큰을 검사하지 않고, 실패 시 `error_code` 없이 `status: "failed"`만 보내므로 백엔드는 `AI_PROCESSING_FAILED`로 기록합니다.

```json
{
  "document_version_id": "0e5c7a1b-...",
  "file_name": "프로세스.md",
  "mime_type": "text/markdown",
  "download_url": "https://...",
  "expires_in": 600
}
```

AI는 같은 HTTP 응답으로 `document_version_id`, `status`(`success`/`failed`), `embedding_model`, `embedding_dim`, `chunks[{chunk_index, chunk_text, embedding}]` 또는 `error_code`를 돌려줍니다. 백엔드는 차원·숫자·순서 번호 중복을 검증하고 한 트랜잭션으로 청크를 모두 저장한 뒤에만 `ready`로 바꿉니다. PDF 추출 결과에 섞인 NUL 문자(`\x00`)는 PostgreSQL에 저장할 수 없어 백엔드가 지우고 저장합니다.

현재 AI 서버 확인 결과 (2026-11-24, `D:\Test_Docs` 160개):

| 항목 | 값 |
| --- | --- |
| 모델 | `sentence-transformers/paraphrase-MiniLM-L3-v2`, 384차원 |
| 처리 성공 형식 | `.md`, `.pdf`, `.docx`, `.pptx`, `.txt` |
| 처리 실패 형식 | `.hwp` (지원하지 않음, `AI_PROCESSING_FAILED`) |
| 처리 시간 | 문서 1개 약 2~3초(대형 PDF 6~16초). CPU·GPU 서버 차이 거의 없음 |

**검색어 임베딩** `POST {AI_EMBED_URL}` (형식 가정, 미확정. 현재 AI 서버에 없음)

```json
{ "text": "검색어" }
```

```json
{ "embedding_model": "<문서와 같은 모델>", "embedding_dim": 384, "embedding": [0.01, -0.03] }
```

## 미정 사항

- `local_path`는 설계 초안대로 평문 저장합니다. 개인정보 고지와 보관 기간은 팀 결정이 필요합니다.
- PK 이름 규칙(`id` vs `테이블_id`)이 정해지면 컬럼 이름이 바뀔 수 있습니다.
- 임베딩 후 새로 제외한 폴더는 검색에서 바로 빠지지만, 이미 올라간 R2 원본·청크는 지우지 않습니다. 삭제 정책은 팀 결정이 필요합니다.
- 경로는 Unicode NFC로 맞춰 비교합니다. Windows 대소문자 구분 정책은 미정이며 현재는 대소문자를 구분합니다.
- 백엔드 ↔ AI 동기/비동기 방식, 검색어 임베딩 형식, AI 서버 인증(내부 토큰)은 AI 담당과 확정해야 합니다. 문서 처리 엔드포인트는 `/upload`로 확인했습니다. 현재는 업로드 완료 응답 후 같은 서버에서 AI를 호출하므로, 처리 중 서버가 꺼지면 버전이 `processing`에 남습니다(작업 큐 도입 시 해결).
- URL 유효 시간(업로드·다운로드 1800초, AI용 600초)과 업로드 크기 제한(100MB)은 임시 기본값이며 환경 변수로 바꿀 수 있습니다.
- 멱등성 기준(최신 버전과 해시·크기 비교), 파일 이동·이름 변경·삭제 시 문서 처리는 팀 확정 전입니다.
- 지원 파일 형식은 미정입니다. 현재 백엔드는 형식을 제한하지 않아 `.hwp`도 등록·업로드되고 분석 단계에서 실패합니다. 지원 목록이 정해지면 등록 단계에서 거부합니다.
- 임베딩 차원이 정해지면 `chunks.embedding`을 `vector(N)`으로 고정하고 검색 인덱스(HNSW 등)를 추가합니다. 지금은 인덱스 없이 전체 비교합니다. AI 모델을 바꾸면 기존 청크는 새 모델로 다시 분석해야 검색됩니다.
