// Pure, side-effect-free helpers for the double-entry accounting layer.
// Kept dependency-free (no DB, no better-sqlite3) so they can be unit tested
// without booting the whole server.

const BALANCE_TOLERANCE = 0.01;

export function round2(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function voucherTotals(entries) {
  return (Array.isArray(entries) ? entries : []).reduce(
    (acc, entry) => {
      const debit = Number(entry?.debit ?? 0);
      const credit = Number(entry?.credit ?? 0);
      acc.debit += Number.isFinite(debit) ? debit : 0;
      acc.credit += Number.isFinite(credit) ? credit : 0;
      return acc;
    },
    { debit: 0, credit: 0 },
  );
}

export function isBalanced(entries, tolerance = BALANCE_TOLERANCE) {
  const totals = voucherTotals(entries);
  return Math.abs(totals.debit - totals.credit) <= tolerance;
}

export function assertBalanced(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Account voucher must contain at least one ledger entry");
  }
  const totals = voucherTotals(entries);
  if (Math.abs(totals.debit - totals.credit) > BALANCE_TOLERANCE) {
    throw new Error(
      `Unbalanced account voucher: debits ${round2(totals.debit)} != credits ${round2(totals.credit)}`,
    );
  }
  return { debit: round2(totals.debit), credit: round2(totals.credit) };
}

// Natural-balance sign helper. Assets/expenses are debit-positive,
// liabilities/equity/income are credit-positive.
export function naturalBalance(type, { debit = 0, credit = 0 } = {}) {
  const normalized = String(type || "").toLowerCase();
  const isDebitNatured = normalized === "asset" || normalized === "expense";
  return isDebitNatured
    ? Number(debit || 0) - Number(credit || 0)
    : Number(credit || 0) - Number(debit || 0);
}

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"];
