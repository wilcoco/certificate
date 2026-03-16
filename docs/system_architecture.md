# 시스템 아키텍처

## 구성 요소

- **Browser(UI)**
  - 정적 HTML(`public/index.html`) + Vanilla JS(`public/app.js`)
- **API 서버**
  - Node.js + Express (`server.js`)
- **DB**
  - PostgreSQL(`pg`) 또는 개발용 in-memory DB(`db.js`)
- **PDF 처리**
  - 증명서 생성: `pdfkit`
  - PDF 조작(레거시 원천징수 폴백): `pdf-lib`
- **QR 생성**
  - `qrcode`
- **오프라인 문서 분석(파이썬)**
  - `split_tax_pdf.py` (pypdf/pdfplumber 기반 분할 + 텍스트 추출)

## 전체 데이터 흐름(요약)

로그인
↓
파일 업로드(관리자)
↓
문서 분석(파일명/텍스트 추출)
↓
데이터 추출(RRN 해시/날짜)
↓
PDF 생성(증명서) 또는 PDF 저장(원천징수)
↓
QR 코드 삽입
↓
증명서 발급/다운로드

## 로그인 흐름

1. Client → `POST /api/login` (사번/비밀번호)
2. Server → `employees` 조회 후 세션 저장
3. Client → `GET /api/me` 로 세션 확인 및 UI 렌더링

## 증명서 발급 흐름(재직/경력/퇴직)

1. Client → `GET /api/certificates/:id`
2. Server
   - 문서번호(`documentNumber`) 생성
   - 검증 URL(`/verify/:documentNumber`) 생성
   - QR 이미지 생성(`qrcode`)
   - 발급 이력 저장: `INSERT certificate_issues (payload 포함)`
   - PDFKit으로 템플릿 렌더링 후 응답 스트리밍
3. Client: PDF 다운로드

### 검증(Verification) 흐름

1. 외부 사용자/수신자 → `GET /verify/:documentNumber`
2. Server → `certificate_issues`에서 payload 조회
3. Server → HTML로 발급 당시 정보 렌더링

## 원천징수 영수증 흐름

### 1) 관리자 업로드

1. Admin Client → `POST /api/admin/withholding-receipts/upload` (ZIP/PDF)
2. Server
   - ZIP이면 내부 PDF를 순회
   - 파일명에서 `RRN + YYYY-MM-DD` 파싱
   - `resident_number_hash = sha256(salt:digits)` 계산
   - 사원 테이블 resident_number 기반 즉시 매칭 가능하면 `withholding_receipts`에 저장
   - 매칭이 안 되면 `withholding_receipts_staged`에 저장
3. 응답: imported/matched/staged/skipped count

### 2) 스테이징 → 사번 연결

1. Admin Client → `POST /api/admin/withholding-receipts/link`
2. Server
   - 사번/이름 일치 검증
   - resident_number_hash 계산
   - staged 레코드 조회(+ taxYear 필터 optional)
   - `withholding_receipts`로 이관(upsert)
   - `withholding_receipts_staged`에서 삭제

### 3) 직원 다운로드

1. Employee Client → `GET /api/certificates/withholding?taxYear=YYYY`
2. Server
   - `withholding_receipts`에서 employee_id 기준 조회
   - 요청 taxYear가 없으면 최신 연도 선택
   - 저장된 PDF bytes를 그대로 내려줌
   - (폴백) 레거시 master PDF + page-map에서 pdf-lib로 페이지 추출

## 경계/제약

- 개발(in-memory DB) 환경에서는 서버 재시작 시 데이터가 초기화됩니다.
- 원천징수 PDF는 현재 DB의 `BYTEA`로 저장합니다(대용량/확장성은 추후 object storage로 전환 고려).
