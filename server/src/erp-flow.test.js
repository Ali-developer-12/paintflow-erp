import { after, before, test } from "node:test";
import { serverRuntimeEnv, serverRuntimePath } from "./test-runtime.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getFreePort } from "./test-utils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let BASE;
const ADMIN_USER = "testadmin";
const ADMIN_PASS = "TestPass123!";
const USER_NAME = "testuser";
const USER_PASS = "UserPass123!";

let child;
let dataDir;
let dbFile;
let token;
let supplierId;
let customerId;
let materialId;
let particularId;

function readDb() {
  return new Database(dbFile, { readonly: true });
}

function writableDb() {
  return new Database(dbFile);
}

async function api(method, endpoint, body, authToken = token) {
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
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Test server did not become healthy");
}

function assertAllVouchersBalanced() {
  const conn = readDb();
  try {
    const rows = conn
      .prepare(
        `SELECT av.voucher_no,
                COALESCE(SUM(al.debit), 0) AS debit,
                COALESCE(SUM(al.credit), 0) AS credit
         FROM account_vouchers av
         LEFT JOIN account_ledger al ON al.voucher_id = av.id
         GROUP BY av.id`,
      )
      .all();
    assert.ok(rows.length > 0, "expected at least one account voucher to be posted");
    for (const row of rows) {
      assert.ok(
        Math.abs(row.debit - row.credit) <= 0.01,
        `unbalanced account voucher ${row.voucher_no}: ${row.debit} vs ${row.credit}`,
      );
    }
  } finally {
    conn.close();
  }
}

async function rawStockQty() {
  const res = await api("GET", "/factory-items");
  return Number(res.json.find((row) => row.id === materialId).stock_qty);
}

async function finishedStockQty() {
  const res = await api("GET", "/particulars");
  return Number(res.json.find((row) => row.id === particularId).stock_qty);
}

