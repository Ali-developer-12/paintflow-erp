# Final Risk Report

## Fixed

Highest-risk issues addressed in this pass:

1. **Two features were 100% broken at runtime (High).** Issue vouchers and customer
   returns both failed on every call due to `stock_ledger` INSERT column/value
   count mismatches. The prior reports claimed a passing "live business flow"
   including customer return; that claim was wrong, and the code proves it — the
   SQL could not execute. Both are fixed and now covered by tests.
2. **Trial balance could never balance (High).** Debit/credit sides were assigned
   without regard to account nature, so the core financial statement was wrong
   even though the underlying ledger was correct.
3. **Party balances were overstated (High).** Documents plus account ledger were
   summed together for mapped parties, double counting the same money.
4. **Backup was not WAL-safe (High).** It used `fs.readFileSync` on a WAL-mode
   database, which can capture an inconsistent state, and `npm run backup`
   referenced a `src/backup.js` that did not exist. Both fixed; every snapshot is
   now taken with SQLite's online backup API and verified with `integrity_check`
   before being reported as successful.
5. **No double-entry accounting existed (High).** Financial transactions moved
   stock but never wrote `account_vouchers`/`account_ledger`. Vouchers are now
   posted for purchase, production, sale and both return types, and posting is
   refused unless debits equal credits.
6. **Year posting was fictitious (High).** It inserted a single row and nothing
   else. It now closes the prior year, carries balances forward, records
   `year_postings`, and blocks writes into closed years.
7. **Supplier shim bypassed master data (Medium).** Purchases auto-created
   suppliers from free text. Removed from both API and UI.
8. **Authorization gaps (Medium).** `POST /api/suppliers` had no role check;
   `created_by` was not recorded for purchases or productions. Both fixed.
9. **Privilege/secret handling (Low, previously addressed).** No hard-coded
   default credential remains; the admin bootstrap is environment-driven and
   `POST /api/auth/change-password` is now available.

## Verified

- **52/52** automated tests pass (was 32/32), including the full HTTP business
  flow plus restore, back-post, numbering, duplicate-posting, auth and a full
  A/B/X acceptance scenario.
- `tsc` clean (exit 0), `eslint` 0 errors, production build exit 0.
- Stock ledger reconciles with master stock in the A/B/X scenario.
- Trial balance balances; every voucher asserted balanced individually.
- Backup produced a real 266 KB file with `Integrity: ok`.
- **Restore is now implemented and proven on an isolated database.** Copy-only
  HTTP restore; in-place restore requires the exact `RESTORE-OVER-LIVE` token and
  retains a safety copy. Live overwrite is not reachable over HTTP.
- Back-post rehearsed on a WAL-safe copy of the live database: 14 posted, 0 failed,
  trial balance balanced (3,660 = 3,660), `integrity_check: ok`.
- Role enforcement, session expiry/revocation, password salting, and duplicate
  posting are all covered by executable tests.

## Open risks (found this pass, not fixed)

1. **The live stock data is not ledger-backed (High).** Raw stock totals 990 while
   the raw `stock_ledger` nets to −360; 10 of 18 active raw items have no ledger
   row. `reconcileStock()` correctly reports `ok: false` (19 issues). Nothing was
   silently adjusted — this needs a decision from the business owner: either
   write an opening-balance ledger entry per item, or accept the stock figures as
   unmanaged.
2. **Legacy gross profit is not audit-grade (High).** Legacy sales and customer
   returns were back-posted on the revenue side only, because no historical unit
   cost exists in the data. COGS is therefore understated for those periods. The
   omission is recorded per voucher and surfaced by the report, rather than
   fabricated. Closing this requires either a cost snapshot on future lines or a
   manual, approved cost basis for the legacy period.
3. **UI layer remains unverified (High).** No browser testing was possible;
   Playwright is not installed.
4. **Concurrency and soak untested (Medium).** The duplicate-posting index closes
   the ledger race at the storage layer, but multi-user throughput, long-running
   behaviour and large datasets were not exercised.

## Not verified

- Browser/UI interaction, responsive layout, visual states.
- Multi-user concurrency, soak, and large-dataset performance.
- Restore and back-post of the **live** database — both were rehearsed only
  against copies, by design.

## Blocked

- **Full production-readiness certification** remains blocked on UI regression
  testing and Electron packaging.
- **Audit-grade historical reporting** remains blocked until legacy COGS is
  resolved with an approved cost basis.

## Deferred

- Electron desktop packaging (Phase 8) — dependency/configuration unavailable.
- Receipt/payment vouchers and stock adjustments. These are **not implemented**:
  a full API search found no `/api/receipts`, `/api/payments` or
  `/api/adjustments` route and no `receipt`/`payment` voucher type usage. They
  remain a genuine functional gap, not merely untested.
- Richer master-data edit screens.

## Risk summary

The dominant risk found in this pass was **silent fabrication**: the legacy
back-post would have priced historical cost of goods sold using _today's_ cost
price, producing a confidently wrong gross profit. It now refuses to do so and
reports what it could not reconstruct. The second-order risk was **false
confidence from a broken verification method**: the live database is almost
entirely WAL, and a naive file copy of it yields an empty database — a rehearsal
using that method silently "passed" with zero documents before the copy method
was corrected to SQLite's online backup API.

Backend invariants that matter most for data integrity — atomic writes, no
partial business rows, balanced double entry, exactly-once ledger posting,
collision-free numbering, reversible and audited migrations, and server-side
authorization — are now enforced in code and covered by 52 executable tests.
Residual risk is concentrated in the **unverified UI layer**, **live stock data
that the ledger does not support**, and **legacy periods whose cost basis does
not exist in the data**.
