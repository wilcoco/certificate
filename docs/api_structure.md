# API 구조

## 공통

- 인증: `express-session` 쿠키 세션
- 기본적으로 `/api/*`는 로그인 필요(`requireAuth`)
- 관리자 전용 API는 `requireAdmin` 적용

## Auth

### `POST /api/login`

- **Body(JSON)**: `{ employeeId, password }`
- **Response**: `{ employee }`

### `POST /api/logout`

- 세션 삭제

### `GET /api/me`

- **설명**: 세션 기반 현재 사용자/증명서 목록/관리자용 사원 목록 반환

## Employee(Admin)

### `GET /api/employees`

### `POST /api/employees`

- 사원 생성

### `PUT /api/employees/:id`

- 사원 수정

### `DELETE /api/employees/:id`

- 사원 삭제

## Certificate(발급/다운로드)

### `GET /api/certificates/:id`

- `:id` 예: `employment`, `career`, `withholding`, `retirement`
- **Query**
  - `maskResidentNumber` (0/1): 검증 페이지 payload에 주민번호 마스킹 적용 여부
  - 원천징수(`withholding`)인 경우
    - `taxYear` (optional): 귀속연도 지정

- **Response**: PDF(`Content-Type: application/pdf`)

## Withholding(Admin)

### `POST /api/admin/withholding-receipts/upload`

- **권한**: 관리자
- **Request**: `multipart/form-data`
  - `file`: `.zip` 또는 `.pdf`
  - `taxYear`(optional): 귀속연도 강제 지정
- **Query**
  - `details=1`: 개별 파일 처리 결과 포함(민감정보는 마스킹된 파일명으로 반환)

- **파일명 규칙**
  - `000000-0000000_YYYY-MM-DD.pdf`

- **Response(JSON)**
  - `importedCount`, `matchedCount`, `stagedCount`, `skippedCount`

### `POST /api/admin/withholding-receipts/link`

- **권한**: 관리자
- **Body(JSON)**
  - `{ employeeId, name, residentNumber, taxYear? }`
- **Response(JSON)**
  - `{ employeeId, linkedCount, taxYears }`

## Verification(공개)

### `GET /verify/:documentNumber`

- **설명**: QR 코드로 접근하는 문서 진위 확인 페이지(HTML)
- **DB**: `certificate_issues.payload`를 기준으로 렌더링

## 정적 리소스

- `GET /` 및 기타 경로: `public/index.html`
- `GET /assets/*`: 로고/폰트 등
