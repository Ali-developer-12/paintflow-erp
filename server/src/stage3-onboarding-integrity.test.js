import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getFreePort } from "./test-utils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = { username: "firstadmin", password: "FirstAdminPass123!" };
let child;
let dataDir;
let dbFile;
let base;
let adminToken;
let supplierId;
let customerId;
let rawItemId;
let particularId;

function readDb() {
  return new Database(dbFile, { readonly: true });
}

async function api(method, endpoint, body, token = adminToken) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null,
  };
}

async function startServer(extraEnv = {}) {
  const port = await getFreePort();
  base = `http://127.0.0.1:${port}/api`;
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    DB_PATH: dbFile,
  };
  delete env.PAINT_ERP_ADMIN_USERNAME;
  delete env.PAINT_ERP_ADMIN_PASSWORD;
  Object.assign(env, extraEnv);
  child = spawn(process.execPath, [path.join(here, "index.js")], { env, stdio: "ignore" });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error("Stage 3 test server exited before becoming healthy");
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Stage 3 test server did not become healthy");
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paint-erp-stage3-"));
  dbFile = path.join(dataDir, "paint-erp.db");
  await startServer();
});

after(async () => {
  await stopServer();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
});

test("first-run setup is single-use, concurrent-safe, and logs in", async () => {
  const initialStatus = await api("GET", "/auth/status", undefined, null);
  assert.deepEqual(initialStatus, { status: 200, json: { needsSetup: true } });

  const attempts = await Promise.all([
    api("POST", "/auth/setup", { ...admin, full_name: "First Administrator" }, null),
    api("POST", "/auth/setup", { ...admin, full_name: "First Administrator" }, null),
  ]);
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 403]);
  const setup = attempts.find((result) => result.status === 201);
  assert.ok(setup?.json.token);
  assert.equal(setup.json.user.role, "admin");
  adminToken = setup.json.token;

  const duplicate = await api(
    "POST",
    "/auth/setup",
    { ...admin, full_name: "Another Administrator" },
    null,
  );
  assert.equal(duplicate.status, 403);
  assert.deepEqual((await api("GET", "/auth/status", undefined, null)).json, {
    needsSetup: false,
  });
  assert.equal(
    (await api("POST", "/auth/login", admin, null)).status,
    200,
    "the administrator created by setup must be able to log in",
  );

  const tooShort = await api(
    "POST",
    "/auth/setup",
    { username: "otheradmin", password: "short", full_name: "Other" },
    null,
  );
  assert.equal(tooShort.status, 400);
  const conn = readDb();
  try {
    assert.equal(conn.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
  } finally {
    conn.close();
  }
});

test("environment bootstrap never changes an existing user's password or role", async () => {
  const create = await api("POST", "/users", {
    username: "envtarget",
    password: "ExistingPass123!",
    role: "accountant",
    full_name: "Existing Accountant",
  });
  assert.equal(create.status, 201);

  await stopServer();
  await startServer({
    PAINT_ERP_ADMIN_USERNAME: "envtarget",
    PAINT_ERP_ADMIN_PASSWORD: "BootstrapPass123!",
  });

  const existingPassword = await api(
    "POST",
    "/auth/login",
    { username: "envtarget", password: "ExistingPass123!" },
    null,
  );
  assert.equal(existingPassword.status, 200);
  assert.equal(existingPassword.json.user.role, "accountant");
  assert.equal(
    (
      await api(
        "POST",
        "/auth/login",
        {
          username: "envtarget",
          password: "BootstrapPass123!",
        },
        null,
      )
    ).status,
    401,
  );
  const adminLogin = await api("POST", "/auth/login", admin, null);
  assert.equal(adminLogin.status, 200);
  adminToken = adminLogin.json.token;

  const conn = readDb();
  try {
    assert.equal(conn.prepare("SELECT COUNT(*) AS count FROM users").get().count, 2);
    assert.equal(
      conn.prepare("SELECT role FROM users WHERE username = 'envtarget'").get().role,
      "accountant",
    );
  } finally {
    conn.close();
  }
});

