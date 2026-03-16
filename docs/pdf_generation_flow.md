# PDF 생성/발급 흐름

## 1) 재직/경력/퇴직 증명서(PDFKit)

### 입력 데이터

- 세션 사용자 정보(`req.session.employee`)
- 발급 유형(`certificateLibrary`에서 `id`로 선택)
- 옵션: `maskResidentNumber` (검증 페이지 payload에만 적용)

### 처리 단계

1. **문서번호 생성**
   - 형식: `<CERT_ID>-<EMPLOYEE_ID>-<timestamp_suffix>`

2. **검증 URL 생성**
   - `/verify/:documentNumber`
   - `PUBLIC_BASE_URL`이 있으면 해당 값 사용

3. **발급 이력 저장**
   - `certificate_issues`에 `payload`(발급 시점 스냅샷) 저장

4. **QR 코드 생성**
   - `qrcode.toDataURL(verifyUrl)` → base64 → Buffer

5. **PDFKit 렌더링**
   - 헤더(로고/회사명/문서 제목)
   - 본문(사원 정보 rows)
   - 하단 스탬프/QR 이미지 삽입

6. **응답 스트리밍**
   - `Content-Type: application/pdf`
   - `Content-Disposition: attachment; filename="..."`

### 주민등록번호 표시 정책(현재)

- PDF 본문에는 현재 세션의 `residentNumber`를 그대로 사용
- 검증 페이지 payload(`certificate_issues.payload.employee.residentNumber`)에는 기본 마스킹 적용

## 2) 원천징수 영수증

### 다운로드(직원)

- 우선순위
  1. `withholding_receipts`에서 `pdf_bytes`가 있으면 그대로 다운로드
  2. 없으면 레거시 폴백: master PDF + 페이지 맵(JSON)을 `pdf-lib`로 페이지 추출

### 업로드(관리자)

- 파일명에서 `RRN + workStartDate` 파싱
- `resident_number_hash`로만 저장
- employee resident_number로 즉시 매칭되면 `withholding_receipts`
- 아니면 `withholding_receipts_staged`로 저장

## 3) 향후 개선 포인트

- PDF 암호화 옵션(배포/외부 전달용)
- 원천징수 PDF 저장소를 object storage(S3 등)로 분리
- 주민번호 저장 정책을 해시-only로 전환(사원 테이블 포함)
- 발급 PDF(바이너리) 저장 여부 결정(현재는 스트리밍 + 발급 이력만 저장)
