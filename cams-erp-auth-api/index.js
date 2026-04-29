/**
 * CAMS ERP 인증 API 서버
 *
 * Oracle ERP 사원 테이블을 이용한:
 *   - POST /api/login          사번 + 비밀번호 인증
 *   - GET  /api/employee/:id   사원 프로필 조회
 *   - GET  /api/employees      사원 목록 조회
 *
 * 모든 요청에 x-api-key 헤더 필요 (환경변수 API_KEY)
 */

require("dotenv").config();
const express = require("express");
const oracledb = require("oracledb");

// ─── Oracle Thick Mode ───────────────────────────────────────
if (process.env.ORACLE_USE_THICK_MODE === "true") {
  try {
    const opts = {};
    if (process.env.ORACLE_CLIENT_LIB_DIR) {
      opts.libDir = process.env.ORACLE_CLIENT_LIB_DIR;
    }
    oracledb.initOracleClient(opts);
    console.log("[oracle] thick mode 초기화 완료");
  } catch (err) {
    console.error("[oracle] thick mode 초기화 실패:", err.message);
  }
}
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];

// ─── 환경변수 ────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 4000;
const API_KEY = process.env.API_KEY || "";

const ORACLE_CONFIG = {
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
};

// Oracle 테이블/컬럼 설정 (기본값은 CAMS ERP 기준)
const EMP_TABLE = process.env.ORACLE_EMP_TABLE || "T_XX_BSC";
const DEPT_TABLE = process.env.ORACLE_DEPT_TABLE || "T_XX_DPT";
const PASS_TABLE = process.env.ORACLE_PASS_TABLE || "T_XX_PWD";

const COL = {
  empId: process.env.ORACLE_EMP_COL_EMPLOYEE_ID || "BSCSBN",
  empName: process.env.ORACLE_EMP_COL_NAME || "BSCNAME",
  empResident: process.env.ORACLE_EMP_COL_RESIDENT_NUMBER || "BSCJUMNO",
  empDeptCode: process.env.ORACLE_EMP_COL_DEPT_CODE || "BSCDPTCOD",
  empDivCode: process.env.ORACLE_EMP_COL_DIV_CODE || "BSCDIVCOD",
  empAddress: process.env.ORACLE_EMP_COL_ADDRESS || "BSCJUSO",
  empJoinDate: process.env.ORACLE_EMP_COL_JOIN_DATE || "BSCGIYMD",
  empRetireDate: process.env.ORACLE_EMP_COL_RETIRE_DATE || "BSCRTYMD",
  deptName: process.env.ORACLE_DEPT_COL_NAME || "DPTDPTN",
  deptCode: process.env.ORACLE_DEPT_COL_CODE || "DPTDPTCOD",
  deptDivCode: process.env.ORACLE_DEPT_COL_DIV_CODE || "DPTDIVCOD",
  passUserId: process.env.ORACLE_PASS_COL_USER_ID || "PWDUSRID",
  passValue: process.env.ORACLE_PASS_COL_PASSWORD || "ETC6",
};

const EMP_ID_PREFIXES = (process.env.ORACLE_EMP_ID_PREFIXES || "103,2")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ─── Oracle Connection Pool ──────────────────────────────────
let pool = null;

const getPool = async () => {
  if (pool) return pool;
  if (!ORACLE_CONFIG.user || !ORACLE_CONFIG.connectString) {
    throw new Error("Oracle 연결 정보가 설정되지 않았습니다.");
  }
  pool = await oracledb.createPool({
    ...ORACLE_CONFIG,
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1,
  });
  console.log("[oracle] 커넥션 풀 생성 완료");
  return pool;
};

// ─── Helpers ─────────────────────────────────────────────────
const normalize = (v) => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

const readTextValue = async (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && typeof v.getData === "function") {
    return (await v.getData()).trim();
  }
  return String(v).trim();
};

const formatDate = (d) => {
  if (!d) return "";
  const digits = String(d).replace(/[^0-9]/g, "");
  if (digits.length === 8)
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return d;
};

// ─── Express App ─────────────────────────────────────────────
const app = express();
app.use(express.json());

// API Key 인증 미들웨어
app.use("/api", (req, res, next) => {
  if (!API_KEY) return next(); // API_KEY 미설정 시 인증 없이 통과 (개발용)
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    return res.status(401).json({ message: "Invalid API key" });
  }
  next();
});

// 헬스체크
app.get("/health", (_req, res) => {
  res.json({ status: "ok", oracle: !!pool });
});

