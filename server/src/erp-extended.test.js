import { after, before, test } from "node:test";
import { serverRuntimeEnv, serverRuntimePath } from "./test-runtime.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { getFreePort } from "./test-utils.js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const here = path.dirname(fileURLToPath(import.meta.url));
let BASE;
const ADMIN_USER = "extadmin";
const ADMIN_PASS = "ExtAdminPass123!";
const REGULAR_USER = "extuser";
const REGULAR_PASS = "ExtUserPass123!";

let child;
let dataDir;
let dbFile;
let adminToken;
let userToken;
let accountantToken;
let customerId;
let supplierId;
let rawItemId;
let particularId;
let cashAccountId;
let expenseAccountId;
let incomeAccountId;

function readDb() {
  return new Database(dbFile, { readonly: true });
}

async function api(method, endpoint, body, authToken = adminToken) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* waiting */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Extended test server did not become healthy in time");
}

before(async () => {
  const port = await getFreePort();
  BASE = `http://127.0.0.1:${port}/api`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paint-erp-ext-test-"));
  dbFile = path.join(dataDir, "paint-erp.db");

  child = spawn(serverRuntimePath(), [path.join(here, "index.js")], {
    env: serverRuntimeEnv({
      PORT: String(port),
      DATA_DIR: dataDir,
      DB_PATH: dbFile,
      PAINT_ERP_ADMIN_USERNAME: ADMIN_USER,
      PAINT_ERP_ADMIN_PASSWORD: ADMIN_PASS,
    }),
    stdio: "ignore",
  });

  await waitForServer();

  // Login as admin
  const loginAdmin = await api(
    "POST",
    "/auth/login",
    { username: ADMIN_USER, password: ADMIN_PASS },
    null,
  );
  assert.equal(loginAdmin.status, 200, `Admin login failed: ${JSON.stringify(loginAdmin.json)}`);
  adminToken = loginAdmin.json.token;

  // Create a regular user for role tests
  const createUser = await api("POST", "/users", {
    username: REGULAR_USER,
    password: REGULAR_PASS,
    role: "user",
    full_name: "Regular Operator",
  });
  assert.equal(createUser.status, 201, `Create user failed: ${JSON.stringify(createUser.json)}`);

  const loginUser = await api(
    "POST",
    "/auth/login",
    { username: REGULAR_USER, password: REGULAR_PASS },
    null,
  );
  assert.equal(loginUser.status, 200);
  userToken = loginUser.json.token;

  const createAccountant = await api("POST", "/users", {
    username: "extaccountant",
    password: "ExtAccountant123!",
    role: "accountant",
    full_name: "Accountant",
  });
  assert.equal(createAccountant.status, 201);
  const loginAccountant = await api(
    "POST",
    "/auth/login",
    { username: "extaccountant", password: "ExtAccountant123!" },
    null,
  );
  assert.equal(loginAccountant.status, 200);
  accountantToken = loginAccountant.json.token;

  // Setup seed customer & supplier
  const cusRes = await api("POST", "/setup/customers", {
    name: "Al-Rehman Paints",
    phone: "03001234567",
    address: "Lahore",
    opening_balance: "1000",
  });
  assert.equal(cusRes.status, 201);
  customerId = cusRes.json.id;

  const supRes = await api("POST", "/setup/suppliers", {
    name: "Chemical Traders",
    phone: "03217654321",
    address: "Karachi",
    opening_balance: "2000",
  });
  assert.equal(supRes.status, 201);
  supplierId = supRes.json.id;

  // Setup raw material
  const rawRes = await api("POST", "/setup/factory-items", {
    name: "Titanium Dioxide Rutile",
    unit: "KG",
    rate: "250",
    stock: "100",
  });
  assert.equal(rawRes.status, 201);
  rawItemId = rawRes.json.id;

  // Setup finished good
  const itemRes = await api("POST", "/items", {
    name: "Weather Shield Luxury Emulsion",
    category: "Emulsion",
    remarks: "Exterior high gloss",
  });
  assert.equal(itemRes.status, 201);

  const partRes = await api("POST", `/items/${itemRes.json.id}/particulars`, {
    type: "Drum",
    weight_unit: "16 L",
    cost_price: 3200,
    ws_price: 3800,
    sale_price: 4200,
    stock_qty: 10,
  });
  assert.equal(partRes.status, 201);
  particularId = partRes.json.id;

  // Resolve standard accounts (1100 Cash in Hand, 5200 Salaries, 4000 Sales)
  const accountsRes = await api("GET", "/accounts");
  assert.equal(accountsRes.status, 200);
  const accounts = accountsRes.json;

  cashAccountId = accounts.find((a) => a.code === "1100")?.id;
  expenseAccountId = accounts.find((a) => a.code === "5200")?.id;
  incomeAccountId = accounts.find((a) => a.code === "4000")?.id;
  assert.ok(cashAccountId, "Cash account (1100) must exist");
  assert.ok(expenseAccountId, "Expense account (5200) must exist");
  assert.ok(incomeAccountId, "Income account (4000) must exist");
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  if (dataDir) {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* temp cleanup */
    }
  }
});

