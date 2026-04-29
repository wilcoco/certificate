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
    certificate_issues: [],
    withholding_receipts: [],
    withholding_receipts_staged: [],
    shop_products: [],
    shop_orders: [],
    _nextProductId: 1,
    _nextOrderId: 1,
    query: async (text, params) => {
      const safeParams = (params || []).map((value) => {
        if (Buffer.isBuffer(value)) {
          return `<Buffer length=${value.length}>`;
        }
        return value;
      });
      console.log("Query:", text, safeParams);
      
      if (text.includes("CREATE TABLE")) {
        return { rows: [] };
      }
      
      if (text.includes("SELECT COUNT(*)")) {
        if (text.includes("FROM certificate_issues")) {
          return { rows: [{ count: memoryDB.certificate_issues.length }] };
        }
        return { rows: [{ count: memoryDB.employees.length }] };
      }
      
      if (text.includes("SELECT")) {
        if (text.includes("FROM certificate_issues")) {
          if (text.includes("WHERE document_number =")) {
            const documentNumber = params[0];
            const issue = memoryDB.certificate_issues.find(
              (item) => item.document_number === documentNumber
            );
            return { rows: issue ? [issue] : [] };
          }
          return { rows: memoryDB.certificate_issues };
        }

        if (text.includes("FROM withholding_receipts_staged")) {
          if (text.includes("WHERE resident_number_hash =")) {
            const residentHash = params[0];
            const rows = memoryDB.withholding_receipts_staged
              .filter((item) => item.resident_number_hash === residentHash)
              .sort((a, b) => (b.tax_year || 0) - (a.tax_year || 0));
            if (text.includes("LIMIT 1")) {
              return { rows: rows.length ? [rows[0]] : [] };
            }
            return { rows };
          }
          return { rows: memoryDB.withholding_receipts_staged };
        }

        if (text.includes("FROM withholding_receipts")) {
          if (text.includes("WHERE employee_id =")) {
            const employeeId = params[0];
            const rows = memoryDB.withholding_receipts
              .filter((item) => item.employee_id === employeeId)
              .sort((a, b) => (b.tax_year || 0) - (a.tax_year || 0));
            if (text.includes("LIMIT 1")) {
              return { rows: rows.length ? [rows[0]] : [] };
            }
            return { rows };
          }
          return { rows: memoryDB.withholding_receipts };
        }

        if (text.includes("FROM shop_products")) {
          if (text.includes("WHERE id =")) {
            const id = Number(params[0]);
            const product = memoryDB.shop_products.find(p => p.id === id);
            return { rows: product ? [product] : [] };
          }
          if (text.includes("active = TRUE") || text.includes("active = true")) {
            return { rows: memoryDB.shop_products.filter(p => p.active !== false) };
          }
          return { rows: memoryDB.shop_products };
        }

        if (text.includes("FROM shop_orders")) {
          if (text.includes("WHERE") && text.includes("employee_id")) {
            const employeeId = params[0];
            const orders = memoryDB.shop_orders
              .filter(o => o.employee_id === employeeId)
              .sort((a, b) => new Date(b.ordered_at) - new Date(a.ordered_at));
            return { rows: orders };
          }
          return { rows: [...memoryDB.shop_orders].sort((a, b) => new Date(b.ordered_at) - new Date(a.ordered_at)) };
        }

        if (text.includes("WHERE employee_id =")) {
          const employeeId = params[0];
          const employee = memoryDB.employees.find(emp => emp.employee_id === employeeId);
          return { rows: employee ? [employee] : [] };
        }
        return { rows: memoryDB.employees };
      }
      
      if (text.includes("INSERT")) {
        if (text.includes("INSERT INTO certificate_issues")) {
          const newIssue = {
            document_number: params[0],
            certificate_id: params[1],
            employee_id: params[2],
            issued_at: params[3],
            payload:
              typeof params[4] === "string" ? JSON.parse(params[4]) : params[4],
          };

          const existing = memoryDB.certificate_issues.find(
            (item) => item.document_number === newIssue.document_number
          );
          if (!existing) {
            memoryDB.certificate_issues.push(newIssue);
          }
          return { rows: [newIssue] };
        }

        if (text.includes("INSERT INTO withholding_receipts_staged")) {
          const newReceipt = {
            resident_number_hash: params[0],
            tax_year: params[1],
            work_start_date: params[2],
            pdf_bytes: params[3],
            uploaded_at: new Date().toISOString(),
          };

          const existingIndex = memoryDB.withholding_receipts_staged.findIndex(
            (item) =>
              item.resident_number_hash === newReceipt.resident_number_hash &&
              item.tax_year === newReceipt.tax_year
          );
          if (existingIndex !== -1) {
            memoryDB.withholding_receipts_staged[existingIndex] = {
              ...memoryDB.withholding_receipts_staged[existingIndex],
              ...newReceipt,
            };
            return { rows: [memoryDB.withholding_receipts_staged[existingIndex]] };
          }
          memoryDB.withholding_receipts_staged.push(newReceipt);
          return { rows: [newReceipt] };
        }

        if (text.includes("INSERT INTO withholding_receipts")) {
          const newReceipt = {
            employee_id: params[0],
            tax_year: params[1],
            work_start_date: params[2],
            resident_number_hash: params[3],
            pdf_bytes: params[4],
            uploaded_at: new Date().toISOString(),
          };

          const existingIndex = memoryDB.withholding_receipts.findIndex(
            (item) =>
              item.employee_id === newReceipt.employee_id &&
              item.tax_year === newReceipt.tax_year
          );
          if (existingIndex !== -1) {
            memoryDB.withholding_receipts[existingIndex] = {
              ...memoryDB.withholding_receipts[existingIndex],
              ...newReceipt,
            };
            return { rows: [memoryDB.withholding_receipts[existingIndex]] };
          }
          memoryDB.withholding_receipts.push(newReceipt);
          return { rows: [newReceipt] };
        }

        if (text.includes("INSERT INTO shop_products")) {
          const newProduct = {
            id: memoryDB._nextProductId++,
            name: params[0],
            description: params[1] || '',
            image_url: params[2] || '',
            point_price: params[3],
            category: params[4] || '',
            stock: params[5] ?? -1,
            active: true,
            created_at: new Date().toISOString(),
          };
          memoryDB.shop_products.push(newProduct);
          return { rows: [newProduct] };
        }

        if (text.includes("INSERT INTO shop_orders")) {
          const newOrder = {
            id: memoryDB._nextOrderId++,
            employee_id: params[0],
            product_id: params[1],
            product_name: params[2],
            point_cost: params[3],
            quantity: params[4] || 1,
            ordered_at: new Date().toISOString(),
          };
          memoryDB.shop_orders.push(newOrder);
          return { rows: [newOrder] };
        }

        if (text.includes("INSERT INTO employees")) {
          const newEmployee = {
            employee_id: params[0],
            password: params[1],
            name: params[2],
            team: params[3],
            join_date: params[4],
            retirement_date: params[5],
            is_admin: params[6],
            address: params[7],
            resident_number: params[8],
          };
          memoryDB.employees.push(newEmployee);
          return { rows: [newEmployee] };
        }

        return { rows: [] };
      }
      
      if (text.includes("UPDATE")) {
        if (text.includes("UPDATE shop_products")) {
          const id = Number(params[params.length - 1]);
          const index = memoryDB.shop_products.findIndex(p => p.id === id);
          if (index !== -1) {
            memoryDB.shop_products[index] = {
              ...memoryDB.shop_products[index],
              name: params[0] ?? memoryDB.shop_products[index].name,
              description: params[1] ?? memoryDB.shop_products[index].description,
              image_url: params[2] ?? memoryDB.shop_products[index].image_url,
              point_price: params[3] ?? memoryDB.shop_products[index].point_price,
              category: params[4] ?? memoryDB.shop_products[index].category,
              stock: params[5] ?? memoryDB.shop_products[index].stock,
              active: params[6] ?? memoryDB.shop_products[index].active,
            };
            return { rows: [memoryDB.shop_products[index]] };
          }
          return { rows: [] };
        }

        if (text.includes("UPDATE employees") && text.includes("SET points")) {
          if (text.includes("points -")) {
            const amount = Number(params[0]);
            const employeeId = params[1];
            const index = memoryDB.employees.findIndex(emp => emp.employee_id === employeeId);
            if (index !== -1 && (memoryDB.employees[index].points || 0) >= amount) {
              memoryDB.employees[index].points = (memoryDB.employees[index].points || 0) - amount;
              return { rows: [{ points: memoryDB.employees[index].points }] };
            }
            return { rows: [] };
          }
          const points = Number(params[0]);
          const employeeId = params[1];
          const index = memoryDB.employees.findIndex(emp => emp.employee_id === employeeId);
          if (index !== -1) {
            memoryDB.employees[index].points = points;
            return { rows: [memoryDB.employees[index]] };
          }
          return { rows: [] };
        }

        if (!text.includes("UPDATE employees")) {
          return { rows: [] };
        }
        const employeeId = params[8];
        const index = memoryDB.employees.findIndex(emp => emp.employee_id === employeeId);
        if (index !== -1) {
          memoryDB.employees[index] = {
            ...memoryDB.employees[index],
            password: params[0] || memoryDB.employees[index].password,
            name: params[1] || memoryDB.employees[index].name,
            team: params[2] || memoryDB.employees[index].team,
            join_date: params[3] || memoryDB.employees[index].join_date,
            retirement_date: params[4],
            is_admin: params[5] !== null ? params[5] : memoryDB.employees[index].is_admin,
            address: params[6] ?? memoryDB.employees[index].address,
            resident_number: params[7] ?? memoryDB.employees[index].resident_number,
          };
          return { rows: [memoryDB.employees[index]] };
        }
        return { rows: [] };
      }
      
      if (text.includes("DELETE")) {
        if (text.includes("DELETE FROM withholding_receipts_staged")) {
          const residentHash = params[0];
          const taxYear = params[1];
          const index = memoryDB.withholding_receipts_staged.findIndex(
            (item) =>
              item.resident_number_hash === residentHash &&
              item.tax_year === taxYear
          );
          if (index !== -1) {
            const deleted = memoryDB.withholding_receipts_staged.splice(index, 1)[0];
            return { rows: [deleted] };
          }
          return { rows: [] };
        }

        if (text.includes("DELETE FROM shop_products")) {
          const id = Number(params[0]);
          const index = memoryDB.shop_products.findIndex(p => p.id === id);
          if (index !== -1) {
            const deleted = memoryDB.shop_products.splice(index, 1)[0];
            return { rows: [deleted] };
          }
          return { rows: [] };
        }

        if (!text.includes("DELETE FROM employees")) {
          return { rows: [] };
        }
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
    address: "",
    residentNumber: "",
    points: 100000,
  },
  {
    employeeId: "1002",
    password: "2222",
    name: "이준서",
    team: "재무",
    joinDate: "2019-08-01",
    retirementDate: null,
    isAdmin: false,
    address: "",
    residentNumber: "",
    points: 50000,
  },
  {
    employeeId: "1003",
    password: "3333",
    name: "박민지",
    team: "개발",
    joinDate: "2018-02-21",
    retirementDate: "2024-12-31",
    isAdmin: false,
    address: "",
    residentNumber: "",
    points: 50000,
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
        is_admin: employee.isAdmin,
        address: employee.address,
        resident_number: employee.residentNumber,
        points: employee.points || 0,
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
      is_admin BOOLEAN DEFAULT FALSE,
      address TEXT,
      resident_number TEXT
    )
  `);

  await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT`);
  await pool.query(
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS resident_number TEXT`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS certificate_issues (
      document_number TEXT PRIMARY KEY,
      certificate_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withholding_receipts (
      employee_id TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
      tax_year INT NOT NULL,
      work_start_date DATE,
      resident_number_hash TEXT NOT NULL,
      pdf_bytes BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (employee_id, tax_year)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withholding_receipts_staged (
      resident_number_hash TEXT NOT NULL,
      tax_year INT NOT NULL,
      work_start_date DATE,
      pdf_bytes BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (resident_number_hash, tax_year)
    )
  `);

  await pool.query(
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      point_price INTEGER NOT NULL,
      category TEXT DEFAULT '',
      stock INTEGER DEFAULT -1,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_images (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(employee_id),
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      point_cost INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ordered',
      ordered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ordered';
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM employees");
  if (rows[0].count === 0) {
    const insertText = `
      INSERT INTO employees
        (employee_id, password, name, team, join_date, retirement_date, is_admin, address, resident_number)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        employee.address || null,
        employee.residentNumber || null,
      ]);
    }
  }
};

const mapEmployee = (row) => ({
  employeeId: row.employee_id,
  name: row.name,
  team: row.team,
  address: row.address || "",
  residentNumber: row.resident_number || "",
  joinDate: row.join_date instanceof Date
    ? row.join_date.toISOString().slice(0, 10)
    : row.join_date,
  retirementDate: row.retirement_date
    ? row.retirement_date instanceof Date
      ? row.retirement_date.toISOString().slice(0, 10)
      : row.retirement_date
    : "",
  isAdmin: row.is_admin,
  points: row.points || 0,
});

module.exports = {
  pool,
  initSchema,
  mapEmployee,
};
