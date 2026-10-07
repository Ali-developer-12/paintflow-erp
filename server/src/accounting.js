import db from "./db.js";
import { assertBalanced, naturalBalance, round2, voucherTotals } from "./accounting-core.js";

// Canonical chart-of-accounts codes used to map business transactions onto
// double-entry postings. Codes are stable and seeded by ensureChartOfAccounts().
export const ACCOUNT_CODES = {
  cash: "1100",
  bank: "1200",
  receivable: "1300",
  inventory: "1400",
  rawInventory: "1410",
  finishedInventory: "1420",
  payable: "2100",
  capital: "3000",
  sales: "4000",
  salesReturns: "4100",
  purchases: "5000",
  costOfGoodsSold: "5300",
};

// Standard accounts. INSERT OR IGNORE keeps this safe to run on every boot and
// on databases created before the accounting layer existed.
const SEED_ACCOUNTS = [
  ["1000", "Assets", "asset"],
  ["1100", "Cash In Hand", "asset"],
  ["1200", "Bank", "asset"],
  ["1300", "Accounts Receivable", "asset"],
  ["1400", "Inventory", "asset"],
  ["1410", "Raw Material Inventory", "asset"],
  ["1420", "Finished Goods Inventory", "asset"],
  ["2000", "Liabilities", "liability"],
  ["2100", "Accounts Payable", "liability"],
  ["3000", "Capital", "equity"],
  ["4000", "Sales", "income"],
  ["4100", "Sales Returns", "income"],
  ["5000", "Purchases", "expense"],
  ["5100", "Production Overheads", "expense"],
  ["5200", "Salaries", "expense"],
  ["5300", "Cost of Goods Sold", "expense"],
];

export function ensureChartOfAccounts(customDb = null) {
  const d = customDb || db;
  const insert = d.prepare("INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)");
  const insertMany = d.transaction((rows) => {
    for (const [code, name, type] of rows) insert.run(code, name, type);
  });
  insertMany(SEED_ACCOUNTS);
}

export function findAccountIdByCode(code, customDb = null) {
  const d = customDb || db;
  const row = d
    .prepare("SELECT id FROM accounts WHERE code = ? AND is_active = 1")
    .get(String(code));
  return row ? Number(row.id) : null;
}

export function requireAccountIdByCode(code, customDb = null) {
  const id = findAccountIdByCode(code, customDb);
  if (!id) {
    throw new Error(`Required account ${code} is missing from the chart of accounts`);
  }
  return id;
}

export function findAccountIdByParty(partyType, partyId, customDb = null) {
  const d = customDb || db;
  const table = partyType === "supplier" ? "suppliers" : "customers";
  const row = d
    .prepare(`SELECT account_id FROM ${table} WHERE id = ? AND is_active = 1`)
    .get(Number(partyId));
  return row && row.account_id ? Number(row.account_id) : null;
}

// Resolve the account that should receive a party balance. Prefer the party's
// mapped account, falling back to the shared control account (AR/AP).
export function resolvePartyAccountId(partyType, partyId, customDb = null) {
  const mapped = findAccountIdByParty(partyType, partyId, customDb);
  if (mapped) return mapped;
  return requireAccountIdByCode(
    partyType === "supplier" ? ACCOUNT_CODES.payable : ACCOUNT_CODES.receivable,
    customDb,
  );
}

