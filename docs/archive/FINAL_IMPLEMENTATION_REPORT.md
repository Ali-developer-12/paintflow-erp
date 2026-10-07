# Final Implementation Report — gap-closure pass

## Scope of this pass

Prove safe restore, back-post legacy accounting, reconcile stock/accounts,
harden numbering and security, execute the full test/build cycle, and report the
real phase status. No restore or back-post was executed against the live database.

## Fixed

Real, reproducible defects found by auditing code and data in this pass:

1. **Timestamp voucher numbers could collide.** Document numbers were
   `Date.now()`-based, so two operators saving in the same millisecond produced the
   same `PUR-`/`SL-`/`RT-` number. `server/src/vouchers.js` now draws numbers from
   a `voucher_sequences` counter **inside the caller's transaction**, so a number
   is consumed atomically with the document it belongs to. `nextUniqueVoucherNo()`
   additionally refuses to reissue a number that already exists, so legacy
   timestamp-style rows can never be shadowed. Applied to purchase, production,
   sale, issue, return and year-opening.
2. **Duplicate ledger postings were possible under concurrency (High).** The
   "already posted?" check in application code is advisory — two concurrent
   requests can both pass it. Added a **partial unique index**
   `idx_vouchers_ref_unique ON account_vouchers(ref_type, ref_id) WHERE ref_type IS
NOT NULL AND ref_id IS NOT NULL`, so a duplicate posting is impossible at the
   storage layer. NULL-ref journal vouchers are excluded deliberately (SQLite
   treats NULLs as distinct, so such an index would enforce nothing while
   appearing to).
3. **Back-posting fabricated cost of goods sold (High).** The legacy back-post
   joined `item_particulars.cost_price` to price legacy COGS. Today's cost price
   is **not** the historical cost, so this silently invented a gross profit.
   `sale_lines`/`return_lines` store no cost snapshot and the `stock_ledger.rate`
   written by the sale/return endpoints is the _sale_ rate, not unit cost — so the
   figure is genuinely unreconstructible. The back-post now posts the revenue side
   only and **reports the omission** instead of inventing COGS.
4. **Back-posting produced unbalanced purchase vouchers (High).** Purchase lines
   referencing neither a raw nor a finished item produced a payable credit with no
   matching inventory debit, and `assertBalanced` rejected the voucher. Such value
   now posts to the parent **Inventory control account** and is reported.
   Unreconstructable documents (line total ≠ document total, valued document with
   no lines, missing party) are refused and listed rather than posted.
5. **Migration audit rows could disagree with the ledger.** The `migration_log`
   insert ran _after_ the posting transaction committed. It now runs **inside the
   same transaction**, so a voucher can never exist without its audit row.
6. **`verifyDatabaseFile()` crashed on non-SQLite files.** The `new Database()`
   constructor threw before the guarded `PRAGMA`. The whole open-and-check is now
   inside the `try`.

## New capability

- `server/src/vouchers.js` — transactional, collision-free document numbering.
- `server/src/backpost.js` — legacy accounting back-post with dry-run,
  existing-voucher detection, per-document transactions, honest-skip reporting,
  audit logging, and `revertBackpost()`.
- `server/src/restore.js` — verified backups, **copy-only** HTTP restore, and a
  protected in-place CLI restore requiring the exact token `RESTORE-OVER-LIVE`
  plus a retained safety copy. Live overwrite is not exposed over HTTP.
- `voucher_sequences` and `migration_log` tables.
- Admin endpoints: `/api/accounting/backpost-report`,
  `/api/accounting/backpost`, `/api/accounting/backpost/revert`,
  `/api/accounting/migration-log`, `/api/backup/restore`, `/api/backup/verify`.

## Verified (exact evidence)

- `npm test` in `server/`: **52/52 passing** (was 32/32).
- `npx tsc --noEmit`: exit 0, clean.
- `npx eslint .`: exit 0, **0 errors**, 8 pre-existing warnings.
- `npm run build`: exit 0 (`✓ built`; Nitro SSR output in `.output/`).
- **Isolated back-post rehearsal against a WAL-safe copy of the live database:**
  14 documents posted, 0 failed, trial balance balanced (3,660 = 3,660),
  `integrity_check: ok`, COGS correctly not fabricated. Live `paint-erp.db` and
  `paint-erp.db-wal` mtimes were **unchanged** before and after.

## A critical operational fact about the live database

`server/data/paint-erp.db` is only **4,096 bytes**; its data lives almost entirely
in a **2.6 MB `paint-erp.db-wal`**. Copying the main file alone yields an
essentially empty database — this was observed directly during this pass, when a
naive `fs.copyFileSync` "snapshot" reported 0 documents.

`createBackup()` already avoids this by using SQLite's online backup API
(`db.backup()`), so backups are correct. Any manual copy of this database, or any
future tooling that copies the file rather than using the backup API, will
silently lose almost all data.

## Not verified

- Browser/UI interaction: Playwright is not installed. BLOCKED.
- Multi-user concurrency, soak, and large-dataset performance.
- The live database has **not** been restored or back-posted. Both were rehearsed
  only against copies.

## Blocked

- Electron desktop packaging: dependency/configuration unavailable.
- Audit-grade gross profit for legacy sales/returns: the historical cost snapshot
  does not exist in the data, so it cannot be derived without being invented.

## Deferred

- Electron desktop packaging (Phase 8).
- Richer edit screens for master data.
- Receipt/payment vouchers and stock adjustments (see risk report — these
  endpoints **do not exist**).

## Overall status

All eight phases have working, tested backend behaviour for the core financial
and stock invariants, now with 52 passing tests including restore, back-post,
numbering, duplicate-posting, auth and a full A/B/X acceptance scenario. Because
UI-level testing and Electron packaging could not be executed here, this is **not**
a claim of full production readiness.
