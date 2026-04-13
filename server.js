const express = require("express");
const path = require("path");
const session = require("express-session");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument } = require("pdf-lib");
const QRCode = require("qrcode");
const { pool, initSchema, mapEmployee } = require("./db");

let oracledb = null;
try {
  oracledb = require("oracledb");
  const useThickMode = (() => {
    const value = process.env.ORACLE_USE_THICK_MODE;
    if (value === undefined || value === null || value === "") return false;
    const lowered = String(value).trim().toLowerCase();
    if (["0", "false", "no", "off"].includes(lowered)) return false;
    return true;
  })();

  if (useThickMode && typeof oracledb.initOracleClient === "function") {
    const libDir = String(process.env.ORACLE_CLIENT_LIB_DIR || "").trim();
    oracledb.initOracleClient(libDir ? { libDir } : undefined);
  }

  const clobType = oracledb.DB_TYPE_CLOB || oracledb.CLOB;
  const nclobType = oracledb.DB_TYPE_NCLOB || oracledb.NCLOB;
  oracledb.fetchAsString = [clobType, nclobType].filter(Boolean);
} catch (error) {
  if (
    process.env.ORACLE_USE_THICK_MODE ||
    process.env.ORACLE_DB_USER ||
    process.env.ORACLE_DB_CONNECT_STRING
  ) {
    console.error("oracledb 초기화 실패", error);
  }
  oracledb = null;
}

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3001;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 200,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 30,
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "assets")));

initSchema().catch((error) => {
  console.error("DB 초기화 실패", error);
  process.exit(1);
});

const certificateLibrary = [
  {
    id: "employment",
    title: "재직 증명서",
    description: "현재 재직 사실을 증명하는 공식 문서",
    filename: "employment_certificate.pdf",
  },
  {
    id: "career",
    title: "경력 증명서",
    description: "근무 기간 및 직무 이력을 확인하는 문서",
    filename: "career_certificate.pdf",
  },
  {
    id: "withholding",
    title: "원천징수 영수증",
    description: "근로소득 원천징수 내역을 확인하는 문서",
    filename: "withholding_tax_receipt.pdf",
  },
  {
    id: "retirement",
    title: "퇴직 증명서",
    description: "퇴직 사실과 퇴직일자를 확인하는 문서",
    filename: "retirement_certificate.pdf",
  },
];

const requireAuth = (req, res, next) => {
  if (!req.session.employee) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  return next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.employee?.isAdmin) {
    return res.status(403).json({ message: "관리자 권한이 필요합니다." });
  }
  return next();
};

const sanitizeEmployee = ({ password, ...record }) => record;

const escapeHtml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const normalizeString = (value) => String(value ?? "").trim();

const WITHHOLDING_MASTER_PDF_PATH =
  process.env.WITHHOLDING_MASTER_PDF_PATH ||
  path.join(__dirname, "private", "withholding_master.pdf");

const WITHHOLDING_PAGE_MAP_PATH =
  process.env.WITHHOLDING_PAGE_MAP_PATH ||
  path.join(__dirname, "private", "withholding_master.pages.json");

const toPositiveInteger = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  const integerValue = Math.trunc(numericValue);
  if (integerValue !== numericValue || integerValue < 1) return null;
  return integerValue;
};

const expandPageRange = (startPage, endPage) => {
  const pages = [];
  for (let page = startPage; page <= endPage; page += 1) {
    pages.push(page);
  }
  return pages;
};

const normalizeWithholdingPages = (entry) => {
  if (!entry) return [];

  if (Array.isArray(entry)) {
    return entry.map(toPositiveInteger).filter((page) => page !== null);
  }

  if (typeof entry === "number" || typeof entry === "string") {
    const single = toPositiveInteger(entry);
    return single ? [single] : [];
  }

  if (typeof entry === "object") {
    const pages = Array.isArray(entry.pages)
      ? entry.pages
          .map(toPositiveInteger)
          .filter((page) => page !== null)
      : null;
    if (pages && pages.length > 0) return pages;

    const startPage = toPositiveInteger(entry.startPage ?? entry.start);
    const endPage = toPositiveInteger(entry.endPage ?? entry.end);
    if (!startPage) return [];
    if (!endPage) return [startPage];
    if (startPage > endPage) return [];
    return expandPageRange(startPage, endPage);
  }

  return [];
};

const parseMaskResidentNumber = (value) => {
  if (value === undefined || value === null || value === "") return true;
  const lowered = String(value).toLowerCase();
  if (["0", "false", "no", "off"].includes(lowered)) return false;
  return true;
};

const maskResidentNumber = (value) => {
  const input = String(value || "").trim();
  if (!input) return "";
  const digits = input.replace(/[^0-9]/g, "");
  if (digits.length < 7) return input;

  const front = digits.slice(0, 6);
  const backFirst = digits.slice(6, 7);
  const maskLength = Math.max(0, digits.length - 7);
  return `${front}-${backFirst}${"*".repeat(maskLength)}`;
};

const normalizeResidentDigits = (value) =>
  String(value || "").replace(/[^0-9]/g, "");

const parseWithholdingReceiptFilename = (filename) => {
  const base = path.basename(String(filename || ""));
  const match = base.match(
    /^(\d{6})-?(\d{7})_(\d{4}-\d{2}-\d{2})\.pdf$/i
  );
  if (!match) return null;
  const rrnDigits = `${match[1]}${match[2]}`;
  const workStartDate = match[3];
  return { rrnDigits, workStartDate, taxYear: Number(workStartDate.slice(0, 4)) };
};

const maskReceiptFilename = (filename) => {
  const base = path.basename(String(filename || ""));
  const parsed = parseWithholdingReceiptFilename(base);
  if (parsed) {
    return `******-*******_${parsed.workStartDate}.pdf`;
  }
  return base.replace(/[0-9]/g, "*");
};

const hashResidentDigits = (digits) => {
  const salt =
    process.env.RESIDENT_NUMBER_HASH_SALT ||
    process.env.SESSION_SECRET ||
    "dev-secret-change-me";
  return crypto
    .createHash("sha256")
    .update(`${salt}:${String(digits || "")}`)
    .digest("hex");
};

let oraclePoolPromise = null;

const readOracleTextValue = async (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");

  if (typeof value.getData === "function") {
    const data = await value.getData();
    if (data === null || data === undefined) return "";
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    return String(data);
  }

  if (typeof value.on === "function") {
    return await new Promise((resolve, reject) => {
      let text = "";
      try {
        if (typeof value.setEncoding === "function") {
          value.setEncoding("utf8");
        }
      } catch (error) {
      }

      value.on("data", (chunk) => {
        text += chunk;
      });
      value.on("end", () => resolve(text));
      value.on("error", reject);
    });
  }

  return String(value);
};

const normalizeOracleIdentifier = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_.$#]+(\.[A-Za-z0-9_.$#]+)*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
};

const getRequiredOracleIdentifier = (envValue, defaultValue) => {
  const candidate =
    envValue === undefined || envValue === null
      ? String(defaultValue || "").trim()
      : String(envValue).trim() || String(defaultValue || "").trim();

  const normalized = normalizeOracleIdentifier(candidate);
  if (!normalized) {
    throw new Error("Oracle 컬럼 설정이 올바르지 않습니다.");
  }
  return normalized;
};

const getOptionalOracleIdentifier = (envValue, defaultValue) => {
  if (envValue === undefined || envValue === null) {
    return normalizeOracleIdentifier(defaultValue);
  }
  const trimmed = String(envValue).trim();
  if (!trimmed) return null;
  const normalized = normalizeOracleIdentifier(trimmed);
  if (!normalized) {
    throw new Error("Oracle 컬럼 설정이 올바르지 않습니다.");
  }
  return normalized;
};

const extractOracleInvalidIdentifier = (error) => {
  const message = String(error && error.message ? error.message : "");
  const matches = [...message.matchAll(/"([^"]+)"/g)];
  if (!matches.length) return "";
  const last = matches[matches.length - 1];
  return last && last[1] ? last[1] : "";
};

const isOracleAuthConfigured = () => {
  if (!oracledb) return false;
  if (!process.env.ORACLE_DB_USER) return false;
  if (!process.env.ORACLE_DB_PASSWORD) return false;
  if (!process.env.ORACLE_DB_CONNECT_STRING) return false;
  if (!normalizeOracleIdentifier(process.env.ORACLE_EMP_TABLE)) return false;
  if (!normalizeOracleIdentifier(process.env.ORACLE_PASS_TABLE)) return false;
  return true;
};

