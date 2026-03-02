const express = require("express");
const path = require("path");
const session = require("express-session");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { pool, initSchema, mapEmployee } = require("./db");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3001;

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

app.post("/api/login", async (req, res) => {
  const { employeeId, password } = req.body;
  const { rows } = await pool.query(
    `
      SELECT employee_id, password, name, team, join_date, retirement_date, is_admin
      FROM employees
      WHERE employee_id = $1
    `,
    [employeeId]
  );
  const employee = rows[0];

  if (!employee || employee.password !== password) {
    return res.status(401).json({ message: "사번이 확인되지 않습니다." });
  }

  req.session.employee = {
    ...mapEmployee(employee),
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
    "SELECT employee_id, name, team, join_date, retirement_date, is_admin FROM employees"
  );
  return res.json({
    employee: req.session.employee,
    certificates: certificateLibrary,
    employees: rows.map(mapEmployee),
  });
});

app.get("/api/employees", requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT employee_id, name, team, join_date, retirement_date, is_admin FROM employees"
  );
  return res.json({ employees: rows.map(mapEmployee) });
});

app.post("/api/employees", requireAuth, requireAdmin, async (req, res) => {

  const { employeeId, password, name, team, joinDate, retirementDate } = req.body;
  if (!employeeId || !password || !name || !team || !joinDate) {
    return res.status(400).json({ message: "필수 항목을 입력해주세요." });
  }

  const { rows: existing } = await pool.query(
    "SELECT employee_id FROM employees WHERE employee_id = $1",
    [employeeId]
  );
  if (existing.length > 0) {
    return res.status(409).json({ message: "이미 등록된 사번입니다." });
  }

  const { rows } = await pool.query(
    `
      INSERT INTO employees
        (employee_id, password, name, team, join_date, retirement_date, is_admin)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      RETURNING employee_id, name, team, join_date, retirement_date, is_admin
    `,
    [employeeId, password, name, team, joinDate, retirementDate || null, false]
  );

  return res.status(201).json({ employee: mapEmployee(rows[0]) });
});

app.put("/api/employees/:id", requireAuth, requireAdmin, async (req, res) => {
  const { password, name, team, joinDate, retirementDate, isAdmin } = req.body;

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
        is_admin = COALESCE($6, is_admin)
      WHERE employee_id = $7
      RETURNING employee_id, name, team, join_date, retirement_date, is_admin
    `,
    [
      password || null,
      name || null,
      team || null,
      joinDate || null,
      retirementDate === "" ? null : retirementDate ?? null,
      typeof isAdmin === "boolean" ? isAdmin : null,
      req.params.id,
    ]
  );

  return res.json({ employee: mapEmployee(rows[0]) });
});

app.delete("/api/employees/:id", requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM employees WHERE employee_id = $1 RETURNING employee_id, name, team, join_date, retirement_date, is_admin",
    [req.params.id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
  }
  return res.json({ employee: mapEmployee(rows[0]) });
});

app.get("/api/certificates/:id", requireAuth, async (req, res) => {

  const certificate = certificateLibrary.find((item) => item.id === req.params.id);
  if (!certificate) {
    return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
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

    const issuePayload = {
      documentNumber,
      certificateId: certificate.id,
      certificateTitle: certificate.title,
      issuedAt: issuedAt.toISOString(),
      issuedAtText,
      employee: {
        employeeId: req.session.employee.employeeId,
        name: req.session.employee.name,
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

    doc.fontSize(13).fillColor("#444").text("주식회사 캠스", {
      align: "right",
    });
    doc.moveDown(0.2);
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
      ["소속팀", req.session.employee.team],
      ["입사일자", req.session.employee.joinDate],
      ["퇴직일자", req.session.employee.retirementDate || "재직 중"],
      ["발급일시", issuedAtText],
      ["문서번호", documentNumber],
    ];

    rows.forEach(([label, value]) => {
      doc.fontSize(11).fillColor("#666").text(label, labelX, cursorY);
      doc.fontSize(12).fillColor("#222").text(value, valueX, cursorY);
      cursorY += rowGap;
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
      .text("주식회사 캠스", stampX + 12, stampY + 14)
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
  <title>문서 확인 실패</title>
</head>
<body>
  <div class="app">
    <header class="hero">
      <div class="hero__label">Verification</div>
      <h1 class="hero__title">전자발급 확인</h1>
      <p class="hero__subtitle">문서를 찾을 수 없습니다.</p>
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
  <title>전자발급 확인 - ${escapeHtml(certificateTitle)}</title>
</head>
<body>
  <div class="app">
    <header class="hero">
      <div class="hero__label">Verification</div>
      <h1 class="hero__title">전자발급 확인</h1>
      <p class="hero__subtitle">QR 코드로 확인된 문서입니다.</p>
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
  <title>문서 확인 오류</title>
</head>
<body>
  <div class="app">
    <header class="hero">
      <div class="hero__label">Verification</div>
      <h1 class="hero__title">전자발급 확인</h1>
      <p class="hero__subtitle">잠시 후 다시 시도해주세요.</p>
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
