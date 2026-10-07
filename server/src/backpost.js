import db from "./db.js";
import {
  ACCOUNT_CODES,
  postAccountVoucher,
  requireAccountIdByCode,
  resolvePartyAccountId,
} from "./accounting.js";
import { round2 } from "./accounting-core.js";

export const MIGRATION_NAME = "backpost-legacy-accounting";

// A document already has an accounting voucher when a voucher exists for the
// same (ref_type, ref_id). This is the single guard that makes the migration
// idempotent and duplicate-safe.
export function hasVoucher(refType, refId) {
  const row = db
    .prepare("SELECT id FROM account_vouchers WHERE ref_type = ? AND ref_id = ? LIMIT 1")
    .get(refType, Number(refId));
  return row ? Number(row.id) : null;
}

function logMigration(row) {
  db.prepare(
    `INSERT INTO migration_log (migration, action, ref_type, ref_id, voucher_id, amount, message, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    MIGRATION_NAME,
    row.action,
    row.ref_type ?? null,
    row.ref_id ?? null,
    row.voucher_id ?? null,
    row.amount ?? null,
    String(row.message || ""),
    row.created_by ?? null,
  );
}

// Historical cost for COGS.
//
// sale_lines / return_lines do NOT store a cost snapshot, and the stock_ledger
// `rate` written by the sale/return endpoints is the SALE rate, not the unit
// cost. So for legacy documents there is no reliable historical cost.
//
// We therefore return null ("unknown") rather than substituting today's
// item_particulars.cost_price, which would silently fabricate a gross profit.
// If a cost snapshot column is added to the line tables later, this picks it up
// automatically because the queries select *.
function historicalUnitCost(line) {
  const raw = line?.cost_price;
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw)) || Number(raw) <= 0)
    return null;
  return Number(raw);
}

// Sums qty * historical unit cost for the lines that HAVE a snapshot.
// Returns { cost, knownLines, unknownLines }.
function sumHistoricalCost(lines) {
  let cost = 0;
  let knownLines = 0;
  let unknownLines = 0;
  for (const line of lines) {
    const unit = historicalUnitCost(line);
    if (unit === null) {
      unknownLines += 1;
      continue;
    }
    knownLines += 1;
    cost += round2(Number(line.qty || 0) * unit);
  }
  return { cost: round2(cost), knownLines, unknownLines };
}

// ---------- Builders: one per document type ----------
//
// Every builder returns { entries, notes }. `entries` must be a BALANCED set of
// ledger lines or the voucher is rejected by assertBalanced(). Anything we cannot
// derive honestly is reported in `notes` instead of being invented.

function buildPurchaseEntries(purchase, lines) {
  const entries = [];
  const notes = [];
  let rawValue = 0;
  let finishedValue = 0;
  let unclassifiedValue = 0;

  for (const line of lines) {
    const amount = round2(Number(line.amount || 0));
    if (line.factory_item_id) rawValue += amount;
    else if (line.particular_id) finishedValue += amount;
    else unclassifiedValue += amount;
  }

  const net = round2(Number(purchase.net_total || 0));
  const paid = round2(Number(purchase.paid_amount || 0));

  // Inventory side: debit the specific sub-accounts when the line identifies the
  // stock, and fall back to the parent Inventory control account when a legacy
  // line has no item reference at all. We know stock was bought; we do not know
  // which sub-account, and the control account records that honestly.
  if (rawValue > 0) {
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.rawInventory),
      debit: round2(rawValue),
      credit: 0,
    });
  }
  if (finishedValue > 0) {
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
      debit: round2(finishedValue),
      credit: 0,
    });
  }
  if (unclassifiedValue > 0) {
    notes.push(
      `${unclassifiedValue} of purchase value has no raw/finished item reference; posted to the Inventory control account.`,
    );
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.inventory),
      debit: round2(unclassifiedValue),
      credit: 0,
    });
  }

  if (paid > 0) {
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.cash),
      debit: 0,
      credit: round2(paid),
    });
  }
  const outstanding = round2(net - paid);
  if (outstanding > 0) {
    if (!purchase.supplier_id) {
      throw new Error(
        "Purchase has an outstanding balance but no supplier; cannot post to a party account",
      );
    }
    entries.push({
      account_id: resolvePartyAccountId("supplier", purchase.supplier_id),
      debit: 0,
      credit: round2(outstanding),
    });
  }

  // Line value must reconcile with the document total, otherwise the inventory
  // debit and the payable credit disagree and the voucher is simply wrong.
  const lineTotal = round2(rawValue + finishedValue + unclassifiedValue);
  if (lines.length > 0 && Math.abs(lineTotal - net) > 0.01) {
    throw new Error(
      `Purchase line total ${lineTotal} does not reconcile with document total ${net}`,
    );
  }
  if (lines.length === 0 && net > 0) {
    throw new Error("Purchase has a value but no line detail; inventory side cannot be determined");
  }

  return { entries, notes };
}

// A sale posts the REVENUE side only when the COGS side cannot be proven.
// Fabricating a cost of goods sold from today's cost price would overstate or
// understate gross profit, so the COGS pair is omitted and the omission is
// reported for a human to review.
function buildSaleEntries(sale, lines) {
  const entries = [];
  const notes = [];
  const net = round2(Number(sale.net_total || 0));
  const paid = round2(Number(sale.paid_amount || 0));

  if (net <= 0) return { entries, notes };

  if (net - paid > 0) {
    if (!sale.customer_id) {
      throw new Error(
        "Sale has an outstanding balance but no customer; cannot post to a party account",
      );
    }
    entries.push({
      account_id: resolvePartyAccountId("customer", sale.customer_id),
      debit: round2(net - paid),
      credit: 0,
    });
  }
  if (paid > 0) {
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.cash),
      debit: round2(paid),
      credit: 0,
    });
  }
  entries.push({ account_id: requireAccountIdByCode(ACCOUNT_CODES.sales), debit: 0, credit: net });

  const { cost, knownLines, unknownLines } = sumHistoricalCost(lines);
  if (unknownLines === 0 && knownLines > 0 && cost > 0) {
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.costOfGoodsSold),
      debit: cost,
      credit: 0,
    });
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
      debit: 0,
      credit: cost,
    });
  } else if (knownLines > 0) {
    notes.push(
      `Partial COGS: ${knownLines} line(s) priced, ${unknownLines} without a historical cost snapshot. COGS omitted for the unpriced lines.`,
    );
  } else {
    notes.push(
      "No historical cost snapshot exists for this sale; COGS/inventory entries were NOT posted. Gross profit for this document is overstated until a cost is supplied.",
    );
  }

  return { entries, notes };
}

function buildProductionEntries(production) {
  const cost = round2(Number(production.material_cost || 0));
  const notes = [];
  if (cost <= 0) return { entries: [], notes };
  const overhead = round2(Number(production.overhead_cost || 0));
  if (overhead > 0) {
    notes.push(
      `Production overhead of ${overhead} has no purchase or cash source recorded, so it was NOT capitalised into stock.`,
    );
  }
  return {
    entries: [
      {
        account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
        debit: cost,
        credit: 0,
      },
      {
        account_id: requireAccountIdByCode(ACCOUNT_CODES.rawInventory),
        debit: 0,
        credit: cost,
      },
    ],
    notes,
  };
}

function buildReturnEntries(returnRow, lines) {
  const entries = [];
  const notes = [];
  const total = round2(Number(returnRow.net_total || 0));
  const type = String(returnRow.return_type || "");

  if (total <= 0) return { entries, notes };

  if (type === "customer") {
    if (!returnRow.customer_id) {
      throw new Error(
        "Customer return has a value but no customer; cannot post to a party account",
      );
    }
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.salesReturns),
      debit: total,
      credit: 0,
    });
    entries.push({
      account_id: resolvePartyAccountId("customer", returnRow.customer_id),
      debit: 0,
      credit: total,
    });

    const { cost, knownLines, unknownLines } = sumHistoricalCost(lines);
    if (knownLines === 0) {
      notes.push(
        "No historical cost snapshot exists for this customer return; the stock/COGS pair was NOT posted. Cost of returned goods remains unrecorded.",
      );
    } else if (unknownLines > 0) {
      notes.push(
        `Partial return cost: ${knownLines} line(s) priced, ${unknownLines} without a historical cost snapshot.`,
      );
    }
    if (knownLines > 0 && unknownLines === 0 && cost > 0) {
      entries.push({
        account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
        debit: cost,
        credit: 0,
      });
      entries.push({
        account_id: requireAccountIdByCode(ACCOUNT_CODES.costOfGoodsSold),
        debit: 0,
        credit: cost,
      });
    }
  } else if (type === "supplier") {
    if (!returnRow.supplier_id) {
      throw new Error(
        "Supplier return has a value but no supplier; cannot post to a party account",
      );
    }
    entries.push({
      account_id: resolvePartyAccountId("supplier", returnRow.supplier_id),
      debit: total,
      credit: 0,
    });
    entries.push({
      account_id: requireAccountIdByCode(ACCOUNT_CODES.rawInventory),
      debit: 0,
      credit: total,
    });
  } else {
    throw new Error(`Unsupported return type "${type}"`);
  }

  return { entries, notes };
}
// ---------- Discovery (read-only, safe to call at any time) ----------

const SCOPE = [
  {
    refType: "purchase",
    table: "purchases",
    build: (id) => {
      const doc = db.prepare("SELECT * FROM purchases WHERE id = ?").get(id);
      if (!doc) throw new Error(`Purchase ${id} no longer exists`);
      const lines = db.prepare("SELECT * FROM purchase_lines WHERE purchase_id = ?").all(doc.id);
      return { doc, ...buildPurchaseEntries(doc, lines) };
    },
  },
  {
    refType: "production",
    table: "productions",
    build: (id) => {
      const doc = db.prepare("SELECT * FROM productions WHERE id = ?").get(id);
      if (!doc) throw new Error(`Production ${id} no longer exists`);
      return { doc, ...buildProductionEntries(doc) };
    },
  },
  {
    refType: "sale",
    table: "sales",
    build: (id) => {
      const doc = db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
      if (!doc) throw new Error(`Sale ${id} no longer exists`);
      // NOTE: no join to item_particulars.cost_price. Today's cost price is not
      // the historical cost of a legacy sale and must not be substituted.
      const lines = db.prepare("SELECT * FROM sale_lines WHERE sale_id = ?").all(doc.id);
      return { doc, ...buildSaleEntries(doc, lines) };
    },
  },
  {
    refType: "return",
    table: "returns",
    build: (id) => {
      const doc = db.prepare("SELECT * FROM returns WHERE id = ?").get(id);
      if (!doc) throw new Error(`Return ${id} no longer exists`);
      const lines = db.prepare("SELECT * FROM return_lines WHERE return_id = ?").all(doc.id);
      return { doc, ...buildReturnEntries(doc, lines) };
    },
  },
];

export function backpostReport() {
  const result = {
    pending: [],
    already_posted: 0,
    zero_value: 0,
    skipped: [],
    notes: [],
  };

  for (const scope of SCOPE) {
    const rows = db.prepare(`SELECT id, voucher_no, date FROM ${scope.table} ORDER BY id`).all();
    for (const row of rows) {
      if (hasVoucher(scope.refType, row.id)) {
        result.already_posted += 1;
        continue;
      }
      let entries = [];
      let notes = [];
      let reason = null;
      try {
        ({ entries, notes } = scope.build(row.id));
      } catch (error) {
        reason = error.message;
      }

      const allZero = entries.length > 0 && entries.every((e) => !e.debit && !e.credit);
      if (reason) {
        result.skipped.push({ ref_type: scope.refType, ref_id: row.id, reason });
      } else if (entries.length === 0 || allZero) {
        result.zero_value += 1;
        result.skipped.push({
          ref_type: scope.refType,
          ref_id: row.id,
          reason: "Document has no monetary value; no accounting effect to post.",
        });
      } else {
        const total = round2(entries.reduce((s, e) => s + Number(e.debit || 0), 0));
        result.pending.push({
          ref_type: scope.refType,
          ref_id: row.id,
          voucher_no: row.voucher_no,
          date: row.date,
          amount: total,
          lines: entries.length,
          notes,
        });
      }
    }
  }
  return result;
}

// ---------- Execution ----------

// Each document is posted in its OWN transaction. A failure rolls back only that
// document and is recorded, so one bad legacy row cannot block or corrupt the
// rest of the migration. The audit row is written INSIDE the same transaction as
// the voucher, so the log can never disagree with the ledger.
export function runBackpost({ dryRun = false, userId = null } = {}) {
  const report = backpostReport();
  const results = { posted: [], skipped: [], failed: [], dryRun };

  if (dryRun) return { ...results, report };

  const postOne = db.transaction((item) => {
    // Re-check inside the transaction: guards a concurrent double run.
    if (hasVoucher(item.ref_type, item.ref_id)) return { skipped: "already posted" };

    const scope = SCOPE.find((s) => s.refType === item.ref_type);
    const { doc, entries, notes } = scope.build(item.ref_id);
    if (!entries.length) return { skipped: "no entries" };

    const typeFor =
      item.ref_type === "sale"
        ? "sale"
        : item.ref_type === "purchase"
          ? "purchase"
          : item.ref_type === "return"
            ? "return"
            : "journal";

    const voucher = postAccountVoucher({
      voucherNo: `AV-MIG-${doc.voucher_no}`,
      date: String(doc.date),
      voucherType: typeFor,
      refType: item.ref_type,
      refId: item.ref_id,
      narration: `Back-post of legacy ${item.ref_type} ${doc.voucher_no}`,
      createdBy: userId,
      entries,
    });

    logMigration({
      action: "posted",
      ref_type: item.ref_type,
      ref_id: item.ref_id,
      voucher_id: voucher.id,
      amount: voucher.debit,
      message: [voucher.voucher_no, ...notes].join(" | "),
      created_by: userId,
    });

    return { voucher, notes };
  });

  for (const item of report.pending) {
    try {
      const outcome = postOne(item);
      if (outcome.voucher) {
        results.posted.push({ ...item, voucher_id: outcome.voucher.id });
        if (outcome.notes?.length) {
          results.posted[results.posted.length - 1].notes = outcome.notes;
        }
      } else {
        results.skipped.push({ ...item, reason: outcome.skipped });
      }
    } catch (error) {
      results.failed.push({ ...item, error: error.message });
      // The voucher transaction rolled back, so this failure row is logged on
      // its own. It records a voucher_id of NULL and never claims a posting.
      logMigration({
        action: "failed",
        ref_type: item.ref_type,
        ref_id: item.ref_id,
        voucher_id: null,
        amount: item.amount,
        message: error.message,
        created_by: userId,
      });
    }
  }
  return { ...results, report };
}

// Reverse the migration by deleting only vouchers this migration created
// (account_ledger rows cascade with the voucher).
export function revertBackpost() {
  const rows = db
    .prepare("SELECT id, voucher_id FROM migration_log WHERE migration = ? AND action = 'posted'")
    .all(MIGRATION_NAME);
  if (!rows.length) return { reverted: 0, note: "No back-posted vouchers found." };

  const revert = db.transaction((logRows) => {
    let count = 0;
    for (const row of logRows) {
      if (row.voucher_id) {
        count += db
          .prepare("DELETE FROM account_vouchers WHERE id = ?")
          .run(row.voucher_id).changes;
      }
    }
    return count;
  });
  const reverted = revert(rows);
  return { reverted, note: `Removed ${reverted} back-posted vouchers.` };
}
