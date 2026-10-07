// Final A/B/X acceptance suite.
//
//   A — Happy path: purchase -> production -> sale -> customer return, proving
//       stock and the ledger stay consistent and every document posts exactly once.
//   B — Failure paths: closed year, unbalanced voucher, rollback, zero-value docs.
//   X — Security and integrity: sessions, passwords, roles, duplicate posting, numbering.
//
// Runs against a throwaway temporary database and NEVER touches server/data.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(__dirname, "..", "data", "scenario-"));

process.env.DATA_DIR = tmpRoot;
process.env.BACKUP_DIR = path.join(tmpRoot, "backups");
process.env.RESTORE_DIR = path.join(tmpRoot, "restored");

const { default: db, applySchema } = await import("./db.js");
const accounting = await import("./accounting.js");
const { assertPostingAllowed } = await import("./years.js");
const { DOC_PREFIX, nextUniqueVoucherNo } = await import("./vouchers.js");
const backpost = await import("./backpost.js");
const auth = await import("./auth.js");

before(() => {
  applySchema();
  accounting.ensureChartOfAccounts();
});

after(() => {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

function reset() {
  const tables = [
    "stock_ledger",
    "account_ledger",
    "account_vouchers",
    "migration_log",
    "return_lines",
    "returns",
    "issue_voucher_lines",
    "issue_vouchers",
    "sale_lines",
    "sales",
    "production_consumptions",
    "productions",
    "purchase_lines",
    "purchases",
    "formula_lines",
    "formulas",
    "item_particulars",
    "items",
    "factory_items",
    "suppliers",
    "customers",
    "sessions",
    "users",
  ];
  const wipe = db.transaction(() => {
    db.pragma("foreign_keys = OFF");
    for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
    db.pragma("foreign_keys = ON");
  });
  wipe();
}

function seed() {
  const sup = db
    .prepare(
      "INSERT INTO suppliers (code,name,is_active,created_at) VALUES ('SUP-1','Supplier',1,datetime('now'))",
    )
    .run();
  const cus = db
    .prepare(
      "INSERT INTO customers (code,name,is_active,created_at) VALUES ('CUS-1','Customer',1,datetime('now'))",
    )
    .run();
  const raw = db
    .prepare(
      "INSERT INTO factory_items (name,stock_qty,is_active,created_at) VALUES ('Raw A',0,1,datetime('now'))",
    )
    .run();
  const item = db
    .prepare(
      "INSERT INTO items (code,name,is_active,created_at) VALUES ('IT-1','Paint',1,datetime('now'))",
    )
    .run();
  const fin = db
    .prepare(
      "INSERT INTO item_particulars (item_id,type,cost_price,ws_price,sale_price,stock_qty,created_at) VALUES (?,'Gallon',0,0,0,0,datetime('now'))",
    )
    .run(item.lastInsertRowid);
  return {
    supplierId: Number(sup.lastInsertRowid),
    customerId: Number(cus.lastInsertRowid),
    rawId: Number(raw.lastInsertRowid),
    particularId: Number(fin.lastInsertRowid),
  };
}

// Ledger net balance for an account code (debit positive).
function balance(code) {
  return Number(
    db
      .prepare(
        "SELECT COALESCE(SUM(al.debit - al.credit),0) AS bal FROM account_ledger al JOIN accounts a ON a.id = al.account_id WHERE a.code = ?",
      )
      .get(code).bal,
  );
}

function addLedger({
  date,
  type,
  particularId,
  rawId,
  refType,
  refId,
  refNo,
  inQty = 0,
  outQty = 0,
  rate = 0,
  after = 0,
}) {
  db.prepare(
    `INSERT INTO stock_ledger (date,stock_type,particular_id,factory_item_id,ref_type,ref_id,ref_no,qty_in,qty_out,rate,balance_after,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
  ).run(
    date,
    type,
    particularId ?? null,
    rawId ?? null,
    refType,
    refId,
    refNo,
    inQty,
    outQty,
    rate,
    after,
  );
}
// ---- Scenario A: happy path ----------------------------------------------

test("A: purchase -> production -> sale -> return keeps stock and ledger consistent", () => {
  reset();
  const { supplierId, customerId, rawId, particularId } = seed();

  // Purchase 100 raw units @ 10 = 1000; pay 400, owe 600.
  db.prepare(
    `INSERT INTO purchases (voucher_no,date,supplier_id,sub_total,net_total,paid_amount,created_at)
     VALUES ('PUR-000001','2025-01-05',?,1000,1000,400,datetime('now'))`,
  ).run(supplierId);
  const purchaseId = Number(db.prepare("SELECT id FROM purchases").get().id);
  db.prepare(
    "INSERT INTO purchase_lines (purchase_id,factory_item_id,qty,rate,amount) VALUES (?,?,100,10,1000)",
  ).run(purchaseId, rawId);
  addLedger({
    date: "2025-01-05",
    type: "raw",
    rawId,
    refType: "purchase",
    refId: purchaseId,
    refNo: "PUR-000001",
    inQty: 100,
    rate: 10,
    after: 100,
  });
  db.prepare("UPDATE factory_items SET stock_qty = 100 WHERE id = ?").run(rawId);

  accounting.postAccountVoucher({
    voucherNo: "AV-PUR-000001",
    date: "2025-01-05",
    voucherType: "purchase",
    refType: "purchase",
    refId: purchaseId,
    entries: [
      { account_id: accounting.requireAccountIdByCode("1410"), debit: 1000, credit: 0 },
      { account_id: accounting.requireAccountIdByCode("1100"), debit: 0, credit: 400 },
      { account_id: accounting.requireAccountIdByCode("2100"), debit: 0, credit: 600 },
    ],
  });

  // Produce 40 finished units consuming 100 raw (material cost 1000).
  db.prepare(
    `INSERT INTO productions (voucher_no,date,particular_id,batches,produced_qty,material_cost,overhead_cost,total_cost,created_at)
     VALUES ('PRO-000001','2025-01-10',?,1,40,1000,0,1000,datetime('now'))`,
  ).run(particularId);
  const productionId = Number(db.prepare("SELECT id FROM productions").get().id);
  db.prepare(
    "INSERT INTO production_consumptions (production_id,factory_item_id,qty,rate,amount) VALUES (?,?,100,10,1000)",
  ).run(productionId, rawId);
  addLedger({
    date: "2025-01-10",
    type: "raw",
    rawId,
    refType: "production",
    refId: productionId,
    refNo: "PRO-000001",
    outQty: 100,
    rate: 10,
    after: 0,
  });
  addLedger({
    date: "2025-01-10",
    type: "finished",
    particularId,
    refType: "production",
    refId: productionId,
    refNo: "PRO-000001",
    inQty: 40,
    rate: 25,
    after: 40,
  });
  db.prepare("UPDATE factory_items SET stock_qty = 0 WHERE id = ?").run(rawId);
  db.prepare("UPDATE item_particulars SET stock_qty = 40, cost_price = 25 WHERE id = ?").run(
    particularId,
  );

  accounting.postAccountVoucher({
    voucherNo: "AV-PRO-000001",
    date: "2025-01-10",
    voucherType: "journal",
    refType: "production",
    refId: productionId,
    entries: [
      { account_id: accounting.requireAccountIdByCode("1420"), debit: 1000, credit: 0 },
      { account_id: accounting.requireAccountIdByCode("1410"), debit: 0, credit: 1000 },
    ],
  });
  // Sell 10 @ 40 = 400 on credit; COGS = 10 x 25 = 250.
  db.prepare(
    `INSERT INTO sales (voucher_no,date,customer_id,sale_type,sub_total,net_total,paid_amount,created_at)
     VALUES ('SL-000001','2025-01-15',?,'counter',400,400,0,datetime('now'))`,
  ).run(customerId);
  const saleId = Number(db.prepare("SELECT id FROM sales").get().id);
  db.prepare(
    "INSERT INTO sale_lines (sale_id,particular_id,qty,rate,amount) VALUES (?,?,10,40,400)",
  ).run(saleId, particularId);
  addLedger({
    date: "2025-01-15",
    type: "finished",
    particularId,
    refType: "sale",
    refId: saleId,
    refNo: "SL-000001",
    outQty: 10,
    rate: 40,
    after: 30,
  });
  db.prepare("UPDATE item_particulars SET stock_qty = 30 WHERE id = ?").run(particularId);

  accounting.postAccountVoucher({
    voucherNo: "AV-SL-000001",
    date: "2025-01-15",
    voucherType: "sale",
    refType: "sale",
    refId: saleId,
    entries: [
      { account_id: accounting.requireAccountIdByCode("1300"), debit: 400, credit: 0 },
      { account_id: accounting.requireAccountIdByCode("4000"), debit: 0, credit: 400 },
      { account_id: accounting.requireAccountIdByCode("5300"), debit: 250, credit: 0 },
      { account_id: accounting.requireAccountIdByCode("1420"), debit: 0, credit: 250 },
    ],
  });

  // Customer returns 2 units @ 40 = 80; stock and COGS reverse.
  db.prepare(
    `INSERT INTO returns (voucher_no,date,return_type,customer_id,net_total,created_at)
     VALUES ('RT-000001','2025-01-20','customer',?,80,datetime('now'))`,
  ).run(customerId);
  const returnId = Number(db.prepare("SELECT id FROM returns").get().id);
  db.prepare(
    "INSERT INTO return_lines (return_id,particular_id,qty,rate,amount) VALUES (?,?,2,40,80)",
  ).run(returnId, particularId);
  addLedger({
    date: "2025-01-20",
    type: "finished",
    particularId,
    refType: "return",
    refId: returnId,
    refNo: "RT-000001",
    inQty: 2,
    rate: 40,
    after: 32,
  });
  db.prepare("UPDATE item_particulars SET stock_qty = 32 WHERE id = ?").run(particularId);

  accounting.postAccountVoucher({
    voucherNo: "AV-RT-000001",
    date: "2025-01-20",
    voucherType: "return",
    refType: "return",
    refId: returnId,
    entries: [
      { account_id: accounting.requireAccountIdByCode("4100"), debit: 80, credit: 0 },
      { account_id: accounting.requireAccountIdByCode("1300"), debit: 0, credit: 80 },
      { account_id: accounting.requireAccountIdByCode("1420"), debit: 50, credit: 0 },
      { account_id: accounting.requireAccountIdByCode("5300"), debit: 0, credit: 50 },
    ],
  });

  // Stock must reconcile exactly against the ledger.
  const stock = accounting.reconcileStock();
  assert.equal(stock.ok, true, JSON.stringify(stock.issues));
  assert.deepEqual(stock.checked, { raw: 1, finished: 1 });

  // Every voucher must balance individually, and the trial balance must tie.
  const unbalanced = db
    .prepare(
      `SELECT av.voucher_no FROM account_vouchers av
       JOIN account_ledger al ON al.voucher_id = av.id
       GROUP BY av.id HAVING ABS(SUM(al.debit) - SUM(al.credit)) > 0.01`,
    )
    .all();
  assert.deepEqual(unbalanced, [], "every voucher must balance individually");

  const trial = accounting.trialBalance();
  assert.equal(
    trial.balanced,
    true,
    `debits ${trial.total_debit} vs credits ${trial.total_credit}`,
  );
  // Natural balances: finished 800 + COGS 200 + receivable 320 + returns 80 = 1400
  assert.equal(trial.total_debit, 1400);
  assert.equal(trial.total_credit, 1400);

  // Each business document must have exactly one voucher.
  for (const [refType, refId] of [
    ["purchase", purchaseId],
    ["production", productionId],
    ["sale", saleId],
    ["return", returnId],
  ]) {
    const voucherId = backpost.hasVoucher(refType, refId);
    assert.ok(voucherId, `${refType} ${refId} not posted`);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS c FROM account_vouchers WHERE ref_type = ? AND ref_id = ?")
        .get(refType, refId).c,
      1,
      `${refType} ${refId} must have exactly one voucher`,
    );
  }

  // Key closing balances.
  assert.equal(balance("1410"), 0, "raw inventory fully consumed");
  assert.equal(balance("1420"), 800, "finished goods = (1000 + 50 returned) - 250 sold");
  assert.equal(balance("5300"), 200, "net COGS = 250 - 50");
  assert.equal(balance("1300"), 320, "receivable = 400 - 80");
  assert.equal(balance("2100"), -600, "payable outstanding (credit balance)");
  assert.equal(balance("1100"), -400, "cash paid out");
  assert.equal(balance("4000"), -400, "sales");
  assert.equal(balance("4100"), 80, "sales returns contra");
});
// ---- Scenario B: failure paths -------------------------------------------

test("B1: posting into a closed financial year is refused", () => {
  db.prepare("DELETE FROM financial_years").run();
  db.prepare(
    "INSERT INTO financial_years (name,start_date,end_date,is_closed,is_current,created_at) VALUES ('2024','2024-01-01','2024-12-31',1,0,datetime('now'))",
  ).run();
  assert.throws(() => assertPostingAllowed("2024-06-01"), /closed/i);
  assert.doesNotThrow(() => assertPostingAllowed("2025-06-01"));
  db.prepare("DELETE FROM financial_years").run();
});

test("B2: an unbalanced voucher is rejected and nothing is persisted", () => {
  reset();
  const before = db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c;
  assert.throws(
    () =>
      accounting.postAccountVoucher({
        voucherNo: "AV-BAD-1",
        date: "2025-01-01",
        voucherType: "journal",
        entries: [{ account_id: accounting.requireAccountIdByCode("1100"), debit: 100, credit: 0 }],
      }),
    /Unbalanced/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c, before);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_ledger").get().c, 0);
});

test("B3: a failed transaction leaves no partial business rows", () => {
  reset();
  const { supplierId } = seed();
  const writeAll = db.transaction(() => {
    db.prepare(
      `INSERT INTO purchases (voucher_no,date,supplier_id,sub_total,net_total,paid_amount,created_at)
       VALUES ('PUR-ROLLBACK','2025-01-01',?,100,100,0,datetime('now'))`,
    ).run(supplierId);
    db.prepare(
      "INSERT INTO purchase_lines (purchase_id,qty,rate,amount) VALUES ((SELECT id FROM purchases WHERE voucher_no='PUR-ROLLBACK'),1,100,100)",
    ).run();
    throw new Error("simulated failure after writes");
  });
  assert.throws(() => writeAll(), /simulated failure/);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM purchases").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM purchase_lines").get().c, 0);
});

test("B4: back-post skips zero-value documents instead of posting empty vouchers", () => {
  reset();
  const { supplierId } = seed();
  db.prepare(
    `INSERT INTO purchases (voucher_no,date,supplier_id,sub_total,net_total,paid_amount,created_at)
     VALUES ('PUR-ZERO','2025-01-01',?,0,0,0,datetime('now'))`,
  ).run(supplierId);

  const report = backpost.backpostReport();
  assert.equal(report.pending.length, 0);
  assert.equal(report.zero_value, 1);

  const run = backpost.runBackpost();
  assert.equal(run.posted.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c, 0);
});
// ---- Scenario X: security and integrity ----------------------------------

test("X1: session tokens are unforgeable, expiring and revocable", () => {
  reset();
  const user = db
    .prepare(
      "INSERT INTO users (username,password_hash,password_salt,role,is_active) VALUES ('admin','','','admin',1)",
    )
    .run();
  const userId = Number(user.lastInsertRowid);

  const session = auth.createSession(userId);
  assert.equal(session.token.length, 64);
  assert.ok(auth.getSessionUser(session.token));

  const second = auth.createSession(userId);
  assert.notEqual(session.token, second.token, "session tokens must be unique");

  auth.destroySession(session.token);
  assert.equal(auth.getSessionUser(session.token), null, "revoked token must not authenticate");

  // An expired session must be rejected and its row deleted.
  const expired = auth.createSession(userId);
  db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(
    "2000-01-01T00:00:00.000Z",
    expired.token,
  );
  assert.equal(auth.getSessionUser(expired.token), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE token = ?").get(expired.token).c,
    0,
    "expired session row must be deleted",
  );

  assert.equal(auth.getSessionUser("not-a-real-token"), null);
  assert.equal(auth.getSessionUser(null), null);
});

test("X2: password hashing is salted and verifiable", () => {
  const a = auth.hashPassword("correct horse");
  const b = auth.hashPassword("correct horse");
  assert.notEqual(a.salt, b.salt, "each hash must use a fresh salt");
  assert.notEqual(a.hash, b.hash);

  assert.equal(auth.verifyPassword("correct horse", a.hash, a.salt), true);
  assert.equal(auth.verifyPassword("wrong horse", a.hash, a.salt), false);

  // A malformed/short stored hash must throw rather than silently pass.
  // The login route catches this and returns 401 instead of crashing.
  assert.throws(() => auth.verifyPassword("correct horse", "abcd", a.salt));
});

test("X3: the role gate denies non-admins and unauthenticated callers", () => {
  const middleware = auth.requireRole("admin");

  // Returns the HTTP status that was sent, or 200 when the request was allowed
  // through to the next handler.
  const run = (req) => {
    let allowed = false;
    let code = 0;
    const res = {
      status(value) {
        code = value;
        return this;
      },
      json() {},
    };
    middleware(req, res, () => {
      allowed = true;
    });
    return allowed ? 200 : code;
  };

  assert.equal(run({ user: { role: "user" } }), 403, "non-admin must be forbidden");
  assert.equal(run({ user: { role: "admin" } }), 200, "admin must be allowed");
  assert.equal(run({}), 401, "missing user must be unauthorized");
  assert.equal(run({ user: { role: "viewer" } }), 403, "unknown role must be forbidden");
});

test("X4: the storage layer refuses a duplicate posting even under race conditions", () => {
  reset();
  const entries = [
    { account_id: accounting.requireAccountIdByCode("1100"), debit: 25, credit: 0 },
    { account_id: accounting.requireAccountIdByCode("4000"), debit: 0, credit: 25 },
  ];
  const post = (voucherNo) =>
    accounting.postAccountVoucher({
      voucherNo,
      date: "2025-01-01",
      voucherType: "sale",
      refType: "sale",
      refId: 99,
      entries,
    });

  post("AV-RACE-1");
  assert.throws(() => post("AV-RACE-2"), /UNIQUE constraint failed/);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS c FROM account_vouchers WHERE ref_type='sale' AND ref_id=99")
      .get().c,
    1,
  );
});

test("X5: generated document numbers are unique, sequential and gap-free", () => {
  reset();
  const numbers = db.transaction(() => {
    const list = [];
    for (let i = 0; i < 300; i += 1) list.push(nextUniqueVoucherNo(DOC_PREFIX.sale));
    return list;
  })();

  assert.equal(new Set(numbers).size, numbers.length);
  assert.equal(numbers[0], "SL-000001");
  assert.equal(numbers[299], "SL-000300");
  for (let i = 1; i < numbers.length; i += 1) {
    const prev = Number(numbers[i - 1].split("-")[1]);
    assert.equal(Number(numbers[i].split("-")[1]), prev + 1);
  }

  // A legacy timestamp-style number must never be reissued.
  db.prepare(
    "INSERT INTO sales (voucher_no,date,customer_id,sub_total,net_total,paid_amount,created_at) VALUES ('SL-1791091812901','2025-01-01',NULL,0,0,0,datetime('now'))",
  ).run();
  const next = db.transaction(() => nextUniqueVoucherNo(DOC_PREFIX.sale))();
  assert.notEqual(next, "SL-1791091812901");
});
