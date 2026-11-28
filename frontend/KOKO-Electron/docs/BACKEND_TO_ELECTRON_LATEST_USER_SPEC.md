### 사용자 조작 vs 자동 처리

| 단계                   | 처리 주체                         | 사용자에게 보이는 것             |
| -------------------- | ----------------------------- | ----------------------- |
| 3.1 폴더 등록            | Electron → 백엔드                | 폴더 선택 창에서 폴더 선택         |
| 3.2 폴더 제외            | Electron → 백엔드                | 트리 화면의 X 표시 후 **확인** 클릭 |
| 4.1 문서 등록·업로드 URL 수신 | Electron → 백엔드 (URL 발급)       | 로딩 화면                   |
| 4.2 R2 업로드           | Electron → R2 (앱 코드 자동)       | 로딩 화면                   |
| 4.3 업로드 완료 알림        | Electron → 백엔드 (검증, AI 분석 요청) | 로딩 화면                   |

- 사용자 조작: 폴더 선택 + 확인 버튼 1회
- 확인 이후 4.1~4.3: 파일별 자동 반복

## 1. 공통

- 인증 헤더: `Authorization: Bearer <access_token>` (모든 요청)
- 경로 구분자: `/` (폴더 루트 기준 상대 경로)
- ID 형식: UUID 문자열

### 공통 오류

| 코드 | 의미 |
|---|---|
| 401 | 토큰 없음·만료 |
| 404 | 없는 리소스 또는 남의 리소스 |
| 409 | 사용할 수 없는 상태 (예: 폴더 중복 등록, 업로드 전 다운로드) |
| 413 | 파일 크기 초과 |
| 422 | 입력값 오류 (경로, 해시, 제외 경로 안의 파일 등) |
| 502 | 파일 저장소(R2) 연결 실패 |
| 503 | 저장소·AI 설정 없음 |

- 오류 본문: `{"detail": "..."}`

## 2. 최초 실행 (1회) - 사용자 PC 별칭 입력 요청

| 순서 | API | 요청 | 응답 |
|---|---|---|---|
| 1 | `POST /api/v1/devices` | `device_name` | `device_id`, `device_name`, `created_at` |

- `device_id`의 앱 내 영구 보관
- 재실행 시 재호출 금지 (호출마다 새 기기 생성)
- `device_id` 분실 시 복구 API 없음 (기기 목록 API 추후) → 반드시 영구 저장

## 3. 폴더 등록·제외 (폴더 선택 → 확인 화면 → 저장 시작)

### 3.1 폴더 등록

`POST /api/v1/folders`

| 요청 | 응답 |
|---|---|
| `device_id`, `folder_name`, `local_path`(폴더 절대 경로) | `folder_id`, `folder_name`, `status`, `created_at` |

