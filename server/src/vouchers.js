import db from "./db.js";

// Document numbers are generated from a database-backed counter rather than a
// timestamp. Two operators saving within the same millisecond used to be able to
// produce the same PUR-/SL-/RT- number, which the UNIQUE constraint then rejected
// with a confusing error (or, worse, collided with legacy data).
//
// MUST be called inside the caller's db.transaction() so the number is consumed
// atomically with the document it belongs to.

export const DOC_PREFIX = {
  purchase: "PUR",
  production: "PRO",
  sale: "SL",
  issue: "IV",
  return: "RT",
  account: "AV",
  opening: "OB",
  receipt: "RCP",
  payment: "PMT",
  expense: "EXP",
  income: "INC",
  journal: "JV",
  adjustment: "ADJ",
};

export function nextVoucherNo(prefix) {
  const key = String(prefix).toUpperCase();

  const row = db.prepare("SELECT next_value FROM voucher_sequences WHERE prefix = ?").get(key);
  const value = row ? Number(row.next_value) : 1;

  db.prepare(
    `INSERT INTO voucher_sequences (prefix, next_value) VALUES (?, ?)
     ON CONFLICT(prefix) DO UPDATE SET next_value = excluded.next_value`,
  ).run(key, value + 1);

  return `${key}-${String(value).padStart(6, "0")}`;
}

// Account vouchers are prefixed from the business document number so the two are
// obviously linked when reading the ledger (e.g. AV-PUR-000012).
export function accountVoucherNo(docPrefix, docVoucherNo) {
  return `${DOC_PREFIX.account}-${docVoucherNo}`;
}

// Ensure a generated number is genuinely free, so a legacy timestamp-style row
// can never be shadowed by a new sequence value.
export function nextUniqueVoucherNo(prefix) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = nextVoucherNo(prefix);
    const clash = db
      .prepare(
        `SELECT 1 AS c FROM (
           SELECT voucher_no FROM purchases
           UNION ALL SELECT voucher_no FROM productions
           UNION ALL SELECT voucher_no FROM sales
           UNION ALL SELECT voucher_no FROM issue_vouchers
           UNION ALL SELECT voucher_no FROM returns
           UNION ALL SELECT voucher_no FROM account_vouchers
           UNION ALL SELECT voucher_no FROM customer_receipts
           UNION ALL SELECT voucher_no FROM supplier_payments
           UNION ALL SELECT voucher_no FROM expense_vouchers
           UNION ALL SELECT voucher_no FROM income_vouchers
           UNION ALL SELECT voucher_no FROM journal_vouchers
           UNION ALL SELECT voucher_no FROM stock_adjustments
           UNION ALL SELECT voucher_no FROM opening_stocks
         ) WHERE voucher_no = ? LIMIT 1`,
      )
      .get(candidate);
    if (!clash) return candidate;
  }
  throw new Error(`Unable to generate a unique voucher number for prefix ${prefix}`);
}

export default { DOC_PREFIX, nextVoucherNo, accountVoucherNo, nextUniqueVoucherNo };