test("CUSTOMER RECEIPT: posts balanced double-entry voucher, reduces party balance", async () => {
  const receiptAmount = 450;
  const res = await api("POST", "/receipts", {
    customer_id: customerId,
    date: "2026-10-05",
    payment_mode: "cash",
    payment_account_id: cashAccountId,
    amount: receiptAmount,
    reference_no: "CHQ-1001",
    remarks: "Advance payment against order",
    total_amount: 999999,
    net_total: 999999,
  });

  assert.equal(res.status, 201, `Receipt creation failed: ${JSON.stringify(res.json)}`);
  assert.equal(Number(res.json.amount), receiptAmount);
  assert.ok(res.json.id > 0);
  assert.match(res.json.voucher_no, /^RCP-\d+$/);

  // Check double-entry voucher in DB
  const conn = readDb();
  try {
    const voucher = conn
      .prepare("SELECT * FROM account_vouchers WHERE ref_type = 'receipt' AND ref_id = ?")
      .get(res.json.id);
    assert.ok(voucher, "Accounting voucher must be posted for receipt");
    assert.equal(voucher.voucher_type, "receipt");

    const lines = conn
      .prepare("SELECT * FROM account_ledger WHERE voucher_id = ? ORDER BY debit DESC")
      .all(voucher.id);
    assert.equal(lines.length, 2);

    // Line 1: Debit Cash/Bank
    assert.equal(lines[0].account_id, cashAccountId);
    assert.equal(lines[0].debit, receiptAmount);
    assert.equal(lines[0].credit, 0);

    // Line 2: Credit Customer
    assert.equal(lines[1].credit, receiptAmount);
    assert.equal(lines[1].debit, 0);

    // Assert total debit == total credit
    assert.equal(lines[0].debit, lines[1].credit);
  } finally {
    conn.close();
  }

  // Verify GET /receipts lists this receipt
  const listRes = await api("GET", `/receipts?customer_id=${customerId}`);
  assert.equal(listRes.status, 200);
  assert.ok(listRes.json.some((r) => r.id === res.json.id));

  // Verify statement reflects the receipt
  const stmtRes = await api(
    "GET",
    `/reports/statements?party_type=customer&party_id=${customerId}`,
  );
  assert.equal(stmtRes.status, 200);
  assert.equal(stmtRes.json.closing_balance, 1000 - receiptAmount); // Opening 1000 - 450 = 550
});

test("CUSTOMER RECEIPT: rejects invalid inputs safely", async () => {
  // Missing / invalid customer
  const badCust = await api("POST", "/receipts", {
    customer_id: 99999,
    date: "2026-10-05",
    payment_account_id: cashAccountId,
    amount: 100,
  });
  assert.equal(badCust.status, 400);

  // Zero or negative amount
  const badAmount = await api("POST", "/receipts", {
    customer_id: customerId,
    date: "2026-10-05",
    payment_account_id: cashAccountId,
    amount: -50,
  });
  assert.equal(badAmount.status, 400);

  // Invalid payment account (non-asset account)
  const badAccount = await api("POST", "/receipts", {
    customer_id: customerId,
    date: "2026-10-05",
    payment_account_id: expenseAccountId, // Expense is not an asset
    amount: 100,
  });
  assert.equal(badAccount.status, 400);
});

