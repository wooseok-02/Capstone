# Knowledge Pet API 명세서

기기 등록과 폴더 지정 API의 명세입니다. 소셜 로그인 API는 [백엔드 README](../README.md)를 참고하세요.

## 공통 규칙

| 항목 | 내용 |
| --- | --- |
| 로컬 Base URL | `http://localhost:8000` |
| 인증 | 모든 API에 `Authorization: Bearer <access_token>` 필요 |
| 형식 | 요청과 응답 본문은 `application/json` |
| ID | `device_id`, `folder_id`, `scan_id`는 UUID |
| 시각 | ISO 8601 형식이며 시간대를 포함 |
| 캐시 | 응답에 `Cache-Control: no-store` 포함 |

`user_id`는 요청 본문으로 받지 않고 Access Token에서 꺼냅니다. 로그아웃했거나 만료된 세션의 토큰은 거부합니다.

### 공통 오류

| 상태 | 의미 |
| --- | --- |
| `401` | Access Token이 없거나, 유효하지 않거나, 세션이 종료됨 |
| `404` | 대상이 없거나 **다른 계정의 소유**임 |
| `409` | 같은 기기에 이미 등록된 폴더 |
| `422` | 요청 형식 또는 경로 검증 실패 |

다른 계정의 기기·폴더는 존재 여부가 드러나지 않도록 `403` 대신 `404`로 응답합니다.

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

모든 기기와의 연결을 해제하고 `204`를 반환합니다. 기기별 `local_path`는 삭제하고, 폴더 기록과 제외 규칙은 `disconnected` 상태로 보존합니다. 해제한 폴더는 조회할 수 없으며, 같은 경로를 다시 등록하면 새 `folder_id`가 발급됩니다.

## 미정 사항

- `local_path`는 설계 초안대로 평문 저장합니다. 개인정보 고지와 보관 기간은 팀 결정이 필요합니다.
- PK 이름 규칙(`id` vs `테이블_id`)이 정해지면 컬럼 이름이 바뀔 수 있습니다.
- 임베딩 후 새로 제외한 폴더의 R2 원본·청크 처리 정책은 문서 기능 구현 시 확정합니다.
- 제외 경로의 Unicode 정규화와 대소문자 정책은 미정이며, 현재는 입력한 문자 그대로 비교합니다.
