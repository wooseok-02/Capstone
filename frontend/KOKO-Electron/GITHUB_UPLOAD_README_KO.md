# KOKO 프론트엔드 GitHub 업로드 안내

이 폴더는 Electron 프론트엔드 소스코드입니다. ZIP 자체 대신 압축을 풀어 프로젝트 폴더를 팀 저장소의 `frontend/` 하위에 올리세요. 팀에서 이미 사용하는 프론트엔드 경로가 있다면 그 구조를 우선합니다.

## 포함해야 하는 파일
`main.js`, `preload.js`, `package.json`, `package-lock.json`, `renderer/`, `lib/`, `assets/`, `test/`, `docs/`, `README*.md`, `RUN_DEMO.cmd`, `RUN_KOKO.cmd` 등 소스와 문서.

## 포함하면 안 되는 파일
`node_modules/`, `dist/`, `.env`, `.env.local`, DB 파일, 토큰, API 키, 개인 계정 설정, 시스템에 설치한 프로그램 파일.

## 권장 GitHub 작업 흐름
1. 팀 공용 개발 브랜치를 확인하고 자신만의 `feature/frontend-koko` 브랜치를 만듭니다.
2. 이 프론트엔드 폴더의 파일을 `frontend/` 경로로 업로드합니다. 다른 팀원 파일을 덮어쓰지 마세요.
3. Pull Request를 만들어 백엔드 팀원에게 검토를 요청합니다.
4. 병합 전 `npm install`, `npm test`, `npm run demo`, `npm start`를 각각 검증합니다.

비밀정보는 프론트엔드 소스에 넣지 마세요. `https://capstone.nsu-coco.online`은 공개 API 주소이고 SSH/DB 비밀번호는 오직 서버 측에서 관리해야 합니다. 이전에 채팅으로 노출한 비밀번호는 반드시 변경하세요.

실제 백엔드 로그인, R2 업로드, AI 분석, 알림 API 통합 테스트는 별도로 진행해야 합니다.