test("SUPPLIER PAYMENT: posts balanced double-entry voucher, reduces payable balance", async () => {
  const paymentAmount = 800;
  const res = await api("POST", "/payments", {
    supplier_id: supplierId,
    date: "2026-10-05",
    payment_mode: "cash",
    payment_account_id: cashAccountId,
    amount: paymentAmount,
    reference_no: "TRF-909",
    remarks: "Raw material invoice partial payment",
    total_amount: 999999,
    net_total: 999999,
  });

  assert.equal(res.status, 201, `Payment failed: ${JSON.stringify(res.json)}`);
  assert.equal(Number(res.json.amount), paymentAmount);
  assert.ok(res.json.id > 0);
  assert.match(res.json.voucher_no, /^PMT-\d+$/);

  const conn = readDb();
  try {
    const voucher = conn
      .prepare("SELECT * FROM account_vouchers WHERE ref_type = 'payment' AND ref_id = ?")
      .get(res.json.id);
    assert.ok(voucher, "Accounting voucher must be posted for payment");

    const lines = conn
      .prepare("SELECT * FROM account_ledger WHERE voucher_id = ? ORDER BY debit DESC")
      .all(voucher.id);
    assert.equal(lines.length, 2);

    // Line 1: Debit Supplier (Liability reduction)
    assert.equal(lines[0].debit, paymentAmount);
    assert.equal(lines[0].credit, 0);

    // Line 2: Credit Cash/Bank
    assert.equal(lines[1].account_id, cashAccountId);
    assert.equal(lines[1].credit, paymentAmount);
    assert.equal(lines[1].debit, 0);

    assert.equal(lines[0].debit, lines[1].credit);
  } finally {
    conn.close();
  }

  // Verify GET /payments lists this payment
  const listRes = await api("GET", `/payments?supplier_id=${supplierId}`);
  assert.equal(listRes.status, 200);
  assert.ok(listRes.json.some((p) => p.id === res.json.id));

  // Verify statement reflects the payment
  const stmtRes = await api(
    "GET",
    `/reports/statements?party_type=supplier&party_id=${supplierId}`,
  );
  assert.equal(stmtRes.status, 200);
  assert.equal(stmtRes.json.closing_balance, 2000 - paymentAmount); // Opening 2000 - 800 = 1200
});

test("EXPENSE & INCOME: post through double-entry accounting engine", async () => {
  // Expense: Salaries 5200 paid from Cash 1100
  const expRes = await api("POST", "/expenses", {
    expense_account_id: expenseAccountId,
    payment_account_id: cashAccountId,
    date: "2026-10-05",
    amount: 1500,
    remarks: "Monthly factory supervisor salary",
  });
  assert.equal(expRes.status, 201, `Expense failed: ${JSON.stringify(expRes.json)}`);
  assert.match(expRes.json.voucher_no, /^EXP-\d+$/);

  // Income: Scrap sales / miscellaneous revenue credited to Income 4000
  const incRes = await api("POST", "/income", {
    income_account_id: incomeAccountId,
    payment_account_id: cashAccountId,
    date: "2026-10-05",
    amount: 300,
    remarks: "Scrap drum sale cash received",
  });
  assert.equal(incRes.status, 201, `Income failed: ${JSON.stringify(incRes.json)}`);
  assert.match(incRes.json.voucher_no, /^INC-\d+$/);

  // Verify GET listings
  const expList = await api("GET", "/expenses");
  assert.equal(expList.status, 200);
  assert.ok(expList.json.some((e) => e.id === expRes.json.id));

  const incList = await api("GET", "/income");
  assert.equal(incList.status, 200);
  assert.ok(incList.json.some((i) => i.id === incRes.json.id));
});

