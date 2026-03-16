# 프로젝트 개요

## 서비스 목적

이 프로젝트는 사번 기반 로그인을 통해 사내 증명서(PDF)를 발급하는 웹 서비스입니다.

- 사용자가 로그인 후 필요한 증명서를 내려받을 수 있습니다.
- 관리자는 사원 정보를 관리하고, 원천징수 영수증 PDF를 업로드/매칭하여 직원별로 안전하게 다운로드할 수 있게 합니다.

## 현재 구현된 기능

### 인증/권한

- `express-session` 기반 세션 로그인
- 관리자 권한(`isAdmin`) 기반 기능 분리

### 증명서 발급(PDF)

- 재직/경력/퇴직 증명서: 서버에서 PDFKit으로 즉시 생성하여 다운로드
- 발급 시 문서번호를 생성하고, 검증 URL로 연결되는 QR 코드를 PDF에 삽입
- 발급 이력은 DB(`certificate_issues`)에 저장
- 검증 페이지: `/verify/:documentNumber`

### 원천징수 영수증(업로드/매칭/다운로드)

- 관리자 업로드: ZIP 또는 PDF 업로드
- 파일명에서 주민등록번호(RRN) + 근무 시작일을 파싱
- RRN은 **원문 저장 없이 해시(`resident_number_hash`)**로 변환하여 저장
- 업로드 시 즉시 직원 매칭이 불가한 경우 **스테이징 테이블**에 저장 후, 관리자 매칭 API로 사번에 연결

## 기술 스택

- Runtime: Node.js
- Backend: Express
- Authentication: express-session
- Upload: multer
- ZIP 처리: adm-zip
- Database: PostgreSQL + node `pg` driver (개발 편의를 위한 in-memory DB fallback 포함)
- PDF 처리: pdfkit, pdf-lib
- QR 코드: qrcode
- Frontend: 정적 HTML + Vanilla JS
- Python 문서 처리(오프라인 스크립트): pypdf, pdfplumber (옵션 OCR)

## 실행 방법

- `npm install`
- `npm run dev`
- 접속: `http://localhost:3001`

## 환경 변수

- `SESSION_SECRET`: 세션/해시 salt에 사용(개발 기본값 존재)
- `DATABASE_URL`: 프로덕션 필수. 개발에서는 미설정 시 in-memory DB 사용
- `DATABASE_SSL`: `false`로 두면 SSL 비활성화
- `PUBLIC_BASE_URL`: QR 검증 URL 생성 시 외부 베이스 URL 지정
- (레거시/폴백용)
  - `WITHHOLDING_MASTER_PDF_PATH`
  - `WITHHOLDING_PAGE_MAP_PATH`

## 실제 프로젝트 구조(현재)

- `server.js`: Express 서버/라우팅, PDF 발급, 원천징수 업로드/매칭
- `db.js`: PostgreSQL 연결 + 스키마 초기화 + 개발용 in-memory DB
- `public/`
  - `index.html`: UI
  - `app.js`: 프론트 로직(로그인/다운로드/관리자 기능)
  - `styles.css`
- `assets/`: 로고/폰트 등 정적 리소스
- `split_tax_pdf.py`: 원천징수 PDF 분할/텍스트 추출용 파이썬 유틸(현재는 루트에 존재)

## 보안/개인정보(현 상태)

- 원천징수 업로드 파일명에서 RRN을 읽지만, 서버 저장은 `resident_number_hash`로만 유지
- 검증 페이지(`/verify/...`)는 기본적으로 주민번호 마스킹을 적용
- 사원 테이블(`employees.resident_number`)은 현재 평문 저장 구조이므로, 해시-only 전환은 별도 작업으로 진행 필요

## 다음 개발 단계(제안)

- 원천징수: staged → link → 직원 다운로드 smoke test 자동화
- 주민번호 저장 정책 정리(사원 테이블의 평문 저장 제거/마이그레이션)
- PDF 암호화(배포/전달용 옵션) 도입
- 코드 구조 리팩터링(예: `routes/`, `services/`, `scripts/` 디렉토리로 분리)
