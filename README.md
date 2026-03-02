# 사내 문서 발급 포털

모바일 우선 UI로 사번 로그인 후 재직 증명서, 경력 증명서 등을 내려받을 수 있는 데모 서비스입니다.

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3001` 접속

## 데모 사번

- 1001 (김하늘)
- 1002 (이준서)
- 1003 (박민지)

## Railway 배포

1. GitHub에 푸시 후 Railway에서 새 프로젝트 생성
2. `NPM` 환경을 선택
3. `SESSION_SECRET` 환경 변수를 설정
4. Railway에서 PostgreSQL 추가 (New → Database → PostgreSQL)
5. 생성된 `DATABASE_URL` 환경 변수를 유지
6. Deploy 버튼 클릭

## 데이터베이스

- 앱 시작 시 `DATABASE_URL` 기준으로 테이블을 자동 생성합니다.
- 기본 사원 3명이 자동으로 시딩됩니다.
- 로컬에서는 PostgreSQL을 직접 띄우고 `DATABASE_URL`을 지정해야 합니다.

## PDF 한글 폰트 설정

PDFKit 기본 폰트는 한글이 깨집니다. 아래 폰트를 추가해주세요.

1. `assets/NotoSansKR-Regular.ttf` 파일 추가
2. 커밋 후 배포

권장 폰트: Google Noto Sans KR
