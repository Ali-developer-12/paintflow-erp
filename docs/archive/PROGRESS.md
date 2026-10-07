# Current Progress — 2026-10-04 (gap-closure pass)

## This pass in one paragraph

Restore is now implemented and proven; legacy accounting can be back-posted
reversibly with an audit trail; document numbering is collision-free; duplicate
ledger posting is impossible at the storage layer; and a full A/B/X acceptance
scenario was added. Test count went from **32 → 52**, all passing. No restore or
back-post was executed against the live database — both were rehearsed only
against copies.

## Real defects found and fixed in this pass

1. **Timestamp voucher numbers could collide.** Replaced `Date.now()` numbering
   with a `voucher_sequences` counter consumed **inside the caller's
   transaction** (`server/src/vouchers.js`). A number is now allocated atomically
   with the document it belongs to, and legacy timestamp-style numbers
   (`PUR-1791091812901`) can never be reissued.
2. **Duplicate ledger postings were possible under concurrency (High).** An
   application-level "already posted?" check is advisory. Added a partial unique
   index `idx_vouchers_ref_unique ON account_vouchers(ref_type, ref_id)` so a
   second posting of the same document is rejected by SQLite itself.
3. **Back-posting fabricated cost of goods sold (High).** It joined
   `item_particulars.cost_price` — today's cost — to price legacy COGS. That
   silently invented a gross profit. Legacy COGS is genuinely unreconstructible
   (no cost column on `sale_lines`/`return_lines`; the ledger `rate` on sale rows
   is the _sale_ rate), so the back-post now posts the revenue side only and
   **reports the omission**.
4. **Back-posting produced unbalanced purchase vouchers (High).** Unclassified
   purchase lines produced a payable credit with no inventory debit. Such value
   now posts to the parent Inventory control account and is flagged. Documents
   that cannot be reconstructed (line total ≠ document total, valued document
   with no lines, missing party) are refused and listed.
5. **Audit rows could disagree with the ledger.** `migration_log` is now written
   inside the same transaction as the voucher.
6. **`verifyDatabaseFile()` crashed on non-SQLite input** — the whole open and
   check is now guarded.

## Critical operational fact discovered

`server/data/paint-erp.db` is only **4,096 bytes**; its data lives almost entirely
in a **2.6 MB `paint-erp.db-wal`**. Copying the main file alone yields an
essentially empty database — a rehearsal using `fs.copyFileSync` silently
"passed" with **0 documents** before the method was corrected to SQLite's online
backup API. `createBackup()` already uses that API, so backups are correct; any
future manual copy of this database would lose almost all data.

## Verified (exact evidence)

- `npm test` in `server/`: **52/52 passing**
- `npx tsc --noEmit`: exit 0
- `npx eslint .`: exit 0 — **0 errors**, 8 pre-existing warnings
- `npm run build`: exit 0
- Back-post rehearsal on a WAL-safe copy of the live DB: **14 posted, 0 failed**,
  trial balance balanced (3,660 = 3,660), `integrity_check: ok`
- Live `paint-erp.db` and `paint-erp.db-wal` mtimes **unchanged** before/after

## Remaining known gaps

- **Live stock data is not ledger-backed (High).** Raw stock totals 990 while the
  raw ledger nets to −360; 10 of 18 active raw items have no ledger row.
  `reconcileStock()` correctly reports `ok: false`. Nothing was silently adjusted —
  this needs a business decision (opening-balance entries vs. accept as unmanaged).
- **Legacy gross profit is not audit-grade (High).** See defect 3.
- **Receipt/payment vouchers and stock adjustments do not exist.** A full API
  search found no such routes or voucher types. This is a functional gap, not
  merely untested.
- Browser QA is **BLOCKED** — Playwright is not installed.
- Electron packaging is **BLOCKED/DEFERRED** — dependency and configuration
  unavailable.
- `npm run backup` integration test hardcodes default port 3999; override with
  `ERP_TEST_PORT` if busy.
- Master-data UIs are largely read/create/delete; richer edit screens are partial.

## Phase status matrix (evidence-based)

