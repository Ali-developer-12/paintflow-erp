-- Paint Factory ERP — full SQLite schema (all 13 modules)
PRAGMA foreign_keys = ON;

-- =========================================================
-- 1. USERS / AUTH
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'user', -- admin | user
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- =========================================================
-- 2. SETUP / MASTERS
-- =========================================================
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE,
  name        TEXT NOT NULL,
  designation TEXT,
  phone       TEXT,
  cnic        TEXT,
  address     TEXT,
  salary      REAL NOT NULL DEFAULT 0,
  join_date   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT UNIQUE,
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  city           TEXT,
  ntn            TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  credit_limit   REAL NOT NULL DEFAULT 0,
  account_id     INTEGER REFERENCES accounts(id),
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT UNIQUE,
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  city           TEXT,
  ntn            TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  account_id     INTEGER REFERENCES accounts(id),
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transporters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE,
  name       TEXT NOT NULL,
  driver     TEXT,
  vehicle_no TEXT,
  phone      TEXT,
  address    TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chart of accounts (self-referencing tree)
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT UNIQUE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL, -- asset | liability | equity | income | expense
  parent_id       INTEGER REFERENCES accounts(id),
  party_type      TEXT,          -- customer | supplier | employee | null
  party_id        INTEGER,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw materials / factory items
CREATE TABLE IF NOT EXISTS factory_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE,
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'KG',
  rate        REAL NOT NULL DEFAULT 0,
  stock_qty   REAL NOT NULL DEFAULT 0,
  min_qty     REAL NOT NULL DEFAULT 0,
  max_qty     REAL NOT NULL DEFAULT 0,
  category    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Financial years (New Year Posting)
CREATE TABLE IF NOT EXISTS financial_years (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_closed  INTEGER NOT NULL DEFAULT 0,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS year_postings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_year_id   INTEGER NOT NULL REFERENCES financial_years(id),
  to_year_id     INTEGER NOT NULL REFERENCES financial_years(id),
  posted_at      TEXT NOT NULL DEFAULT (datetime('now')),
  posted_by      INTEGER REFERENCES users(id),
  notes          TEXT
);

-- =========================================================
-- 3. ITEMS MASTER + PARTICULARS + FORMULA (BOM)
-- =========================================================
CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE,
  name       TEXT NOT NULL,
  category   TEXT,
  remarks    TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per size/shade/pack variant shown in the right-hand grid