const getOraclePool = async () => {
  if (!isOracleAuthConfigured()) return null;
  if (!oraclePoolPromise) {
    oraclePoolPromise = oracledb.createPool({
      user: process.env.ORACLE_DB_USER,
      password: process.env.ORACLE_DB_PASSWORD,
      connectString: process.env.ORACLE_DB_CONNECT_STRING,
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
      poolTimeout: 60,
    });
  }
  return oraclePoolPromise;
};

const fetchOracleEmployeeProfile = async (employeeId) => {
  const oraclePool = await getOraclePool();
  if (!oraclePool) return null;

  const employeeTable = normalizeOracleIdentifier(process.env.ORACLE_EMP_TABLE);
  if (!employeeTable) {
    throw new Error("Oracle 테이블 설정이 올바르지 않습니다.");
  }

  const employeeIdColumn = getRequiredOracleIdentifier(
    process.env.ORACLE_EMP_COL_EMPLOYEE_ID,
    "BSCSBN"
  );
  const employeeNameColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_NAME,
    "BSCNAME"
  );
  const employeeResidentNumberColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_RESIDENT_NUMBER,
    "BSCJUMNO"
  );
  const employeeJobGroupColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_JOB_GROUP,
    "BSCJGN"
  );

  let connection;
  try {
    connection = await oraclePool.getConnection();
    const selectFragments = [
      `TRIM(e.${employeeIdColumn}) AS "employeeId"`,
      employeeNameColumn
        ? `e.${employeeNameColumn} AS "name"`
        : 'NULL AS "name"',
      employeeResidentNumberColumn
        ? `e.${employeeResidentNumberColumn} AS "residentNumber"`
        : 'NULL AS "residentNumber"',
      employeeJobGroupColumn
        ? `e.${employeeJobGroupColumn} AS "jobGroup"`
        : 'NULL AS "jobGroup"',
    ];

    const result = await connection.execute(
      `
        SELECT
          ${selectFragments.join(",\n          ")}
        FROM ${employeeTable} e
        WHERE TRIM(e.${employeeIdColumn}) = :employeeId
      `,
      { employeeId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const row = result.rows?.[0] || null;
    if (!row) return null;
    row.name = await readOracleTextValue(row.name);
    row.residentNumber = await readOracleTextValue(row.residentNumber);
    row.jobGroup = await readOracleTextValue(row.jobGroup);
    return row;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (error) {
      }
    }
  }
};

const fetchOracleEmployees = async () => {
  const oraclePool = await getOraclePool();
  if (!oraclePool) return null;

  const employeeTable = normalizeOracleIdentifier(process.env.ORACLE_EMP_TABLE);
  if (!employeeTable) {
    throw new Error("Oracle 테이블 설정이 올바르지 않습니다.");
  }

  const employeeIdColumn = getRequiredOracleIdentifier(
    process.env.ORACLE_EMP_COL_EMPLOYEE_ID,
    "BSCSBN"
  );
  const employeeNameColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_NAME,
    "BSCNAME"
  );
  const employeeJobGroupColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_JOB_GROUP,
    "BSCJGN"
  );

  let connection;
  try {
    connection = await oraclePool.getConnection();
    const selectFragments = [
      `TRIM(e.${employeeIdColumn}) AS "employeeId"`,
      employeeNameColumn
        ? `e.${employeeNameColumn} AS "name"`
        : 'NULL AS "name"',
      employeeJobGroupColumn
        ? `e.${employeeJobGroupColumn} AS "team"`
        : 'NULL AS "team"',
    ];

    const result = await connection.execute(
      `
        SELECT
          ${selectFragments.join(",\n          ")}
        FROM ${employeeTable} e
        ORDER BY TRIM(e.${employeeIdColumn})
      `,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const employees = await Promise.all(
      rows.map(async (row) => {
        const employeeIdValue = normalizeString(row.employeeId);
        const nameValue = normalizeString(await readOracleTextValue(row.name));
        const teamValue = normalizeString(await readOracleTextValue(row.team));
        return { employeeId: employeeIdValue, name: nameValue, team: teamValue };
      })
    );

    return employees.filter((record) => record.employeeId);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (error) {
      }
    }
  }
};

const fetchOracleEmployeesWithResidentNumbers = async () => {
  const oraclePool = await getOraclePool();
  if (!oraclePool) return null;

  const employeeTable = normalizeOracleIdentifier(process.env.ORACLE_EMP_TABLE);
  if (!employeeTable) {
    throw new Error("Oracle 테이블 설정이 올바르지 않습니다.");
  }

  const employeeIdColumn = getRequiredOracleIdentifier(
    process.env.ORACLE_EMP_COL_EMPLOYEE_ID,
    "BSCSBN"
  );
  const employeeResidentNumberColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_RESIDENT_NUMBER,
    "BSCJUMNO"
  );

  if (!employeeResidentNumberColumn) return null;

  let connection;
  try {
    connection = await oraclePool.getConnection();

    const result = await connection.execute(
      `
        SELECT
          TRIM(e.${employeeIdColumn}) AS "employeeId",
          e.${employeeResidentNumberColumn} AS "residentNumber"
        FROM ${employeeTable} e
      `,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const employees = [];
    for (const row of rows) {
      const employeeIdValue = normalizeString(row.employeeId);
      if (!employeeIdValue) continue;

      const residentNumberValue = await readOracleTextValue(row.residentNumber);
      const residentDigits = normalizeResidentDigits(residentNumberValue);
      if (residentDigits.length !== 13) continue;

      employees.push({ employeeId: employeeIdValue, residentDigits });
    }

    return employees;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (error) {
      }
    }
  }
};