before(async () => {
  const port = await getFreePort();
  BASE = `http://127.0.0.1:${port}/api`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paint-erp-test-"));
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

  const login = await api(
    "POST",
    "/auth/login",
    { username: ADMIN_USER, password: ADMIN_PASS },
    null,
  );
  assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.json)}`);
  token = login.json.token;
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
      if (attempt % 30 === 0) console.error("erp health probe not ready", attempt);
      // The temporary directory is disposable; a locked file must not fail the run.
    }
  }
});

test("health endpoint reports the active database", async () => {
  const res = await api("GET", "/health", undefined, null);
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.db, dbFile);
});

test("login rejects a wrong password with 401", async () => {
  const res = await api("POST", "/auth/login", { username: ADMIN_USER, password: "wrong" }, null);
  assert.equal(res.status, 401);
});

test("protected endpoints reject missing and unknown tokens with 401", async () => {
  assert.equal((await api("GET", "/items", undefined, null)).status, 401);
  assert.equal((await api("GET", "/items", undefined, "not-a-real-token")).status, 401);
});

test("masters create supplier, customer and raw material", async () => {
  const supplier = await api("POST", "/setup/suppliers", { name: "Test Supplier" });
  assert.equal(supplier.status, 201, JSON.stringify(supplier.json));
  supplierId = supplier.json.id;

  const customer = await api("POST", "/setup/customers", { name: "Test Customer" });
  assert.equal(customer.status, 201, JSON.stringify(customer.json));
  customerId = customer.json.id;

  const material = await api("POST", "/setup/factory-items", {
    name: "Solvent",
    unit: "KG",
    rate: 60,
    stock: 0,
  });
  assert.equal(material.status, 201, JSON.stringify(material.json));
  materialId = material.json.id;
});

test("item and particular are created with server-validated numbers", async () => {
  const item = await api("POST", "/items", { name: "Paint" });
  assert.equal(item.status, 201, JSON.stringify(item.json));

  const particular = await api("POST", `/items/${item.json.id}/particulars`, {
    type: "Gallon",
    weight_unit: "3.5 KG",
    cost_price: 100,
    ws_price: 150,
    sale_price: 200,
    stock_qty: 0,
  });
  assert.equal(particular.status, 201, JSON.stringify(particular.json));
  particularId = particular.json.id;

  const blank = await api("POST", "/items", { name: "   " });
  assert.equal(blank.status, 400);
});

test("formula totals are calculated on the server from stored lines", async () => {
  const res = await api("POST", `/formulas/${particularId}`, {
    code: "F-001",
    batch_size: 10,
    // Deliberately send a wrong client-side total; the server must ignore it.
    total_cost: 999999,
    lines: [{ factory_item_id: materialId, material_name: "Solvent", value: 2, rate: 50 }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(Number(res.json.formula.total_cost), 100);
  assert.equal(Number(res.json.lines[0].cost_value), 100);
});

test("purchase rejects unknown suppliers, zero quantity and missing item references", async () => {
  const unknownSupplier = await api("POST", "/purchases", {
    supplier_id: 999999,
    lines: [{ factory_item_id: materialId, qty: 1, rate: 10 }],
  });
  assert.equal(unknownSupplier.status, 400);

  const zeroQty = await api("POST", "/purchases", {
    supplier_id: supplierId,
    lines: [{ factory_item_id: materialId, qty: 0, rate: 10 }],
  });
  assert.equal(zeroQty.status, 400);

  const noReference = await api("POST", "/purchases", {
    supplier_id: supplierId,
    lines: [{ qty: 1, rate: 10 }],
  });
  assert.equal(noReference.status, 400);
});

test("purchase posts a balanced voucher and raises raw stock", async () => {
  const res = await api("POST", "/purchases", {
    supplier_id: supplierId,
    lines: [{ factory_item_id: materialId, qty: 100, rate: 60 }],
    paid_amount: 2000,
    payment_mode: "cash",
    sub_total: 999999,
    net_total: 999999,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.purchase.sub_total), 6000);
  assert.equal(Number(res.json.purchase.net_total), 6000);
  assert.equal(await rawStockQty(), 100);

  const ledger = await api("GET", `/stock/ledger?item_id=${materialId}&stock_type=raw`);
  assert.equal(ledger.json.length, 1);
  assert.equal(Number(ledger.json[0].balance_after), 100);
  assertAllVouchersBalanced();
});

test("production consumes formula materials and produces finished stock", async () => {
  const res = await api("POST", "/productions", {
    particular_id: particularId,
    batch_quantity: 20,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.calculation.batchMultiplier), 2);
  assert.equal(await rawStockQty(), 96);
  assert.equal(await finishedStockQty(), 20);
  assertAllVouchersBalanced();
});

test("production rolls back completely when stock is insufficient", async () => {
  const before = await api("GET", "/productions");
  const res = await api("POST", "/productions", {
    particular_id: particularId,
    batch_quantity: 100000,
  });
  assert.equal(res.status, 400);
  const after = await api("GET", "/productions");
  assert.equal(after.json.length, before.json.length);
  assert.equal(await rawStockQty(), 96);
  assertAllVouchersBalanced();
});

test("counter sale deducts stock and posts receivable, sales and COGS", async () => {
  const res = await api("POST", "/sales", {
    customer_id: customerId,
    lines: [{ particular_id: particularId, qty: 5, rate: 200 }],
    sub_total: 999999,
    net_total: 999999,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.total), 1000);
  assert.equal(await finishedStockQty(), 15);
  assertAllVouchersBalanced();
});

test("issue voucher is stock-only and rejects zero quantity", async () => {
  const zero = await api("POST", "/issue-vouchers", {
    customer_id: customerId,
    lines: [{ particular_id: particularId, qty: 0 }],
  });
  assert.equal(zero.status, 400);

  const ok = await api("POST", "/issue-vouchers", {
    customer_id: customerId,
    lines: [{ particular_id: particularId, qty: 2 }],
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(await finishedStockQty(), 13);

  const conn = readDb();
  try {
    const count = conn
      .prepare("SELECT COUNT(*) AS c FROM account_vouchers WHERE ref_type = 'issue'")
      .get().c;
    assert.equal(count, 0, "issue vouchers must not post financial vouchers");
  } finally {
    conn.close();
  }
});

test("customer return restores stock and reverses the sale value", async () => {
  const res = await api("POST", "/returns", {
    return_type: "customer",
    customer_id: customerId,
    lines: [{ particular_id: particularId, qty: 1, rate: 200 }],
    net_total: 999999,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.total), 200);
  assert.equal(await finishedStockQty(), 14);
  assertAllVouchersBalanced();
});

test("supplier return cannot drive raw stock negative", async () => {
  const tooMuch = await api("POST", "/returns", {
    return_type: "supplier",
    supplier_id: supplierId,
    lines: [{ factory_item_id: materialId, qty: 100000, rate: 60 }],
  });
  assert.equal(tooMuch.status, 400);
  assert.equal(await rawStockQty(), 96);

  const ok = await api("POST", "/returns", {
    return_type: "supplier",
    supplier_id: supplierId,
    lines: [{ factory_item_id: materialId, qty: 10, rate: 60 }],
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(await rawStockQty(), 86);
  assertAllVouchersBalanced();
});

test("stock ledger reconciles with master stock balances", async () => {
  const res = await api("GET", "/stock/reconciliation");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true, JSON.stringify(res.json.issues));
});

test("trial balance is balanced after the full flow", async () => {
  const res = await api("GET", "/accounts/trial-balance");
  assert.equal(res.status, 200);
  assert.equal(res.json.balanced, true, JSON.stringify(res.json));
});

test("purchase records the authenticated user as created_by", async () => {
  const conn = readDb();
  try {
    const rows = conn.prepare("SELECT voucher_no, created_by FROM purchases").all();
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.ok(row.created_by, `purchase ${row.voucher_no} has no created_by`);
    }
  } finally {
    conn.close();
  }
});

test("backup produces a verified WAL-safe snapshot and logs it", async () => {
  const res = await api("GET", "/backup/export");
  assert.equal(res.status, 200);

  const list = await api("GET", "/backup/list");
  assert.equal(list.status, 200);
  assert.ok(list.json.backups.length >= 1, "backup was not logged in the backups table");

  const conn = readDb();
  try {
    const row = conn
      .prepare("SELECT file_path, size_bytes FROM backups ORDER BY id DESC LIMIT 1")
      .get();
    assert.ok(row.size_bytes > 0);
    assert.ok(fs.existsSync(row.file_path), "backup file was not created on disk");
    assert.ok(
      row.file_path.startsWith(list.json.directory),
      "backup escaped the configured backup directory",
    );
  } finally {
    conn.close();
  }
});

test("year rollover closes the old year, records the posting and blocks closed-year writes", async () => {
  const years = await api("GET", "/setup/financial-years");
  assert.equal(years.status, 200);
  const original = years.json[0];

  const rollover = await api("POST", "/setup/new-year-posting", { name: "TestYear" });
  assert.equal(rollover.status, 201, JSON.stringify(rollover.json));

  const after = await api("GET", "/setup/financial-years");
  const closed = after.json.find((year) => year.name === original.name);
  assert.equal(Number(closed.is_closed), 1);
  assert.equal(Number(closed.is_current), 0);
  assert.equal(Number(after.json.find((year) => year.name === "TestYear").is_current), 1);

  const postings = await api("GET", "/setup/year-postings");
  assert.equal(postings.json.length, 1);
  assert.equal(postings.json[0].from_year_name, original.name);
  assert.equal(postings.json[0].to_year_name, "TestYear");

  const duplicate = await api("POST", "/setup/new-year-posting", { name: "TestYear" });
  assert.equal(duplicate.status, 400);

  const blocked = await api("POST", "/purchases", {
    date: original.start_date,
    supplier_id: supplierId,
    lines: [{ factory_item_id: materialId, qty: 5, rate: 60 }],
  });
  assert.equal(blocked.status, 400);
  assert.match(String(blocked.json.error), /closed/i);
  assert.equal(await rawStockQty(), 86);
  assertAllVouchersBalanced();
});

test("role checks are enforced server-side", async () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(USER_PASS, salt, 64).toString("hex");
  const conn = writableDb();
  try {
    conn
      .prepare(
        "INSERT INTO users (username, password_hash, password_salt, full_name, role, is_active) VALUES (?, ?, ?, ?, 'user', 1)",
      )
      .run(USER_NAME, hash, salt, "Regular User");
  } finally {
    conn.close();
  }

  const login = await api(
    "POST",
    "/auth/login",
    { username: USER_NAME, password: USER_PASS },
    null,
  );
  assert.equal(login.status, 200);
  const userToken = login.json.token;

  const readAllowed = await api("GET", "/items", undefined, userToken);
  assert.equal(readAllowed.status, 200, "normal users must still be able to read masters");

  const masterWrite = await api("POST", "/setup/suppliers", { name: "Nope" }, userToken);
  assert.equal(masterWrite.status, 403);

  const supplierCreate = await api("POST", "/suppliers", { name: "Nope" }, userToken);
  assert.equal(supplierCreate.status, 403);

  const backup = await api("GET", "/backup/export", undefined, userToken);
  assert.equal(backup.status, 403);
});

test("change-password rejects a wrong current password and accepts a valid one", async () => {
  const wrong = await api("POST", "/auth/change-password", {
    current_password: "nope",
    new_password: "AnotherPass123!",
  });
  assert.equal(wrong.status, 400);

  const tooShort = await api("POST", "/auth/change-password", {
    current_password: ADMIN_PASS,
    new_password: "short",
  });
  assert.equal(tooShort.status, 400);

  const ok = await api("POST", "/auth/change-password", {
    current_password: ADMIN_PASS,
    new_password: "RotatedPass123!",
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  const relogin = await api(
    "POST",
    "/auth/login",
    { username: ADMIN_USER, password: "RotatedPass123!" },
    null,
  );
  assert.equal(relogin.status, 200);
});
