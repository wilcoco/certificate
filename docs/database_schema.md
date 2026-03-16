# 데이터베이스 스키마

## 실행 환경

- **프로덕션**: PostgreSQL (`DATABASE_URL` 필요)
- **개발**: `DATABASE_URL`이 없으면 in-memory DB로 동작(`db.js`)

## 테이블: employees

- **설명**: 사용자(사원) 계정/프로필
- **PK**: `employee_id`

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| employee_id | TEXT | 사번(PK) |
| password | TEXT | 비밀번호(데모용 평문) |
| name | TEXT | 이름 |
| team | TEXT | 소속팀 |
| join_date | DATE | 입사일 |
| retirement_date | DATE | 퇴직일(옵션) |
| is_admin | BOOLEAN | 관리자 여부 |
| address | TEXT | 주소(옵션) |
| resident_number | TEXT | 주민등록번호(현재 평문 저장) |

## 테이블: certificate_issues

- **설명**: 증명서 발급 이력(검증 페이지의 source of truth)
- **PK**: `document_number`

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| document_number | TEXT | 문서번호(PK) |
| certificate_id | TEXT | 문서 유형 ID (employment/career/retirement/withholding 등) |
| employee_id | TEXT | 발급자 사번 |
| issued_at | TIMESTAMPTZ | 발급 시각 |
| payload | JSONB | 발급 당시 스냅샷(검증 페이지에 사용) |

## 테이블: withholding_receipts

- **설명**: 사원별 원천징수 영수증 저장소
- **PK**: `(employee_id, tax_year)`

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| employee_id | TEXT | 사번(FK: employees.employee_id) |
| tax_year | INT | 귀속연도 |
| work_start_date | DATE | 파일명에서 파싱한 근무 시작일(옵션) |
| resident_number_hash | TEXT | 주민번호 해시(sha256) |
| pdf_bytes | BYTEA | PDF 바이너리 |
| uploaded_at | TIMESTAMPTZ | 업로드 시각 |

## 테이블: withholding_receipts_staged

- **설명**: 업로드는 되었지만 사번 매칭이 되지 않은 원천징수 영수증 임시 저장소
- **PK**: `(resident_number_hash, tax_year)`

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| resident_number_hash | TEXT | 주민번호 해시(sha256) |
| tax_year | INT | 귀속연도 |
| work_start_date | DATE | 근무 시작일(옵션) |
| pdf_bytes | BYTEA | PDF 바이너리 |
| uploaded_at | TIMESTAMPTZ | 업로드 시각 |

## 관계/정합성 메모

- `withholding_receipts.employee_id`는 `employees`를 참조합니다(프로덕션 스키마 기준).
- staged 테이블은 사번이 없고 해시만 보유합니다.
- 현재 `employees.resident_number`가 평문이라 **해시-only 전환 시 마이그레이션 설계가 필요**합니다.