const fetchOracleLoginRecord = async (employeeId) => {
  const oraclePool = await getOraclePool();
  if (!oraclePool) return null;

  const employeeTable = normalizeOracleIdentifier(process.env.ORACLE_EMP_TABLE);
  const passwordTable = normalizeOracleIdentifier(process.env.ORACLE_PASS_TABLE);
  if (!employeeTable || !passwordTable) {
    throw new Error("Oracle 테이블 설정이 올바르지 않습니다.");
  }

  const employeeIdColumn = getRequiredOracleIdentifier(
    process.env.ORACLE_EMP_COL_EMPLOYEE_ID,
    "BSCSBN"
  );
  const employeeNameColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_NAME,
    "BSCNAME"
  );
  const employeeResidentNumberColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_RESIDENT_NUMBER,
    "BSCJUMNO"
  );
  const employeeJobGroupColumn = getOptionalOracleIdentifier(
    process.env.ORACLE_EMP_COL_JOB_GROUP,
    "BSCJGN"
  );
  const passwordUserIdColumn = getRequiredOracleIdentifier(
    process.env.ORACLE_PASS_COL_USER_ID,
    "PWDUSRID"
  );
  const passwordValueColumn = getRequiredOracleIdentifier(
    process.env.ORACLE_PASS_COL_PASSWORD,
    "ETC6"
  );

  let connection;
  try {
    connection = await oraclePool.getConnection();
    const selectFragments = [
      `TRIM(e.${employeeIdColumn}) AS "employeeId"`,
      employeeNameColumn
        ? `e.${employeeNameColumn} AS "name"`
        : 'NULL AS "name"',
      employeeResidentNumberColumn
        ? `e.${employeeResidentNumberColumn} AS "residentNumber"`
        : 'NULL AS "residentNumber"',
      employeeJobGroupColumn
        ? `e.${employeeJobGroupColumn} AS "jobGroup"`
        : 'NULL AS "jobGroup"',
      `p.${passwordValueColumn} AS "etc6"`,
    ];

    let result;
    let fallbackDiagnostics = null;
    try {
      result = await connection.execute(
        `
          SELECT
            ${selectFragments.join(",\n            ")}
          FROM ${employeeTable} e
          LEFT JOIN ${passwordTable} p
            ON TRIM(p.${passwordUserIdColumn}) = TRIM(e.${employeeIdColumn})
          WHERE TRIM(e.${employeeIdColumn}) = :employeeId
        `,
        { employeeId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
    } catch (error) {
      const oracleErrorCode = error && error.code ? String(error.code) : "";
      if (["ORA-00904", "ORA-00942"].includes(oracleErrorCode)) {
        fallbackDiagnostics = {
          code: oracleErrorCode,
          invalidIdentifier: extractOracleInvalidIdentifier(error),
        };
        result = await connection.execute(
          `
            SELECT
              TRIM(p.${passwordUserIdColumn}) AS "employeeId",
              NULL AS "name",
              NULL AS "residentNumber",
              NULL AS "jobGroup",
              p.${passwordValueColumn} AS "etc6"
            FROM ${passwordTable} p
            WHERE TRIM(p.${passwordUserIdColumn}) = :employeeId
          `,
          { employeeId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
      } else {
        throw error;
      }
    }

    const row = result.rows?.[0] || null;
    if (!row) return null;
    row.etc6 = await readOracleTextValue(row.etc6);
    row.name = await readOracleTextValue(row.name);
    row.residentNumber = await readOracleTextValue(row.residentNumber);
    row.jobGroup = await readOracleTextValue(row.jobGroup);
    if (fallbackDiagnostics) {
      row.__oracleFallbackDiagnostics = fallbackDiagnostics;
    }
    return row;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (error) {
      }
    }
  }
};

app.post("/api/login", async (req, res) => {
  const employeeId = normalizeString(req.body?.employeeId);
  const password = normalizeString(req.body?.password);

  if (!employeeId || !password) {
    return res.status(400).json({ message: "사번과 비밀번호를 입력해주세요." });
  }

  const useOracleAuth = isOracleAuthConfigured();
  res.set("X-Auth-Backend", useOracleAuth ? "oracle" : "local");
  if (useOracleAuth) {
    const oracleMode =
      oracledb && typeof oracledb.thin === "boolean"
        ? oracledb.thin
          ? "thin"
          : "thick"
        : "unknown";
    res.set("X-Oracle-Mode", oracleMode);
  }

  if (useOracleAuth) {
    try {
      const oracleRecord = await fetchOracleLoginRecord(employeeId);
      if (!oracleRecord) {
        return res
          .status(401)
          .json({ message: "사번 또는 비밀번호가 올바르지 않습니다." });
      }

      if (oracleRecord.__oracleFallbackDiagnostics) {
        const { code, invalidIdentifier } =
          oracleRecord.__oracleFallbackDiagnostics;
        if (code) {
          res.set("X-Oracle-Query-Fallback", code);
        }
        if (invalidIdentifier) {
          res.set("X-Oracle-Invalid-Identifier", invalidIdentifier);
        }
      }

      const expectedPassword = normalizeString(oracleRecord.etc6);

      if (!expectedPassword || expectedPassword !== password) {
        return res
          .status(401)
          .json({ message: "사번 또는 비밀번호가 올바르지 않습니다." });
      }

      const { rows } = await pool.query(
        `
          SELECT employee_id, password, name, team, join_date, retirement_date, is_admin, address, resident_number
          FROM employees
          WHERE employee_id = $1
        `,
        [employeeId]
      );
      let employee = rows[0];

      if (!employee) {
        const { rows: maybeMatches } = await pool.query(
          "SELECT employee_id, password, name, team, join_date, retirement_date, is_admin, address, resident_number FROM employees WHERE TRIM(employee_id) = $1",
          [employeeId]
        );
        employee = maybeMatches.find(
          (record) => normalizeString(record.employee_id) === employeeId
        );
      }

      const oracleName = normalizeString(oracleRecord.name);
      const oracleResidentNumber = normalizeString(oracleRecord.residentNumber);
      const oracleJobGroup = normalizeString(oracleRecord.jobGroup);
      let oracleProfile = null;
      if (!oracleName || !oracleResidentNumber || !oracleJobGroup) {
        try {
          oracleProfile = await fetchOracleEmployeeProfile(employeeId);
        } catch (profileError) {
          console.error("Oracle 프로필 조회 실패", profileError);
        }
      }

      const oracleProfileName = normalizeString(oracleProfile?.name);
      const oracleProfileResidentNumber = normalizeString(
        oracleProfile?.residentNumber
      );
      const oracleProfileJobGroup = normalizeString(oracleProfile?.jobGroup);
      const resolvedOracleName = oracleProfileName || oracleName;
      const resolvedOracleResidentNumber =
        oracleProfileResidentNumber || oracleResidentNumber;
      const resolvedOracleTeam = oracleProfileJobGroup || oracleJobGroup;

      if (employee) {
        const mappedEmployee = mapEmployee(employee);
        req.session.employee = {
          ...mappedEmployee,
          employeeId: normalizeString(employee.employee_id),
          name: resolvedOracleName || mappedEmployee.name,
          team: resolvedOracleTeam || mappedEmployee.team,
          residentNumber:
            mappedEmployee.residentNumber || resolvedOracleResidentNumber || "",
        };

        const shouldSyncName =
          resolvedOracleName && normalizeString(employee.name) !== resolvedOracleName;
        const shouldSyncTeam =
          resolvedOracleTeam && normalizeString(employee.team) !== resolvedOracleTeam;
        if (shouldSyncName || shouldSyncTeam) {
          try {
            const fragments = [];
            const values = [];
            let idx = 1;
            if (shouldSyncName) {
              fragments.push(`name = $${idx}`);
              values.push(resolvedOracleName);
              idx += 1;
            }
            if (shouldSyncTeam) {
              fragments.push(`team = $${idx}`);
              values.push(resolvedOracleTeam);
              idx += 1;
            }
            values.push(employeeId);
            await pool.query(
              `UPDATE employees SET ${fragments.join(", ")} WHERE employee_id = $${idx}`,
              values
            );
          } catch (syncError) {
            console.error("Oracle 프로필 동기화 실패", syncError);
          }
        }
      } else {
        req.session.employee = {
          employeeId,
          name: resolvedOracleName || employeeId,
          team: resolvedOracleTeam || "",
          joinDate: "",
          retirementDate: "",
          isAdmin: false,
          address: "",
          residentNumber: resolvedOracleResidentNumber || "",
        };
      }

      return res.json({ employee: req.session.employee });
    } catch (error) {
      console.error("Oracle 로그인 실패", error);
      const oracleErrorCode = error && error.code ? String(error.code) : "";
      res.set("X-Oracle-Error-Code", oracleErrorCode);
      if (oracleErrorCode === "ORA-00904") {
        const invalidIdentifier = extractOracleInvalidIdentifier(error);
        if (invalidIdentifier) {
          res.set("X-Oracle-Invalid-Identifier", invalidIdentifier);
        }
      }
      return res
        .status(500)
        .json({ message: "로그인 처리 중 오류가 발생했습니다." });
    }
  }

  const { rows } = await pool.query(
    `
      SELECT employee_id, password, name, team, join_date, retirement_date, is_admin, address, resident_number
      FROM employees
      WHERE employee_id = $1
    `,
    [employeeId]
  );
  let employee = rows[0];

  if (!employee) {
    const { rows: maybeMatches } = await pool.query(
      "SELECT employee_id, password, name, team, join_date, retirement_date, is_admin, address, resident_number FROM employees WHERE TRIM(employee_id) = $1",
      [employeeId]
    );
    employee = maybeMatches.find(
      (record) => normalizeString(record.employee_id) === employeeId
    );
  }

  if (!employee || normalizeString(employee.password) !== password) {
    return res
      .status(401)
      .json({ message: "사번 또는 비밀번호가 올바르지 않습니다." });
  }

  req.session.employee = {
    ...mapEmployee(employee),
    employeeId: normalizeString(employee.employee_id),
  };
  return res.json({ employee: req.session.employee });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, async (req, res) => {
  if (!req.session.employee.isAdmin) {
    return res.json({
      employee: req.session.employee,
      certificates: certificateLibrary,
      employees: [],
    });
  }

  if (isOracleAuthConfigured()) {
    try {
      const employees = await fetchOracleEmployees();
      return res.json({
        employee: req.session.employee,
        certificates: certificateLibrary,
        employees: employees || [],
      });
    } catch (error) {
      console.error("Oracle 사원 목록 조회 실패", error);
    }
  }

  const { rows } = await pool.query(
    "SELECT employee_id, name, team, join_date, retirement_date, is_admin, address, resident_number FROM employees"
  );
  return res.json({
    employee: req.session.employee,
    certificates: certificateLibrary,
    employees: rows.map(mapEmployee),
  });
});

app.get("/api/employees", requireAuth, requireAdmin, async (req, res) => {
  if (isOracleAuthConfigured()) {
    try {
      const employees = await fetchOracleEmployees();
      return res.json({ employees: employees || [] });
    } catch (error) {
      console.error("Oracle 사원 목록 조회 실패", error);
    }
  }

  const { rows } = await pool.query(
    "SELECT employee_id, name, team, join_date, retirement_date, is_admin, address, resident_number FROM employees"
  );
  return res.json({ employees: rows.map(mapEmployee) });
});

app.post("/api/employees", requireAuth, requireAdmin, async (req, res) => {

  const {
    employeeId,
    password,
    name,
    team,
    joinDate,
    retirementDate,
    address,
    residentNumber,
  } = req.body;

  const employeeIdValue = normalizeString(employeeId);
  const passwordValue = normalizeString(password);
  const nameValue = normalizeString(name);
  const teamValue = normalizeString(team);
  const joinDateValue = normalizeString(joinDate);
  const retirementDateValue = normalizeString(retirementDate);
  const addressValue = normalizeString(address);
  const residentNumberValue = normalizeString(residentNumber);

  if (!employeeIdValue || !passwordValue || !nameValue || !teamValue || !joinDateValue) {
    return res.status(400).json({ message: "필수 항목을 입력해주세요." });
  }

  const { rows: existing } = await pool.query(
    "SELECT employee_id FROM employees WHERE employee_id = $1",
    [employeeIdValue]
  );
  if (existing.length > 0) {
    return res.status(409).json({ message: "이미 등록된 사번입니다." });
  }

  const { rows: existingTrimmed } = await pool.query(
    "SELECT employee_id FROM employees WHERE TRIM(employee_id) = $1",
    [employeeIdValue]
  );
  const hasTrimmedConflict = existingTrimmed.some(
    (record) => normalizeString(record.employee_id) === employeeIdValue
  );
  if (hasTrimmedConflict) {
    return res.status(409).json({ message: "이미 등록된 사번입니다." });
  }

  const { rows } = await pool.query(
    `
      INSERT INTO employees
        (employee_id, password, name, team, join_date, retirement_date, is_admin, address, resident_number)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING employee_id, name, team, join_date, retirement_date, is_admin, address, resident_number
    `,
    [
      employeeIdValue,
      passwordValue,
      nameValue,
      teamValue,
      joinDateValue,
      retirementDateValue || null,
      false,
      addressValue || null,
      residentNumberValue || null,
    ]
  );

  return res.status(201).json({ employee: mapEmployee(rows[0]) });
});

app.put("/api/employees/:id", requireAuth, requireAdmin, async (req, res) => {
  const {
    password,
    name,
    team,
    joinDate,
    retirementDate,
    isAdmin,
    address,
    residentNumber,
  } = req.body;

  const passwordValue = password === undefined ? null : normalizeString(password) || null;
  const nameValue = name === undefined ? null : normalizeString(name) || null;
  const teamValue = team === undefined ? null : normalizeString(team) || null;
  const joinDateValue = joinDate === undefined ? null : normalizeString(joinDate) || null;
  const retirementDateValue =
    retirementDate === undefined ? null : normalizeString(retirementDate);
  const addressValue =
    address === undefined || address === null ? null : normalizeString(address);
  const residentNumberValue =
    residentNumber === undefined || residentNumber === null
      ? null
      : normalizeString(residentNumber);

  const { rows: existing } = await pool.query(
    "SELECT employee_id FROM employees WHERE employee_id = $1",
    [req.params.id]
  );
  if (existing.length === 0) {
    return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
  }

  const { rows } = await pool.query(
    `
      UPDATE employees
      SET
        password = COALESCE($1, password),
        name = COALESCE($2, name),
        team = COALESCE($3, team),
        join_date = COALESCE($4, join_date),
        retirement_date = $5,
        is_admin = COALESCE($6, is_admin),
        address = COALESCE($7, address),
        resident_number = COALESCE($8, resident_number)
      WHERE employee_id = $9
      RETURNING employee_id, name, team, join_date, retirement_date, is_admin, address, resident_number
    `,
    [
      passwordValue,
      nameValue,
      teamValue,
      joinDateValue,
      retirementDateValue === "" ? null : retirementDateValue ?? null,
      typeof isAdmin === "boolean" ? isAdmin : null,
      addressValue,
      residentNumberValue,
      req.params.id,
    ]
  );

  return res.json({ employee: mapEmployee(rows[0]) });
});

app.delete("/api/employees/:id", requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM employees WHERE employee_id = $1 RETURNING employee_id, name, team, join_date, retirement_date, is_admin, address, resident_number",
    [req.params.id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
  }
  return res.json({ employee: mapEmployee(rows[0]) });
});

app.post(
  "/api/admin/withholding-receipts/upload",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "업로드 파일이 필요합니다." });
      }

      const requestedTaxYear = toPositiveInteger(req.body?.taxYear);
      const { rows: employees } = await pool.query(
        "SELECT employee_id, resident_number FROM employees"
      );
      const employeeByResidentDigits = new Map();
      employees.forEach((record) => {
        const digits = normalizeResidentDigits(record.resident_number);
        if (!digits) return;
        employeeByResidentDigits.set(digits, normalizeString(record.employee_id));
      });

      const results = [];
      let importedCount = 0;
      let matchedCount = 0;
      let stagedCount = 0;

      const importOne = async (originalName, buffer) => {
        const parsed = parseWithholdingReceiptFilename(originalName);
        if (!parsed) {
          results.push({
            filename: maskReceiptFilename(originalName),
            ok: false,
            reason: "filename_parse_failed",
          });
          return;
        }

        const taxYear = requestedTaxYear || parsed.taxYear;
        if (!taxYear) {
          results.push({
            filename: maskReceiptFilename(originalName),
            ok: false,
            reason: "missing_tax_year",
          });
          return;
        }

        const residentHash = hashResidentDigits(parsed.rrnDigits);
        const employeeId = employeeByResidentDigits.get(parsed.rrnDigits);

        if (employeeId) {
          await pool.query(
            `
              INSERT INTO withholding_receipts
                (employee_id, tax_year, work_start_date, resident_number_hash, pdf_bytes)
              VALUES
                ($1, $2, $3, $4, $5)
              ON CONFLICT (employee_id, tax_year)
              DO UPDATE SET
                work_start_date = EXCLUDED.work_start_date,
                resident_number_hash = EXCLUDED.resident_number_hash,
                pdf_bytes = EXCLUDED.pdf_bytes,
                uploaded_at = NOW()
            `,
            [
              employeeId,
              taxYear,
              parsed.workStartDate || null,
              residentHash,
              buffer,
            ]
          );

          importedCount += 1;
          matchedCount += 1;
          results.push({
            filename: maskReceiptFilename(originalName),
            ok: true,
            storedAs: "employee",
            employeeId,
            taxYear,
            workStartDate: parsed.workStartDate,
          });
          return;
        }

        await pool.query(
          `
            INSERT INTO withholding_receipts_staged
              (resident_number_hash, tax_year, work_start_date, pdf_bytes)
            VALUES
              ($1, $2, $3, $4)
            ON CONFLICT (resident_number_hash, tax_year)
            DO UPDATE SET
              work_start_date = EXCLUDED.work_start_date,
              pdf_bytes = EXCLUDED.pdf_bytes,
              uploaded_at = NOW()
          `,
          [residentHash, taxYear, parsed.workStartDate || null, buffer]
        );

        importedCount += 1;
        stagedCount += 1;
        results.push({
          filename: maskReceiptFilename(originalName),
          ok: true,
          storedAs: "staged",
          taxYear,
          workStartDate: parsed.workStartDate,
        });
      };

      const lowerName = String(file.originalname || "").toLowerCase();
      if (lowerName.endsWith(".zip")) {
        const zip = new AdmZip(file.buffer);
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          const entryName = entry.entryName || "";
          if (!String(entryName).toLowerCase().endsWith(".pdf")) continue;
          await importOne(entryName, entry.getData());
        }
      } else {
        await importOne(file.originalname, file.buffer);
      }

      const skippedCount = results.length - importedCount;
      const includeResultsRaw = String(req.query?.details || "").toLowerCase();
      const includeResults = ["1", "true", "yes", "on"].includes(
        includeResultsRaw
      );
      const responsePayload = {
        importedCount,
        matchedCount,
        stagedCount,
        skippedCount,
      };
      if (includeResults) {
        responsePayload.results = results;
      }
      return res.json(responsePayload);
    } catch (error) {
      console.error("원천징수 영수증 업로드 실패", error);
      return res
        .status(500)
        .json({ message: "원천징수 영수증 업로드에 실패했습니다." });
    }
  }
);

