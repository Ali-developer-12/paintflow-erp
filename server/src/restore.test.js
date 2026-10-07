import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// Every case runs against an isolated temporary database. The live database is
// never opened or written by this suite.
//
// The modules import db.js at load time, so the temp directory must be created
// and the env set BEFORE the first import. All modules then share ONE database
// connection, which is why there is a single tmpRoot for the whole file.

const SCHEMA = fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paint-erp-restore-"));
const dataDir = path.join(tmpRoot, "data");
const backupDir = path.join(tmpRoot, "backups");
const restoreDir = path.join(tmpRoot, "restored");
const dbFile = path.join(dataDir, "paint-erp.db");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync(restoreDir, { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.DB_PATH = dbFile;
process.env.BACKUP_DIR = backupDir;
process.env.RESTORE_DIR = restoreDir;

const dbMod = await import("./db.js");
const backupMod = await import("./backup.js");
const restoreMod = await import("./restore.js");
const vouchersMod = await import("./vouchers.js");
const backpostMod = await import("./backpost.js");
const accountingMod = await import("./accounting.js");

const db = dbMod.db;
dbMod.applySchema();
accountingMod.ensureChartOfAccounts();

after(() => {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

// Wipe business + accounting data between cases, keeping the schema.
function reset() {
  const tables = [
    "stock_ledger",
    "account_ledger",
    "account_vouchers",
    "migration_log",
    "backups",
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
  ];
  const wipe = db.transaction(() => {
    db.pragma("foreign_keys = OFF");
    for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
    db.pragma("foreign_keys = ON");
  });
  wipe();
}

function seedParty() {
  db.prepare(
    "INSERT INTO suppliers (code, name, is_active, created_at) VALUES ('SUP-1','Restore Supplier',1,datetime('now'))",
  ).run();
  db.prepare(
    "INSERT INTO customers (code, name, is_active, created_at) VALUES ('CUST-1','Restore Customer',1,datetime('now'))",
  ).run();
  db.prepare(
    "INSERT INTO items (code, name, is_active, created_at) VALUES ('IT-1','Restore Item',1,datetime('now'))",
  ).run();
  const itemId = db.prepare("SELECT id FROM items WHERE code='IT-1'").get().id;
  db.prepare(
    "INSERT INTO item_particulars (item_id, type, cost_price, stock_qty, created_at) VALUES (?, 'Gallon', 100, 42, datetime('now'))",
  ).run(itemId);
}

test("backup -> restore round-trip is proven end to end on an isolated database", async () => {
  reset();
  seedParty();
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM item_particulars").get().c, 1);

  // 2. Backup via the application's real mechanism.
  const backup = await backupMod.createBackup(null);
  assert.ok(backup.integrity.ok, `backup integrity: ${backup.integrity.result}`);
  assert.ok(fs.existsSync(backup.file_path));
  assert.ok(
    path.resolve(backup.file_path).startsWith(path.resolve(backupDir)),
    "backup written outside the backup directory",
  );

  // 3. Independent integrity verification.
  assert.equal(backupMod.verifyDatabaseFile(backup.file_path).ok, true);

  // 4/5. Restore into a separate file and open it.
  const restored = restoreMod.restoreToNewFile(backup.id);
  assert.equal(restored.ok, true);
  assert.ok(fs.existsSync(restored.restored_to));
  assert.notEqual(
    path.resolve(restored.restored_to),
    path.resolve(dbFile),
    "restore must not target the live database",
  );

  const copy = new Database(restored.restored_to, { readonly: true });
  try {
    // 6. Schema present.
    const tables = copy
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .get().c;
    assert.ok(tables >= 15, `expected full schema, found ${tables} tables`);

    // 7. Representative data.
    assert.equal(copy.prepare("SELECT COUNT(*) AS c FROM item_particulars").get().c, 1);
    assert.equal(copy.prepare("SELECT stock_qty FROM item_particulars").get().stock_qty, 42);
    assert.equal(
      copy.prepare("SELECT name FROM suppliers WHERE code='SUP-1'").get().name,
      "Restore Supplier",
    );
    assert.equal(
      copy.prepare("SELECT name FROM customers WHERE code='CUST-1'").get().name,
      "Restore Customer",
    );

    // 8. Integrity check on the restored copy.
    assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");

    // 9. WAL consistency: usable standalone, no FK violations.
    assert.equal(copy.pragma("foreign_key_check").length, 0);
    copy.prepare("SELECT COUNT(*) AS c FROM stock_ledger").get();
  } finally {
    copy.close();
  }

  // Live database still intact and separate.
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM item_particulars").get().c, 1);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
});

test("in-place restore refuses to run without the exact confirmation token", async () => {
  reset();
  seedParty();
  const backup = await backupMod.createBackup(null);

  assert.throws(() => restoreMod.restoreInPlace(backup.id, {}), /Refusing to overwrite/);
  assert.throws(
    () => restoreMod.restoreInPlace(backup.id, { confirm: "yes" }),
    /Refusing to overwrite/,
  );
  assert.throws(
    () => restoreMod.restoreInPlace(backup.id, { confirm: "RESTORE" }),
    /Refusing to overwrite/,
  );

  // Live data untouched by the refused attempts.
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM suppliers").get().c, 1);
});

test("restore rejects a corrupted backup and writes no output", async () => {
  reset();
  const corruptPath = path.join(backupDir, "corrupt-backup.db");
  fs.writeFileSync(corruptPath, Buffer.from("not a sqlite db at all"));

  const before = fs.readdirSync(restoreDir).length;
  assert.throws(
    () => restoreMod.restoreToNewFile("corrupt-backup.db"),
    /integrity|could not open/i,
  );
  assert.equal(
    fs.readdirSync(restoreDir).length,
    before,
    "no file may be produced from a corrupt backup",
  );
});

test("restore refuses path traversal outside the backup directory", async () => {
  reset();
  assert.throws(() => restoreMod.resolveBackup("../../../etc/passwd"));
  assert.throws(() => restoreMod.resolveBackup("..%2F..%2Fpaint-erp.db"));
  assert.throws(() => restoreMod.restoreToNewFile("does-not-exist.db"));
});

test("voucher sequence produces unique, contiguous numbers under rapid creation", () => {
  reset();
  seedParty();

  const numbers = db.transaction(() => {
    const list = [];
    for (let i = 0; i < 500; i += 1) {
      list.push(vouchersMod.nextUniqueVoucherNo(vouchersMod.DOC_PREFIX.purchase));
    }
    return list;
  })();

  assert.equal(new Set(numbers).size, numbers.length, "duplicate voucher numbers generated");
  assert.match(numbers[0], /^PUR-\d{6}$/);

  const values = numbers.map((n) => Number(n.split("-")[1]));
  for (let i = 1; i < values.length; i += 1) {
    assert.equal(values[i], values[i - 1] + 1, "sequence is not contiguous");
  }

  // A legacy timestamp-style number must never be shadowed or collide.
  db.prepare(
    "INSERT INTO purchases (voucher_no, date, supplier_id, sub_total, net_total, paid_amount, created_at) VALUES ('PUR-1791091812901','2025-01-01',(SELECT id FROM suppliers WHERE code='SUP-1'),0,0,0,datetime('now'))",
  ).run();
  const next = db.transaction(() =>
    vouchersMod.nextUniqueVoucherNo(vouchersMod.DOC_PREFIX.purchase),
  )();
  assert.notEqual(next, "PUR-1791091812901");
});
function seedLegacyDocs() {
  const supplierId = db.prepare("SELECT id FROM suppliers WHERE code='SUP-1'").get().id;
  const customerId = db.prepare("SELECT id FROM customers WHERE code='CUST-1'").get().id;
  const particularId = db.prepare("SELECT id FROM item_particulars").get().id;

  db.prepare(
    "INSERT INTO purchases (voucher_no, date, supplier_id, sub_total, net_total, paid_amount, created_at) VALUES ('LEG-PUR-1','2025-01-01',?,500,500,200,datetime('now'))",
  ).run(supplierId);
  // No raw/finished item reference: must fall back to the Inventory control account.
  db.prepare(
    "INSERT INTO purchase_lines (purchase_id, description, qty, rate, amount) VALUES ((SELECT id FROM purchases WHERE voucher_no='LEG-PUR-1'),'legacy',10,50,500)",
  ).run();

  db.prepare(
    "INSERT INTO sales (voucher_no, date, customer_id, sub_total, net_total, paid_amount, created_at) VALUES ('LEG-SL-1','2025-02-01',?,800,800,0,datetime('now'))",
  ).run(customerId);
  db.prepare(
    "INSERT INTO sale_lines (sale_id, particular_id, description, qty, rate, amount) VALUES ((SELECT id FROM sales WHERE voucher_no='LEG-SL-1'),?,'legacy',4,200,800)",
  ).run(particularId);

  db.prepare(
    "INSERT INTO returns (voucher_no, date, return_type, customer_id, remarks, net_total, created_at) VALUES ('LEG-RT-1','2025-03-01','customer',?,'legacy',200,datetime('now'))",
  ).run(customerId);
  db.prepare(
    "INSERT INTO return_lines (return_id, particular_id, description, qty, rate, amount) VALUES ((SELECT id FROM returns WHERE voucher_no='LEG-RT-1'),?,'legacy',1,200,200)",
  ).run(particularId);
}

test("legacy back-posting is idempotent, balanced, auditable and reversible", () => {
  reset();
  seedParty();
  seedLegacyDocs();

  const before = backpostMod.backpostReport();
  assert.equal(before.pending.length, 3, "purchase, sale and return should be pending");
  assert.equal(before.already_posted, 0);

  // COGS must be reported as unknown, never invented from today's cost price.
  const saleItem = before.pending.find((p) => p.ref_type === "sale");
  assert.ok(
    saleItem.notes.some((n) => /No historical cost snapshot/.test(n)),
    "sale must report that COGS could not be reconstructed",
  );
  const purchaseItem = before.pending.find((p) => p.ref_type === "purchase");
  assert.ok(
    purchaseItem.notes.some((n) => /Inventory control account/.test(n)),
    "unclassified purchase value must be reported",
  );

  const dry = backpostMod.runBackpost({ dryRun: true });
  assert.equal(dry.posted.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c, 0);

  const result = backpostMod.runBackpost();
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.equal(result.posted.length, 3);

  const totals = db
    .prepare("SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM account_ledger")
    .get();
  assert.ok(Math.abs(totals.d - totals.c) <= 0.01, `unbalanced: ${totals.d} vs ${totals.c}`);

  for (const row of db
    .prepare(
      `SELECT av.voucher_no, COALESCE(SUM(al.debit),0) AS d, COALESCE(SUM(al.credit),0) AS c
       FROM account_vouchers av LEFT JOIN account_ledger al ON al.voucher_id = av.id GROUP BY av.id`,
    )
    .all()) {
    assert.ok(Math.abs(row.d - row.c) <= 0.01, `voucher ${row.voucher_no} unbalanced`);
  }
  assert.equal(accountingMod.trialBalance().balanced, true);

  // No fabricated COGS: the sale posted its revenue side only.
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM account_ledger al JOIN accounts a ON a.id=al.account_id WHERE a.code='5300'",
      )
      .get().c,
    0,
    "COGS must not be fabricated without a historical cost",
  );

  const second = backpostMod.runBackpost();
  assert.equal(second.posted.length, 0, "second run posted duplicates");
  assert.equal(second.report.already_posted, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c, 3);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM migration_log WHERE action='posted'").get().c,
    3,
  );
  // Each posted voucher's audit row is written in the same transaction as the voucher.
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM migration_log m
         JOIN account_vouchers av ON av.id = m.voucher_id WHERE m.action='posted'`,
      )
      .get().c,
    3,
    "every posted voucher must have a matching audit row",
  );

  const reverted = backpostMod.revertBackpost();
  assert.equal(reverted.reverted, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_ledger").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM purchases").get().c, 1);
});

test("back-posting skips zero-value documents instead of fabricating entries", () => {
  reset();
  seedParty();
  const supplierId = db.prepare("SELECT id FROM suppliers WHERE code='SUP-1'").get().id;
  db.prepare(
    "INSERT INTO returns (voucher_no, date, return_type, supplier_id, remarks, net_total, created_at) VALUES ('LEG-RT-0','2025-01-01','supplier',?,'zero',0,datetime('now'))",
  ).run(supplierId);

  const report = backpostMod.backpostReport();
  assert.equal(report.pending.length, 0, "zero-value document must not be pending");
  assert.ok(report.zero_value >= 1);

  const run = backpostMod.runBackpost();
  assert.equal(run.posted.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c, 0);
});

test("the database rejects a duplicate posting for the same document", () => {
  reset();
  seedParty();

  const entries = [
    { account_id: accountingMod.requireAccountIdByCode("1100"), debit: 100, credit: 0 },
    { account_id: accountingMod.requireAccountIdByCode("4000"), debit: 0, credit: 100 },
  ];
  const post = () =>
    accountingMod.postAccountVoucher({
      voucherNo: `AV-DUP-${Math.random().toString(36).slice(2, 8)}`,
      date: "2025-01-01",
      voucherType: "journal",
      refType: "purchase",
      refId: 4242,
      entries,
    });

  post();
  assert.throws(post, /UNIQUE constraint failed/);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM account_vouchers WHERE ref_type='purchase' AND ref_id=4242",
      )
      .get().c,
    1,
  );

  // Standalone journal vouchers (NULL ref) must still be allowed to repeat.
  const journal = [
    { account_id: accountingMod.requireAccountIdByCode("1100"), debit: 50, credit: 0 },
    { account_id: accountingMod.requireAccountIdByCode("4000"), debit: 0, credit: 50 },
  ];
  for (let i = 0; i < 2; i += 1) {
    accountingMod.postAccountVoucher({
      voucherNo: `AV-JRN-${i}`,
      date: "2025-01-01",
      voucherType: "journal",
      entries: journal,
    });
  }
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM account_vouchers WHERE voucher_no LIKE 'AV-JRN-%'").get()
      .c,
    2,
  );
});

test("back-posting refuses documents it cannot reconstruct honestly", () => {
  reset();
  seedParty();

  const supplierId = db.prepare("SELECT id FROM suppliers WHERE code='SUP-1'").get().id;
  // Lines do not reconcile with the document total.
  db.prepare(
    "INSERT INTO purchases (voucher_no, date, supplier_id, sub_total, net_total, paid_amount, created_at) VALUES ('BAD-PUR-1','2025-01-01',?,500,900,0,datetime('now'))",
  ).run(supplierId);
  db.prepare(
    "INSERT INTO purchase_lines (purchase_id, description, qty, rate, amount) VALUES ((SELECT id FROM purchases WHERE voucher_no='BAD-PUR-1'),'legacy',10,50,500)",
  ).run();
  // A valued purchase with no line detail at all.
  db.prepare(
    "INSERT INTO purchases (voucher_no, date, supplier_id, sub_total, net_total, paid_amount, created_at) VALUES ('BAD-PUR-2','2025-01-02',?,0,700,0,datetime('now'))",
  ).run(supplierId);
  // A valued sale with no customer to carry the receivable.
  db.prepare(
    "INSERT INTO sales (voucher_no, date, customer_id, sub_total, net_total, paid_amount, created_at) VALUES ('BAD-SL-1','2025-02-01',NULL,300,300,0,datetime('now'))",
  ).run();

  const report = backpostMod.backpostReport();
  assert.equal(report.pending.length, 0, "unreconstructable documents must not be pending");
  assert.equal(report.skipped.length, 3);
  assert.ok(report.skipped.some((s) => /does not reconcile/.test(s.reason)));
  assert.ok(report.skipped.some((s) => /no line detail/.test(s.reason)));
  assert.ok(report.skipped.some((s) => /no customer/.test(s.reason)));

  const run = backpostMod.runBackpost();
  assert.equal(run.posted.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM account_vouchers").get().c, 0);
});

// Runs last: restoreInPlace() closes the shared connection.
test("in-place restore succeeds with the token and retains a safety copy", async () => {
  reset();
  seedParty();
  const backup = await backupMod.createBackup(null);

  const result = restoreMod.restoreInPlace(backup.id, {
    confirm: restoreMod.INPLACE_CONFIRM_TOKEN,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "in-place");
  assert.ok(fs.existsSync(result.safety_copy), "safety copy must be retained");
  assert.ok(fs.existsSync(dbFile));

  const reopened = new Database(dbFile);
  try {
    assert.equal(reopened.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(reopened.prepare("SELECT COUNT(*) AS c FROM item_particulars").get().c, 1);
    assert.equal(reopened.prepare("SELECT stock_qty FROM item_particulars").get().stock_qty, 42);
  } finally {
    reopened.close();
  }
});
