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

## 호출 예시 (언어별)

아래 예시는 모두 **로그인 인증** API 호출입니다. 사용하는 언어에 맞는 코드를 복사하세요.

### curl (터미널에서 바로 테스트)
```bash
curl -X POST https://selfservice.icams.co.kr/api/erp/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: 6147" \
  -d '{"employeeId":"103485","password":"mypassword"}'
```

### JavaScript / Node.js
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
  console.log(data.employee.name + "님 로그인 성공");
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
    print(data["employee"]["name"] + "님 로그인 성공")
```

### Java
```java
HttpClient client = HttpClient.newHttpClient();
String body = "{\"employeeId\":\"103485\",\"password\":\"mypassword\"}";
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://selfservice.icams.co.kr/api/erp/login"))
    .header("Content-Type", "application/json")
    .header("x-api-key", "6147")
    .POST(HttpRequest.BodyPublishers.ofString(body))
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());
```

### C# (.NET)
```csharp
using var client = new HttpClient();
client.DefaultRequestHeaders.Add("x-api-key", "6147");
var content = new StringContent(
    "{\"employeeId\":\"103485\",\"password\":\"mypassword\"}",
    System.Text.Encoding.UTF8, "application/json");
var res = await client.PostAsync("https://selfservice.icams.co.kr/api/erp/login", content);
var json = await res.Content.ReadAsStringAsync();
Console.WriteLine(json);
```

### PHP
```php
$ch = curl_init("https://selfservice.icams.co.kr/api/erp/login");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Content-Type: application/json",
        "x-api-key: 6147",
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "employeeId" => "103485",
        "password" => "mypassword",
    ]),
]);
$response = curl_exec($ch);
curl_close($ch);
$data = json_decode($response, true);
if ($data["authenticated"]) {
    echo $data["employee"]["name"] . "님 로그인 성공";
}
```

### Kotlin (Android)
```kotlin
val client = OkHttpClient()
val body = """{"employeeId":"103485","password":"mypassword"}"""
    .toRequestBody("application/json".toMediaType())
val request = Request.Builder()
    .url("https://selfservice.icams.co.kr/api/erp/login")
    .addHeader("x-api-key", "6147")
    .post(body)
    .build()
val response = client.newCall(request).execute()
println(response.body?.string())
```

### Swift (iOS)
```swift
var request = URLRequest(url: URL(string: "https://selfservice.icams.co.kr/api/erp/login")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("6147", forHTTPHeaderField: "x-api-key")
request.httpBody = try? JSONSerialization.data(withJSONObject: [
    "employeeId": "103485", "password": "mypassword"
])
let (data, _) = try await URLSession.shared.data(for: request)
let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
print(json ?? [:])
```

---

## Oracle 테이블 구조 참고

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|-----------|
| `T_XX_BSC` | 사원 마스터 | BSCSBN(사번), BSCNAME(이름), BSCJUMNO(주민번호), BSCDPTCOD(부서코드), BSCDIVCOD(사업장코드), BSCJUSO(주소), BSCGIYMD(입사일), BSCRTYMD(퇴직일) |
| `T_XX_DPT` | 부서 마스터 | DPTDPTCOD(부서코드), DPTDIVCOD(사업장코드), DPTDPTN(부서명) |
| `T_XX_PWD` | 비밀번호 | PWDUSRID(사번), ETC6(비밀번호) |

부서명은 사원→부서 JOIN으로 조회: `BSCDPTCOD = DPTDPTCOD AND BSCDIVCOD = DPTDIVCOD`