// ─── POST /api/login ─────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const employeeId = normalize(req.body?.employeeId);
  const password = normalize(req.body?.password);

  if (!employeeId || !password) {
    return res.status(400).json({ message: "employeeId와 password를 입력하세요." });
  }

  let connection;
  try {
    const oraclePool = await getPool();
    connection = await oraclePool.getConnection();

    const result = await connection.execute(
      `
        SELECT
          TRIM(e.${COL.empId})          AS "employeeId",
          e.${COL.empName}              AS "name",
          d.${COL.deptName}             AS "department",
          e.${COL.empAddress}           AS "address",
          e.${COL.empJoinDate}          AS "joinDate",
          e.${COL.empRetireDate}        AS "retirementDate",
          p.${COL.passValue}            AS "storedPassword"
        FROM ${EMP_TABLE} e
        LEFT JOIN ${DEPT_TABLE} d
          ON e.${COL.empDeptCode} = d.${COL.deptCode}
         AND e.${COL.empDivCode} = d.${COL.deptDivCode}
        LEFT JOIN ${PASS_TABLE} p
          ON TRIM(p.${COL.passUserId}) = TRIM(e.${COL.empId})
        WHERE TRIM(e.${COL.empId}) = :employeeId
      `,
      { employeeId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const row = result.rows?.[0];
    if (!row) {
      return res.status(401).json({ message: "사원을 찾을 수 없습니다." });
    }

    const storedPassword = normalize(await readTextValue(row.storedPassword));
    if (storedPassword !== password) {
      return res.status(401).json({ message: "비밀번호가 일치하지 않습니다." });
    }

    return res.json({
      authenticated: true,
      employee: {
        employeeId: normalize(row.employeeId),
        name: normalize(await readTextValue(row.name)),
        department: normalize(await readTextValue(row.department)),
        address: normalize(await readTextValue(row.address)),
        joinDate: formatDate(await readTextValue(row.joinDate)),
        retirementDate: formatDate(await readTextValue(row.retirementDate)),
      },
    });
  } catch (error) {
    console.error("[login] 오류:", error.message);
    return res.status(500).json({ message: "인증 처리 중 오류가 발생했습니다." });
  } finally {
    if (connection) try { await connection.close(); } catch (_) {}
  }
});

// ─── GET /api/employee/:id ───────────────────────────────────
app.get("/api/employee/:id", async (req, res) => {
  const employeeId = normalize(req.params.id);
  if (!employeeId) {
    return res.status(400).json({ message: "employeeId가 필요합니다." });
  }

  let connection;
  try {
    const oraclePool = await getPool();
    connection = await oraclePool.getConnection();

    const result = await connection.execute(
      `
        SELECT
          TRIM(e.${COL.empId})          AS "employeeId",
          e.${COL.empName}              AS "name",
          e.${COL.empResident}          AS "residentNumber",
          d.${COL.deptName}             AS "department",
          e.${COL.empAddress}           AS "address",
          e.${COL.empJoinDate}          AS "joinDate",
          e.${COL.empRetireDate}        AS "retirementDate"
        FROM ${EMP_TABLE} e
        LEFT JOIN ${DEPT_TABLE} d
          ON e.${COL.empDeptCode} = d.${COL.deptCode}
         AND e.${COL.empDivCode} = d.${COL.deptDivCode}
        WHERE TRIM(e.${COL.empId}) = :employeeId
      `,
      { employeeId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const row = result.rows?.[0];
    if (!row) {
      return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
    }

    return res.json({
      employee: {
        employeeId: normalize(row.employeeId),
        name: normalize(await readTextValue(row.name)),
        residentNumber: normalize(await readTextValue(row.residentNumber)),
        department: normalize(await readTextValue(row.department)),
        address: normalize(await readTextValue(row.address)),
        joinDate: formatDate(await readTextValue(row.joinDate)),
        retirementDate: formatDate(await readTextValue(row.retirementDate)),
      },
    });
  } catch (error) {
    console.error("[employee] 오류:", error.message);
    return res.status(500).json({ message: "사원 조회 중 오류가 발생했습니다." });
  } finally {
    if (connection) try { await connection.close(); } catch (_) {}
  }
});

// ─── GET /api/employees ──────────────────────────────────────
app.get("/api/employees", async (req, res) => {
  let connection;
  try {
    const oraclePool = await getPool();
    connection = await oraclePool.getConnection();

    const whereClauses = EMP_ID_PREFIXES.map(
      (_, i) => `TRIM(e.${COL.empId}) LIKE :p${i}`
    ).join(" OR ");
    const binds = {};
    EMP_ID_PREFIXES.forEach((p, i) => {
      binds[`p${i}`] = p + "%";
    });

    const result = await connection.execute(
      `
        SELECT
          TRIM(e.${COL.empId})  AS "employeeId",
          e.${COL.empName}      AS "name",
          d.${COL.deptName}     AS "department"
        FROM ${EMP_TABLE} e
        LEFT JOIN ${DEPT_TABLE} d
          ON e.${COL.empDeptCode} = d.${COL.deptCode}
         AND e.${COL.empDivCode} = d.${COL.deptDivCode}
        WHERE ${whereClauses}
        ORDER BY TRIM(e.${COL.empId})
      `,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const seen = new Set();
    const employees = [];

    for (const row of rows) {
      const eid = normalize(row.employeeId);
      if (!eid || seen.has(eid)) continue;
      seen.add(eid);
      employees.push({
        employeeId: eid,
        name: normalize(await readTextValue(row.name)),
        department: normalize(await readTextValue(row.department)),
      });
    }

    return res.json({ count: employees.length, employees });
  } catch (error) {
    console.error("[employees] 오류:", error.message);
    return res.status(500).json({ message: "사원 목록 조회 중 오류가 발생했습니다." });
  } finally {
    if (connection) try { await connection.close(); } catch (_) {}
  }
});

// ─── Start Server ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[cams-erp-auth-api] http://localhost:${PORT} 에서 실행 중`);
  console.log(`  POST /api/login         사번 인증`);
  console.log(`  GET  /api/employee/:id  사원 조회`);
  console.log(`  GET  /api/employees     사원 목록`);
});
