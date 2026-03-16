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
  const clobType = oracledb.DB_TYPE_CLOB || oracledb.CLOB;
  const nclobType = oracledb.DB_TYPE_NCLOB || oracledb.NCLOB;
  oracledb.fetchAsString = [clobType, nclobType].filter(Boolean);
} catch (error) {
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

const fetchOracleLoginRecord = async (employeeId) => {
  const oraclePool = await getOraclePool();
  if (!oraclePool) return null;

  const employeeTable = normalizeOracleIdentifier(process.env.ORACLE_EMP_TABLE);
  const passwordTable = normalizeOracleIdentifier(process.env.ORACLE_PASS_TABLE);
  if (!employeeTable || !passwordTable) {
    throw new Error("Oracle 테이블 설정이 올바르지 않습니다.");
  }

  let connection;
  try {
    connection = await oraclePool.getConnection();
    const result = await connection.execute(
      `
        SELECT
          TRIM(e.BSCSBN) AS "employeeId",
          e.BSCNAME AS "name",
          e.BSCJUMNO AS "residentNumber",
          e.BSCJGN AS "jobGroup",
          p.ETC6 AS "etc6"
        FROM ${employeeTable} e
        LEFT JOIN ${passwordTable} p
          ON TRIM(p.PWUDSRID) = TRIM(e.BSCSBN)
        WHERE TRIM(e.BSCSBN) = :employeeId
      `,
      { employeeId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = result.rows?.[0] || null;
    if (!row) return null;
    row.etc6 = await readOracleTextValue(row.etc6);
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

  res.set("X-Auth-Backend", isOracleAuthConfigured() ? "oracle" : "local");

  if (isOracleAuthConfigured()) {
    try {
      const oracleRecord = await fetchOracleLoginRecord(employeeId);
      if (!oracleRecord) {
        return res
          .status(401)
          .json({ message: "사번 또는 비밀번호가 올바르지 않습니다." });
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

      if (employee) {
        req.session.employee = {
          ...mapEmployee(employee),
          employeeId: normalizeString(employee.employee_id),
          name: oracleName || mapEmployee(employee).name,
          residentNumber:
            mapEmployee(employee).residentNumber || oracleResidentNumber || "",
        };
      } else {
        req.session.employee = {
          employeeId,
          name: oracleName || employeeId,
          team: "",
          joinDate: "",
          retirementDate: "",
          isAdmin: false,
          address: "",
          residentNumber: oracleResidentNumber || "",
        };
      }

      return res.json({ employee: req.session.employee });
    } catch (error) {
      console.error("Oracle 로그인 실패", error);
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
        "SELECT employee_id, name FROM employees WHERE employee_id = $1",
        [employeeId]
      );
      const employee = employees[0];
      if (!employee) {
        return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
      }

      const actualName = normalizeString(employee.name);
      if (actualName && actualName !== employeeName) {
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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