app.post(
  "/api/admin/withholding-receipts/auto-link",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const requestedTaxYear = toPositiveInteger(req.body?.taxYear);

      const includeResultsRaw = String(req.query?.details || "").toLowerCase();
      const includeResults = ["1", "true", "yes", "on"].includes(
        includeResultsRaw
      );

      const { rows: stagedRows } = await pool.query(
        "SELECT resident_number_hash, tax_year, work_start_date, pdf_bytes FROM withholding_receipts_staged"
      );

      const normalizedStaged = (stagedRows || [])
        .map((row) => ({
          ...row,
          taxYear: Number(row.tax_year),
        }))
        .filter((row) => Number.isFinite(row.taxYear));

      const targets = requestedTaxYear
        ? normalizedStaged.filter((row) => row.taxYear === requestedTaxYear)
        : normalizedStaged;

      const { rows: employees } = await pool.query(
        "SELECT employee_id, resident_number FROM employees"
      );
      const employeeIdSet = new Set(
        (employees || [])
          .map((row) => normalizeString(row.employee_id))
          .filter(Boolean)
      );

      const residentHashToEmployee = new Map();
      const conflictingHashes = new Set();
      let postgresHashCount = 0;
      let oracleHashCount = 0;
      let oracleLookupOk = false;

      const upsertMapping = (residentHash, employeeId, existsInEmployees) => {
        if (!residentHash || !employeeId) return;
        if (conflictingHashes.has(residentHash)) return;

        const existing = residentHashToEmployee.get(residentHash);
        if (!existing) {
          residentHashToEmployee.set(residentHash, {
            employeeId,
            existsInEmployees: Boolean(existsInEmployees),
          });
          return;
        }

        if (existing.employeeId === employeeId) {
          if (existsInEmployees && !existing.existsInEmployees) {
            residentHashToEmployee.set(residentHash, {
              employeeId,
              existsInEmployees: true,
            });
          }
          return;
        }

        conflictingHashes.add(residentHash);
        residentHashToEmployee.delete(residentHash);
      };

      (employees || []).forEach((row) => {
        const employeeId = normalizeString(row.employee_id);
        if (!employeeId) return;

        const digits = normalizeResidentDigits(row.resident_number);
        if (digits.length !== 13) return;
        const residentHash = hashResidentDigits(digits);
        upsertMapping(residentHash, employeeId, true);
        postgresHashCount += 1;
      });

      if (isOracleAuthConfigured()) {
        try {
          const oracleEmployees = await fetchOracleEmployeesWithResidentNumbers();
          if (oracleEmployees) {
            oracleLookupOk = true;
            oracleEmployees.forEach((record) => {
              const employeeId = normalizeString(record.employeeId);
              if (!employeeId) return;
              const digits = normalizeResidentDigits(record.residentDigits);
              if (digits.length !== 13) return;

              const residentHash = hashResidentDigits(digits);
              const existsInEmployees = employeeIdSet.has(employeeId);
              upsertMapping(residentHash, employeeId, existsInEmployees);
              oracleHashCount += 1;
            });
          }
        } catch (oracleError) {
          console.error("Oracle 주민등록번호 조회 실패", oracleError);
        }
      }

      const results = [];
      let linkedCount = 0;
      let noMatchCount = 0;
      let conflictCount = 0;
      let missingEmployeeRowCount = 0;
      let errorCount = 0;

      for (const row of targets) {
        const residentHash = normalizeString(row.resident_number_hash);
        const taxYear = row.taxYear;

        if (!residentHash) {
          noMatchCount += 1;
          if (includeResults) {
            results.push({ ok: false, taxYear, reason: "missing_resident_hash" });
          }
          continue;
        }

        if (conflictingHashes.has(residentHash)) {
          conflictCount += 1;
          if (includeResults) {
            results.push({ ok: false, taxYear, reason: "ambiguous_match" });
          }
          continue;
        }

        const mapping = residentHashToEmployee.get(residentHash);
        if (!mapping) {
          noMatchCount += 1;
          if (includeResults) {
            results.push({ ok: false, taxYear, reason: "no_employee_match" });
          }
          continue;
        }

        if (!mapping.existsInEmployees) {
          missingEmployeeRowCount += 1;
          if (includeResults) {
            results.push({
              ok: false,
              taxYear,
              reason: "employee_not_registered",
              employeeId: mapping.employeeId,
            });
          }
          continue;
        }

        try {
          const pdfBytes = Buffer.isBuffer(row.pdf_bytes)
            ? row.pdf_bytes
            : Buffer.from(row.pdf_bytes);

          await pool.query(
            `
              INSERT INTO withholding_receipts
                (employee_id, tax_year, work_start_date, resident_number_hash, pdf_bytes)
              VALUES
                ($1, $2, $3, $4, $5)
              ON CONFLICT (employee_id, tax_year)
              DO UPDATE SET
                work_start_date = EXCLUDED.work_start_date,
                resident_number_hash = EXCLUDED.resident_number_hash,
                pdf_bytes = EXCLUDED.pdf_bytes,
                uploaded_at = NOW()
            `,
            [
              mapping.employeeId,
              taxYear,
              row.work_start_date || null,
              residentHash,
              pdfBytes,
            ]
          );

          await pool.query(
            "DELETE FROM withholding_receipts_staged WHERE resident_number_hash = $1 AND tax_year = $2",
            [residentHash, taxYear]
          );

          linkedCount += 1;
          if (includeResults) {
            results.push({
              ok: true,
              taxYear,
              employeeId: mapping.employeeId,
            });
          }
        } catch (linkError) {
          errorCount += 1;
          console.error("원천징수 영수증 자동 매칭 실패", linkError);
          if (includeResults) {
            results.push({ ok: false, taxYear, reason: "link_failed" });
          }
        }
      }

      const responsePayload = {
        taxYear: requestedTaxYear || null,
        stagedTotalCount: normalizedStaged.length,
        targetCount: targets.length,
        linkedCount,
        remainingStagedCount: Math.max(0, normalizedStaged.length - linkedCount),
        noMatchCount,
        conflictCount,
        missingEmployeeRowCount,
        errorCount,
        employeeHashSources: {
          postgres: postgresHashCount,
          oracle: oracleHashCount,
        },
        oracleUsed: oracleLookupOk,
      };
      if (includeResults) {
        responsePayload.results = results;
      }

      return res.json(responsePayload);
    } catch (error) {
      console.error("원천징수 영수증 자동 매칭 처리 실패", error);
      return res
        .status(500)
        .json({ message: "원천징수 영수증 자동 매칭에 실패했습니다." });
    }
  }
);

