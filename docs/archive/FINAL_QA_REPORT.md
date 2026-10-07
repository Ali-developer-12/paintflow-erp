# Final QA Report

Method: automated Node test runner (`node:test`) executing a real Express server
against a real, throwaway SQLite database over HTTP. No mocks and no static data.
Browser-based checks remain BLOCKED — Playwright is not installed in this
environment.

## Results

| Suite                                                  | Tests  | Pass   | Fail  |
| ------------------------------------------------------ | ------ | ------ | ----- |
| `accounting-core.test.js` (pure helpers)               | 9      | 9      | 0     |
| `phase4-logic.test.js` (production maths)              | 2      | 2      | 0     |
| `erp-flow.test.js` (HTTP integration)                  | 21     | 21     | 0     |
| `restore.test.js` (backup/restore/back-post/numbering) | 10     | 10     | 0     |
| `final-scenario.test.js` (A/B/X acceptance)            | 10     | 10     | 0     |
| **Total**                                              | **52** | **52** | **0** |

### Integration coverage

| Area                 | Result | Evidence                                                                                                                                                                                          |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                 | PASS   | Wrong password → 401; missing token → 401; unknown token → 401                                                                                                                                    |
| Role enforcement     | PASS   | Non-admin: `GET /items` → 200, `POST /setup/suppliers` → 403, `POST /suppliers` → 403, `GET /backup/export` → 403                                                                                 |
| Password change      | PASS   | Wrong current → 400; <8 chars → 400; valid → 200 and re-login succeeds                                                                                                                            |
| Masters              | PASS   | Supplier, customer and raw material created; item + particular created                                                                                                                            |
| Formula              | PASS   | Client-sent `total_cost: 999999` ignored; server computed `total_cost` 100 and line `cost_value` 100                                                                                              |
| Purchase validation  | PASS   | Unknown supplier → 400; `qty: 0` → 400; line with no item reference → 400                                                                                                                         |
| Purchase posting     | PASS   | Raw stock 0 → 100; ledger `balance_after` 100; voucher balanced                                                                                                                                   |
| Production           | PASS   | Multiplier 2; raw 100 → 96; finished 0 → 20; voucher balanced                                                                                                                                     |
| Production rollback  | PASS   | Over-consumption → 400; production count unchanged; stock unchanged; no orphan vouchers                                                                                                           |
| Counter sale         | PASS   | Total 1000 server-calculated; finished 20 → 15; AR/Sales/COGS voucher balanced                                                                                                                    |
| Issue voucher        | PASS   | `qty: 0` → 400; valid issue succeeded; **0** account vouchers created (stock-only contract)                                                                                                       |
| Customer return      | PASS   | Finished 15 → 13 → 14; reversal voucher balanced                                                                                                                                                  |
| Supplier return      | PASS   | Over-return → 400 with stock unchanged; valid return 96 → 86; voucher balanced                                                                                                                    |
| Stock reconciliation | PASS   | `GET /api/stock/reconciliation` → `ok: true`, no mismatches                                                                                                                                       |
| Trial balance        | PASS   | `GET /api/accounts/trial-balance` → `balanced: true`                                                                                                                                              |
| `created_by`         | PASS   | Every purchase row has a non-null author                                                                                                                                                          |
| Backup               | PASS   | 200; file exists on disk; size > 0; logged in `backups`; path inside backup directory                                                                                                             |
| Year rollover        | PASS   | Old year `is_closed=1`/`is_current=0`; new year current; `year_postings` recorded; duplicate year → 400; posting into closed year → 400 with message matching `/closed/i` and **no** stock change |
| Voucher integrity    | PASS   | Every voucher asserted balanced after every business step                                                                                                                                         |

## Bugs this suite caught

These were genuine production bugs, previously undetected because the earlier
QA runs never exercised these code paths:

1. **F-01 — Issue voucher always failed.** `stock_ledger` INSERT had 11 values for
   10 columns (`11 values for 10 columns`). Severity: **High** (feature 100%
   broken). FIXED.
2. **F-02 — Customer return always failed.** `stock_ledger` INSERT had 14 values
   for 13 columns (`14 values for 13 columns`). Severity: **High** (feature 100%
   broken). FIXED.
3. **F-03 — Trial balance side inversion.** Positive natural balances were always
   placed in the debit column, so Cash (asset, credit balance) and Accounts
   Payable (liability, credit balance) rendered on the wrong side and the report
   could never balance. Severity: **High** (financial reporting). FIXED.
4. **F-04 — Party ledger double counting.** Documents and account ledger were
   summed together for mapped parties. Severity: **High** (overstated balances).
   FIXED.
5. **F-05 — Purchase line naming ReferenceError.** `particular` used outside the
   scope of the `.filter()` callback in `app.purchase.tsx`. Severity: Medium.
   FIXED.

## New coverage added in this pass

