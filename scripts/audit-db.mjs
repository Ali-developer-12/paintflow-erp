import Database from "better-sqlite3";

const db = new Database("data/paint-erp.db", { readonly: true });
const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

console.log("=== BUSINESS ROW COUNTS ===");
for (const table of [
  "purchases",
  "productions",
  "sales",
  "returns",
  "issue_vouchers",
  "purchase_lines",
  "production_consumptions",
  "sale_lines",
  "return_lines",
]) {
  console.log("  ", table, count(table));
}

console.log("=== ACCOUNTING ROW COUNTS ===");
for (const table of ["account_vouchers", "account_ledger"]) {
  console.log("  ", table, count(table));
}

console.log("=== BUSINESS DOCS WITHOUT ANY ACCOUNTING VOUCHER ===");
const missing = [
  ["purchases", "purchase"],
  ["productions", "production"],
  ["sales", "sale"],
  ["returns", "return"],
  ["issue_vouchers", "issue"],
];
for (const [table, refType] of missing) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${table} t
       WHERE NOT EXISTS (
         SELECT 1 FROM account_vouchers av WHERE av.ref_type = ? AND av.ref_id = t.id
       )`,
    )
    .get(refType);
  console.log("  ", table, "missing voucher:", row.c, "of", count(table));
}

console.log("=== PURCHASES DETAIL ===");
console.log(
  db
    .prepare(
      `SELECT id, voucher_no, date, supplier_id, net_total, paid_amount, created_by
       FROM purchases ORDER BY id`,
    )
    .all(),
);
console.log("=== SALES DETAIL ===");
console.log(
  db
    .prepare(
      `SELECT id, voucher_no, date, customer_id, net_total, paid_amount FROM sales ORDER BY id`,
    )
    .all(),
);
console.log("=== RETURNS DETAIL ===");
console.log(
  db.prepare(`SELECT id, voucher_no, date, return_type, net_total FROM returns ORDER BY id`).all(),
);
console.log("=== PRODUCTIONS DETAIL ===");
console.log(
  db
    .prepare(
      `SELECT id, voucher_no, date, produced_qty, material_cost FROM productions ORDER BY id`,
    )
    .all(),
);
console.log("=== VOUCHER NUMBER COLLISION CHECK ===");
console.log(
  db
    .prepare(
      `SELECT voucher_no, COUNT(*) AS c FROM (
         SELECT voucher_no FROM purchases
         UNION ALL SELECT voucher_no FROM sales
         UNION ALL SELECT voucher_no FROM returns
         UNION ALL SELECT voucher_no FROM productions
         UNION ALL SELECT voucher_no FROM issue_vouchers
       ) GROUP BY voucher_no HAVING c > 1`,
    )
    .all(),
);
db.close();