// Post a balanced account voucher. MUST be called from inside the caller's
// db.transaction() so the voucher and the business document commit together.
export function postAccountVoucher({
  voucherNo,
  date,
  voucherType = "journal",
  refType = null,
  refId = null,
  narration = "",
  createdBy = null,
  entries = [],
}) {
  const totals = assertBalanced(entries);

  const voucher = db
    .prepare(
      `INSERT INTO account_vouchers (voucher_no, date, voucher_type, ref_type, ref_id, narration, amount, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      String(voucherNo),
      String(date),
      String(voucherType),
      refType ?? null,
      refId ?? null,
      String(narration || ""),
      totals.debit,
      createdBy ?? null,
    );

  const voucherId = Number(voucher.lastInsertRowid);
  const insertLine = db.prepare(
    `INSERT INTO account_ledger (voucher_id, date, account_id, debit, credit, narration, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  );

  for (const entry of entries) {
    insertLine.run(
      voucherId,
      String(date),
      Number(entry.account_id),
      round2(entry.debit ?? 0),
      round2(entry.credit ?? 0),
      String(entry.narration ?? narration ?? ""),
    );
  }

  return { id: voucherId, voucher_no: String(voucherNo), ...totals, entries: entries.length };
}

export function accountBalance(accountId, { to = null } = {}) {
  const params = [Number(accountId)];
  let sql =
    "SELECT COALESCE(SUM(debit),0) AS debit, COALESCE(SUM(credit),0) AS credit FROM account_ledger WHERE account_id = ?";
  if (to) {
    sql += " AND date <= ?";
    params.push(String(to));
  }
  const row = db.prepare(sql).get(...params);
  const account = db
    .prepare("SELECT type, opening_balance FROM accounts WHERE id = ?")
    .get(Number(accountId));
  const opening = Number(account?.opening_balance || 0);
  const movement = naturalBalance(account?.type || "asset", {
    debit: row.debit,
    credit: row.credit,
  });
  return { opening, movement, balance: round2(opening + movement) };
}

function isDebitNatured(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "asset" || normalized === "expense";
}

// ---------------------------------------------
// Integrity helpers used by reconciliation / reporting endpoints.
// ---------------------------------------------

export function reconcileStock(customDb = null) {
  const d = customDb || db;
  const issues = [];

  const rawRows = d
    .prepare(
      `SELECT fi.id, fi.name, fi.stock_qty,
              COALESCE(SUM(sl.qty_in), 0) AS total_in,
              COALESCE(SUM(sl.qty_out), 0) AS total_out
       FROM factory_items fi
       LEFT JOIN stock_ledger sl ON sl.factory_item_id = fi.id AND sl.stock_type = 'raw'
       WHERE fi.is_active = 1
       GROUP BY fi.id`,
    )
    .all();

  const finishedRows = d
    .prepare(
      `SELECT ip.id, ip.stock_qty,
              COALESCE(SUM(sl.qty_in), 0) AS total_in,
              COALESCE(SUM(sl.qty_out), 0) AS total_out
       FROM item_particulars ip
       LEFT JOIN stock_ledger sl ON sl.particular_id = ip.id AND sl.stock_type = 'finished'
       GROUP BY ip.id`,
    )
    .all();

  const check = (row, label, id) => {
    const expected = round2(Number(row.total_in) - Number(row.total_out));
    const actual = round2(Number(row.stock_qty));
    if (Math.abs(expected - actual) > 0.01) {
      issues.push({ stock_type: label, id, name: row.name ?? null, expected, actual });
    }
  };

  for (const row of rawRows) check(row, "raw", row.id);
  for (const row of finishedRows) check(row, "finished", row.id);

  return {
    ok: issues.length === 0,
    checked: { raw: rawRows.length, finished: finishedRows.length },
    issues,
  };
}

export function trialBalance(customDb = null) {
  const d = customDb || db;
  const rows = d
    .prepare(
      `SELECT a.id, a.code, a.name, a.type, a.opening_balance,
              COALESCE(SUM(al.debit), 0) AS debit,
              COALESCE(SUM(al.credit), 0) AS credit
       FROM accounts a
       LEFT JOIN account_ledger al ON al.account_id = a.id
       WHERE a.is_active = 1
       GROUP BY a.id
       ORDER BY a.code ASC`,
    )
    .all();

  let totalDebit = 0;
  let totalCredit = 0;
  const lines = rows.map((row) => {
    const opening = Number(row.opening_balance || 0);
    const debit = Number(row.debit) + (opening > 0 && isDebitNatured(row.type) ? opening : 0);
    const credit = Number(row.credit) + (opening > 0 && !isDebitNatured(row.type) ? opening : 0);
    const balance = naturalBalance(row.type, { debit, credit });
    // A positive natural balance is a debit balance for assets/expenses and a
    // credit balance for liabilities/equity/income.
    const debitSide = isDebitNatured(row.type)
      ? balance > 0
        ? round2(balance)
        : 0
      : balance < 0
        ? round2(-balance)
        : 0;
    const creditSide = isDebitNatured(row.type)
      ? balance < 0
        ? round2(-balance)
        : 0
      : balance > 0
        ? round2(balance)
        : 0;
    totalDebit += debitSide;
    totalCredit += creditSide;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      debit: debitSide,
      credit: creditSide,
    };
  });

  return {
    balanced: Math.abs(round2(totalDebit) - round2(totalCredit)) <= 0.01,
    total_debit: round2(totalDebit),
    total_credit: round2(totalCredit),
    lines,
  };
}

export { voucherTotals };