CREATE TABLE IF NOT EXISTS item_particulars (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type         TEXT,                        -- e.g. Gallon / Quarter / Drum
  weight_unit  TEXT,                        -- e.g. 3.5 KG
  cost_price   REAL NOT NULL DEFAULT 0,
  ws_price     REAL NOT NULL DEFAULT 0,
  sale_price   REAL NOT NULL DEFAULT 0,
  stock_qty    REAL NOT NULL DEFAULT 0,
  min_qty      REAL NOT NULL DEFAULT 0,
  max_qty      REAL NOT NULL DEFAULT 0,
  formula_code TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_particulars_item ON item_particulars(item_id);

CREATE TABLE IF NOT EXISTS formulas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  particular_id INTEGER NOT NULL UNIQUE REFERENCES item_particulars(id) ON DELETE CASCADE,
  code          TEXT,
  batch_size    REAL NOT NULL DEFAULT 1,
  total_cost    REAL NOT NULL DEFAULT 0,
  remarks       TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS formula_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  formula_id      INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  factory_item_id INTEGER REFERENCES factory_items(id),
  material_name   TEXT NOT NULL,
  value           REAL NOT NULL DEFAULT 0,  -- qty per batch
  rate            REAL NOT NULL DEFAULT 0,
  cost_value      REAL NOT NULL DEFAULT 0,  -- value * rate
  sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_formula_lines ON formula_lines(formula_id);

-- =========================================================
-- 4. PURCHASE
-- =========================================================
CREATE TABLE IF NOT EXISTS purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no     TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  transporter_id INTEGER REFERENCES transporters(id),
  bill_no        TEXT,
  remarks        TEXT,
  sub_total      REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  tax            REAL NOT NULL DEFAULT 0,
  freight        REAL NOT NULL DEFAULT 0,
  net_total      REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id     INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  factory_item_id INTEGER REFERENCES factory_items(id),
  particular_id   INTEGER REFERENCES item_particulars(id),
  description     TEXT,
  qty             REAL NOT NULL DEFAULT 0,
  rate            REAL NOT NULL DEFAULT 0,
  amount          REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_lines ON purchase_lines(purchase_id);

-- =========================================================
-- 5. PRODUCTION
-- =========================================================
CREATE TABLE IF NOT EXISTS productions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no    TEXT NOT NULL UNIQUE,
  date          TEXT NOT NULL,
  particular_id INTEGER NOT NULL REFERENCES item_particulars(id),
  batches       REAL NOT NULL DEFAULT 1,
  produced_qty  REAL NOT NULL DEFAULT 0,
  material_cost REAL NOT NULL DEFAULT 0,
  overhead_cost REAL NOT NULL DEFAULT 0,
  total_cost    REAL NOT NULL DEFAULT 0,
  remarks       TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS production_consumptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id   INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  factory_item_id INTEGER REFERENCES factory_items(id),
  material_name   TEXT,
  qty             REAL NOT NULL DEFAULT 0,
  rate            REAL NOT NULL DEFAULT 0,
  amount          REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prod_consume ON production_consumptions(production_id);

-- =========================================================
-- 6. COUNTER SALE
-- =========================================================
CREATE TABLE IF NOT EXISTS sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no  TEXT NOT NULL UNIQUE,
  date        TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  sale_type   TEXT NOT NULL DEFAULT 'counter', -- counter | wholesale
  remarks     TEXT,
  sub_total   REAL NOT NULL DEFAULT 0,
  discount    REAL NOT NULL DEFAULT 0,
  tax         REAL NOT NULL DEFAULT 0,
  net_total   REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  particular_id INTEGER REFERENCES item_particulars(id),
  description   TEXT,
  qty           REAL NOT NULL DEFAULT 0,
  rate          REAL NOT NULL DEFAULT 0,
  amount        REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_lines ON sale_lines(sale_id);

-- =========================================================
-- 7. ISSUE VOUCHER
-- =========================================================
CREATE TABLE IF NOT EXISTS issue_vouchers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no     TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  customer_id    INTEGER REFERENCES customers(id),
  transporter_id INTEGER REFERENCES transporters(id),
  remarks        TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issue_voucher_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id    INTEGER NOT NULL REFERENCES issue_vouchers(id) ON DELETE CASCADE,
  particular_id INTEGER REFERENCES item_particulars(id),
  size          TEXT,
  shade         TEXT,
  in_stock      REAL NOT NULL DEFAULT 0,
  qty           REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_issue_lines ON issue_voucher_lines(voucher_id);

-- =========================================================
-- 8. RETURNS
-- =========================================================
CREATE TABLE IF NOT EXISTS returns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no  TEXT NOT NULL UNIQUE,
  date        TEXT NOT NULL,
  return_type TEXT NOT NULL, -- customer | supplier
  customer_id INTEGER REFERENCES customers(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  remarks     TEXT,
  net_total   REAL NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id       INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  particular_id   INTEGER REFERENCES item_particulars(id),
  factory_item_id INTEGER REFERENCES factory_items(id),
  description     TEXT,
  qty             REAL NOT NULL DEFAULT 0,
  rate            REAL NOT NULL DEFAULT 0,
  amount          REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_return_lines ON return_lines(return_id);

-- =========================================================
-- 9. STOCK LEDGER (all movements, finished + raw)
-- =========================================================
CREATE TABLE IF NOT EXISTS stock_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,
  stock_type      TEXT NOT NULL,  -- finished | raw
  particular_id   INTEGER REFERENCES item_particulars(id),
  factory_item_id INTEGER REFERENCES factory_items(id),
  ref_type        TEXT NOT NULL,  -- purchase | production | sale | issue | return | opening | adjustment
  ref_id          INTEGER,
  ref_no          TEXT,
  qty_in          REAL NOT NULL DEFAULT 0,
  qty_out         REAL NOT NULL DEFAULT 0,
  rate            REAL NOT NULL DEFAULT 0,
  balance_after   REAL NOT NULL DEFAULT 0,
  remarks         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_date ON stock_ledger(date);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_part ON stock_ledger(particular_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_raw ON stock_ledger(factory_item_id);

-- =========================================================
-- 10. ACCOUNTS — vouchers / double-entry ledger
-- =========================================================
CREATE TABLE IF NOT EXISTS account_vouchers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no   TEXT NOT NULL UNIQUE,
  date         TEXT NOT NULL,
  voucher_type TEXT NOT NULL, -- receipt | payment | journal | sale | purchase | return
  ref_type     TEXT,
  ref_id       INTEGER,
  narration    TEXT,
  amount       REAL NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER REFERENCES account_vouchers(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit      REAL NOT NULL DEFAULT 0,
  credit     REAL NOT NULL DEFAULT 0,
  narration  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON account_ledger(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON account_ledger(date);

-- =========================================================
-- 11. BACKUP LOG
-- =========================================================
CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- 12. APP SETTINGS (company info, voucher counters)
-- =========================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