app.post(
  "/api/admin/withholding-receipts/link",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const employeeId = normalizeString(req.body?.employeeId);
      const employeeName = normalizeString(req.body?.name);
      const residentDigits = normalizeResidentDigits(req.body?.residentNumber);
      const requestedTaxYear = toPositiveInteger(req.body?.taxYear);

      if (!employeeId || !employeeName || !residentDigits) {
        return res
          .status(400)
          .json({ message: "사번, 이름, 주민등록번호를 입력해주세요." });
      }

      if (residentDigits.length !== 13) {
        return res
          .status(400)
          .json({ message: "주민등록번호 형식이 올바르지 않습니다." });
      }

      const { rows: employees } = await pool.query(
        "SELECT employee_id, name, team FROM employees WHERE employee_id = $1",
        [employeeId]
      );
      const employee = employees[0];
      if (!employee) {
        return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
      }

      const actualName = normalizeString(employee.name);
      let oracleNameForValidation = "";
      let oracleTeamForSync = "";
      if (isOracleAuthConfigured()) {
        try {
          const oracleProfile = await fetchOracleEmployeeProfile(employeeId);
          oracleNameForValidation = normalizeString(oracleProfile?.name);
          oracleTeamForSync = normalizeString(oracleProfile?.jobGroup);

          if (oracleNameForValidation && oracleNameForValidation !== employeeName) {
            return res
              .status(400)
              .json({ message: "사번과 이름이 일치하지 않습니다." });
          }

          const shouldSyncName =
            oracleNameForValidation && actualName !== oracleNameForValidation;
          const shouldSyncTeam =
            oracleTeamForSync && normalizeString(employee.team) !== oracleTeamForSync;
          if (shouldSyncName || shouldSyncTeam) {
            const fragments = [];
            const values = [];
            let idx = 1;
            if (shouldSyncName) {
              fragments.push(`name = $${idx}`);
              values.push(oracleNameForValidation);
              idx += 1;
            }
            if (shouldSyncTeam) {
              fragments.push(`team = $${idx}`);
              values.push(oracleTeamForSync);
              idx += 1;
            }
            values.push(employeeId);
            await pool.query(
              `UPDATE employees SET ${fragments.join(", ")} WHERE employee_id = $${idx}`,
              values
            );
          }
        } catch (oracleError) {
          console.error("Oracle 프로필 조회 실패", oracleError);
        }
      }

      if (!oracleNameForValidation && actualName && actualName !== employeeName) {
        return res.status(400).json({ message: "사번과 이름이 일치하지 않습니다." });
      }

      const residentHash = hashResidentDigits(residentDigits);
      const { rows: stagedRows } = await pool.query(
        "SELECT resident_number_hash, tax_year, work_start_date, pdf_bytes FROM withholding_receipts_staged WHERE resident_number_hash = $1",
        [residentHash]
      );

      const normalizedStaged = (stagedRows || [])
        .map((row) => ({
          ...row,
          taxYear: Number(row.tax_year),
        }))
        .filter((row) => Number.isFinite(row.taxYear));

      const selected = requestedTaxYear
        ? normalizedStaged.filter((row) => row.taxYear === requestedTaxYear)
        : normalizedStaged;

      if (selected.length === 0) {
        return res.status(404).json({
          message: "매칭할 스테이징 영수증을 찾을 수 없습니다.",
        });
      }

      const linkedTaxYears = [];
      for (const row of selected) {
        const taxYear = row.taxYear;
        const pdfBytes = Buffer.isBuffer(row.pdf_bytes)
          ? row.pdf_bytes
          : Buffer.from(row.pdf_bytes);

        await pool.query(
          `
            INSERT INTO withholding_receipts
              (employee_id, tax_year, work_start_date, resident_number_hash, pdf_bytes)
            VALUES
              ($1, $2, $3, $4, $5)
            ON CONFLICT (employee_id, tax_year)
            DO UPDATE SET
              work_start_date = EXCLUDED.work_start_date,
              resident_number_hash = EXCLUDED.resident_number_hash,
              pdf_bytes = EXCLUDED.pdf_bytes,
              uploaded_at = NOW()
          `,
          [
            employeeId,
            taxYear,
            row.work_start_date || null,
            residentHash,
            pdfBytes,
          ]
        );

        await pool.query(
          "DELETE FROM withholding_receipts_staged WHERE resident_number_hash = $1 AND tax_year = $2",
          [residentHash, taxYear]
        );

        linkedTaxYears.push(taxYear);
      }

      linkedTaxYears.sort((a, b) => a - b);
      return res.json({
        employeeId,
        linkedCount: linkedTaxYears.length,
        taxYears: linkedTaxYears,
      });
    } catch (error) {
      console.error("원천징수 영수증 매칭 실패", error);
      return res
        .status(500)
        .json({ message: "원천징수 영수증 매칭에 실패했습니다." });
    }
  }
);