test("JOURNAL VOUCHER: enforces strict double-entry balancing and atomic storage", async () => {
  // Valid balanced 2-line journal voucher
  const jvRes = await api("POST", "/journals", {
    date: "2026-10-05",
    reference_no: "JV-REF-01",
    remarks: "Bank deposit of cash",
    lines: [
      { account_id: cashAccountId, debit: 0, credit: 500, narration: "Cash transferred out" },
      { account_id: expenseAccountId, debit: 500, credit: 0, narration: "Factory maintenance fee" },
    ],
  });
  assert.equal(jvRes.status, 201, `Journal creation failed: ${JSON.stringify(jvRes.json)}`);
  assert.match(jvRes.json.voucher_no, /^JV-\d+$/);

  // Unbalanced journal must be rejected
  const unbalanced = await api("POST", "/journals", {
    date: "2026-10-05",
    lines: [
      { account_id: cashAccountId, debit: 500, credit: 0 },
      { account_id: expenseAccountId, debit: 0, credit: 400 }, // Off by 100
    ],
  });
  assert.equal(unbalanced.status, 400);
  assert.match(unbalanced.json.error, /not balanced/i);

  // Journal with only 1 line must be rejected
  const singleLine = await api("POST", "/journals", {
    date: "2026-10-05",
    lines: [{ account_id: cashAccountId, debit: 100, credit: 0 }],
  });
  assert.equal(singleLine.status, 400);

  // Verify GET /journals includes line items
  const jvList = await api("GET", "/journals");
  assert.equal(jvList.status, 200);
  const found = jvList.json.find((j) => j.id === jvRes.json.id);
  assert.ok(found);
  assert.equal(found.lines.length, 2);
});

test("STOCK ADJUSTMENT: positive and negative movements update stock and ledger auditably", async () => {
  // 1. Positive adjustment on raw material (+20 KG)
  const posAdj = await api("POST", "/stock/adjustments", {
    item_type: "raw",
    factory_item_id: rawItemId,
    date: "2026-10-05",
    adjustment_qty: 20,
    reason: "Found surplus in warehouse during cycle count",
  });
  assert.equal(posAdj.status, 201, `Positive adjustment failed: ${JSON.stringify(posAdj.json)}`);
  assert.equal(posAdj.json.resulting_qty, 100 + 20); // 120

  // 2. Negative adjustment on raw material (-15 KG)
  const negAdj = await api("POST", "/stock/adjustments", {
    item_type: "raw",
    factory_item_id: rawItemId,
    date: "2026-10-05",
    adjustment_qty: -15,
    reason: "Damaged bag discarded",
  });
  assert.equal(negAdj.status, 201);
  assert.equal(negAdj.json.resulting_qty, 120 - 15); // 105

  // 3. Negative adjustment exceeding current stock must be refused
  const overDeduct = await api("POST", "/stock/adjustments", {
    item_type: "raw",
    factory_item_id: rawItemId,
    date: "2026-10-05",
    adjustment_qty: -200, // Stock is only 105
    reason: "Attempting excessive reduction",
  });
  assert.equal(overDeduct.status, 400);
  assert.match(overDeduct.json.error, /drive stock negative/i);

  // 4. Verify stock ledger rows
  const conn = readDb();
  try {
    const rawStock = conn
      .prepare("SELECT stock_qty FROM factory_items WHERE id = ?")
      .get(rawItemId).stock_qty;
    assert.equal(rawStock, 105);

    const ledgerEntries = conn
      .prepare(
        "SELECT * FROM stock_ledger WHERE factory_item_id = ? AND ref_type = 'adjustment' ORDER BY id ASC",
      )
      .all(rawItemId);
    assert.equal(ledgerEntries.length, 2);
    assert.equal(ledgerEntries[0].qty_in, 20);
    assert.equal(ledgerEntries[0].qty_out, 0);
    assert.equal(ledgerEntries[1].qty_in, 0);
    assert.equal(ledgerEntries[1].qty_out, 15);
  } finally {
    conn.close();
  }
});

test("OPENING STOCK: posts ledger entry and enforces admin-only authorization", async () => {
  // Non-admin user must be rejected
  const nonAdminTry = await api(
    "POST",
    "/stock/opening",
    {
      item_type: "raw",
      factory_item_id: rawItemId,
      date: "2026-10-01",
      qty: 50,
      unit_cost: 250,
    },
    userToken,
  );
  assert.equal(nonAdminTry.status, 403, "Non-admin must not post opening stock");

  // Admin posts opening stock
  const adminPost = await api(
    "POST",
    "/stock/opening",
    {
      item_type: "raw",
      factory_item_id: rawItemId,
      date: "2026-10-01",
      qty: 50,
      unit_cost: 250,
      remarks: "Audited physical opening stock",
    },
    adminToken,
  );
  assert.equal(adminPost.status, 201, `Opening stock failed: ${JSON.stringify(adminPost.json)}`);
  assert.match(adminPost.json.voucher_no, /^OB-\d+$/);

  // Stock should now be 105 + 50 = 155
  assert.equal(adminPost.json.new_balance, 155);

  const listRes = await api("GET", "/stock/opening");
  assert.equal(listRes.status, 200);
  assert.ok(listRes.json.some((o) => o.id === adminPost.json.id));
});

