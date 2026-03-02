const express = require("express");
const path = require("path");
const session = require("express-session");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const app = express();
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

const employeeRecords = [
  {
    employeeId: "1001",
    password: "1111",
    name: "김하늘",
    team: "HR",
    joinDate: "2021-04-12",
    retirementDate: "",
    isAdmin: true,
  },
  {
    employeeId: "1002",
    password: "2222",
    name: "이준서",
    team: "재무",
    joinDate: "2019-08-01",
    retirementDate: "",
    isAdmin: false,
  },
  {
    employeeId: "1003",
    password: "3333",
    name: "박민지",
    team: "개발",
    joinDate: "2018-02-21",
    retirementDate: "2024-12-31",
    isAdmin: false,
  },
];

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

app.post("/api/login", (req, res) => {
  const { employeeId, password } = req.body;
  const employee = employeeRecords.find(
    (record) => record.employeeId === employeeId && record.password === password
  );

  if (!employee) {
    return res.status(401).json({ message: "사번이 확인되지 않습니다." });
  }

  req.session.employee = {
    employeeId: employee.employeeId,
    name: employee.name,
    team: employee.team,
    joinDate: employee.joinDate,
    retirementDate: employee.retirementDate,
    isAdmin: employee.isAdmin,
  };
  return res.json({ employee: req.session.employee });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  return res.json({
    employee: req.session.employee,
    certificates: certificateLibrary,
    employees: req.session.employee.isAdmin
      ? employeeRecords.map(sanitizeEmployee)
      : [],
  });
});

app.get("/api/employees", requireAuth, requireAdmin, (req, res) => {
  return res.json({ employees: employeeRecords.map(sanitizeEmployee) });
});

app.post("/api/employees", requireAuth, requireAdmin, (req, res) => {

  const { employeeId, password, name, team, joinDate, retirementDate } = req.body;
  if (!employeeId || !password || !name || !team || !joinDate) {
    return res.status(400).json({ message: "필수 항목을 입력해주세요." });
  }

  if (employeeRecords.some((record) => record.employeeId === employeeId)) {
    return res.status(409).json({ message: "이미 등록된 사번입니다." });
  }

  const newRecord = {
    employeeId,
    password,
    name,
    team,
    joinDate,
    retirementDate: retirementDate || "",
    isAdmin: false,
  };
  employeeRecords.push(newRecord);

  return res.status(201).json({
    employee: sanitizeEmployee(newRecord),
  });
});

app.put("/api/employees/:id", requireAuth, requireAdmin, (req, res) => {
  const record = employeeRecords.find(
    (item) => item.employeeId === req.params.id
  );
  if (!record) {
    return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
  }

  const { password, name, team, joinDate, retirementDate, isAdmin } = req.body;
  record.password = password || record.password;
  record.name = name || record.name;
  record.team = team || record.team;
  record.joinDate = joinDate || record.joinDate;
  record.retirementDate = retirementDate ?? record.retirementDate;
  record.isAdmin = typeof isAdmin === "boolean" ? isAdmin : record.isAdmin;

  return res.json({ employee: sanitizeEmployee(record) });
});

app.delete("/api/employees/:id", requireAuth, requireAdmin, (req, res) => {
  const index = employeeRecords.findIndex(
    (item) => item.employeeId === req.params.id
  );
  if (index === -1) {
    return res.status(404).json({ message: "사원을 찾을 수 없습니다." });
  }
  const [removed] = employeeRecords.splice(index, 1);
  return res.json({ employee: sanitizeEmployee(removed) });
});

app.get("/api/certificates/:id", requireAuth, async (req, res) => {

  const certificate = certificateLibrary.find((item) => item.id === req.params.id);
  if (!certificate) {
    return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
  }

  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${certificate.filename}"`
    );

    const issuedAt = new Date();
    const issuedAtText = issuedAt.toLocaleString("ko-KR");
    const documentNumber = `${certificate.id.toUpperCase()}-${
      req.session.employee.employeeId
    }-${issuedAt.getTime().toString().slice(-6)}`;

    const qrPayload = JSON.stringify({
      documentNumber,
      issuedAt: issuedAt.toISOString(),
      employeeId: req.session.employee.employeeId,
      certificate: certificate.id,
    });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      margin: 1,
      width: 180,
    });
    const qrImage = Buffer.from(qrDataUrl.split(",")[1], "base64");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(22).text(certificate.title, { align: "center" });
    doc.moveDown();

    doc
      .fontSize(12)
      .fillColor("#222")
      .text(`발급 대상: ${req.session.employee.name}`)
      .text(`소속팀: ${req.session.employee.team}`)
      .text(`입사일자: ${req.session.employee.joinDate}`)
      .text(
        `퇴직일자: ${req.session.employee.retirementDate || "재직 중"}`
      )
      .text(`발급일시: ${issuedAtText}`)
      .text(`문서번호: ${documentNumber}`);

    doc.moveDown(2);
    doc
      .fontSize(10)
      .fillColor("#777")
      .text("회사 내부 인증용 문서", { align: "right" });

    const stampWidth = 220;
    const stampHeight = 70;
    const stampX = doc.page.width - stampWidth - 50;
    const stampY = doc.page.height - 230;

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

    const qrSize = 110;
    const qrX = stampX + stampWidth - qrSize;
    const qrY = stampY + stampHeight + 14;
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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