app.get("/api/certificates/:id", requireAuth, async (req, res) => {

  const certificate = certificateLibrary.find((item) => item.id === req.params.id);
  if (!certificate) {
    return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
  }

  if (certificate.id === "withholding") {
    try {
      const employeeId = req.session.employee.employeeId;

      const requestedTaxYear = toPositiveInteger(req.query.taxYear);
      const { rows } = await pool.query(
        "SELECT employee_id, tax_year, pdf_bytes FROM withholding_receipts WHERE employee_id = $1",
        [employeeId]
      );
      const sorted = rows
        .map((row) => ({
          ...row,
          taxYear: Number(row.tax_year),
        }))
        .filter((row) => Number.isFinite(row.taxYear))
        .sort((a, b) => b.taxYear - a.taxYear);

      const selected = requestedTaxYear
        ? sorted.find((row) => row.taxYear === requestedTaxYear)
        : sorted[0];

      if (selected?.pdf_bytes) {
        const pdfBytes = Buffer.isBuffer(selected.pdf_bytes)
          ? selected.pdf_bytes
          : Buffer.from(selected.pdf_bytes);
        const downloadFilename = selected.taxYear
          ? `withholding_tax_receipt_${selected.taxYear}.pdf`
          : certificate.filename;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${downloadFilename}"`
        );
        return res.status(200).send(pdfBytes);
      }

      if (!fs.existsSync(WITHHOLDING_MASTER_PDF_PATH)) {
        return res.status(404).json({
          message: "해당 사번의 원천징수 영수증을 찾을 수 없습니다.",
        });
      }

      if (!fs.existsSync(WITHHOLDING_PAGE_MAP_PATH)) {
        return res.status(404).json({
          message: "해당 사번의 원천징수 영수증을 찾을 수 없습니다.",
        });
      }

      const mapRaw = fs.readFileSync(WITHHOLDING_PAGE_MAP_PATH, "utf8");
      const pageMap = mapRaw ? JSON.parse(mapRaw) : {};
      const entry = pageMap?.[employeeId];
      const pages = normalizeWithholdingPages(entry);

      if (!pages.length) {
        return res.status(404).json({
          message: "해당 사번의 원천징수 영수증을 찾을 수 없습니다.",
        });
      }

      const sourceBytes = fs.readFileSync(WITHHOLDING_MASTER_PDF_PATH);
      const sourceDoc = await PDFLibDocument.load(sourceBytes);
      const pageCount = sourceDoc.getPageCount();
      const uniquePages = Array.from(new Set(pages)).sort((a, b) => a - b);

      const invalidPages = uniquePages.filter(
        (page) => page < 1 || page > pageCount
      );
      if (invalidPages.length > 0) {
        return res.status(400).json({
          message: "원천징수 영수증 페이지 정보가 올바르지 않습니다.",
        });
      }

      const indices = uniquePages.map((page) => page - 1);
      const outputDoc = await PDFLibDocument.create();
      const copiedPages = await outputDoc.copyPages(sourceDoc, indices);
      copiedPages.forEach((page) => outputDoc.addPage(page));
      const outputBytes = await outputDoc.save();

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${certificate.filename}"`
      );

      return res.status(200).send(Buffer.from(outputBytes));
    } catch (error) {
      console.error("원천징수 영수증 PDF 추출 실패", error);
      return res
        .status(500)
        .json({ message: "원천징수 영수증 PDF 생성에 실패했습니다." });
    }
  }

  try {
    const issuedAt = new Date();
    const issuedAtText = issuedAt.toLocaleString("ko-KR");
    const documentNumber = `${certificate.id.toUpperCase()}-${
      req.session.employee.employeeId
    }-${issuedAt.getTime().toString().slice(-6)}`;

    const baseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`)
      .replace(/\/$/, "");
    const verifyUrl = `${baseUrl}/verify/${encodeURIComponent(documentNumber)}`;

    const residentNumberRaw = String(req.session.employee.residentNumber || "").trim();
    const shouldMaskResidentNumber = parseMaskResidentNumber(
      req.query.maskResidentNumber
    );
    const residentNumberForVerify = shouldMaskResidentNumber
      ? maskResidentNumber(residentNumberRaw)
      : residentNumberRaw;
    const residentNumberForPdf = residentNumberRaw;

    const issuePayload = {
      documentNumber,
      certificateId: certificate.id,
      certificateTitle: certificate.title,
      issuedAt: issuedAt.toISOString(),
      issuedAtText,
      employee: {
        employeeId: req.session.employee.employeeId,
        name: req.session.employee.name,
        address: req.session.employee.address || "",
        residentNumber: residentNumberForVerify,
        team: req.session.employee.team,
        joinDate: req.session.employee.joinDate,
        retirementDate: req.session.employee.retirementDate || "",
      },
    };

    await pool.query(
      `
        INSERT INTO certificate_issues
          (document_number, certificate_id, employee_id, issued_at, payload)
        VALUES
          ($1, $2, $3, $4, $5)
        ON CONFLICT (document_number) DO NOTHING
      `,
      [
        documentNumber,
        certificate.id,
        req.session.employee.employeeId,
        issuedAt.toISOString(),
        issuePayload,
      ]
    );

    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 1,
      width: 180,
    });
    const qrImage = Buffer.from(qrDataUrl.split(",")[1], "base64");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${certificate.filename}"`
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    const fontCandidates = [
      path.join(__dirname, "assets", "NotoSansKR-Regular.ttf"),
      path.join(
        __dirname,
        "assets",
        "Noto_Sans_KR",
        "static",
        "NotoSansKR-Regular.ttf"
      ),
      path.join(
        __dirname,
        "assets",
        "Noto_Sans_KR",
        "NotoSansKR-VariableFont_wght.ttf"
      ),
    ];

    const selectedFont = fontCandidates.find((candidate) =>
      fs.existsSync(candidate)
    );
    if (selectedFont) {
      doc.font(selectedFont);
    }

    const logoCandidates = [
      path.join(__dirname, "assets", "cams_tr2.png"),
      path.join(__dirname, "assets", "cams_TR2.png"),
    ];
    const selectedLogo = logoCandidates.find((candidate) =>
      fs.existsSync(candidate)
    );

    const headerTop = doc.page.margins.top;
    const headerLeft = doc.page.margins.left;
    const logoSize = 40;

    if (selectedLogo) {
      try {
        doc.image(selectedLogo, headerLeft, headerTop - 4, { width: logoSize });
      } catch (logoError) {}
    }

    const companyTextX = selectedLogo
      ? headerLeft + logoSize + 10
      : headerLeft;
    doc.fontSize(13).fillColor("#444").text("(주)캠스", companyTextX, headerTop + 10);

    doc.y = headerTop + (selectedLogo ? logoSize : 26) + 10;
    doc.fontSize(20).fillColor("#111").text(certificate.title, {
      align: "center",
    });
    doc
      .moveDown(0.6)
      .lineWidth(1)
      .strokeColor("#d4c8bb")
      .moveTo(50, doc.y)
      .lineTo(doc.page.width - 50, doc.y)
      .stroke();

    doc.moveDown(1.2);
    doc.fontSize(12).fillColor("#222");
    const labelX = 70;
    const valueX = 150;
    const rowGap = 22;
    let cursorY = doc.y;

    const rows = [
      ["성명", req.session.employee.name],
      ["주민등록번호", residentNumberForPdf],
      ["주소", req.session.employee.address || ""],
      ["소속팀", req.session.employee.team],
      ["입사일자", req.session.employee.joinDate],
      ["퇴직일자", req.session.employee.retirementDate || "재직 중"],
      ["발급일시", issuedAtText],
      ["문서번호", documentNumber],
    ];

    const valueWidth = doc.page.width - doc.page.margins.right - valueX;
    rows.forEach(([label, value]) => {
      const displayValue =
        value === undefined || value === null || value === "" ? "-" : String(value);

      doc.fontSize(11).fillColor("#666").text(label, labelX, cursorY);
      doc.fontSize(12).fillColor("#222");
      const valueHeight = doc.heightOfString(displayValue, { width: valueWidth });
      doc.text(displayValue, valueX, cursorY, { width: valueWidth });
      cursorY += Math.max(rowGap, valueHeight + 6);
    });

    const stampWidth = 220;
    const stampHeight = 70;
    const stampX = doc.page.width - stampWidth - 50;
    const safeBottom = doc.page.height - doc.page.margins.bottom;
    const stampPaddingBottom = 14;
    const qrSize = 110;
    const issueInfoHeight = 44;
    const stampBlockHeight = stampHeight + stampPaddingBottom + qrSize + issueInfoHeight;
    const stampY = safeBottom - stampBlockHeight;

    doc
      .save()
      .rect(stampX, stampY, stampWidth, stampHeight)
      .lineWidth(2)
      .strokeColor("#b4382d")
      .stroke()
      .fontSize(12)
      .fillColor("#b4382d")
      .text("(주)캠스", stampX + 12, stampY + 14)
      .fontSize(13)
      .text("전자발급 확인", stampX + 12, stampY + 36);

    const qrX = stampX + stampWidth - qrSize;
    const qrY = stampY + stampHeight + stampPaddingBottom;
    doc.image(qrImage, qrX, qrY, { width: qrSize });

    doc
      .fontSize(9)
      .fillColor("#444")
      .text(`발급일시: ${issuedAtText}`, stampX, qrY + qrSize + 8)
      .text(`문서번호: ${documentNumber}`, stampX, qrY + qrSize + 22);

    doc.restore();
    doc.end();
  } catch (error) {
    res.status(500).json({ message: "PDF 생성에 실패했습니다." });
  }
});

