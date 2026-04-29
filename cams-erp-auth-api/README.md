# CAMS ERP 인증 API

CAMS Self Service 서버에서 제공하는 **ERP 사번 인증** 및 **사원정보 조회** REST API입니다.  
별도 서버 설치 없이, 아래 정보만으로 바로 사용할 수 있습니다.

---

## 접속 정보

| 항목 | 값 |
|------|----|
| **Base URL** | `https://selfservice.icams.co.kr` |
| **API Key** | `6147` |
| **인증 방법** | 모든 요청에 `x-api-key: 6147` 헤더 추가 |

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
    "x-api-key": "6147",
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
    headers={"x-api-key": "6147"},
)
data = res.json()
if data.get("authenticated"):
    print(f"{data['employee']['name']}님 로그인 성공")
```

### curl
```bash
curl -X POST https://selfservice.icams.co.kr/api/erp/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: 6147" \
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