| Area                        | Result | Evidence                                                                                                                                                                                                                       |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backup → restore round-trip | PASS   | Real backup via `db.backup()`, independent `integrity_check`, restored copy opened read-only: full schema, representative rows, `integrity_check: ok`, 0 FK violations, live DB untouched                                      |
| Restore safety              | PASS   | `restoreToNewFile` never targets the live DB; `restoreInPlace` rejects `{}`, `"yes"`, `"RESTORE"`; only exact `RESTORE-OVER-LIVE` proceeds and retains a safety copy                                                           |
| Corrupt backup rejected     | PASS   | Non-SQLite bytes → throws; **no** output file produced                                                                                                                                                                         |
| Path traversal              | PASS   | `../../../etc/passwd` and `..%2F..%2Fpaint-erp.db` rejected; unknown backup rejected                                                                                                                                           |
| Back-post idempotency       | PASS   | Dry-run posts 0; run posts 3; second run posts 0 and reports 3 already-posted                                                                                                                                                  |
| Back-post balanced          | PASS   | Ledger totals equal; every voucher balanced individually; `trialBalance().balanced === true`                                                                                                                                   |
| Back-post auditable         | PASS   | Each posted voucher has a `migration_log` row written in the same transaction                                                                                                                                                  |
| Back-post reversible        | PASS   | `revertBackpost()` removes all 3 vouchers and their ledger rows; business rows preserved                                                                                                                                       |
| COGS not fabricated         | PASS   | Account 5300 has **0** ledger rows for a legacy sale; the omission is reported in `notes`                                                                                                                                      |
| Unreconstructable docs      | PASS   | Line total ≠ document total, valued purchase with no lines, and a sale with no customer are all refused and listed                                                                                                             |
| Zero-value docs             | PASS   | Skipped as `zero_value`; no empty voucher created                                                                                                                                                                              |
| Duplicate posting           | PASS   | A second voucher for the same `(ref_type, ref_id)` throws `UNIQUE constraint failed`; NULL-ref journals may still repeat                                                                                                       |
| Voucher numbering           | PASS   | 500 numbers, all unique and contiguous (`PUR-000001`…); a legacy timestamp-style number is never reissued                                                                                                                      |
| Session security            | PASS   | 64-hex tokens; tokens unique; revoked token rejected; expired session rejected **and its row deleted**; unknown/null rejected                                                                                                  |
| Password hashing            | PASS   | Fresh salt per hash; correct/wrong passwords distinguished; malformed stored hash throws rather than passing                                                                                                                   |
| Role gate                   | PASS   | `user`/`viewer` → 403, `admin` → 200, missing user → 401                                                                                                                                                                       |
| Scenario A (happy path)     | PASS   | Purchase → production → sale → customer return; stock reconciles exactly; every voucher balanced; each document has exactly one voucher; closing balances asserted (raw 0, finished 800, COGS 200, AR 320, AP −600, cash −400) |
| Scenario B (failure paths)  | PASS   | Closed-year posting refused; unbalanced voucher rejected with nothing persisted; mid-transaction failure leaves no orphan rows; zero-value back-post skipped                                                                   |
| Scenario X (security)       | PASS   | Session, password, role, duplicate-posting and numbering checks as above                                                                                                                                                       |

## Rehearsal against a copy of the live database

Executed on a WAL-safe copy (`db.backup()`), never on `server/data/paint-erp.db`:

| Measure               | Result                                  |
| --------------------- | --------------------------------------- |
| Documents back-posted | 14                                      |
| Failures              | 0                                       |
| Trial balance         | balanced — debits 3,660 = credits 3,660 |
| `integrity_check`     | `ok`                                    |
| Live DB / WAL mtime   | unchanged before and after              |

## Data-integrity findings on the live database (reported, not silently "fixed")

- **Stock does not reconcile.** `reconcileStock()` reports `ok: false` with 19
  issues. Raw stock totals **990** while the raw `stock_ledger` nets to **−360**
  (purchases in 300, production out 640, returns out 20). **10 of 18** active raw
  items have no ledger row at all — their quantities were set directly, so the
  ledger never supported them. Finished stock is 660 vs a ledger net of 650.
  The reconciliation endpoint is behaving correctly; the underlying data is not
  ledger-backed.
- **Legacy COGS is unreconstructible.** `sale_lines` and `return_lines` have no
  cost column and the ledger `rate` on sale/return rows is the sale rate. Two
  returns also have no line rows at all.

## Build checks

| Check                  | Result                                               |
| ---------------------- | ---------------------------------------------------- |
| `npm test` (server)    | **PASS** — 52/52                                     |
| `npx tsc --noEmit`     | **PASS** — exit 0                                    |
| `npx eslint .`         | **PASS** — exit 0, 0 errors, 8 pre-existing warnings |
| `npm run build`        | **PASS** — exit 0                                    |
| Live database modified | **NO** — main file and WAL mtimes unchanged          |

## Not executed

| Item                              | Status          | Reason                                      |
| --------------------------------- | --------------- | ------------------------------------------- |
| Browser click-through / visual QA | BLOCKED         | Playwright Chromium not installed           |
| Responsive layout at ~768px       | BLOCKED         | Requires a browser                          |
| Low-stock visual indicator        | BLOCKED         | Requires a browser                          |
| Receipt / payment vouchers        | NOT IMPLEMENTED | No such endpoints exist anywhere in the API |
| Stock adjustment                  | NOT IMPLEMENTED | No such endpoint exists                     |
| Restore of the live database      | NOT RUN         | Rehearsed only against copies, by design    |
| Back-post of the live database    | NOT RUN         | Rehearsed only against copies, by design    |
| Electron packaging / launch       | BLOCKED         | Dependency and configuration unavailable    |
| Load/soak testing                 | NOT RUN         | Out of scope for this pass                  |

## Confidence

The core financial and stock invariants — atomicity, no negative stock,
stock-ledger reconciliation, balanced double entry, and role enforcement — are
now covered by executable tests rather than manual inspection. Confidence in
those invariants is high. Confidence in UI behaviour remains low until a browser
pass is run.
