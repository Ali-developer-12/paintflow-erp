import { round2 } from "./accounting-core.js";
import { ensureChartOfAccounts, reconcileStock } from "./accounting.js";
import { runBackpost } from "./backpost.js";
import { logger } from "./logger.js";
import { TARGET_SCHEMA_VERSION } from "./schema-version.js";

export { TARGET_SCHEMA_VERSION };

export function runMigrations(db) {
  const currentVersion = db.pragma("user_version", { simple: true }) || 0;
  logger.info(
    `Checking database schema version. Current: ${currentVersion}, Target: ${TARGET_SCHEMA_VERSION}`,
  );

  if (currentVersion >= TARGET_SCHEMA_VERSION) {
    logger.info("Database schema is up to date.");
    return { applied: 0, currentVersion };
  }

  let applied = 0;

  // Migration 1: Baseline schema alignments, sequences, accounts, and performance indexes
  if (currentVersion < 1) {
    logger.info("Applying Migration 1: Baseline schema, sequences, and indexes...");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS voucher_sequences (
          prefix     TEXT PRIMARY KEY,
          next_value INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS migration_log (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          migration     TEXT NOT NULL,
          action        TEXT NOT NULL,
          ref_type      TEXT,
          ref_id        INTEGER,
          voucher_id    INTEGER REFERENCES account_vouchers(id) ON DELETE CASCADE,
          amount        REAL,
          message       TEXT,
          created_by    INTEGER REFERENCES users(id),
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_migration_log_migration ON migration_log(migration);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_ref_unique
          ON account_vouchers(ref_type, ref_id)
          WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_stock_ledger_ref ON stock_ledger(ref_type, ref_id);
        CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
        CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
        CREATE INDEX IF NOT EXISTS idx_returns_date ON returns(date);
        CREATE INDEX IF NOT EXISTS idx_productions_date ON productions(date);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      `);

      // Add cost_price to sale_lines and return_lines if missing
      const saleLineCols = db.pragma("table_info(sale_lines)").map((c) => c.name);
      if (!saleLineCols.includes("cost_price")) {
        db.exec("ALTER TABLE sale_lines ADD COLUMN cost_price REAL DEFAULT 0");
      }
      const returnLineCols = db.pragma("table_info(return_lines)").map((c) => c.name);
      if (!returnLineCols.includes("cost_price")) {
        db.exec("ALTER TABLE return_lines ADD COLUMN cost_price REAL DEFAULT 0");
      }

      // Ensure chart of accounts has all 16 accounts (including 1410, 1420, 4100, 5300)
      ensureChartOfAccounts(db);

      db.pragma("user_version = 1");
    })();
    applied++;
  }

  // Migration 2: Opening stock and Stock adjustment tracking tables
  if (currentVersion < 2) {
    logger.info("Applying Migration 2: Stock adjustments and opening stocks tables...");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stock_adjustments (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_no     TEXT NOT NULL UNIQUE,
          date           TEXT NOT NULL,
          item_type      TEXT NOT NULL, -- 'raw' | 'finished'
          factory_item_id INTEGER REFERENCES factory_items(id),
          particular_id  INTEGER REFERENCES item_particulars(id),
          previous_qty   REAL NOT NULL,
          adjustment_qty REAL NOT NULL,
          resulting_qty  REAL NOT NULL,
          reason         TEXT NOT NULL,
          user_id        INTEGER REFERENCES users(id),
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS opening_stocks (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_no     TEXT NOT NULL UNIQUE,
          date           TEXT NOT NULL,
          item_type      TEXT NOT NULL, -- 'raw' | 'finished'
          factory_item_id INTEGER REFERENCES factory_items(id),
          particular_id  INTEGER REFERENCES item_particulars(id),
          qty            REAL NOT NULL,
          unit_cost      REAL NOT NULL DEFAULT 0,
          total_value    REAL NOT NULL DEFAULT 0,
          user_id        INTEGER REFERENCES users(id),
          remarks        TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_stock_adj_date ON stock_adjustments(date);
        CREATE INDEX IF NOT EXISTS idx_opening_stock_date ON opening_stocks(date);
      `);
      db.pragma("user_version = 2");
    })();
    applied++;
  }

  // Migration 3: Customer Receipts and Supplier Payments
  if (currentVersion < 3) {
    logger.info("Applying Migration 3: Receipts and payments tables...");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS customer_receipts (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_no         TEXT NOT NULL UNIQUE,
          date               TEXT NOT NULL,
          customer_id        INTEGER NOT NULL REFERENCES customers(id),
          payment_mode       TEXT NOT NULL DEFAULT 'cash', -- 'cash' | 'bank'
          payment_account_id INTEGER NOT NULL REFERENCES accounts(id),
          amount             REAL NOT NULL,
          reference_no       TEXT,
          remarks            TEXT,
          created_by         INTEGER REFERENCES users(id),
          created_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS supplier_payments (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_no         TEXT NOT NULL UNIQUE,
          date               TEXT NOT NULL,
          supplier_id        INTEGER NOT NULL REFERENCES suppliers(id),
          payment_mode       TEXT NOT NULL DEFAULT 'cash', -- 'cash' | 'bank'
          payment_account_id INTEGER NOT NULL REFERENCES accounts(id),
          amount             REAL NOT NULL,
          reference_no       TEXT,
          remarks            TEXT,
          created_by         INTEGER REFERENCES users(id),
          created_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_receipts_customer ON customer_receipts(customer_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_date ON customer_receipts(date);
        CREATE INDEX IF NOT EXISTS idx_payments_supplier ON supplier_payments(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_payments_date ON supplier_payments(date);
      `);
      db.pragma("user_version = 3");
    })();
    applied++;
  }

  // Migration 4: Expenses, Income and Journal Vouchers
  if (currentVersion < 4) {
    logger.info("Applying Migration 4: Expenses, Income and Journal Vouchers tables...");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS expense_vouchers (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_no         TEXT NOT NULL UNIQUE,
          date               TEXT NOT NULL,
          expense_account_id INTEGER NOT NULL REFERENCES accounts(id),
          payment_account_id INTEGER NOT NULL REFERENCES accounts(id),
          amount             REAL NOT NULL,
          reference_no       TEXT,
          remarks            TEXT,
          created_by         INTEGER REFERENCES users(id),
          created_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS income_vouchers (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_no         TEXT NOT NULL UNIQUE,
          date               TEXT NOT NULL,
          income_account_id  INTEGER NOT NULL REFERENCES accounts(id),
          payment_account_id INTEGER NOT NULL REFERENCES accounts(id),
          amount             REAL NOT NULL,
          reference_no       TEXT,
          remarks            TEXT,
          created_by         INTEGER REFERENCES users(id),
          created_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS journal_vouchers (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_no   TEXT NOT NULL UNIQUE,
          date         TEXT NOT NULL,
          reference_no TEXT,
          remarks      TEXT,
          total_amount REAL NOT NULL,
          created_by   INTEGER REFERENCES users(id),
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS journal_voucher_lines (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_id INTEGER NOT NULL REFERENCES journal_vouchers(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          debit      REAL NOT NULL DEFAULT 0,
          credit     REAL NOT NULL DEFAULT 0,
          narration  TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expense_vouchers(date);
        CREATE INDEX IF NOT EXISTS idx_income_date ON income_vouchers(date);
        CREATE INDEX IF NOT EXISTS idx_journals_date ON journal_vouchers(date);
        CREATE INDEX IF NOT EXISTS idx_journal_lines_voucher ON journal_voucher_lines(voucher_id);
      `);
      db.pragma("user_version = 4");
    })();
    applied++;
  }

  // Migration 5: System Audit Trail
  if (currentVersion < 5) {
    logger.info("Applying Migration 5: Audit log table...");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER REFERENCES users(id),
          username   TEXT,
          action     TEXT NOT NULL,
          entity     TEXT NOT NULL,
          entity_id  TEXT,
          details    TEXT,
          ip_address TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log(created_at);
      `);
      db.pragma("user_version = 5");
    })();
    applied++;
  }

  // Migration 6: Live Stock Reconciliation (creating opening stock ledger rows for pre-existing stock)
  if (currentVersion < 6) {
    logger.info("Applying Migration 6: Auditable Opening Stock Reconciliation...");
    db.transaction(() => {
      // Reconcile Raw Materials (factory_items)
      const rawItems = db
        .prepare("SELECT id, name, unit, rate, stock_qty FROM factory_items")
        .all();
      for (const item of rawItems) {
        const currentStock = round2(Number(item.stock_qty || 0));
        const ledger = db
          .prepare(
            `SELECT COALESCE(SUM(qty_in), 0) AS total_in, COALESCE(SUM(qty_out), 0) AS total_out
             FROM stock_ledger WHERE factory_item_id = ?`,
          )
          .get(item.id);
        const ledgerNet = round2(Number(ledger.total_in) - Number(ledger.total_out));
        const delta = round2(currentStock - ledgerNet);

        if (Math.abs(delta) > 0.001) {
          const voucherNo = `OPN-RAW-${String(item.id).padStart(4, "0")}`;
          // Record in opening_stocks
          const insertOpn = db
            .prepare(
              `INSERT INTO opening_stocks (voucher_no, date, item_type, factory_item_id, qty, unit_cost, total_value, remarks)
               VALUES (?, '2025-01-01', 'raw', ?, ?, ?, ?, 'Pre-existing catalog opening balance')`,
            )
            .run(voucherNo, item.id, delta, item.rate || 0, round2(delta * (item.rate || 0)));

          // Insert into stock_ledger dated 2025-01-01 (before transactions)
          db.prepare(
            `INSERT INTO stock_ledger (date, stock_type, factory_item_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at)
             VALUES ('2025-01-01', 'raw', ?, 'opening', ?, ?, ?, 0, ?, ?, 'Opening stock balance', '2025-01-01 00:00:00')`,
          ).run(item.id, insertOpn.lastInsertRowid, voucherNo, delta, item.rate || 0, delta);

          logger.info(
            `Reconciled Raw Item #${item.id} (${item.name}): Opening stock ${delta} ${item.unit}`,
          );
        }
      }

      // Reconcile Finished Goods (item_particulars)
      const finishedParticulars = db
        .prepare("SELECT id, item_id, type, cost_price, stock_qty FROM item_particulars")
        .all();
      for (const part of finishedParticulars) {
        const currentStock = round2(Number(part.stock_qty || 0));
        const ledger = db
          .prepare(
            `SELECT COALESCE(SUM(qty_in), 0) AS total_in, COALESCE(SUM(qty_out), 0) AS total_out
             FROM stock_ledger WHERE particular_id = ?`,
          )
          .get(part.id);
        const ledgerNet = round2(Number(ledger.total_in) - Number(ledger.total_out));
        const delta = round2(currentStock - ledgerNet);

        if (Math.abs(delta) > 0.001) {
          const voucherNo = `OPN-FIN-${String(part.id).padStart(4, "0")}`;
          const insertOpn = db
            .prepare(
              `INSERT INTO opening_stocks (voucher_no, date, item_type, particular_id, qty, unit_cost, total_value, remarks)
               VALUES (?, '2025-01-01', 'finished', ?, ?, ?, ?, 'Pre-existing catalog opening balance')`,
            )
            .run(
              voucherNo,
              part.id,
              delta,
              part.cost_price || 0,
              round2(delta * (part.cost_price || 0)),
            );

          db.prepare(
            `INSERT INTO stock_ledger (date, stock_type, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at)
             VALUES ('2025-01-01', 'finished', ?, 'opening', ?, ?, ?, 0, ?, ?, 'Opening stock balance', '2025-01-01 00:00:00')`,
          ).run(part.id, insertOpn.lastInsertRowid, voucherNo, delta, part.cost_price || 0, delta);

          logger.info(`Reconciled Finished Particular #${part.id}: Opening stock ${delta}`);
        }
      }

      // Re-verify stock reconciliation
      const recon = reconcileStock(db);
      if (!recon.ok) {
        throw new Error(
          `Stock reconciliation failed after Migration 6: ${JSON.stringify(recon.issues)}`,
        );
      }
      logger.info("Migration 6: Stock reconciliation check PASSED perfectly! ok: true");

      db.pragma("user_version = 6");
    })();
    applied++;
  }

  // Migration 7: Double-entry Accounting Back-post for historical documents
  if (currentVersion < 7) {
    logger.info(
      "Applying Migration 7: Double-entry back-posting for historical business documents...",
    );
    const res = runBackpost(db);
    logger.info(
      `Migration 7 result: posted=${res.posted.length}, skipped=${res.skipped.length}, failed=${res.failed.length}`,
    );
    if (res.failed.length > 0) {
      throw new Error(`Backpost migration had failures: ${JSON.stringify(res.failed)}`);
    }
    db.pragma("user_version = 7");
    applied++;
  }

  logger.info(
    `Migrations finished. Total applied: ${applied}. Current user_version: ${TARGET_SCHEMA_VERSION}`,
  );
  return { applied, currentVersion: TARGET_SCHEMA_VERSION };
}

export default runMigrations;