test("fresh-database purchase, production, sale, return, receipt and payment flow", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const supplier = await api("POST", "/setup/suppliers", { name: "Stage 3 Supplier" });
  const customer = await api("POST", "/setup/customers", { name: "Stage 3 Customer" });
  assert.equal(supplier.status, 201);
  assert.equal(customer.status, 201);
  supplierId = supplier.json.id;
  customerId = customer.json.id;

  const raw = await api("POST", "/setup/factory-items", {
    name: "Stage 3 Raw Material",
    unit: "KG",
    rate: 50,
    stock: 0,
  });
  assert.equal(raw.status, 201, JSON.stringify(raw.json));
  rawItemId = raw.json.id;

  const item = await api("POST", "/items", { name: "Stage 3 Finished Paint" });
  assert.equal(item.status, 201, JSON.stringify(item.json));
  const particular = await api("POST", `/items/${item.json.id}/particulars`, {
    type: "Can",
    weight_unit: "1 KG",
    cost_price: 50,
    ws_price: 100,
    sale_price: 200,
    stock_qty: 0,
  });
  assert.equal(particular.status, 201, JSON.stringify(particular.json));
  particularId = particular.json.id;

  const formula = await api("POST", `/formulas/${particularId}`, {
    code: "STAGE3-FORMULA",
    batch_size: 1,
    lines: [
      { factory_item_id: rawItemId, material_name: "Stage 3 Raw Material", value: 1, rate: 50 },
    ],
  });
  assert.equal(formula.status, 200, JSON.stringify(formula.json));

  const purchase = await api("POST", "/purchases", {
    date,
    supplier_id: supplierId,
    paid_amount: 0,
    lines: [{ factory_item_id: rawItemId, qty: 20, rate: 50 }],
    sub_total: 1,
    net_total: 1,
  });
  assert.equal(purchase.status, 201, JSON.stringify(purchase.json));
  assert.equal(Number(purchase.json.purchase.net_total), 1000);

  const production = await api("POST", "/productions", {
    date,
    particular_id: particularId,
    batch_quantity: 10,
  });
  assert.equal(production.status, 201, JSON.stringify(production.json));

  const sale = await api("POST", "/sales", {
    date,
    customer_id: customerId,
    lines: [{ particular_id: particularId, qty: 2, rate: 200 }],
    sub_total: 1,
    net_total: 1,
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const saleLine = readDb();
  try {
    assert.equal(
      saleLine.prepare("SELECT cost_price FROM sale_lines WHERE sale_id = ?").get(sale.json.id)
        .cost_price,
      50,
    );
  } finally {
    saleLine.close();
  }

  const customerReturn = await api("POST", "/returns", {
    date,
    return_type: "customer",
    customer_id: customerId,
    lines: [{ particular_id: particularId, qty: 1, rate: 200 }],
    net_total: 1,
  });
  assert.equal(customerReturn.status, 201, JSON.stringify(customerReturn.json));
  const returnLine = readDb();
  try {
    assert.equal(
      returnLine
        .prepare("SELECT cost_price FROM return_lines WHERE return_id = ?")
        .get(customerReturn.json.id).cost_price,
      50,
    );
  } finally {
    returnLine.close();
  }

  const accounts = await api("GET", "/accounts");
  const cashAccount = accounts.json.find((account) => account.code === "1100");
  assert.ok(cashAccount, "cash account must be available for receipts and payments");
  const receipt = await api("POST", "/receipts", {
    date,
    customer_id: customerId,
    payment_account_id: cashAccount.id,
    amount: 100,
  });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.json));
  const payment = await api("POST", "/payments", {
    date,
    supplier_id: supplierId,
    payment_account_id: cashAccount.id,
    amount: 100,
  });
  assert.equal(payment.status, 201, JSON.stringify(payment.json));
});

test("zero-cost sales and returns are blocked without stock or document changes", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const item = await api("POST", "/items", { name: "Uncosted Paint" });
  const particular = await api("POST", `/items/${item.json.id}/particulars`, {
    type: "Can",
    cost_price: 0,
    ws_price: 0,
    sale_price: 10,
    stock_qty: 0,
  });
  assert.equal(particular.status, 201, JSON.stringify(particular.json));
  const adjustment = await api("POST", "/stock/adjustments", {
    date,
    item_type: "finished",
    particular_id: particular.json.id,
    adjustment_qty: 1,
    reason: "Stage 3 cost validation test",
  });
  assert.equal(adjustment.status, 201, JSON.stringify(adjustment.json));

  const sale = await api("POST", "/sales", {
    date,
    customer_id: customerId,
    lines: [{ particular_id: particular.json.id, qty: 1, rate: 10 }],
  });
  assert.equal(sale.status, 400);
  assert.match(sale.json.error, /Item has no cost price; set the cost first/);
  const customerReturn = await api("POST", "/returns", {
    date,
    return_type: "customer",
    customer_id: customerId,
    lines: [{ particular_id: particular.json.id, qty: 1, rate: 10 }],
  });
  assert.equal(customerReturn.status, 400);
  assert.match(customerReturn.json.error, /Item has no cost price; set the cost first/);
  assert.equal(
    Number(
      (await api("GET", "/particulars")).json.find((row) => row.id === particular.json.id)
        .stock_qty,
    ),
    1,
  );
  const conn = readDb();
  try {
    assert.equal(
      conn
        .prepare("SELECT COUNT(*) AS count FROM sale_lines WHERE particular_id = ?")
        .get(particular.json.id).count,
      0,
    );
    assert.equal(
      conn
        .prepare("SELECT COUNT(*) AS count FROM return_lines WHERE particular_id = ?")
        .get(particular.json.id).count,
      0,
    );
  } finally {
    conn.close();
  }
});

