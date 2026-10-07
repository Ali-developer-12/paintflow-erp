import db from "./db.js";
import { ACCOUNT_CODES, postAccountVoucher, requireAccountIdByCode } from "./accounting.js";
import { round2 } from "./accounting-core.js";
import { DOC_PREFIX, nextUniqueVoucherNo } from "./vouchers.js";

export function getCurrentYear() {
  return (
    db
      .prepare(
        "SELECT * FROM financial_years WHERE is_current = 1 ORDER BY start_date DESC LIMIT 1",
      )
      .get() || null
  );
}

// Guard used by every posting route. Rejects writes that target a closed year.
export function assertPostingAllowed(date) {
  const target = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return;
  const year = db
    .prepare("SELECT * FROM financial_years WHERE ? BETWEEN start_date AND end_date LIMIT 1")
    .get(target);
  if (year && Number(year.is_closed) === 1) {
    throw new Error(`Financial year ${year.name} is closed; posting on ${target} is not allowed`);
  }
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addYears(isoDate, years) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

// Per-account closing balance up to (and including) the given date.
function closingBalances(toDate) {
  const rows = db
    .prepare(
      `SELECT a.id, a.code, a.name, a.type, a.opening_balance,
              COALESCE(SUM(al.debit), 0) AS debit,
              COALESCE(SUM(al.credit), 0) AS credit
       FROM accounts a
       LEFT JOIN account_ledger al ON al.account_id = a.id AND (? IS NULL OR al.date <= ?)
       WHERE a.is_active = 1
       GROUP BY a.id`,
    )
    .all(toDate ?? null, toDate ?? null);

  return rows.map((row) => {
    const opening = Number(row.opening_balance || 0);
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    const isDebitNatured = row.type === "asset" || row.type === "expense";
    // Positive => natural balance on its own side; negative => opposite side.
    const natural = isDebitNatured ? opening + debit - credit : opening + credit - debit;
    return { ...row, natural: round2(natural), isDebitNatured };
  });
}

// Explicit, atomic year rollover:
//  - closes the current year and opens a new one,
//  - posts closing/carry-forward journal entries into the new year,
//  - records the event in year_postings,
//  - preserves all historical transactions (nothing is deleted/updated).
export function closeAndOpenYear({ name, startDate, endDate, userId = null, notes = "" } = {}) {
  const label = String(name || "").trim();
  if (!label) throw new Error("New financial year label is required");

  return db.transaction(() => {
    const existing = db.prepare("SELECT id FROM financial_years WHERE name = ?").get(label);
    if (existing) throw new Error(`Financial year ${label} already exists`);

    const current = getCurrentYear();
    if (!current)
      throw new Error("No current financial year found. Initialise the database first.");

    const resolvedStart = startDate ? String(startDate).slice(0, 10) : addDays(current.end_date, 1);
    const resolvedEnd = endDate
      ? String(endDate).slice(0, 10)
      : addDays(addYears(resolvedStart, 1), -1);

    if (resolvedEnd < resolvedStart) {
      throw new Error("Financial year end date cannot be before the start date");
    }
    if (resolvedStart <= current.end_date) {
      throw new Error("New financial year must start after the current year ends");
    }

    // Build the closing / carry-forward journal.
    const balances = closingBalances(current.end_date);
    const entries = [];
    let diff = 0;
    for (const account of balances) {
      if (Math.abs(account.natural) <= 0.005) continue;
      if (account.type === "income") {
        entries.push({ account_id: account.id, debit: Math.abs(account.natural), credit: 0 });
        diff += Math.abs(account.natural);
      } else if (account.type === "expense") {
        entries.push({ account_id: account.id, debit: 0, credit: Math.abs(account.natural) });
        diff -= Math.abs(account.natural);
      } else if (account.natural > 0) {
        entries.push({ account_id: account.id, debit: account.natural, credit: 0 });
        diff += account.natural;
      } else {
        entries.push({ account_id: account.id, debit: 0, credit: round2(-account.natural) });
        diff -= -account.natural;
      }
    }

    const capitalId = requireAccountIdByCode(ACCOUNT_CODES.capital);
    if (Math.abs(diff) > 0.005) {
      if (diff > 0) {
        entries.push({ account_id: capitalId, debit: 0, credit: round2(diff) });
      } else {
        entries.push({ account_id: capitalId, debit: round2(-diff), credit: 0 });
      }
    }

    db.prepare("UPDATE financial_years SET is_closed = 1, is_current = 0 WHERE id = ?").run(
      current.id,
    );

    const inserted = db
      .prepare(
        "INSERT INTO financial_years (name, start_date, end_date, is_closed, is_current, created_at) VALUES (?, ?, ?, 0, 1, datetime('now'))",
      )
      .run(label, resolvedStart, resolvedEnd);
    const newYearId = Number(inserted.lastInsertRowid);

    let posting = null;
    if (entries.length > 0) {
      posting = postAccountVoucher({
        // Sequence-based, so repeated rollovers in the same millisecond cannot collide.
        voucherNo: nextUniqueVoucherNo(DOC_PREFIX.opening),
        date: resolvedStart,
        voucherType: "journal",
        refType: "year_posting",
        refId: newYearId,
        narration: `Opening balances carried forward from ${current.name}`,
        createdBy: userId,
        entries: entries.map((entry) => ({ ...entry, narration: "Carry forward" })),
      });
    }

    // Opening balances now live in the carried-forward journal, so the static
    // account opening column is reset to avoid double counting.
    db.prepare("UPDATE accounts SET opening_balance = 0").run();

    db.prepare(
      "INSERT INTO year_postings (from_year_id, to_year_id, posted_at, posted_by, notes) VALUES (?, ?, datetime('now'), ?, ?)",
    ).run(current.id, newYearId, userId ?? null, String(notes || ""));

    const newYear = db.prepare("SELECT * FROM financial_years WHERE id = ?").get(newYearId);
    return { closed_year: current, new_year: newYear, posting };
  })();
}

export function listYears() {
  return db.prepare("SELECT * FROM financial_years ORDER BY start_date DESC").all();
}

// Ensure the database always has exactly one open current financial year so the
// rollover workflow and the closed-year guard have a baseline to work from.
export function ensureCurrentFinancialYear() {
  const existing = db
    .prepare("SELECT * FROM financial_years WHERE is_current = 1 ORDER BY start_date DESC LIMIT 1")
    .get();
  if (existing) return existing;

  const year = new Date().getFullYear();
  db.prepare(
    "INSERT OR IGNORE INTO financial_years (name, start_date, end_date, is_closed, is_current, created_at) VALUES (?, ?, ?, 0, 1, datetime('now'))",
  ).run(`${year}-${year + 1}`, `${year}-07-01`, `${year + 1}-06-30`);
  return getCurrentYear();
}
