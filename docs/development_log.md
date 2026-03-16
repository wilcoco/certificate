# Development Log

## 2026-03-13

### 작업 내용

- 원천징수 영수증 업로드 시 직원 매칭이 불가해도 저장되도록 **스테이징 테이블** 플로우 추가
- 관리자 매칭 기능 구현
  - API: `POST /api/admin/withholding-receipts/link`
  - UI: 관리자 화면에 매칭 폼 추가
- 원천징수 다운로드 시 DB 저장본을 우선 제공하도록 다운로드 로직 정리
- 생성 산출물/테스트 아카이브가 커밋되지 않도록 `.gitignore` 강화

### 수정 파일(핵심)

- `server.js`
- `db.js`
- `public/index.html`
- `public/app.js`
- `.gitignore`

### 다음 작업

- staged → link → 직원 다운로드 smoke test 수행
- 주민번호 저장 정책(평문 vs 해시-only) 확정 및 마이그레이션 설계
- PDF 암호화/배포 정책 설계
