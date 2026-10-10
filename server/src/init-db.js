import db, { applySchema, DB_PATH } from "./db.js";
import { ensureInitialAdminUser } from "./auth.js";

applySchema();

const admin = ensureInitialAdminUser();
if (admin) {
  console.log(`Created initial admin user: ${admin.username}`);
} else {
  console.warn(
    "No initial admin user created. Set PAINT_ERP_ADMIN_USERNAME and PAINT_ERP_ADMIN_PASSWORD before bootstrapping the app.",
  );
}

// Minimal chart of accounts skeleton
const rootAccounts = [
  ["1000", "Assets", "asset"],
  ["1100", "Cash In Hand", "asset"],
  ["1200", "Bank", "asset"],
  ["1300", "Accounts Receivable", "asset"],
  ["1400", "Inventory", "asset"],
  ["2000", "Liabilities", "liability"],
  ["2100", "Accounts Payable", "liability"],
  ["3000", "Capital", "equity"],
  ["4000", "Sales", "income"],
  ["5000", "Purchases", "expense"],
  ["5100", "Production Overheads", "expense"],
  ["5200", "Salaries", "expense"],
];
const insertAccount = db.prepare(
  "INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)",
);
for (const [code, name, type] of rootAccounts) insertAccount.run(code, name, type);

// Current financial year
const year = new Date().getFullYear();
db.prepare(
  `INSERT OR IGNORE INTO financial_years (name, start_date, end_date, is_current)
   VALUES (?, ?, ?, 1)`,
).run(`${year}-${year + 1}`, `${year}-07-01`, `${year + 1}-06-30`);

db.prepare(
  "INSERT OR IGNORE INTO settings (key, value) VALUES ('company_name', 'GSN Paints')",
).run();

console.log("Database initialised at", DB_PATH);
