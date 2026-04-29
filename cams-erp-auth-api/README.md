# CAMS ERP 인증 API

기존 CAMS Self Service 서버(`selfservice.icams.co.kr`)에서 제공하는 **사번 인증** 및 **사원정보 조회** REST API.  
다른 사내 앱에서 HTTP로 호출하여 ERP 로그인/사원조회 기능을 공유할 수 있습니다.

> **별도 서버 불필요** — 기존 서버의 `/api/erp/*` 경로로 제공됩니다.

---

## 활성화 방법

Railway 환경변수에 아래 하나만 추가:

```
ERP_API_KEY=your-secret-api-key-here
```

설정하지 않으면 ERP API는 비활성화 상태(503)입니다.

---

## API 엔드포인트

**Base URL**: `https://selfservice.icams.co.kr`

### 인증 공통

모든 `/api/erp/*` 요청에 아래 헤더 필요:
```
x-api-key: {ERP_API_KEY}
```

---

### 1. 로그인 인증

```
POST /api/erp/login
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
GET /api/erp/employee/{사번}
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
GET /api/erp/employees
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

---

## 다른 앱에서 호출 예시

### Node.js
```javascript
const res = await fetch("https://selfservice.icams.co.kr/api/erp/login", {
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
    "https://selfservice.icams.co.kr/api/erp/login",
    json={"employeeId": "103485", "password": "mypassword"},
    headers={"x-api-key": "your-secret-key"},
)
data = res.json()
if data.get("authenticated"):
    print(f"{data['employee']['name']}님 로그인 성공")
```

### curl
```bash
curl -X POST https://selfservice.icams.co.kr/api/erp/login \
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