test("USER MANAGEMENT: admin creates, updates, resets password, protects last admin", async () => {
  // Non-admin blocked from listing users
  const forbiddenList = await api("GET", "/users", undefined, userToken);
  assert.equal(forbiddenList.status, 403);

  // Admin lists users
  const userList = await api("GET", "/users", undefined, adminToken);
  assert.equal(userList.status, 200);
  assert.ok(userList.json.length >= 2);

  // Admin creates new user
  const newUserRes = await api(
    "POST",
    "/users",
    {
      username: "cashier1",
      password: "CashierSecret123!",
      role: "user",
      full_name: "Front Cashier",
    },
    adminToken,
  );
  assert.equal(newUserRes.status, 201);
  const newUserId = newUserRes.json.id;

  const oldCashierSession = await api(
    "POST",
    "/auth/login",
    { username: "cashier1", password: "CashierSecret123!" },
    null,
  );
  assert.equal(oldCashierSession.status, 200);

  // Admin resets cashier password
  const resetRes = await api(
    "POST",
    `/users/${newUserId}/reset-password`,
    { new_password: "NewCashierPass456!" },
    adminToken,
  );
  assert.equal(resetRes.status, 200);
  assert.equal((await api("GET", "/auth/me", undefined, oldCashierSession.json.token)).status, 401);

  // Cashier can login with new password
  const cashierLogin = await api(
    "POST",
    "/auth/login",
    { username: "cashier1", password: "NewCashierPass456!" },
    null,
  );
  assert.equal(cashierLogin.status, 200);

  // Attempt to deactivate or demote the last active admin must be prevented
  const allAdmins = userList.json.filter((u) => u.role === "admin" && u.is_active === 1);
  assert.equal(allAdmins.length, 1, "Only 1 active admin exists initially in test");

  const demoteAdmin = await api("PUT", `/users/${allAdmins[0].id}`, { role: "user" }, adminToken);
  assert.equal(demoteAdmin.status, 400);
  assert.match(demoteAdmin.json.error, /last active administrator/i);

  const deactivateAdmin = await api(
    "PUT",
    `/users/${allAdmins[0].id}`,
    { is_active: 0 },
    adminToken,
  );
  assert.equal(deactivateAdmin.status, 400);
  assert.match(deactivateAdmin.json.error, /last active administrator/i);
});

test("AUDIT TRAIL: records business actions and protects credentials", async () => {
  const auditRes = await api("GET", "/audit-logs", undefined, adminToken);
  assert.equal(auditRes.status, 200);
  assert.ok(auditRes.json.total > 0);
  assert.ok(Array.isArray(auditRes.json.rows));

  // Verify that no passwords or salts appear in any audit log details
  for (const row of auditRes.json.rows) {
    if (row.details) {
      assert.ok(!row.details.includes("password_hash"), "Audit log must not leak password_hash");
      assert.ok(!row.details.includes("password_salt"), "Audit log must not leak password_salt");
    }
  }
});

test("FINANCIAL REPORTS & DIAGNOSTICS: produce correct financial statements", async () => {
  // Profit & Loss
  const pnlRes = await api("GET", "/reports/profit-and-loss");
  assert.equal(pnlRes.status, 200);
  assert.ok(pnlRes.json.revenue !== undefined);
  assert.ok(pnlRes.json.gross_profit !== undefined);
  assert.ok(pnlRes.json.net_profit !== undefined);

  // Balance Sheet
  const bsRes = await api("GET", "/reports/balance-sheet");
  assert.equal(bsRes.status, 200);
  assert.ok(bsRes.json.assets !== undefined);
  assert.ok(bsRes.json.liabilities !== undefined);
  assert.ok(bsRes.json.equity !== undefined);
  assert.equal(bsRes.json.balanced, true, "Balance sheet must be in balance");

  // Stock Valuation
  const valRes = await api("GET", "/reports/stock-valuation");
  assert.equal(valRes.status, 200);
  assert.ok(valRes.json.total_inventory_cost_value > 0);
  assert.ok(valRes.json.raw_materials.count > 0);
  assert.ok(valRes.json.finished_goods.count > 0);

  // System Diagnostics
  const diagRes = await api("GET", "/diagnostics", undefined, adminToken);
  assert.equal(diagRes.status, 200);
  assert.equal(diagRes.json.database.journal_mode.toUpperCase(), "WAL");
  assert.equal(diagRes.json.database.integrity_check, "ok");
  assert.equal(diagRes.json.database.foreign_key_violations, 0);
  assert.equal(diagRes.json.accounting.trial_balance_balanced, true);
});

