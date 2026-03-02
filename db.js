const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL 환경 변수가 필요합니다.");
}

const useSsl = process.env.DATABASE_SSL !== "false";
const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

const seedEmployees = [
  {
    employeeId: "1001",
    password: "1111",
    name: "김하늘",
    team: "HR",
    joinDate: "2021-04-12",
    retirementDate: null,
    isAdmin: true,
  },
  {
    employeeId: "1002",
    password: "2222",
    name: "이준서",
    team: "재무",
    joinDate: "2019-08-01",
    retirementDate: null,
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

const initSchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      team TEXT NOT NULL,
      join_date DATE NOT NULL,
      retirement_date DATE,
      is_admin BOOLEAN DEFAULT FALSE
    )
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM employees");
  if (rows[0].count === 0) {
    const insertText = `
      INSERT INTO employees
        (employee_id, password, name, team, join_date, retirement_date, is_admin)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (employee_id) DO NOTHING
    `;
    for (const employee of seedEmployees) {
      await pool.query(insertText, [
        employee.employeeId,
        employee.password,
        employee.name,
        employee.team,
        employee.joinDate,
        employee.retirementDate,
        employee.isAdmin,
      ]);
    }
  }
};

const mapEmployee = (row) => ({
  employeeId: row.employee_id,
  name: row.name,
  team: row.team,
  joinDate: row.join_date instanceof Date
    ? row.join_date.toISOString().slice(0, 10)
    : row.join_date,
  retirementDate: row.retirement_date
    ? row.retirement_date instanceof Date
      ? row.retirement_date.toISOString().slice(0, 10)
      : row.retirement_date
    : "",
  isAdmin: row.is_admin,
});

module.exports = {
  pool,
  initSchema,
  mapEmployee,
};