test("stock operations reject negative balances atomically and concurrent last-unit sales serialize", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const item = await api("POST", "/items", { name: "One Unit Paint" });
  const particular = await api("POST", `/items/${item.json.id}/particulars`, {
    type: "Can",
    cost_price: 5,
    ws_price: 8,
    sale_price: 10,
    stock_qty: 0,
  });
  assert.equal(particular.status, 201, JSON.stringify(particular.json));
  const stockAdjustment = await api("POST", "/stock/adjustments", {
    date,
    item_type: "finished",
    particular_id: particular.json.id,
    adjustment_qty: 1,
    reason: "Stage 3 concurrency test",
  });
  assert.equal(stockAdjustment.status, 201, JSON.stringify(stockAdjustment.json));

  const issue = await api("POST", "/issue-vouchers", {
    date,
    customer_id: customerId,
    lines: [{ particular_id: particular.json.id, qty: 2 }],
  });
  assert.equal(issue.status, 400);
  const adjustment = await api("POST", "/stock/adjustments", {
    date,
    item_type: "finished",
    particular_id: particular.json.id,
    adjustment_qty: -2,
    reason: "Must not become negative",
  });
  assert.equal(adjustment.status, 400);

  const rawBefore = Number(
    (await api("GET", "/factory-items")).json.find((row) => row.id === rawItemId).stock_qty,
  );
  const productionCountBefore = Number((await api("GET", "/productions")).json.length);
  const production = await api("POST", "/productions", {
    date,
    particular_id: particularId,
    batch_quantity: 1000,
  });
  assert.equal(production.status, 400);
  assert.equal(Number((await api("GET", "/productions")).json.length), productionCountBefore);
  assert.equal(
    Number((await api("GET", "/factory-items")).json.find((row) => row.id === rawItemId).stock_qty),
    rawBefore,
  );

  const supplierReturn = await api("POST", "/returns", {
    date,
    return_type: "supplier",
    supplier_id: supplierId,
    lines: [{ factory_item_id: rawItemId, qty: rawBefore + 1, rate: 50 }],
  });
  assert.equal(supplierReturn.status, 400);
  assert.equal(
    Number((await api("GET", "/factory-items")).json.find((row) => row.id === rawItemId).stock_qty),
    rawBefore,
  );

  const saleBody = {
    date,
    customer_id: customerId,
    lines: [{ particular_id: particular.json.id, qty: 1, rate: 10 }],
  };
  const sales = await Promise.all([
    api("POST", "/sales", saleBody),
    api("POST", "/sales", saleBody),
  ]);
  assert.deepEqual(sales.map((result) => result.status).sort(), [201, 400]);
  assert.equal(
    Number(
      (await api("GET", "/particulars")).json.find((row) => row.id === particular.json.id)
        .stock_qty,
    ),
    0,
  );
});

test("integrity endpoints reconcile stock and keep the trial balance balanced", async () => {
  const reconciliation = await api("GET", "/stock/reconciliation");
  const trialBalance = await api("GET", "/accounts/trial-balance");
  assert.equal(reconciliation.status, 200);
  assert.equal(reconciliation.json.ok, true, JSON.stringify(reconciliation.json));
  assert.deepEqual(reconciliation.json.issues, []);
  assert.equal(trialBalance.status, 200);
  assert.equal(trialBalance.json.balanced, true, JSON.stringify(trialBalance.json));
  assert.equal(trialBalance.json.total_debit, trialBalance.json.total_credit);
  console.log("STAGE3_RECONCILE_STOCK", JSON.stringify(reconciliation.json));
  console.log("STAGE3_TRIAL_BALANCE", JSON.stringify(trialBalance.json));
});

test("closed-year writes fail without changing the balanced trial balance", async () => {
  const years = await api("GET", "/setup/financial-years");
  assert.equal(years.status, 200);
  const currentYear = years.json.find((year) => Number(year.is_current) === 1);
  assert.ok(currentYear, "expected a current financial year");
  const close = await api("POST", "/setup/new-year-posting", {
    name: `Stage3-${Date.now()}`,
  });
  assert.equal(close.status, 201, JSON.stringify(close.json));

  const before = await api("GET", "/accounts/trial-balance");
  const rejected = await api("POST", "/purchases", {
    date: currentYear.start_date,
    supplier_id: supplierId,
    lines: [{ factory_item_id: rawItemId, qty: 1, rate: 50 }],
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json.error, /closed/i);
  const after = await api("GET", "/accounts/trial-balance");
  assert.deepEqual(after.json, before.json);
});