| Phase                        | Status                                       | Evidence                                                                                    |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1 — Foundation               | **COMPLETE**                                 | Auth, roles, env-based admin bootstrap, password change; session expiry/revocation tested   |
| 2 — Items & Formula/BOM      | **COMPLETE**                                 | Server-computed totals, duplicate-material and positive-quantity validation                 |
| 3 — Setup / Masters          | **COMPLETE**                                 | CRUD + real, atomic year posting; closed-year writes refused (tested)                       |
| 4 — Purchase & Production    | **COMPLETE**                                 | Stock + double-entry posting; over-consumption rolls back atomically                        |
| 5 — Sales, Issue, Returns    | **COMPLETE**                                 | Counter sale, issue voucher (stock-only by design), both return types posted                |
| 6 — Stock & Accounts         | **COMPLETE (code)** / **DATA GAP (live DB)** | Reconciliation + trial balance implemented and tested; live stock data is not ledger-backed |
| 7 — Reports & Backup/Restore | **COMPLETE**                                 | Reports; WAL-safe backup; verified copy-only restore; token-protected in-place restore      |
| 8 — Polish / Electron        | **PARTIAL — BLOCKED**                        | UI polish done; Electron packaging cannot be built or launched                              |

Checklist:

- [x] Phase 1: Foundation (auth, roles, env-based admin, password change)
- [x] Phase 2: Items & Formula/BOM
- [x] Phase 3: Setup / Masters + real year posting
- [x] Phase 4: Purchase & Production (hardened, regression-tested)
- [x] Phase 5: Sales, Issue Voucher, Returns (stock+account posting)
- [x] Phase 6: Stock, reconciliation, double-entry accounts, trial balance
- [x] Phase 7: Reports & WAL-safe backup + verified restore
- [ ] Phase 8: Desktop/Electron packaging (BLOCKED — dependency unavailable)

## Previous pass (superseded)

The Phase 3/5/6/7 hardening pass — issue-voucher and customer-return
`stock_ledger` column/value mismatches, trial-balance side inversion, party-ledger
double counting, `app.purchase.tsx` scope error, WAL-safe backup, real year
posting — was completed and is retained in `FINAL_IMPLEMENTATION_REPORT.md`. Its
"32/32" figures and its "no restore endpoint exists" note are superseded by the
52/52 result and the restore implementation above.

# Phase 1 Progress

## Progress — [Your Name]

Phase 2 is complete for Items + Formula/BOM in scope. The work completed in the route shell, the items route, and server endpoints reuses the existing tables `items`, `item_particulars`, `formulas`, `formula_lines`, and `factory_items`; no new tables were invented and no schema migration was required. The only deviation observed during verification was that the formula line write depends on an existing `factory_items` parent row (`factory_item_id` foreign key), so the example `Solvent` factory row was seeded in the existing database to satisfy the line insert path. Phase 4 has not started yet.

Formula/BOM route repair note: the sidebar route target `/app/formula` previously pointed to a real URL without a matching page file, which produced the visible "Not Found" state. A shared Formula/BOM modal component was extracted from the Items Master page and a new route page in `src/routes/app.formula.tsx` now lists formula-backed particulars, supports opening the same modal editor, and includes a direct Items Master jump path for particulars without a formula. The Express API in `server/src/index.js` now includes a `/api/formulas` list endpoint and `/api/formulas/unassigned` discovery endpoint so the standalone page can render from the existing database tables rather than from a synthetic placeholder.

Documentation note: the Formula/BOM material dropdown is intentionally limited to existing `factory_items` rows. Those rows are populated later in the Phase 3 data/master setup work, so the dropdown dependency on `factory_items` should be read as a known sequencing dependency rather than a bug in the modal or route implementation.

Phase 1 is complete for the requested handoff. The backend in `server/` provides an Express API backed by a SQLite database, and the frontend uses the existing design system and shared app shell. All sidebar placeholder routes relevant to Phase 1 now render safely inside the current app layout without crashing.

## Progress — [Your Name] (Phases 3, 5, 7)

This section is intentionally scoped only to Phase 3 (Setup / Masters), Phase 5 (Sales & Vouchers), and Phase 7 (Reports & Backup). No files or work related to the teammate's assigned phases were changed, and no edits were made outside this scope.