- 폴더 경로의 출처: 사용자가 Windows 폴더 선택 창에서 고른 경로
- 여러 폴더 선택 시 폴더별 1회씩 등록
- 같은 기기에 같은 경로 재등록 시 409 + 기존 `folder_id` 반환 → 그 ID 그대로 사용 (대소문자·끝의 `\` 차이도 같은 경로)
  - 응답 예: `{"detail": {"message": "이 기기에 이미 등록된 폴더입니다.", "folder_id": "..."}}`
- 주의: 이미 등록한 폴더의 하위·상위 폴더는 서버가 막지 않음 → 같은 파일이 중복 업로드되므로 앱에서 선택 차단
### 3.2 폴더 제외

`PUT /api/v1/folders/{folder_id}/exclusions`

| 요청 | 응답 |
|---|---|
| `excluded_paths` (예: `["잡동사니", "study/운영체제"]`) | `folder_id`, `excluded_paths`, `status: saved` |

- 트리 화면의 X 표시 항목 = `excluded_paths`
- 경로 형식: 등록 폴더 루트 기준 상대 경로만 허용
- 전체 경로 전송 불가 (422), 서버의 경로 축약 없음
- Electron의 변환 담당: 전체 경로에서 등록 폴더 경로 제거
  - 예: 등록 폴더 `D:\Test_Docs`, 선택 항목 `D:\Test_Docs\study\운영체제` → `study/운영체제`
- 서버 정리 범위: `\` → `/` 변환, 한글 NFC 통일
- 서버 거부 항목 (422): 절대 경로, `/`로 시작, `.`·`..`, 빈 이름, 금지 문자, Windows 예약 이름(`CON`, `NUL` 등)
- 상대 경로 방식 이유
  - 같은 폴더가 PC마다 다른 위치에 있어도 제외 설정 1회로 모든 PC에 적용
  - 서버에 사용자 이름 등이 포함된 전체 경로 저장 최소화
- 제외 판단 규칙: 파일 경로가 제외 경로와 같거나 `제외경로/`로 시작하면 제외
- 제외 파일의 등록 요청 금지 (서버도 422로 거부)
- 요청마다 목록 전체 교체 (추가·삭제 모두 전체 목록 전송)
- 저장 후 제외되지 않은 파일마다 4번 절차 반복

## 4. 파일 1개 업로드 (3단계, 확인 클릭 이후 자동)

### 4.1 문서 등록·업로드 URL 수신

`POST /api/v1/documents`

| 요청 필드 | 설명 |
|---|---|
| `folder_id` | 폴더 ID |
| `device_id` | 기기 ID |
| `relative_path` | 폴더 루트 기준 경로 (예: `study/os.md`) |
| `file_name` | 파일 이름, `relative_path` 마지막 이름과 동일 |
| `file_size` | 파일 크기(byte), 최대 100MB |
| `sha256` | 파일 내용 SHA-256 (64자리 16진수) |
| `modified_at` | 파일 수정 시각 (선택) |

| 응답 필드                 | 설명                                    |
| --------------------- | ------------------------------------- |
| `document_id`         | 문서 ID                                 |
| `document_version_id` | 버전 ID                                 |
| `version`             | 버전 번호                                 |
| `status`              | 버전 상태                                 |
| `upload_url`          | R2 업로드용 임시 URL, 이미 올라간 같은 파일이면 `null` |
| `upload_headers`      | 업로드 시 그대로 보낼 헤더                       |
| `expires_in`          | URL 유효 시간(초), 현재 1800                 |

- 오류: 413 100MB 초과 / 422 제외 경로 안의 파일, 경로·해시 형식 오류 / 404 이 기기에 연결되지 않은 폴더

### 4.2 R2 직접 업로드 (Electron 앱 코드)

- `upload_url`로 파일 본문 `PUT` (예: `fetch(upload_url, { method: "PUT", headers: upload_headers, body: 파일 })`)
- `upload_headers` 그대로 포함 (불일치 시 403)
- `Authorization` 헤더 미포함 (서명 URL 자체가 권한)
- `upload_url`이 `null`이면 업로드·완료 알림 생략
- 사용자 조작 없음: 로딩 화면 동안 앱이 자동 실행
- 백엔드 대행 불가: 파일은 사용자 PC에만 존재, 서버의 디스크 접근 불가
- `upload_url` = 정해진 R2 위치에 30분 동안 업로드를 허락하는 임시 허가증 (발급은 백엔드, 사용은 Electron)
- 백엔드 경유 업로드(Electron → 백엔드 → R2) 미채택: 최소 사양 서버의 메모리·대역폭 부담, 설계 원칙(원본은 Electron ↔ R2 직접) 위반

### 4.3 업로드 완료 알림

`POST /api/v1/documents/{document_id}/upload-complete`

| 요청 | 응답 |
|---|---|
| `version` | `document_id`, `version`, `status`, `error_code` |

- 응답 직후 서버의 AI 분석 자동 시작
- R2에 파일이 없거나 크기가 다르면 `upload_failed`
- `upload_failed` → 4.1부터 다시 (새 URL 발급, 같은 버전 재사용)
- `processing_failed` → `upload-complete` 재호출 시 AI 재분석

## 5. 진행·결과 화면

| API | 용도 |
|---|---|
| `GET /api/v1/folders/{folder_id}/documents?limit=100&offset=0` | 폴더 내 문서별 최신 버전 `status`·`error_code` (최대 500개씩) |
| `GET /api/v1/documents/{document_id}` | 문서 상세, 버전별 `status`·`error_code` |

| 상태 | 화면 분류 |
|---|---|
| `upload_pending`, `uploaded`, `processing` | 진행 중 |
| `ready` | 완료 |
| `upload_failed`, `processing_failed` | 실패 |

- 진행률: 목록 API 주기 조회
- 결과 요약: "총 N개 중 M개 완료", 실패 목록 우선 표시
- 네트워크 오류: R2 업로드 실패는 Electron이 직접 판단
- - 실패 원인: 목록 응답의 `error_code` (`OBJECT_NOT_FOUND`, `SIZE_MISMATCH`, `AI_PROCESSING_FAILED` 등, 전체 목록은 `docs/API.md`)
- 현재 제약: "지원하지 않는 형식" 구분 방식 미정 (지금은 `AI_PROCESSING_FAILED`로 표시)

## 6. 변경 감지

| 상황 | Electron 처리 |
|---|---|
| 앱 실행 중 파일 수정·추가 | 폴더 감시 → 해당 파일로 4번 절차 |
| 앱 꺼진 동안의 변경 | 앱 시작 시 폴더 재탐색 → 바뀐 파일로 4번 절차 |
| 감시 대상 복원 | `GET /api/v1/folders` → `GET /api/v1/folders/{folder_id}` (기기별 경로 `locations`, `excluded_paths`) |
| 파일 삭제 | 기존 `document_id`로 `DELETE /api/v1/documents/{document_id}` (204) |
| 이동·이름 변경 | 기존 문서 `DELETE` → 새 경로로 4번 절차 (새 문서, 버전 1) |

- 버전 판단은 서버 담당: 같은 경로에 해시가 다르면 새 버전 + AI 재분석, 같으면 `upload_url: null`
- 수정 파일의 별도 API 없음 (신규·수정 모두 `POST /api/v1/documents`)
- 삭제·이동·이름 변경 = 다른 문서 (DB와 R2 원본 모두 삭제, 되돌릴 수 없음)
- 기존 `document_id` 확인: 폴더 문서 목록 응답의 `relative_path`로 조회