test("API responses are not cached and foreign origins receive no CORS grant", async () => {
  const response = await fetch(`${BASE}/health`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("per-username login lockout audits failed and blocked attempts", async () => {
  const username = "missing-lockout-user";
  for (let failure = 0; failure < 5; failure += 1) {
    const result = await api("POST", "/auth/login", { username, password: "wrong-password" }, null);
    assert.equal(result.status, 401);
  }
  const blocked = await api("POST", "/auth/login", { username, password: "wrong-password" }, null);
  assert.equal(blocked.status, 429);

  const conn = readDb();
  try {
    const audit = conn
      .prepare("SELECT action FROM audit_log WHERE username = ? ORDER BY id DESC LIMIT 6")
      .all(username)
      .map((row) => row.action);
    assert.equal(audit.filter((action) => action === "LOGIN_FAILED").length, 5);
    assert.equal(audit[0], "LOGIN_LOCKED");
  } finally {
    conn.close();
  }
});

test("password change retains the current session and invalidates other sessions", async () => {
  const secondSession = await api(
    "POST",
    "/auth/login",
    { username: REGULAR_USER, password: REGULAR_PASS },
    null,
  );
  assert.equal(secondSession.status, 200);

  const changed = await api(
    "POST",
    "/auth/change-password",
    { current_password: REGULAR_PASS, new_password: "ChangedUserPass123!" },
    userToken,
  );
  assert.equal(changed.status, 200);
  assert.equal((await api("GET", "/auth/me", undefined, userToken)).status, 200);
  assert.equal((await api("GET", "/auth/me", undefined, secondSession.json.token)).status, 401);
});

test("shared request validation rejects invalid numeric payloads", async () => {
  const invalidString = await api("POST", "/items", { name: "Bad item", rate: "NaN" });
  assert.equal(invalidString.status, 400);
  assert.match(invalidString.json.error, /valid number/i);

  const negative = await api("POST", "/items", { name: "Bad item", stock_qty: -1 });
  assert.equal(negative.status, 400);
});

let accountantManagedItemId;
let accountantManagedParticularId;

test("POST /items permits accountants and rejects users", async () => {
  assert.equal((await api("POST", "/items", { name: "Accountant item" }, userToken)).status, 403);
  const result = await api("POST", "/items", { name: "Accountant item" }, accountantToken);
  assert.equal(result.status, 201, JSON.stringify(result.json));
  accountantManagedItemId = result.json.id;
});

test("PUT /items/:id permits accountants and rejects users", async () => {
  const body = { name: "Accountant item updated", category: "Emulsion", remarks: "" };
  assert.equal(
    (await api("PUT", `/items/${accountantManagedItemId}`, body, userToken)).status,
    403,
  );
  assert.equal(
    (await api("PUT", `/items/${accountantManagedItemId}`, body, accountantToken)).status,
    200,
  );
});

test("POST /items/:id/particulars permits accountants and rejects users", async () => {
  const body = { type: "Can", weight_unit: "1 L", cost_price: 3, sale_price: 5 };
  assert.equal(
    (await api("POST", `/items/${accountantManagedItemId}/particulars`, body, userToken)).status,
    403,
  );
  const result = await api(
    "POST",
    `/items/${accountantManagedItemId}/particulars`,
    body,
    accountantToken,
  );
  assert.equal(result.status, 201, JSON.stringify(result.json));
  accountantManagedParticularId = result.json.id;
});

test("PUT /items/:id/particulars/:particularId permits accountants and rejects users", async () => {
  const body = {
    type: "Updated Can",
    weight_unit: "1 L",
    cost_price: 4,
    ws_price: 5,
    sale_price: 6,
    stock_qty: 0,
    min_qty: 0,
    max_qty: 0,
    formula_code: "",
  };
  const endpoint = `/items/${accountantManagedItemId}/particulars/${accountantManagedParticularId}`;
  assert.equal((await api("PUT", endpoint, body, userToken)).status, 403);
  assert.equal((await api("PUT", endpoint, body, accountantToken)).status, 200);
});

test("POST /formulas/:particularId permits accountants and rejects users", async () => {
  const body = {
    code: "ROLE-TEST",
    batch_size: 1,
    lines: [{ factory_item_id: rawItemId, material_name: "Raw material", value: 1, rate: 2 }],
  };
  const endpoint = `/formulas/${accountantManagedParticularId}`;
  assert.equal((await api("POST", endpoint, body, userToken)).status, 403);
  assert.equal((await api("POST", endpoint, body, accountantToken)).status, 200);
});

test("DELETE /items/:id permits admins and rejects users", async () => {
  const item = await api("POST", "/items", { name: "Admin-only delete" }, accountantToken);
  assert.equal(item.status, 201);
  assert.equal((await api("DELETE", `/items/${item.json.id}`, undefined, userToken)).status, 403);
  assert.equal((await api("DELETE", `/items/${item.json.id}`, undefined, adminToken)).status, 200);
});

test("DELETE /items/:id/particulars/:particularId permits admins and rejects users", async () => {
  const endpoint = `/items/${accountantManagedItemId}/particulars/${accountantManagedParticularId}`;
  assert.equal((await api("DELETE", endpoint, undefined, userToken)).status, 403);
  assert.equal((await api("DELETE", endpoint, undefined, adminToken)).status, 200);
});

test("POST /receipts permits accountants and rejects users", async () => {
  const body = {
    customer_id: customerId,
    date: "2026-10-05",
    payment_account_id: cashAccountId,
    amount: 1,
  };
  assert.equal((await api("POST", "/receipts", body, userToken)).status, 403);
  assert.equal((await api("POST", "/receipts", body, accountantToken)).status, 201);
});

test("POST /payments permits accountants and rejects users", async () => {
  const body = {
    supplier_id: supplierId,
    date: "2026-10-05",
    payment_account_id: cashAccountId,
    amount: 1,
  };
  assert.equal((await api("POST", "/payments", body, userToken)).status, 403);
  assert.equal((await api("POST", "/payments", body, accountantToken)).status, 201);
});

test("POST /expenses permits accountants and rejects users", async () => {
  const body = {
    expense_account_id: expenseAccountId,
    payment_account_id: cashAccountId,
    date: "2026-10-05",
    amount: 1,
  };
  assert.equal((await api("POST", "/expenses", body, userToken)).status, 403);
  assert.equal((await api("POST", "/expenses", body, accountantToken)).status, 201);
});

test("POST /income permits accountants and rejects users", async () => {
  const body = {
    income_account_id: incomeAccountId,
    payment_account_id: cashAccountId,
    date: "2026-10-05",
    amount: 1,
  };
  assert.equal((await api("POST", "/income", body, userToken)).status, 403);
  assert.equal((await api("POST", "/income", body, accountantToken)).status, 201);
});

test("POST /journals permits accountants and rejects users", async () => {
  const body = {
    date: "2026-10-05",
    lines: [
      { account_id: cashAccountId, debit: 1, credit: 0 },
      { account_id: expenseAccountId, debit: 0, credit: 1 },
    ],
  };
  assert.equal((await api("POST", "/journals", body, userToken)).status, 403);
  assert.equal((await api("POST", "/journals", body, accountantToken)).status, 201);
});

test("POST /stock/adjustments permits accountants and rejects users", async () => {
  const body = {
    item_type: "raw",
    factory_item_id: rawItemId,
    date: "2026-10-05",
    adjustment_qty: 1,
    reason: "Role authorization test",
  };
  assert.equal((await api("POST", "/stock/adjustments", body, userToken)).status, 403);
  assert.equal((await api("POST", "/stock/adjustments", body, accountantToken)).status, 201);
});