app.get("/verify/:documentNumber", async (req, res) => {
  const documentNumber = req.params.documentNumber;

  try {
    const { rows } = await pool.query(
      "SELECT document_number, certificate_id, issued_at, payload FROM certificate_issues WHERE document_number = $1",
      [documentNumber]
    );

    if (rows.length === 0) {
      return res.status(404).send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/styles.css" />
  <title>캠스 증명서 발급 - 문서 확인 실패</title>
</head>
<body>
  <div class="app">
    <header class="hero">
      <div class="hero__content">
        <div class="hero__brand">
          <img class="hero__logo" src="/assets/cams_TR2.png" alt="CAMS 로고" />
          <div>
            <p class="hero__label">전자발급 확인</p>
            <h1 class="hero__title">캠스 증명서 발급</h1>
          </div>
        </div>
        <p class="hero__subtitle">문서를 찾을 수 없습니다.</p>
      </div>
    </header>
    <main class="main">
      <section class="card">
        <h2>문서 조회 실패</h2>
        <p class="muted">문서번호: ${escapeHtml(documentNumber)}</p>
        <p class="helper">QR 코드가 최신 문서인지 확인해주세요.</p>
      </section>
    </main>
  </div>
</body>
</html>`);
    }

    const issue = rows[0];
    const payload =
      issue.payload && typeof issue.payload === "string"
        ? JSON.parse(issue.payload)
        : issue.payload;

    const certificate = certificateLibrary.find(
      (item) => item.id === (payload?.certificateId || issue.certificate_id)
    );

    const certificateTitle =
      certificate?.title || payload?.certificateTitle || "증명서";
    const issuedAtText =
      payload?.issuedAtText || new Date(issue.issued_at).toLocaleString("ko-KR");
    const employee = payload?.employee || {};

    const verificationRows = [
      ["성명", employee.name],
      ["주민등록번호", employee.residentNumber],
      ["주소", employee.address],
      ["소속팀", employee.team],
      ["입사일자", employee.joinDate],
      ["퇴직일자", employee.retirementDate || "재직 중"],
      ["발급일시", issuedAtText],
      ["문서번호", payload?.documentNumber || issue.document_number],
    ];

    const statusBlocks = verificationRows
      .map(
        ([label, value]) => `
        <div>
          <p class="status__label">${escapeHtml(label)}</p>
          <div>${escapeHtml(value || "-")}</div>
        </div>`
      )
      .join("");

    return res.status(200).send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/styles.css" />
  <title>캠스 증명서 발급 - ${escapeHtml(certificateTitle)}</title>
</head>
<body>
  <div class="app">
    <header class="hero">
      <div class="hero__content">
        <div class="hero__brand">
          <img class="hero__logo" src="/assets/cams_TR2.png" alt="CAMS 로고" />
          <div>
            <p class="hero__label">전자발급 확인</p>
            <h1 class="hero__title">캠스 증명서 발급</h1>
          </div>
        </div>
        <p class="hero__subtitle">QR 코드로 확인된 문서입니다.</p>
      </div>
    </header>
    <main class="main">
      <section class="card">
        <h2>${escapeHtml(certificateTitle)}</h2>
        <p class="muted">문서번호: ${escapeHtml(payload?.documentNumber || issue.document_number)}</p>
        <div class="status">
          ${statusBlocks}
        </div>
        <p class="helper">이 페이지는 발급 시점의 정보를 기준으로 표시됩니다.</p>
      </section>
    </main>
  </div>
</body>
</html>`);
  } catch (error) {
    console.error("문서 확인 실패", error);
    return res.status(500).send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/styles.css" />
  <title>캠스 증명서 발급 - 문서 확인 오류</title>
</head>
<body>
  <div class="app">
    <header class="hero">
      <div class="hero__content">
        <div class="hero__brand">
          <img class="hero__logo" src="/assets/cams_TR2.png" alt="CAMS 로고" />
          <div>
            <p class="hero__label">전자발급 확인</p>
            <h1 class="hero__title">캠스 증명서 발급</h1>
          </div>
        </div>
        <p class="hero__subtitle">잠시 후 다시 시도해주세요.</p>
      </div>
    </header>
    <main class="main">
      <section class="card">
        <h2>서버 오류</h2>
        <p class="muted">문서번호: ${escapeHtml(documentNumber)}</p>
      </section>
    </main>
  </div>
</body>
</html>`);
  }
});

// ======== 복지 포인트 쇼핑몰 API ========

// 상품 목록 (로그인 사용자)
app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM shop_products WHERE active = TRUE ORDER BY category, name"
    );
    return res.json({ products: rows });
  } catch (error) {
    console.error("상품 목록 조회 실패", error);
    return res.status(500).json({ message: "상품 목록을 불러올 수 없습니다." });
  }
});

// 내 포인트 조회
app.get("/api/points/me", requireAuth, async (req, res) => {
  try {
    const employeeId = req.session.employee.employeeId;
    const { rows } = await pool.query(
      "SELECT points FROM employees WHERE employee_id = $1",
      [employeeId]
    );
    return res.json({ points: rows[0]?.points || 0 });
  } catch (error) {
    console.error("포인트 조회 실패", error);
    return res.status(500).json({ message: "포인트를 조회할 수 없습니다." });
  }
});

// 내 주문 내역
app.get("/api/orders/me", requireAuth, async (req, res) => {
  try {
    const employeeId = req.session.employee.employeeId;
    const { rows } = await pool.query(
      "SELECT * FROM shop_orders WHERE employee_id = $1 ORDER BY ordered_at DESC",
      [employeeId]
    );
    return res.json({ orders: rows });
  } catch (error) {
    console.error("주문 내역 조회 실패", error);
    return res.status(500).json({ message: "주문 내역을 조회할 수 없습니다." });
  }
});

// 상품 구매 (포인트 차감)
app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const employeeId = req.session.employee.employeeId;
    const productId = Number(req.body.productId);
    const quantity = Math.max(1, Number(req.body.quantity) || 1);

    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ message: "올바른 상품을 선택해주세요." });
    }

    const { rows: productRows } = await pool.query(
      "SELECT * FROM shop_products WHERE id = $1",
      [productId]
    );
    if (!productRows.length || productRows[0].active === false) {
      return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
    }
    const product = productRows[0];
    const totalCost = product.point_price * quantity;

    // 재고 확인 (stock -1 = 무제한)
    if (product.stock >= 0 && product.stock < quantity) {
      return res.status(400).json({ message: "재고가 부족합니다." });
    }

    // 포인트 차감 (atomic)
    const { rows: updateRows } = await pool.query(
      "UPDATE employees SET points = points - $1 WHERE employee_id = $2 AND points >= $1 RETURNING points",
      [totalCost, employeeId]
    );
    if (!updateRows.length) {
      return res.status(400).json({ message: "포인트가 부족합니다." });
    }

    // 재고 차감
    if (product.stock >= 0) {
      await pool.query(
        "UPDATE shop_products SET stock = stock - $1 WHERE id = $2",
        [quantity, productId]
      );
    }

    // 주문 생성
    const { rows: orderRows } = await pool.query(
      "INSERT INTO shop_orders (employee_id, product_id, product_name, point_cost, quantity) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [employeeId, productId, product.name, totalCost, quantity]
    );

    return res.json({
      order: orderRows[0],
      remainingPoints: updateRows[0].points,
    });
  } catch (error) {
    console.error("상품 구매 실패", error);
    return res.status(500).json({ message: "구매 처리에 실패했습니다." });
  }
});

// ======== 관리자: 상품 관리 ========

app.get("/api/admin/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM shop_products ORDER BY id");
    return res.json({ products: rows });
  } catch (error) {
    console.error("상품 목록 조회 실패", error);
    return res.status(500).json({ message: "상품 목록을 불러올 수 없습니다." });
  }
});

app.post("/api/admin/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, imageUrl, pointPrice, category, stock } = req.body;
    if (!name || !pointPrice) {
      return res.status(400).json({ message: "상품명과 포인트 가격은 필수입니다." });
    }
    const { rows } = await pool.query(
      "INSERT INTO shop_products (name, description, image_url, point_price, category, stock) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [name, description || "", imageUrl || "", Number(pointPrice), category || "", stock ?? -1]
    );
    return res.status(201).json({ product: rows[0] });
  } catch (error) {
    console.error("상품 등록 실패", error);
    return res.status(500).json({ message: "상품 등록에 실패했습니다." });
  }
});

app.put("/api/admin/products/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, description, imageUrl, pointPrice, category, stock, active } = req.body;
    const { rows } = await pool.query(
      "UPDATE shop_products SET name=$1, description=$2, image_url=$3, point_price=$4, category=$5, stock=$6, active=$7 WHERE id=$8 RETURNING *",
      [name, description || "", imageUrl || "", Number(pointPrice), category || "", stock ?? -1, active ?? true, id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
    }
    return res.json({ product: rows[0] });
  } catch (error) {
    console.error("상품 수정 실패", error);
    return res.status(500).json({ message: "상품 수정에 실패했습니다." });
  }
});

app.delete("/api/admin/products/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      "DELETE FROM shop_products WHERE id = $1 RETURNING *",
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
    }
    return res.json({ deleted: true });
  } catch (error) {
    console.error("상품 삭제 실패", error);
    return res.status(500).json({ message: "상품 삭제에 실패했습니다." });
  }
});

// 관리자: CSV로 상품 일괄 등록 (Wix 내보내기 호환)
app.post(
  "/api/admin/products/import-csv",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "CSV 파일을 업로드해주세요." });
      }

      const csvText = file.buffer.toString("utf-8");
      const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        return res.status(400).json({ message: "CSV에 데이터가 없습니다." });
      }

      const headerLine = lines[0];
      const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());

      const nameIdx = headers.findIndex((h) => h === "name" || h === "상품명");
      const descIdx = headers.findIndex((h) => h === "description" || h === "설명");
      const imageIdx = headers.findIndex((h) => h === "image_url" || h === "이미지" || h === "image");
      const priceIdx = headers.findIndex((h) => h === "point_price" || h === "price" || h === "포인트" || h === "가격");
      const categoryIdx = headers.findIndex((h) => h === "category" || h === "카테고리");
      const stockIdx = headers.findIndex((h) => h === "stock" || h === "재고");

      if (nameIdx === -1 || priceIdx === -1) {
        return res
          .status(400)
          .json({ message: "CSV에 상품명(name)과 가격(price/point_price) 컬럼이 필요합니다." });
      }

      let importedCount = 0;
      let skippedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        const productName = cols[nameIdx];
        const priceRaw = cols[priceIdx];
        const price = Number(String(priceRaw).replace(/[^0-9]/g, ""));

        if (!productName || !Number.isFinite(price) || price <= 0) {
          skippedCount++;
          continue;
        }

        await pool.query(
          "INSERT INTO shop_products (name, description, image_url, point_price, category, stock) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            productName,
            descIdx >= 0 ? cols[descIdx] || "" : "",
            imageIdx >= 0 ? cols[imageIdx] || "" : "",
            price,
            categoryIdx >= 0 ? cols[categoryIdx] || "" : "",
            stockIdx >= 0 ? Number(cols[stockIdx]) || -1 : -1,
          ]
        );
        importedCount++;
      }

      return res.json({ importedCount, skippedCount });
    } catch (error) {
      console.error("상품 CSV 가져오기 실패", error);
      return res.status(500).json({ message: "CSV 가져오기에 실패했습니다." });
    }
  }
);

// ======== 관리자: 포인트 관리 ========

app.get("/api/admin/points", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT employee_id, name, points FROM employees ORDER BY employee_id"
    );
    return res.json({
      employees: rows.map((r) => ({
        employeeId: r.employee_id,
        name: r.name,
        points: r.points || 0,
      })),
    });
  } catch (error) {
    console.error("포인트 목록 조회 실패", error);
    return res.status(500).json({ message: "포인트 목록을 불러올 수 없습니다." });
  }
});

app.post("/api/admin/points", requireAuth, requireAdmin, async (req, res) => {
  try {
    const employeeId = normalizeString(req.body.employeeId);
    const points = Number(req.body.points);

    if (!employeeId || !Number.isFinite(points) || points < 0) {
      return res.status(400).json({ message: "사번과 올바른 포인트를 입력해주세요." });
    }

    const { rows } = await pool.query(
      "UPDATE employees SET points = $1 WHERE employee_id = $2 RETURNING *",
      [points, employeeId]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
    }
    return res.json({ employee: mapEmployee(rows[0]) });
  } catch (error) {
    console.error("포인트 부여 실패", error);
    return res.status(500).json({ message: "포인트 부여에 실패했습니다." });
  }
});

// 관리자: 전체 사원에게 일괄 포인트 부여
app.post("/api/admin/points/bulk", requireAuth, requireAdmin, async (req, res) => {
  try {
    const points = Number(req.body.points);
    if (!Number.isFinite(points) || points < 0) {
      return res.status(400).json({ message: "올바른 포인트를 입력해주세요." });
    }

    const { rows: employees } = await pool.query(
      "SELECT employee_id FROM employees"
    );
    let updatedCount = 0;
    for (const emp of employees) {
      await pool.query(
        "UPDATE employees SET points = $1 WHERE employee_id = $2",
        [points, emp.employee_id]
      );
      updatedCount++;
    }
    return res.json({ updatedCount, points });
  } catch (error) {
    console.error("일괄 포인트 부여 실패", error);
    return res.status(500).json({ message: "일괄 포인트 부여에 실패했습니다." });
  }
});

// ======== 관리자: 주문 내역 ========

app.get("/api/admin/orders", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows: orders } = await pool.query(
      "SELECT * FROM shop_orders ORDER BY ordered_at DESC"
    );
    // 사원명 매핑
    const { rows: employees } = await pool.query(
      "SELECT employee_id, name FROM employees"
    );
    const nameMap = new Map(employees.map((e) => [e.employee_id, e.name]));

    const enriched = orders.map((o) => ({
      ...o,
      employee_name: nameMap.get(o.employee_id) || o.employee_id,
    }));

    return res.json({ orders: enriched });
  } catch (error) {
    console.error("주문 목록 조회 실패", error);
    return res.status(500).json({ message: "주문 목록을 불러올 수 없습니다." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
