const { Pool } = require("pg");

// 개발 환경에서는 SQLite 사용, 프로덕션에서는 PostgreSQL 사용
const isDevelopment = process.env.NODE_ENV !== 'production';
const connectionString = process.env.DATABASE_URL;

let pool;

if (isDevelopment && !connectionString) {
  // 개발 환경에서는 메모리 DB 사용 (실제로는 파일 기반으로 변경 가능)
  console.log("개발 환경: 인메모리 데이터베이스 사용");
  
  // 간단한 인메모리 데이터베이스 구현
  const memoryDB = {
    employees: [],
    query: async (text, params) => {
      console.log("Query:", text, params);
      
      if (text.includes("CREATE TABLE")) {
        return { rows: [] };
      }
      
      if (text.includes("SELECT COUNT(*)")) {
        return { rows: [{ count: memoryDB.employees.length }] };
      }
      
      if (text.includes("SELECT")) {
        if (text.includes("WHERE employee_id =")) {
          const employeeId = params[0];
          const employee = memoryDB.employees.find(emp => emp.employee_id === employeeId);
          return { rows: employee ? [employee] : [] };
        }
        return { rows: memoryDB.employees };
      }
      
      if (text.includes("INSERT")) {
        const newEmployee = {
          employee_id: params[0],
          password: params[1],
          name: params[2],
          team: params[3],
          join_date: params[4],
          retirement_date: params[5],
          is_admin: params[6]
        };
        memoryDB.employees.push(newEmployee);
        return { rows: [newEmployee] };
      }
      
      if (text.includes("UPDATE")) {
        const employeeId = params[6];
        const index = memoryDB.employees.findIndex(emp => emp.employee_id === employeeId);
        if (index !== -1) {
          memoryDB.employees[index] = {
            ...memoryDB.employees[index],
            password: params[0] || memoryDB.employees[index].password,
            name: params[1] || memoryDB.employees[index].name,
            team: params[2] || memoryDB.employees[index].team,
            join_date: params[3] || memoryDB.employees[index].join_date,
            retirement_date: params[4],
            is_admin: params[5] !== null ? params[5] : memoryDB.employees[index].is_admin
          };
          return { rows: [memoryDB.employees[index]] };
        }
        return { rows: [] };
      }
      
      if (text.includes("DELETE")) {
        const employeeId = params[0];
        const index = memoryDB.employees.findIndex(emp => emp.employee_id === employeeId);
        if (index !== -1) {
          const deleted = memoryDB.employees.splice(index, 1)[0];
          return { rows: [deleted] };
        }
        return { rows: [] };
      }
      
      return { rows: [] };
    }
  };
  
  pool = memoryDB;
} else {
  if (!connectionString) {
    throw new Error("DATABASE_URL 환경 변수가 필요합니다.");
  }
  const useSsl = process.env.DATABASE_SSL !== "false";
  pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  });
}

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
  if (isDevelopment && !connectionString) {
    // 개발 환경: 시드 데이터 직접 추가
    seedEmployees.forEach(employee => {
      pool.employees.push({
        employee_id: employee.employeeId,
        password: employee.password,
        name: employee.name,
        team: employee.team,
        join_date: employee.joinDate,
        retirement_date: employee.retirementDate,
        is_admin: employee.isAdmin
      });
    });
    console.log("시드 데이터가 추가되었습니다.");
    return;
  }

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
