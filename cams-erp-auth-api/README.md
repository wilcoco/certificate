# CAMS ERP 인증 API 서버

Oracle ERP(iCAMS) 사원 테이블을 이용한 **사번 인증** 및 **사원정보 조회** REST API.
다른 사내 앱에서 HTTP로 호출하여 ERP 로그인/사원조회 기능을 공유할 수 있습니다.

---

## 빠른 시작

```bash
# 1. 의존성 설치
cd cams-erp-auth-api
npm install

# 2. 환경변수 설정
cp env.example .env
# .env 파일 편집하여 Oracle 접속 정보, API_KEY 입력

# 3. 실행
npm start
# → http://localhost:4000 에서 실행
```

---

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `PORT` | | `4000` | API 서버 포트 |
| `API_KEY` | ✅ | | API 인증 키 (x-api-key 헤더) |
| `ORACLE_USER` | ✅ | | Oracle 계정 |
| `ORACLE_PASSWORD` | ✅ | | Oracle 비밀번호 |
| `ORACLE_CONNECT_STRING` | ✅ | | Oracle 접속 문자열 (host:port/service) |
| `ORACLE_USE_THICK_MODE` | | `false` | Oracle Thick Mode 사용 여부 |
| `ORACLE_CLIENT_LIB_DIR` | | | Instant Client 경로 |
| `ORACLE_EMP_TABLE` | | `T_XX_BSC` | 사원 마스터 테이블 |
| `ORACLE_DEPT_TABLE` | | `T_XX_DPT` | 부서 마스터 테이블 |
| `ORACLE_PASS_TABLE` | | `T_XX_PWD` | 비밀번호 테이블 |
| `ORACLE_EMP_ID_PREFIXES` | | `103,2` | 사원목록 사번 필터 |

컬럼 이름도 환경변수로 변경 가능 (상세: `env.example` 참조).

---

## API 엔드포인트

### 인증 공통

모든 `/api/*` 요청에 아래 헤더 필요:
```
x-api-key: {API_KEY}
```

### 헬스체크

```
GET /health
```
```json
{ "status": "ok", "oracle": true }
```

---

### 1. 로그인 인증

```
POST /api/login
Content-Type: application/json
```

**요청**
```json
{
  "employeeId": "103485",
  "password": "mypassword"
}
```

**성공 응답** (200)
```json
{
  "authenticated": true,
  "employee": {
    "employeeId": "103485",
    "name": "홍길동",
    "department": "영업관리팀",
    "address": "서울시 강남구 ...",
    "joinDate": "2015-03-02",
    "retirementDate": ""
  }
}
```

**실패 응답** (401)
```json
{ "message": "비밀번호가 일치하지 않습니다." }
```

---

### 2. 사원 프로필 조회

```
GET /api/employee/{사번}
```

**성공 응답** (200)
```json
{
  "employee": {
    "employeeId": "103485",
    "name": "홍길동",
    "residentNumber": "8501011234567",
    "department": "영업관리팀",
    "address": "서울시 강남구 ...",
    "joinDate": "2015-03-02",
    "retirementDate": ""
  }
}
```

> ⚠️ `residentNumber`(주민등록번호)가 포함됩니다. 보안에 유의하세요.

---

### 3. 사원 목록

```
GET /api/employees
```

**응답** (200)
```json
{
  "count": 150,
  "employees": [
    { "employeeId": "103001", "name": "김철수", "department": "생산팀" },
    { "employeeId": "103002", "name": "이영희", "department": "품질팀" }
  ]
}
```

사번 접두사 필터(`ORACLE_EMP_ID_PREFIXES`)에 해당하는 사원만 조회됩니다.

---

## 배포 (Docker)

```bash
docker build -t cams-erp-auth-api .
docker run -d \
  -p 4000:4000 \
  -e API_KEY=your-secret-key \
  -e ORACLE_USER=myuser \
  -e ORACLE_PASSWORD=mypass \
  -e ORACLE_CONNECT_STRING=192.168.1.100:1521/ORCL \
  cams-erp-auth-api
```

Railway, Render 등 PaaS에 배포하려면 환경변수만 설정하면 됩니다.

---

## 다른 앱에서 호출 예시

### Node.js
```javascript
const res = await fetch("http://erp-auth-api:4000/api/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "your-secret-key",
  },
  body: JSON.stringify({ employeeId: "103485", password: "mypassword" }),
});
const data = await res.json();
if (data.authenticated) {
  console.log(`${data.employee.name}님 로그인 성공`);
}
```

### Python
```python
import requests

res = requests.post(
    "http://erp-auth-api:4000/api/login",
    json={"employeeId": "103485", "password": "mypassword"},
    headers={"x-api-key": "your-secret-key"},
)
data = res.json()
if data.get("authenticated"):
    print(f"{data['employee']['name']}님 로그인 성공")
```

### curl
```bash
curl -X POST http://localhost:4000/api/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key" \
  -d '{"employeeId":"103485","password":"mypassword"}'
```

---

## Oracle 테이블 구조 참고

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|-----------|
| `T_XX_BSC` | 사원 마스터 | BSCSBN(사번), BSCNAME(이름), BSCJUMNO(주민번호), BSCDPTCOD(부서코드), BSCDIVCOD(사업장코드), BSCJUSO(주소), BSCGIYMD(입사일), BSCRTYMD(퇴직일) |
| `T_XX_DPT` | 부서 마스터 | DPTDPTCOD(부서코드), DPTDIVCOD(사업장코드), DPTDPTN(부서명) |
| `T_XX_PWD` | 비밀번호 | PWDUSRID(사번), ETC6(비밀번호) |

부서명은 사원→부서 JOIN으로 조회: `BSCDPTCOD = DPTDPTCOD AND BSCDIVCOD = DPTDIVCOD`