- Phase 3: Setup / Masters — planned and scoped to employees, customers, suppliers, transporters, account chart, factory items, and new-year posting screens and supporting CRUD APIs only.
- Phase 5: Sales & Vouchers — planned and scoped to counter sale, issue voucher, and returns screens and their supporting transaction logic only.
- Phase 7: Reports & Backup — planned and scoped to sale, purchase, general report views and database export/backup actions only.

## Architecture Summary

- Backend: Express API and local SQLite database in `server/`
- Database: SQLite schema and init scripts in `server/src/schema.sql` and `server/src/init-db.js`
- Frontend: Vite + TanStack Router + React UI shell using the shared design system in `src/components/ui/`

## Phase 4 Progress

Phase 4 is complete for the requested Purchase + Production scope. The UI now includes a purchase voucher screen that accepts raw materials or finished items, calculates item totals, writes purchase header/line records, and updates stock plus stock ledger rows. The production screen relies on a real Formula/BOM definition, calculates required raw materials by batch multiplier, validates stock before reducing inventory, and records ledger entries for each input consumed and each finished good produced.

Production calculation logic: the server-side helper in `server/src/phase4-logic.js` multiplies each formula line by the batch multiplier (`batchQty / batchSize`) and adds the resulting material quantities and costs. This keeps the logic isolated from route handlers, easy to read, and ready for unit testing later.

Temporary supplier shim: the purchase screen includes a simple inline "add supplier name" fallback when the `suppliers` table is empty because Phase 3 supplier CRUD is not yet implemented. This is intentional and should be removed once the real supplier management UI is added in Phase 3.

Phase 6 is complete for Stock + Accounts. The Stock screen reads current balances from the existing `factory_items` / `item_particulars` records and movement history from the shared `stock_ledger` table written by Purchase and Production. Ledger rows use the persisted `balance_after` value, with item and date-range filters applied server-side. The Accounts screen reads the existing `accounts` chart and provides supplier/customer running-balance ledgers. Supplier purchases are shown directly (Phase 4 does not post account vouchers), and mapped `account_ledger` entries are included when present.

Phase 3 remains the dependency for full customer/supplier master data, so empty party states are intentional. Phase 5 sale-side movements and customer activity will appear automatically once that phase writes the existing sales/account tables. Phase 8 is next and final for this branch.

## Phase 8 Progress

Phase 8 polish is complete for the Phase 2, 4, and 6 surfaces; Electron desktop packaging is deferred. The shared API client now converts non-JSON server failures into readable messages. Items and Formula/BOM now surface load, save, delete, and inline-edit failures instead of leaving rejected requests unhandled. Stock keeps a visible initial loading message and reports readable summary/ledger failures. Existing empty states and responsive table overflow behavior were preserved. TypeScript diagnostics are clean; npm lint/build could not be executed because Node/npm are not available on the current shell PATH.

## Phase Checklist

Superseded by the evidence-based matrix at the top of this file. Historical
state as recorded on 2026-09-29:

- [x] Phase 1: Foundation
- [ ] Phase 2: Items & Formula/BOM (Partial)
- [ ] Phase 3: Setup / Masters (Partial: update UI and complete year posting remain)
- [x] Phase 4: Purchase & Production
- [ ] Phase 5: Sales & Vouchers (Partial: supplier-return inventory/account posting remain)
- [ ] Phase 6: Stock & Accounts (Partial: returns are absent from stock ledger; transaction posting is incomplete)
- [ ] Phase 7: Reports & Backup (Partial: general report filters and WAL-safe backup remain)
- [ ] Phase 8: Polish and Electron packaging (Partial: Electron packaging is deferred)

## Phase Audit — 2026-09-29 (historical)

The dashboard previously marked only Phase 1 complete and rendered every other module as Planned, regardless of implementation. Current source review finds Phases 1 and 4 complete; Phases 2, 3, 5, 6, 7, and 8 partial. The checked-in phase plan and commit history define only eight phases; no Phase 9 requirements or implementation were found.
