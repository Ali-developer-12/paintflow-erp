import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_TYPES,
  assertBalanced,
  isBalanced,
  naturalBalance,
  round2,
  voucherTotals,
} from "./accounting-core.js";

test("round2 keeps two decimals, collapses float noise and rejects junk", () => {
  assert.equal(round2(10.567), 10.57);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(100), 100);
  assert.equal(round2(Number.NaN), 0);
  assert.equal(round2("abc"), 0);
  assert.equal(round2(undefined), 0);
});

test("voucherTotals sums debits and credits separately", () => {
  const totals = voucherTotals([
    { debit: 100, credit: 0 },
    { debit: 25.5, credit: 0 },
    { debit: 0, credit: 125.5 },
  ]);
  assert.deepEqual(totals, { debit: 125.5, credit: 125.5 });
});

test("voucherTotals ignores non-finite amounts instead of producing NaN", () => {
  const totals = voucherTotals([
    { debit: 10, credit: 0 },
    { debit: Number.NaN, credit: 0 },
    { debit: 0, credit: 10 },
  ]);
  assert.deepEqual(totals, { debit: 10, credit: 10 });
});

test("isBalanced accepts a balanced voucher", () => {
  assert.equal(
    isBalanced([
      { debit: 500, credit: 0 },
      { debit: 0, credit: 500 },
    ]),
    true,
  );
});

test("assertBalanced returns the rounded totals for a balanced voucher", () => {
  const totals = assertBalanced([
    { debit: 400.005, credit: 0 },
    { debit: 0, credit: 400.005 },
  ]);
  assert.deepEqual(totals, { debit: 400.01, credit: 400.01 });
});

test("assertBalanced rejects a voucher whose debits and credits differ", () => {
  assert.throws(
    () =>
      assertBalanced([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 40 },
      ]),
    /Unbalanced account voucher/,
  );
});

test("assertBalanced rejects an empty voucher", () => {
  assert.throws(() => assertBalanced([]), /at least one ledger entry/);
});

test("naturalBalance follows debit/credit sign conventions per account type", () => {
  assert.equal(naturalBalance("asset", { debit: 100, credit: 40 }), 60);
  assert.equal(naturalBalance("expense", { debit: 90, credit: 30 }), 60);
  assert.equal(naturalBalance("liability", { debit: 100, credit: 140 }), 40);
  assert.equal(naturalBalance("equity", { debit: 5, credit: 25 }), 20);
  assert.equal(naturalBalance("income", { debit: 10, credit: 70 }), 60);
});

test("the chart uses the five standard account types", () => {
  assert.deepEqual(ACCOUNT_TYPES, ["asset", "liability", "equity", "income", "expense"]);
});
