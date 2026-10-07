```text
AUDIT DATE                : 2026-10-04
PROJECT                   : PaintFlow ERP (paintflow-erp)
AUDIT TYPE                : Final deep audit + Electron / Windows readiness analysis
                            (READ-ONLY - no project file was modified)
CURRENT BUILD STATUS      : PASS (verified independently) - npm run build exit 0
CURRENT TEST STATUS       : PASS (verified independently) - 52/52 tests, 0 fail
CURRENT ELECTRON STATUS   : NONE - no Electron code, dependency, or packaging exists
WINDOWS 10 STATUS         : LIKELY (not verified - nothing built or run)
WINDOWS 7 STATUS          : NOT SUPPORTED on modern Electron; POSSIBLE WITH OLD
                            STACK (unpatched, insecure) - NOT RECOMMENDED
OVERALL VERDICT           : NOT READY
```

---

# FINAL PROJECT AUDIT AND ELECTRON READINESS REPORT

## 0. How this audit was performed (and its honesty constraints)

Every statement below is classified as one of:

| Label            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| **VERIFIED**     | I read the source, schema, live database, or re-ran a command. |
| **INFERRED**     | Strongly implied by verified evidence, not directly executed.  |
| **NOT VERIFIED** | No evidence available in this environment.                     |
| **BLOCKED**      | Cannot be performed here; tooling unavailable.                 |
| **MISSING**      | Confirmed absent from source, schema, and routes.              |

I did **not** modify the project. The only file created is this report. Two
temporary read-only inspection scripts were written under `server/` and deleted.
All database inspection used `readonly: true`; `paint-erp.db` and
`paint-erp.db-wal` mtimes are unchanged.

Where a previous report conflicts with source code, **I trust the source code**
and document the conflict.

---

## 1. Executive summary

PaintFlow ERP is a **partially complete but genuinely working vertical slice**.
The accounting and stock engines are better than previously claimed in one
respect (server-side authorization is enforced on all 80 routes), but materially
worse than claimed in two others:

1. **The live database contains no accounting at all.** `account_vouchers` and
   `account_ledger` both contain **0 rows**. All 16 business documents (4
   purchases, 4 productions, 3 sales, 5 returns) are unposted. No financial
   statement produced from this database is meaningful.
2. **The previous pass's schema changes were never applied to the live
   database.** `voucher_sequences`, `migration_log`, and the unique index
   `idx_vouchers_ref_unique` **do not exist** in `paint-erp.db`. Four required
   accounts (1410 Raw Material, 1420 Finished Goods, 4100 Sales Returns, 5300
   COGS) are **missing** from the live `accounts` table. The live DB predates the
   current code. Next boot will reconcile it, but the "duplicate posting
   protection" and "transactional numbering" claims are **not currently true of
   the shipped data file**.

Regarding the primary question — **is this ready to become a reliable Windows
desktop application with Electron?** — the answer is **no**, and the gap is not
mainly about Electron. Electron is the _smallest_ part of the problem:

- **Zero** Electron code, dependency, main process, preload, IPC, BrowserWindow,
  installer config, or app icon beyond a favicon.
- The production build emits a **Cloudflare Workers** bundle
  (`.output/server/wrangler.json`, worker `index.mjs` with no HTTP listener).
  It cannot be served by Node or loaded by Electron without changing the Nitro
  deployment preset.

---

## 2. Review of existing documentation (and conflicts with source)

I read `README.md`, `PROGRESS.md`, `FINAL_IMPLEMENTATION_REPORT.md`,
`FINAL_QA_REPORT.md`, `FINAL_RISK_REPORT.md`, `QA_REPORT.md`, `AGENTS.md`, and
`src/routes/README.md`.

### 2.1 What `README.md` actually is

`README.md` is **not operational documentation**. It is the verbatim original
Lovable generation prompt ("Paste this as your project prompt / first message in
Lovable"). It is valuable because it is the **authoritative specification**:

- _"I need this to run offline with a local SQLite... not a cloud database"_ and
  _"No cloud database, no Supabase, no Firebase, no external hosting dependency."_
- _"Desktop packaging (later phase): Electron, same codebase"_ - under Phase 8.
- Phase 8 is defined as: _"Electron wrapper for a Windows desktop build"_.

**Conflict:** the current build target is **Cloudflare Workers** (a cloud
deployment target), in tension with the stated offline/local requirement
(see sections 4 and 20).

### 2.2 Conflicts between previous reports and source code

| #    | Prior claim                                             | Source reality                                                                                                                                 | Verdict                   |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| C-1  | 52/52 passing, tsc clean, eslint 0 errors, build exit 0 | Re-ran all four. Confirmed.                                                                                                                    | **ACCURATE**              |
| C-2  | Live db + WAL unchanged                                 | Confirmed - mtimes unchanged.                                                                                                                  | **ACCURATE**              |
| C-3  | Duplicate ledger posting protection added               | Index exists in `schema.sql` but is **absent from the live DB**.                                                                               | **MISLEADING**            |
| C-4  | Transactional voucher sequences added                   | `voucher_sequences` **does not exist in the live DB**.                                                                                         | **MISLEADING**            |
| C-5  | Timestamp numbering replaced                            | True for transaction documents; **7 master-data code paths still use `Date.now()`** (`EMP-`, `CUST-`, `SUP-`, `TR-`, `ACC-`, `MAT-`, `ITEM-`). | **PARTIALLY ACCURATE**    |
| C-6  | Stock reconciliation reports a serious mismatch         | Confirmed; I established the **root cause** (section 8).                                                                                       | **ACCURATE, understated** |
| C-7  | Receipts/payments/stock adjustments do not exist        | Confirmed by exhaustive route search.                                                                                                          | **ACCURATE**              |
| C-8  | Back-posting implemented with limitations               | Accurate, and quantified: **0 of 16 documents posted, 0 account rows**.                                                                        | **ACCURATE, understated** |
| C-9  | Reports claim all phases complete except Electron       | Phases 6/7/8 materially incomplete (section 31).                                                                                               | **OVERSTATED**            |
| C-10 | Reports do not mention user management                  | There is **no user API or UI at all**.                                                                                                         | **OMISSION**              |

**Rule applied per the brief: where a report conflicts with source, the source
wins.**

### 2.3 Documentation hygiene

Six overlapping Markdown reports sit at the repo root (`PROGRESS.md`,
`QA_REPORT.md`, and three `FINAL_*` files), ~51 KB total, several containing
superseded numbers (32/32, "no restore endpoint exists"). There is **no
operational runbook** (how to install, initialise, back up, restore, diagnose).
For a product destined for a factory PC, that is a gap.

---

## 3. Project inventory

### 3.2 Backend (verified)

| Module                   | Size             | Responsibility                                                                             |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------ |
| `src/index.js`           | **81,709 B**     | All **80 routes**, validation, middleware, lifecycle. Monolithic.                          |
| `src/accounting.js`      | 8,293            | Chart of accounts, party resolution, voucher posting, `reconcileStock()`, `trialBalance()` |
| `src/accounting-core.js` | 1,992            | Pure double-entry helpers                                                                  |
| `src/backpost.js`        | 16,670           | Legacy accounting back-post / revert                                                       |
| `src/years.js`           | 7,224            | Financial-year rollover, `assertPostingAllowed()`                                          |
| `src/restore.js`         | 5,314            | Backup resolution, copy-restore, protected in-place restore                                |
| `src/backup.js`          | 3,143            | WAL-safe backup, integrity verification                                                    |
| `src/vouchers.js`        | 2,279            | Transactional sequence numbering                                                           |
| `src/auth.js`            | 3,659            | scrypt hashing, sessions, `requireAuth`, `requireRole`                                     |
| `src/db.js`              | 669              | Connection + `applySchema()`                                                               |
| `src/schema.sql`         | 17,360           | 31 tables, 14 indexes, no triggers, no views                                               |
| `src/init-db.js`         | 1,511            | Bootstrap                                                                                  |
| `src/phase4-logic.js`    | 1,181            | Production requirement maths                                                               |
| `src/phase4-seed.mjs`    | 3,157            | **Dead dev script - hardcoded foreign path**                                               |
| `audit.mjs`              | 2,399            | Read-only inspector, not in any npm script                                                 |
| Tests                    | 5 files, 42.6 KB | 52 tests                                                                                   |

**Structural concern:** `index.js` at 81 KB with 80 routes is a maintainability
and review risk.

### 3.3 Database (verified against the live file)

- **31 tables**, **14 indexes** in schema; **12 present live**, the unique one
  **missing**.
- **0 triggers. 0 views.** All integrity is application-enforced.
- `journal_mode = wal` (set in `db.js`), `foreign_keys = ON`.
- **`busy_timeout` NOT SET** - immediate `SQLITE_BUSY` under contention.
- **`user_version = 0`** - no schema versioning or migration ladder.
- `integrity_check = ok`; `foreign_key_check` = 0 violations.

Live row counts: users 1, sessions **11**, customers 8, suppliers 9,
factory_items 18, items 11, item_particulars 11, formulas 9, formula_lines 18,
purchases 4, purchase_lines 8, productions 4, production_consumptions 8, sales 3,
sale_lines 3, returns 5, return_lines **3**, stock_ledger 25,
**account_vouchers 0, account_ledger 0**, backups 1, settings 1.
`voucher_sequences` and `migration_log`: **MISSING** (`no such table`).

### 3.4 Build / deployment (verified)

### 3.5 Dead / duplicate / obsolete file audit

Nothing was deleted. `NEEDS VERIFICATION` items must not be removed without
confirmation.

| File / Folder                                                          | Status                            | Why it exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Used by                 | Keep/Delete                                                            | Risk                                                       |
| ---------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `page.html`                                                            | **OBSOLETE**                      | Dev-server HTML snapshot with hardcoded foreign paths (`C:/Users/Arslan/paintflow-erp/...`). **Not referenced anywhere** (grep-verified). Title still "Lovable App".                                                                                                                                                                                                                                                                                                                                   | nothing                 | **Delete**                                                             | Low; confusing, leaks a foreign path                       |
| `server/src/phase4-seed.mjs`                                           | **OBSOLETE + DANGEROUS**          | Seeds test data via hardcoded foreign path `c:/Users/Arslan/.../paint-erp.db`, opened **read-write**, and `DELETE`s formula lines. Not in any npm script.                                                                                                                                                                                                                                                                                                                                              | nothing                 | **Delete**                                                             | **Med-High** - would mutate a real DB if that path existed |
| `bun.lock` + `package-lock.json`                                       | **CONFLICT**                      | Two package managers committed                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | git                     | **Pick one**                                                           | Medium - non-reproducible installs                         |
| `app.sales.tsx`                                                        | **DEAD ROUTE**                    | 16-line `<ModulePlaceholder>`; **absent from `MODULES`** so unreachable from nav; reachable only by typing the URL                                                                                                                                                                                                                                                                                                                                                                                     | nothing                 | **Delete or implement**                                                | Low                                                        |
| 41 of 45 `src/components/ui/*`                                         | **UNUSED**                        | accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, hover-card, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toggle-group, toggle, tooltip. Only `button`, `input`, `select`, `form` are imported by routes. | each other only         | **NEEDS VERIFICATION** - shadcn primitives are often kept deliberately | Low (tree-shaken)                                          |
| `src/hooks/use-mobile.tsx`                                             | Only used by unused `sidebar.tsx` | shadcn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `sidebar.tsx`           | NEEDS VERIFICATION                                                     | Low                                                        |
| `src/lib/error-capture.ts`, `error-page.ts`                            | Used                              | SSR error normalisation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `server.ts`, `start.ts` | **Keep**                                                               | -                                                          |
| `src/lib/lovable-error-reporting.ts`                                   | Used                              | Error reporting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `__root.tsx`            | NEEDS VERIFICATION (Lovable-specific)                                  | Low                                                        |
| `server/audit.mjs`                                                     | **ORPHAN SCRIPT**                 | Read-only DB inspector; not in any npm script                                                                                                                                                                                                                                                                                                                                                                                                                                                          | nothing                 | Wire into `npm run audit` or delete                                    | Low                                                        |
| `src/routes/README.md`                                                 | Template doc                      | Generic TanStack routing notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | nothing                 | NEEDS VERIFICATION                                                     | Low                                                        |
| `AGENTS.md`, `.lovable/project.json`, `components.json`, `bunfig.toml` | Tooling config                    | scaffold tooling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | tooling                 | NEEDS VERIFICATION                                                     | Low                                                        |
| `.output/`, `.wrangler/`, `.tanstack/`                                 | **GENERATED**                     | Build artifacts, gitignored but on disk                                                                                                                                                                                                                                                                                                                                                                                                                                                                | build                   | Regenerable                                                            | Low                                                        |
| 6 root Markdown reports                                                | **REDUNDANT**                     | Overlapping, partly superseded                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | humans                  | Consolidate to one runbook                                             | Low                                                        |
| `POST /api/suppliers` (index.js:574)                                   | **DUPLICATE**                     | Second supplier-create path; name-dedupes (200 on match) and **ignores phone/address/opening_balance**, unlike `POST /api/setup/suppliers`                                                                                                                                                                                                                                                                                                                                                             | purchase screen         | **Consolidate**                                                        | **Medium** - divergent behaviour                           |
| `GET /api/suppliers` (index.js:569)                                    | **DUPLICATE**                     | Same as `GET /api/setup/suppliers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | purchase screen         | Consolidate                                                            | Low                                                        |
| `GET /api/stock/particulars` vs `GET /api/particulars`                 | **DUPLICATE**                     | Identical except the first filters `i.is_active = 1`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | sale/production         | Consolidate                                                            | Low                                                        |
| `DOC_PREFIX.receipt` / `.payment` (vouchers.js:17-18)                  | **DEAD CONSTANTS**                | Prefixes for non-existent features                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | nothing                 | Keep as forward-looking or remove                                      | Low                                                        |

---

## 4. Architecture audit

### 4.1 Actual architecture (VERIFIED)

```text
 BROWSER (or future Electron renderer)
   |  TanStack Start SSR app  (React 19 + TanStack Router + Tailwind)
   |  built by Vite -> Nitro, target = Cloudflare Workers
   |
   |  fetch() to http://localhost:3001/api   (VITE_API_URL, default hardcoded)
   |  Authorization: Bearer <token from localStorage>
   v
 EXPRESS 4 API  (server/src/index.js, port 3001, binds ALL interfaces)
   |  requireAuth -> requireRole("admin") middleware
   |  better-sqlite3 (SYNCHRONOUS, single connection)
   v
 SQLITE  server/data/paint-erp.db   (WAL mode)
   |
   +-- server/data/backups/paint-erp-<timestamp>.db   (via db.backup() API)
   +-- server/data/restored/...                       (copy-only restore)
```

**The decisive architectural fact:** this is a **two-process, HTTP-coupled**
application. The UI is an SSR web app; the data lives in a separate Express
process reached over `localhost:3001`. That is a reasonable _web_ architecture,
and it is exactly what makes Electron wrapping non-trivial:

- Electron cannot simply load a file. Either the renderer loads a local URL, or
  the app is converted to a static SPA that calls the API.
- Because the Nitro output targets Cloudflare Workers, there is **no local Node
  server artifact** to point Electron at today.

---

## 5. Business workflow audit

Traced as a real operator would, from login to logout.

Legend: **Y** = present · **P** = partial · **-** = absent · **NV** = not verified

| #   | Workflow                              | UI                              | API             | DB                      | Validation                               | AuthZ                                         | Atomic                                 | Err handling | Acct posting                                    | Stock ledger            | Audit trail         | Tests   | Browser | Prod-ready                                                       |
| --- | ------------------------------------- | ------------------------------- | --------------- | ----------------------- | ---------------------------------------- | --------------------------------------------- | -------------------------------------- | ------------ | ----------------------------------------------- | ----------------------- | ------------------- | ------- | ------- | ---------------------------------------------------------------- |
| 1   | **Login**                             | Y                               | Y               | Y                       | Y                                        | n/a                                           | n/a                                    | Y            | -                                               | -                       | -                   | Y       | NV      | **Y**                                                            |
| 2   | **Company / setup**                   | P                               | P               | Y                       | -                                        | Y                                             | -                                      | P            | -                                               | -                       | -                   | -       | NV      | **P** - no company entity; `settings` has one row, no UI to edit |
| 3   | **Financial year**                    | Y                               | Y               | Y                       | Y                                        | Y (read: any; write: admin)                   | **Y** (`years.js:74`)                  | Y            | Y (carry-forward)                               | -                       | Y (`year_postings`) | Y       | NV      | **Y**                                                            |
| 4   | **Users / roles**                     | **-**                           | **-**           | P                       | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **NO - CRITICAL GAP**                                            |
| 5   | **Suppliers**                         | Y                               | Y (2 dup paths) | Y                       | Y                                        | Y (admin)                                     | P (single inserts)                     | Y            | via purchase                                    | via purchase            | -                   | Y       | NV      | **P**                                                            |
| 6   | **Customers**                         | Y                               | Y               | Y                       | Y                                        | Y (admin)                                     | P                                      | Y            | via sale                                        | via sale                | -                   | Y       | NV      | **P**                                                            |
| 7   | **Raw materials**                     | Y                               | Y               | Y                       | Y                                        | Y (admin)                                     | P                                      | Y            | via purchase                                    | via purchase            | -                   | Y       | NV      | **P**                                                            |
| 8   | **Finished products**                 | Y                               | Y               | Y                       | Y                                        | **-** (any user can create/edit/delete items) | **NO** (delete is 2-3 bare statements) | Y            | -                                               | -                       | -                   | Y       | NV      | **P**                                                            |
| 9   | **Units**                             | P                               | P               | P                       | -                                        | Y                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **P** - `unit`/`weight_unit` are free-text only, no unit master  |
| 10  | **Formula / BOM**                     | Y                               | Y               | Y                       | **Y** (strongest validation in codebase) | Y (any user)                                  | **Y** (`index.js:2136`)                | Y            | -                                               | -                       | -                   | Y       | NV      | **Y**                                                            |
| 11  | **Purchase**                          | Y (card grid, **no `<table>`**) | Y               | Y                       | Y                                        | Y (any user)                                  | **Y** (`index.js:847`)                 | Y            | **Y**                                           | **Y**                   | -                   | Y       | NV      | **P**                                                            |
| 12  | **Production**                        | Y                               | Y               | Y                       | **Y** (BOM + stock check)                | Y (any user)                                  | **Y** (`index.js:1027`)                | Y            | **Y**                                           | **Y**                   | -                   | Y       | NV      | **Y**                                                            |
| 13  | **Stock**                             | Y                               | Y               | Y                       | -                                        | Y                                             | -                                      | Y            | -                                               | **Y** (ledger)          | -                   | Y       | NV      | **P** - reconciliation fails on live data                        |
| 14  | **Counter sale**                      | Y                               | Y               | Y                       | Y (stock + paid-range checks)            | Y (any user)                                  | **Y** (`index.js:1244`)                | Y            | **Y**                                           | **Y**                   | -                   | Y       | NV      | **Y**                                                            |
| 15  | **Issue voucher**                     | Y                               | Y               | Y                       | Y                                        | Y (any user)                                  | **Y** (`index.js:1424`)                | Y            | **-** (deliberately stock-only)                 | **Y**                   | -                   | Y       | NV      | **Y** (by design)                                                |
| 16  | **Sales returns**                     | Y                               | Y               | Y                       | Y                                        | Y (any user)                                  | **Y** (`index.js:1530`)                | Y            | **Y**                                           | **Y**                   | -                   | Y       | NV      | **P** - legacy COGS unknown                                      |
| 17  | **Purchase/supplier returns**         | Y                               | Y               | Y                       | Y (no negative stock)                    | Y (any user)                                  | **Y**                                  | Y            | **Y**                                           | **Y**                   | -                   | Y       | NV      | **P**                                                            |
| 18  | **Accounts**                          | Y                               | Y               | Y                       | -                                        | Y                                             | -                                      | Y            | ledger-derived **or** document fallback         | -                       | -                   | Y       | NV      | **P**                                                            |
| 19  | **Reports**                           | Y                               | Y               | Y                       | -                                        | Y                                             | -                                      | Y            | **mixed sources (§13)**                         | -                       | -                   | Partial | NV      | **P**                                                            |
| 20  | **Backup**                            | Y (create + list only)          | Y               | Y                       | -                                        | Y (admin)                                     | -                                      | Y            | -                                               | -                       | Y (`backups`)       | Y       | NV      | **P** - no retention, no restore UI                              |
| 21  | **Logout**                            | Y                               | Y               | Y                       | -                                        | Y                                             | -                                      | -            | -                                               | -                       | -                   | Y       | NV      | **Y**                                                            |
| 22  | **Receipt / customer payment**        | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING**                                                      |
| 23  | **Payment / supplier payment**        | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING**                                                      |
| 24  | **Stock adjustment**                  | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING**                                                      |
| 25  | **Stock opening balance**             | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | **-** (no ledger entry) | -                   | -       | NV      | **MISSING** - this is the cause of §8                            |
| 26  | **Journal voucher (manual)**          | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING**                                                      |
| 27  | **Expense / income entry**            | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING**                                                      |
| 28  | **Bank transaction**                  | **-**                           | **-**           | P (account 1200 exists) | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING** (only `payment_mode: "bank"` at purchase/sale time)  |
| 29  | **Stock transfer**                    | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING**                                                      |
| 30  | **Wastage / scrap / production loss** | **-**                           | **-**           | **-**                   | -                                        | -                                             | -                                      | -            | -                                               | -                       | -                   | -       | NV      | **MISSING**                                                      |
| 31  | **Debit / credit note**               | P                               | P               | P                       | -                                        | Y                                             | -                                      | Y            | via returns                                     | via returns             | -                   | Y       | NV      | **P** - returns serve this role                                  |
| 32  | **Purchase / sales discount**         | **P**                           | **P**           | P (columns exist)       | -                                        | Y                                             | -                                      | Y            | **ignored** - server forces `discount=0, tax=0` | -                       | -                   | -       | NV      | **P** - schema supports it, code does not                        |

---

## 6. Stock system deep audit (CRITICAL)

### 6.1 How stock is meant to work

`reconcileStock()` (`accounting.js:162-204`) recomputes each item's balance as
`SUM(qty_in) - SUM(qty_out)` from `stock_ledger` and compares it to the stored
`stock_qty` on `factory_items` (raw) or `item_particulars` (finished). A
mismatch above 0.01 is reported as an issue. This is a **correct and useful**
control - and it is currently failing.

### 6.2 The measured position (VERIFIED, read-only)

```text
raw  factory_items.stock_qty total          = 990
raw  stock_ledger net (qty_in - qty_out)    = -360
     -> of which: purchases in 300, production out 640, returns out 20
active raw items with NO ledger row at all  = 10 of 18

finished item_particulars.stock_qty total   = 660
finished stock_ledger net                   = 650     (delta 10)

reconcileStock().ok = false, 19 issues
```

Per-item detail for the four oldest raw items:

| id  | stored stock | ledger in | ledger out | ledger net | delta |
| --- | ------------ | --------- | ---------- | ---------- | ----- |
| 1   | 30           | 50        | 120        | **-70**    | 100   |
| 2   | 35           | 25        | 40         | **-15**    | 50    |
| 3   | 30           | 50        | 120        | **-70**    | 100   |
| 4   | 35           | 25        | 40         | **-15**    | 50    |
| 5   | 100          | 0         | 0          | 0          | 100   |
| 6   | 50           | 0         | 0          | 0          | 50    |

### 6.3 Root cause - precisely determined

**This is NOT a bug in the current transaction logic. It is corrupt legacy
demo/test data produced before the ledger was authoritative.** Four distinct
causes, all confirmed:

1. **Missing opening balances (cause 1 - the dominant one).**
   `item_particulars.stock_qty` and `factory_items.stock_qty` can be set to any
   value at creation time by `POST /api/items/:id/particulars` (the
   `stock_qty` field is labelled "Opening stock") and by the factory-item create
   route. **No `stock_ledger` row is ever written.** There is **no opening-balance
   or stock-adjustment workflow anywhere in the system** (§5 rows 24-25).
   This alone explains the 10 of 18 raw items with zero ledger rows, and the
   finished-stock delta of 10.

2. **Direct stock manipulation outside any transaction.** The production
   endpoint validates stock correctly _today_ (`index.js:1069` rejects
   consumption exceeding available stock), but the shipped rows show
   consumption of 640 against receipts of only 300. The historical data was
   therefore produced by a path that did not enforce that check, or was loaded
   directly.

3. **Legacy seed/test scripts.** `server/src/phase4-seed.mjs` is exactly such a
   script: it opens a database **read-write at a hardcoded foreign path**, and
   `DELETE`s formula lines before re-inserting. The raw item names in the live
   DB (`"A 1791091812743"`, `"B 1791091812743"`, ...) are literally

---

## 7. Accounting deep audit

### 7.1 The decisive fact (VERIFIED)

```text
account_vouchers = 0 rows
account_ledger   = 0 rows

Unposted business documents:
  purchases        4 / 4 unposted
  productions      4 / 4 unposted
  sales            3 / 3 unposted
  returns          5 / 5 unposted
  issue_vouchers   0 / 0 (none exist)
                ---------------
  TOTAL           16 / 16 unposted
```

**The live database has never been double-entry posted.** The double-entry
engine exists and is tested, but it has produced nothing in the shipped data
file. Consequently:

- `GET /api/accounts/trial-balance` returns a balanced but **empty** trial
  balance (every account zero) - "balanced" here means "trivially balanced".
- `GET /api/reports/outstanding` does **not** use the ledger; it computes
  `opening_balance + SUM(net_total - paid_amount)` from documents, so it happens
  to show figures, but it **ignores payments entirely** (there is no payment
  feature) and ignores returns.
- `/api/accounts/party-ledger` uses `source = "account_ledger"` when the party is
  mapped to an account, else falls back to documents. Since the ledger is empty,
  **every** ledger-sourced party balance would read zero.

### 7.2 Double-entry rules: correctly implemented (VERIFIED by code + 52 tests)

| Rule                                       | Status                                                                       | Evidence                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| Voucher must balance                       | **Enforced** - `assertBalanced()` throws before any write                    | `accounting-core.js:31-42`; tests 6-7                  |
| Debit/credit natural side per account type | **Correct**                                                                  | `naturalBalance()`, `trialBalance()`; test 8           |
| One voucher per document                   | **Enforced in schema**, **absent from live DB**                              | partial unique index in `schema.sql`; not present live |
| Stock movement and voucher commit together | **Yes** - `postAccountVoucher` called inside the caller's `db.transaction()` | `index.js:847,1027,1244,1424,1530`                     |
| Numeric validation                         | **Yes** - `finiteNumber()` with min/max; `round2()` throughout               | `index.js:43-53`                                       |
| Ledger rows cascade on voucher delete      | **Yes** - FK `ON DELETE CASCADE`                                             | `schema.sql`                                           |

### 7.3 Chart of accounts: INCOMPLETE IN THE LIVE DB

`accounting.js` seeds **16** accounts. The live DB contains **12**. Missing:

| Code | Name                     | Needed by                                       |
| ---- | ------------------------ | ----------------------------------------------- |
| 1410 | Raw Material Inventory   | purchase posting, production posting, back-post |
| 1420 | Finished Goods Inventory | purchase/sale/return posting                    |
| 4100 | Sales Returns            | customer-return posting                         |
| 5300 | Cost of Goods Sold       | sale COGS posting                               |

Because `ensureChartOfAccounts()` uses `INSERT OR IGNORE` and runs at boot, the
next server start will add them. **But until the server is started once, the
shipped DB cannot post anything** - `requireAccountIdByCode("1420")` would throw.
This is an incomplete-migration state that has never been applied.

---

## 8. Missing business functionality (systematic)

Every item was searched for across routes, schema, UI, and constants.

| Feature                          | Status      | Explanation                                                                                                                              |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Receipts (customer payment)      | **MISSING** | No route, no UI, no doc type. Receivables reduced only by `paid_amount` at sale time.                                                    |
| Payments (supplier payment)      | **MISSING** | Same. Payables likewise.                                                                                                                 |
| Stock adjustments                | **MISSING** | Cannot correct shrinkage, damage, miscount. Directly causes the §6 problem.                                                              |
| Stock opening balance            | **MISSING** | No ledger `opening` concept. Directly causes the §6 problem.                                                                             |
| Expense entries                  | **MISSING** | Accounts 5100/5200 exist; no way to post to them.                                                                                        |
| Income / other income entries    | **MISSING** | -                                                                                                                                        |
| Cash transactions                | **P**       | Cash moved only inside purchase/sale. No standalone cash voucher.                                                                        |
| Bank transactions                | **P**       | Account 1200 exists; `payment_mode:"bank"` honoured at purchase/sale. No bank reconciliation.                                            |
| Manual journal voucher           | **MISSING** | `postAccountVoucher` exists as a function; no route exposes it.                                                                          |
| Debit note / credit note         | **P**       | Returns serve this purpose; no explicit document type.                                                                                   |
| Stock transfer                   | **MISSING** | Single location so arguably N/A, but inter-outlet moves impossible.                                                                      |
| Wastage / scrap                  | **MISSING** | No way to write off production loss.                                                                                                     |
| Production loss / yield variance | **MISSING** | `overhead_cost` always 0; no scrap capture.                                                                                              |
| Purchase discount                | **P**       | `purchases.discount` exists; server forces 0.                                                                                            |
| Sales discount                   | **P**       | `sales.discount` exists; server forces 0.                                                                                                |
| Taxes                            | **P**       | `tax` columns exist; server forces 0. **If the business is VAT/sales-tax registered this is a compliance gap - confirm with the owner.** |
| Multi-company                    | **MISSING** | No `company_id`. Appropriate for a single-site factory.                                                                                  |
| User management                  | **MISSING** | **Critical** - see §8.1.                                                                                                                 |
| Password change                  | **Y**       | `POST /api/auth/change-password`, tested.                                                                                                |
| Audit log (general)              | **MISSING** | Only `migration_log` and `backups`. **No record of who created, edited or deleted a sale, purchase, or master record.**                  |
| Barcode / scanner                | **MISSING** | No barcode fields or scanner handling. Common for paint retail.                                                                          |
| Print / PDF                      | **MISSING** | See §27.                                                                                                                                 |

### 8.1 User management is the most serious omission

There is **no** `GET/POST/PUT/DELETE /api/users*` route anywhere. The only
`INSERT INTO users` statements are in `auth.js` (env-driven bootstrap of a single
admin) and in test files. The live DB contains exactly **one** user
---

## 9. Authentication and security audit

### 9.1 Server-side authorization (VERIFIED - positive finding)

I extracted all **80** Express routes and their middleware chains.

| Category                             | Count   | Result                                                                |
| ------------------------------------ | ------- | --------------------------------------------------------------------- |
| Routes with `requireAuth`            | 78 / 80 | **PASS**                                                              |
| Routes without `requireAuth`         | 2       | `GET /api/health`, `POST /api/auth/login` - **both correctly public** |
| Admin-gated (`requireRole("admin")`) | 26      | Master-data writes, all backup/restore ops, all back-post ops         |

**This satisfies the requirement that frontend role restrictions are NOT the only
security layer.** Authorization is genuinely enforced server-side and verified by
an integration test using a real non-admin account (`erp-flow.test.js:29`).

### 9.2 Cryptography (VERIFIED)

| Control                 | Implementation                                                        | Assessment       |
| ----------------------- | --------------------------------------------------------------------- | ---------------- |
| Password hashing        | `crypto.scryptSync(password, salt, 64)`, 16-byte random salt per hash | **Strong**       |
| Comparison              | `crypto.timingSafeEqual`                                              | **Correct**      |
| Malformed-hash handling | Throws; caught in login route, converted to 401                       | **Fails closed** |
| Session token           | `crypto.randomBytes(32)` -> 64 hex chars                              | **Strong**       |
| Session lifetime        | 12 h, enforced server-side; expired rows deleted on use               | Acceptable       |
| Default credentials     | **None.** Admin bootstrap requires env vars                           | **Good**         |
| Secrets in repo         | None found                                                            | **Good**         |

### 9.3 SQL injection

All queries use **parameterised prepared statements**. Dynamic table/column names
are constrained by allow-lists (`partyType` validated to `supplier|customer`;
`stockType` to `raw|finished`). **No SQL injection found.**

### 9.4 Weaknesses

| #    | Issue                                                                                                        | Severity        | Evidence              |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------- | --------------------- |
| S-1  | **No user management** - every operator shares one admin account                                             | **Critical**    | §8.1                  |
| S-2  | **Server binds all network interfaces** - API reachable from LAN                                             | **High**        | `index.js:2368`       |
| S-3  | **Wide-open CORS** - `app.use(cors())`, any origin                                                           | High (with S-2) | `index.js:109`        |
| S-4  | **Token in `localStorage`** - XSS-readable; no httpOnly cookie                                               | Medium          | `api.ts:22,37`        |
| S-5  | **No CSRF protection on the Express API** - `start.ts` CSRF middleware covers TanStack server functions only | Medium          | `start.ts:23-25`      |
| S-6  | **No rate limiting** on `/api/auth/login`                                                                    | Medium          | no middleware present |
| S-7  | **No security headers** - no CSP, HSTS, `X-Frame-Options`                                                    | Medium          | no helmet             |
| S-8  | **11 live sessions**, no administrative session revocation                                                   | Low-Med         | live DB               |
| S-9  | **Error handler returns raw `err.message`** to the client                                                    | Low             | `index.js:2365`       |
| S-10 | **No role-based UI** - sidebar shows all modules incl. admin-only Backup                                     | Low (UX)        | `app.tsx:52-83`       |
| S-11 | **Internal `API_URL` shown in the app header**                                                               | Low (info)      | `app.tsx:99`          |
| S-12 | **No confirmation dialogs anywhere** - every delete executes immediately                                     | Medium (data)   | §14                   |

### 9.5 CSRF assessment - an honest nuance

Because the API is **Bearer-token** authenticated and does **not** read cookies,
classic CSRF cannot succeed: a cross-origin page cannot read `localStorage` and
the browser will not attach the token automatically. The real residual risk is
**XSS** (S-4), not CSRF. The absence of a CSRF token is defensible **only as long
as the API never moves to cookie-based auth**.

---

## 11. Transaction atomicity audit

Every multi-record write operation was located and classified.

| Operation                 | Location           | In `db.transaction()` | Validation before write                                                           | Verdict    |
| ------------------------- | ------------------ | --------------------- | --------------------------------------------------------------------------------- | ---------- |
| Purchase                  | `index.js:847`     | **Yes**               | supplier, qty > 0, rate, item refs, `assertPostingAllowed`                        | **ATOMIC** |
| Production                | `index.js:1027`    | **Yes**               | formula exists + has lines, **stock sufficiency for every line before any write** | **ATOMIC** |
| Counter sale              | `index.js:1244`    | **Yes**               | customer, qty, **stock sufficiency**, paid in [0, net]                            | **ATOMIC** |
| Issue voucher             | `index.js:1424`    | **Yes**               | customer, qty > 0                                                                 | **ATOMIC** |
| Returns (both types)      | `index.js:1530`    | **Yes**               | return type, party, **no negative stock**                                         | **ATOMIC** |
| Formula save              | `index.js:2136`    | **Yes**               | duplicate materials, positive qty, active factory items                           | **ATOMIC** |
| Year rollover             | `years.js:74`      | **Yes**               | label, duplicate year                                                             | **ATOMIC** |
| Back-post (per doc)       | `backpost.js:424`  | **Yes**               | re-check + `assertBalanced`                                                       | **ATOMIC** |
| Back-post revert          | `backpost.js:502`  | **Yes**               | -                                                                                 | **ATOMIC** |
| Chart-of-accounts seeding | `accounting.js:44` | **Yes**               | -                                                                                 | **ATOMIC** |

This is a **genuinely strong** result: all nine multi-table business operations
are properly atomic, with validation ahead of the first write. Verified by test
B3 ("a failed transaction leaves no partial business rows").

### 11.1 Where partial data CAN remain

| #   | Operation                                                           | Problem                                                                                                                                                                                                       | Severity |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| T-1 | `DELETE /api/items/:id` (`index.js:1912`)                           | **Not atomic.** Two statements (`UPDATE items`, `DELETE item_particulars`), no transaction. Also **hard-deletes particulars regardless of stock on hand**, destroying the cost basis of historical movements. | **High** |
| T-2 | `DELETE /api/items/:id/particulars/:particularId` (`index.js:2041`) | **Not atomic.** Three DELETEs, no transaction. No stock check.                                                                                                                                                | **High** |
| T-3 | `POST /api/setup/*` master creates                                  | Single INSERT each - low risk, no `db.transaction()` wrapper                                                                                                                                                  | Low      |
| T-4 | `applySchema()`                                                     | Not transactional across the file; **cannot add columns to existing tables** (create-only). A mid-file failure leaves partial schema.                                                                         | Medium   |
| T-5 | Shutdown mid-transaction                                            | No explicit close/checkpoint; WAL guarantees atomicity so data is safe, but no clean flush.                                                                                                                   | Low      |

**T-1/T-2 are the ones to fix:** deleting an item with stock on hand silently
destroys historical valuation.

---

## 12. Backup and restore audit (CRITICAL)

### 12.1 Backup - good

| Control                | Status                                                              | Evidence          |
| ---------------------- | ------------------------------------------------------------------- | ----------------- |
| WAL-safe capture       | **Yes** - SQLite online backup API (`db.backup()`), not a file read | `backup.js:46`    |
| Integrity verification | **Yes** - `PRAGMA integrity_check` before reporting success         | `backup.js:18-37` |
| Fail-safe              | Unverifiable files are **deleted**, never reported as good          | `backup.js:59-66` |
| Corrupt-file handling  | Whole open+check guarded in `try`                                   | `backup.js:20-43` |
| Metadata               | Logged to `backups` (path, size, user, timestamp)                   | `backup.js:52-56` |
| Listable               | `GET /api/backup/list` (admin) + UI table                           | `app.backup.tsx`  |
| User export            | `GET /api/backup/export` downloads the verified file                | `index.js:1816`   |

### 12.2 Backup gaps

| #   | Gap                                                                                                                                 | Severity |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| B-1 | **No retention/pruning.** No `DELETE FROM backups`, no max-count, no age limit - **backups accumulate forever**.                    | Medium   |
| B-2 | **No scheduled/automatic backup.** Backup is a manual button click.                                                                 | **High** |
| B-3 | **Backup directory is inside the install tree** (`server/data/backups`) - see §19. Backups would be deleted on uninstall/reinstall. | **High** |
| B-4 | **No off-site / removable-media copy workflow.**                                                                                    | Medium   |
| B-5 | **No "last successful backup was N days ago" warning.**                                                                             | Medium   |

### 12.3 Restore - exists server-side, absent from the product

`restore.js` is **better than previous reports claimed**, and I verified its tests
individually (tests 43-46, 52 all pass):

| Capability | Status |
---

## 13. Reporting audit

### 13.1 Data source of each report (VERIFIED)

| Report / endpoint                 | Derived from                                                                 | Reliable?                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /api/stock/reconciliation`   | **`stock_ledger`** - correct source                                          | Algorithm correct; **currently FAILS on live data**            |
| `GET /api/stock/summary`          | `factory_items.stock_qty` + `item_particulars.stock_qty` (**stored values**) | **Unverified** - these are the disputed numbers                |
| `GET /api/stock/ledger`           | **`stock_ledger`** - correct                                                 | Reliable as a movement history                                 |
| `GET /api/accounts/trial-balance` | **`account_ledger`** + opening balances                                      | Algorithm correct; **currently all zeros**                     |
| `GET /api/reports/general`        | **`stock_ledger`** - correct                                                 | Reliable                                                       |
| `GET /api/reports/production`     | `productions` joined to items                                                | Reliable for what it shows                                     |
| `GET /api/reports/sales`          | **`sales` + `SUM(sale_lines.amount)`** - line totals, not `net_total`        | **Partially unreliable**                                       |
| `GET /api/reports/purchases`      | **`purchases` + `SUM(purchase_lines.amount)`**                               | **Partially unreliable**                                       |
| `GET /api/reports/outstanding`    | **`opening_balance + SUM(net_total - paid_amount)`** - document fallback     | **Unreliable** - ignores payments (none exist) and returns     |
| `GET /api/accounts/party-ledger`  | `account_ledger` if party mapped, else documents                             | **Unreliable now** - ledger empty, so mapped parties read zero |
| `GET /api/dashboard/summary`      | Row counts only                                                              | Reliable but trivial                                           |

### 13.2 Specific report bugs found

| #    | Report                                         | Bug                                                                                                                                                                      | Severity |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| RP-1 | `/api/reports/purchases`                       | Item filter tests `pl.particular_id = ?` only, but purchase lines can reference **`factory_item_id`**. **Raw-material purchases are invisible when filtering by item.**  | Medium   |
| RP-2 | `/api/reports/sales`, `/api/reports/purchases` | Uses `SUM(line.amount)` not the document's `net_total`. Any discount/tax/freight difference is unrepresented. Harmless today (all forced to 0), breaks once implemented. | Medium   |
| RP-3 | `/api/reports/outstanding`                     | **Ignores returns entirely.** A fully-returned customer still shows an outstanding balance.                                                                              | Medium   |
| RP-4 | All list reports                               | **No pagination, no LIMIT.** Every report returns the full table.                                                                                                        | Medium   |

### 13.3 Reports that do not exist

Balance sheet, **P&L / income statement**, aged receivables/payables, stock
valuation, financial-year P&L, returns report, issue-voucher report, customer or
supplier statement (only a party ledger exists), audit-trail report - all
**MISSING**. For a business filing tax returns or seeking a loan, the absence of
P&L and balance sheet is a material gap.

---

## 14. Frontend / UI audit

### 14.1 Navigation and routes

| Check                   | Result                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Sidebar modules         | 13 entries across 6 groups, all resolving to real routes                                      |
| Dead nav entries        | **None** - every `MODULES.to` has a matching route file                                       |
| Unreachable routes      | **`/app/sales`** - 16-line placeholder, absent from `MODULES`                                 |
| Role-based UI           | **None.** `app.tsx` renders all modules for every role; `user.role` is only displayed as text |
| Navigation after logout | Redirects to `/` when unauthenticated - correct                                               |

### 14.2 Forms, error handling, loading, empty states

| Aspect                 | Result                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| Client-side validation | Minimal (numeric `min`/`max`/`type`). All real validation server-side - correct |

---

## 15. Browser QA

### `BLOCKED - BROWSER QA TOOLING NOT AVAILABLE`

Verified absent: `node_modules/playwright`, `node_modules/@playwright`,
`node_modules/cypress`; no other browser-automation dependency; no `data-testid`
attributes to target.

**I therefore make NO claim that any UI works in a browser.** The build compiles
and an SSR bundle is produced, which is necessary but far from sufficient.

### 15.1 Manual browser tests still required before release

1. Login/logout/session-expiry round trip.
2. Every screen loads without console errors (all 14 real routes).
3. Every form: validation errors, empty states, server-error surfacing.
4. Responsive layout at ~768 px and ~1366 px.
5. Data persistence across an app restart.
6. Full operator journey with numbers verified on screen: master -> formula ->
   purchase -> production -> sale -> return -> report.
7. Deleting a master record and confirming the consequence is understood.
8. Barcode-scanner keyboard-wedge input into the sale grid (if implemented).
9. Printing/PDF output on the target printer (§27).

---

## 16. Test coverage audit

### 16.1 The 52 tests by category (I read every test name)

| Suite                     | Tests | Type                                                                                       | What it proves                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounting-core.test.js` | 9     | Pure unit                                                                                  | `round2`, `voucherTotals`, `isBalanced`, `assertBalanced` (empty + unbalanced), `naturalBalance`, 5 account types                                                                                                                                                                                                                                                                                   |
| `phase4-logic.test.js`    | 2     | Pure unit                                                                                  | BOM multiplier maths, fractional batches, no NaN/Infinity                                                                                                                                                                                                                                                                                                                                           |
| `erp-flow.test.js`        | 21    | **Real HTTP integration** - spawns Express as a child process, `fetch` to `127.0.0.1:3999` | Login/401s, masters, items, formula server totals, purchase validation + balanced voucher, production + full rollback on insufficient stock, counter sale (AR/Sales/COGS), issue voucher (stock-only), both return types incl. negative-stock rejection, reconciliation, trial balance, `created_by`, backup, year rollover + closed-year block, **server-side role enforcement**, password change  |
| `restore.test.js`         | 10    | Integration (isolated temp DB)                                                             | Backup->restore round-trip, in-place token refusal + safety copy, corrupt-backup rejection with no output, path traversal, 500-number uniqueness/contiguity, back-post idempotency/balance/audit/revert, zero-value skip, duplicate-posting rejection, refusal of unreconstructable documents                                                                                                       |
| `final-scenario.test.js`  | 10    | Scenario (A/B/X)                                                                           | **A** purchase->production->sale->return with exact stock reconciliation, per-voucher balance, exactly-one-voucher, asserted closing balances; **B** closed-year refusal, unbalanced-voucher rejection, mid-transaction rollback, zero-value skip; **X** session forge/revoke/expire, password salting + malformed hash, role gate, storage-level duplicate rejection, 300-number gap-free sequence |

### 16.2 Coverage matrix

| Area                                   | Unit  | Integration (HTTP) | Browser  | Status             |
| -------------------------------------- | ----- | ------------------ | -------- | ------------------ |
| Double-entry maths                     | **Y** | **Y**              | -        | **GOOD**           |
| Voucher balancing                      | **Y** | **Y**              | -        | **GOOD**           |
| Purchase / Production / Sale / Returns | -     | **Y**              | -        | **GOOD**           |
| Rollback on failure                    | -     | **Y**              | -        | **GOOD**           |
| Year rollover / closed-year            | -     | **Y**              | -        | **GOOD**           |
| Auth / roles / password                | -     | **Y**              | -        | **GOOD**           |
| Backup / restore / corrupt / traversal | -     | **Y**              | -        | **GOOD**           |
| Back-post / idempotency / audit        | -     | **Y**              | -        | **GOOD**           |
| Duplicate-posting prevention           | **Y** | -                  | -        | **GOOD**           |
| Numbering uniqueness                   | **Y** | -                  | -        | **GOOD**           |
| Stock reconciliation algorithm         | **Y** | **Y**              | -        | **GOOD**           |
| Concurrency (2+ clients)               | -     | -                  | -        | **NONE**           |
| Reports correctness                    | -     | **P**              | -        | **WEAK**           |
| **All UI rendering**                   | -     | -                  | **NONE** | **NONE - BLOCKED** |
| **UI forms / validation display**      | -     | -                  | **NONE** | **NONE - BLOCKED** |
| **Print / PDF output**                 | -     | -                  | -        | **NONE - absent**  |

---

## 18. Electron readiness audit

### 18.1 Current state of every Electron prerequisite (VERIFIED)

| Prerequisite                          | Present?    | Evidence                                                               |
| ------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `electron` dependency                 | **NO**      | `node_modules/electron` does not exist; not in `package.json`          |
| `electron-builder` / `electron-forge` | **NO**      | Neither in `package.json` nor `node_modules`                           |
| Main process entry                    | **NO**      | No `main` field; no `electron/main.*` file                             |
| `preload` script                      | **NO**      | -                                                                      |
| `BrowserWindow`                       | **NO**      | -                                                                      |
| Secure IPC / contextIsolation         | **NO**      | -                                                                      |
| Frontend serving strategy             | **NO**      | Build emits a Cloudflare Worker bundle                                 |
| Backend startup from main             | **NO**      | -                                                                      |
| Backend shutdown from main            | **NO**      | -                                                                      |
| SQLite path handling for app data     | **NO**      | Path is `server/data/paint-erp.db`, relative to source dir             |
| Persistent app-data directory         | **NO**      | -                                                                      |
| Backup / logs / config directories    | **NO**      | Backups live inside the install tree                                   |
| First-run initialization              | **PARTIAL** | `init-db.js` exists but requires env vars for the admin                |
| Clean shutdown                        | **NO**      | No SIGINT/SIGTERM handling, no `db.close()`                            |
| Crash recovery                        | **NO**      | No logging, no recovery flow                                           |
| Single-instance lock                  | **NO**      | -                                                                      |
| Window-state persistence              | **NO**      | -                                                                      |
| App version                           | **NO**      | `package.json` has **no version field**                                |
| Auto-update strategy                  | **NO**      | -                                                                      |
| Installer configuration               | **NO**      | -                                                                      |
| App icon                              | **NO**      | Only web favicons (`favicon.ico`/`.svg`), not a 256x256 installer icon |
| Desktop shortcut                      | **NO**      | -                                                                      |
| Start Menu shortcut                   | **NO**      | -                                                                      |
| Uninstall support                     | **NO**      | -                                                                      |

**Summary: 0 of 22 Electron prerequisites are present. This is a greenfield
integration, not a packaging task.**

### 18.2 The four hard technical blockers

#### Blocker 1 - The build output cannot be served locally (CRITICAL)

`npm run build` produces `.output/server/wrangler.json` with `"main":
"index.mjs"`, a `compatibility_date`, an assets binding and `nodejs_compat`.
`.output/server/index.mjs` (17,835 bytes) contains **no `listen()` and no
`node:http`** - it is a Cloudflare Worker `fetch` handler. There is no Node HTTP
server artifact to start.

**Required change:** switch the Nitro preset to `node-server` (or `static` + SPA).

### 18.3 What a correct Electron architecture would look like

```text
electron/main.js
  |- app.requestSingleInstanceLock()        <- prevent two instances
  |- resolve %APPDATA%/PaintFlowERP         <- userData, NEVER the install dir
  |     data/paint-erp.db
  |     backups/  logs/  config/
  |- set process.env.DATA_DIR / DB_PATH BEFORE importing db.js
  |- fork/spawn server/src/index.js with a chosen or ephemeral PORT
  |- poll /api/health until ready (timeout + retry + clear error)
  |- create BrowserWindow
  |     webPreferences: { contextIsolation: true, nodeIntegration: false,
  |                       sandbox: true, preload: ... }
  |- load http://127.0.0.1:<port>            <- renderer uses the SAME origin
  `- on 'before-quit': SIGTERM child -> await exit -> db.close() + WAL checkpoint

electron/preload.js
  `- contextBridge.exposeInMainWorld('paintflow', { /* minimal surface */ })
```

**Key design decision:** the renderer should load the app **from the same local
server that serves the API**, rather than loading static files and then calling
`localhost:3001`. The latter reintroduces CORS, port discovery and
mixed-content problems.

---

## 19. Electron database location (CRITICAL)

### 19.1 Current behaviour (VERIFIED)

`DATA_DIR` = `process.env.DATA_DIR` or `<server/src>/../data`, giving
`server/data/paint-erp.db`, with `server/data/backups/` and
`server/data/restored/` beside it. `.gitignore` excludes `*.db`, so the database
is a purely local artifact. This is a sensible **developer** layout and an
unacceptable **installed** layout.

### 19.2 Required Windows-safe structure

```text
%APPDATA%\PaintFlowERP\          (Electron app.getPath('userData'))
  |- data\
  |    paint-erp.db
  |    paint-erp.db-wal
  |    paint-erp.db-shm
  |- backups\
  |    paint-erp-2026-10-04T....db
  |- restored\
  |- logs\
  |    app.log
  |    crash.log
  `- config\
```

`%APPDATA%` (roaming) is conventional for user documents; `%LOCALAPPDATA%` would
also be acceptable for a single-PC install.

---

## 21. Windows 7 compatibility

### 21.1 Authoritative facts (verified against Electron's own documentation)

From Electron's official deprecation notice _"Farewell, Windows 7/8/8.1"_
(29 November 2022):

> "Electron will end support for Windows 7/8/8.1 beginning in **Electron 23**...
> **Electron 22 will be the last Electron major version to support Windows
> versions older than 10.**"
>
> "Electron 22 (Chromium 108) ... will be the last supported version."
>
> Support for the 22.x line ended **10 October 2023** (extended from 30 May 2023
> to align with Chrome's Windows Server 2012 extended support).

Current Electron README: **"Windows 10 and up"**, x64 and arm64 only.

### 21.2 Consequences for this project

| Question                                     | Answer                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a **current** Electron run on Windows 7? | **NO.** Electron 23+ requires Windows 10 and will not launch.                                                                                                                         |
| Could Electron 22 run on Windows 7?          | **Technically yes** - the last release with Windows 7 support.                                                                                                                        |
| Should we ship Electron 22?                  | **No.** Support ended **10 October 2023**. It carries Chromium 108 with roughly three years of unpatched security vulnerabilities, on a machine that by definition cannot be patched. |
| Would the rest of the stack work?            | **Uncertain.** `better-sqlite3@11` would need building against Electron 22's older Node ABI and an older MSVC toolchain; React 19 and Vite 8 output assume a modern Chromium.         |

### 21.3 Final Windows 7 classification

# `NOT RECOMMENDED`

(Of the brief's permitted answers, only `POSSIBLE WITH OLD STACK` is technically
true - but that stack is unpatched and therefore not responsible to ship. I record
`NOT RECOMMENDED` as the operative verdict.)

**Practical guidance:** Windows 7 reached end of extended support on
**14 January 2020**; any machine still running it is unpatched at the OS level
regardless of the ERP. If legacy hardware must be supported, in order of
preference: (a) upgrade or replace the PC to Windows 10/11; (b) run the ERP as a
**browser application from a machine that does run Windows 10+** on the same LAN;
or (c) a deliberate, security-accepted Electron 22 build on an isolated network.
Option (b) is almost always better than (c).

---

## 22. Electron packaging strategy

### Recommendation: **`electron-builder` with an NSIS installer**

**Why it fits this project specifically:**

1. **NSIS is the right installer format** for a factory PC: a `.exe` installer
   with Start Menu and desktop shortcuts, a proper Add/Remove Programs entry, and
   a custom install directory - all defaults out of the box.

---

## 23. Offline operation

### Classification: `LIKELY OFFLINE-CAPABLE, NOT VERIFIED`

| Dependency                           | Present?       | Evidence                                     |
| ------------------------------------ | -------------- | -------------------------------------------- |
| Cloud database / Supabase / Firebase | **NO**         | Local SQLite only                            |
| External API calls in app code       | **NO**         | Only `localhost:3001`                        |
| Remote fonts                         | **NONE FOUND** | No Google Fonts link observed                |
| CDN-loaded JS/CSS                    | **NONE FOUND** | All deps bundled by Vite                     |
| CDN-loaded images/icons              | **NONE**       | `lucide-react` bundled; favicons local       |
| Telemetry / analytics                | **NONE FOUND** | -                                            |
| Cloud auth                           | **NO**         | Local scrypt + local sessions                |
| Auto-update service                  | **NO**         | Would be a new network dependency (deferred) |

**Nothing in the application requires the internet at runtime.**

### 23.2 Caveats

1. **The build pipeline is online-only** (`npm install`, `vite build`) - a
   build-time concern, and exactly what the installer removes for end users.
2. If a print/PDF library or OS capability is added, verify it fetches nothing
   at runtime.
3. **Electron itself may perform network calls** (crash reporter, component
   updates) unless disabled. For a genuinely air-gapped factory, disable the
   crash reporter and harden the command line.
4. **NOT VERIFIED by execution** - I did not launch the built app offline.

---

## 24. LAN operation

### Classification: **SINGLE-PC ONLY** (the correct and intended design)

**The application as built is a single-PC desktop application.** Electron would
wrap the UI, the Express API and the SQLite file on **one** machine.

### 24.1 Why it must not be used over a LAN as-is

| Issue                                     | Consequence                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| SQLite over SMB/network share             | **Database corruption** - file locking is unreliable over the network                  |
| Server binds all interfaces               | API exposed to the whole LAN **with no transport encryption** and **no rate limiting** |
| Single synchronous connection, no pooling | `SQLITE_BUSY` and lock contention under any concurrency                                |
| No `busy_timeout`                         | Immediate failures rather than waiting                                                 |
| No single-instance lock                   | Two clients writing the same file would contend                                        |

---

## 25. Performance audit

### 25.1 Index adequacy

| Query pattern                                                            | Index present?                          | Verdict                                                      |
| ------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------ |
| `stock_ledger` by date                                                   | `idx_stock_ledger_date`                 | OK                                                           |
| `stock_ledger` by `particular_id`                                        | `idx_stock_ledger_part`                 | OK                                                           |
| `stock_ledger` by `factory_item_id`                                      | `idx_stock_ledger_raw`                  | OK                                                           |
| `account_ledger` by account / date                                       | `idx_ledger_account`, `idx_ledger_date` | OK                                                           |
| Child tables by parent FK                                                | 6 child indexes present                 | OK                                                           |
| **Missing:** `stock_ledger(ref_type, ref_id)`                            | **NO**                                  | Needed as history grows                                      |
| **Missing:** `sessions(expires_at)`                                      | **NO**                                  | Cleanup scans the whole table                                |
| **Missing:** date indexes on `purchases`/`sales`/`returns`/`productions` | **NO**                                  | List/report queries filter and sort by date with a full scan |

### 25.2 Expected problems at scale (INFERRED)

| Concern                     | Finding                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Reports with no LIMIT**   | Every list/report endpoint returns the full result set. **Highest-probability performance problem.**                                   |
| **No pagination in the UI** | Tables render the entire result set                                                                                                    |
| **Synchronous SQLite**      | A large report blocks the event loop, freezing the whole API                                                                           |
| **Backup on click**         | `db.backup()` of a multi-GB database blocks noticeably                                                                                 |
| **WAL growth**              | No routine checkpoint or `wal_autocheckpoint` tuning                                                                                   |
| **Low-spec PCs**            | Electron + Node + Express in one package is heavier than a browser tab; expect ~200-400 MB RSS. 4 GB RAM will cope, 2 GB will struggle |
| **Database growth**         | `stock_ledger` and `account_ledger` grow monotonically with no archiving                                                               |
| **Multiple users**          | Not supported (§24)                                                                                                                    |

### 25.3 Recommended mitigations

1. Add `LIMIT`/pagination to every list and report endpoint.
2. Add date indexes on `purchases`, `sales`, `returns`, `productions`.
3. Add a composite index on `stock_ledger(ref_type, ref_id)`.
4. Configure `busy_timeout` and a periodic `wal_checkpoint(PASSIVE)`.
5. Cache or run heavy reports asynchronously if they become slow.

---

## 26. Data safety and upgrade audit

---

## 27. Printing and Windows hardware

| Capability                            | Status   |
| ------------------------------------- | -------- |
| `window.print()`                      | **NONE** |
| `@media print` stylesheet             | **NONE** |
| Invoice / receipt / report print view | **NONE** |
| PDF generation                        | **NONE** |
| Thermal receipt printing              | **NONE** |
| Barcode / QR generation or scanning   | **NONE** |
| A4/Letter page setup, headers/footers | **NONE** |

### 27.1 What this requires

**Nothing here needs Electron-specific APIs.** `window.print()` and CSS
`@media print` work identically in Electron's Chromium, and Electron can print
via `webContents.print()` / `printToPDF()` from the main process if silent
printing is needed. Thermal printers are reachable through the standard Windows
print dialog.

**However, the feature must actually be built.** The minimum viable set for a
paint factory is: (1) a print stylesheet hiding navigation, (2) printable
invoice/receipt views for Counter Sale, Purchase and Returns, (3) a print button
on each, and optionally (4) `printToPDF()` for "Save as PDF" without a dialog.

This is the most visible gap between the product as built and what a counter
sales business actually needs.

---

## 28. Logging and error recovery

### 28.1 Current state (VERIFIED)

| Log type             | Present? |
| -------------------- | -------- |
| Application log file | **NO**   |

---

## 29. Final phase matrix

Compared against the eight phases defined in `README.md`. Statuses use only
COMPLETE / PARTIAL / MISSING / BLOCKED / NOT VERIFIED. **Passing tests alone
never justify COMPLETE.**

| Phase                       | Requirement (README)                                                                                      | Status                | Evidence                                                                                                                                                                                                       | Remaining work                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **1** Foundation            | Express + SQLite scaffold; full schema; login; app shell                                                  | **PARTIAL**           | Solid backend scaffold; 31-table schema; login/sessions/roles tested; sidebar shell (unverified in browser). **No user management**; root `package.json` still `tanstack_start_ts`; **no version**; no runbook | User CRUD; rename product; add version; browser QA; runbook                                           |
| **2** Items & Formula/BOM   | Two-panel Items Master + particulars grid; BOM modal with auto totals                                     | **COMPLETE**          | `app.items.tsx` (427 lines) + `formula-bom-modal.tsx`; server-computed totals tested; strong BOM validation                                                                                                    | Browser QA only                                                                                       |
| **3** Setup / Masters       | Employees, Customers, Suppliers, Transporters, Account Chart, Factory Items, New Year Posting             | **COMPLETE**          | `app.setup.tsx` (820 lines); all CRUD + atomic year rollover tested                                                                                                                                            | Consolidate duplicate routes; refresh stale UI text                                                   |
| **4** Purchase & Production | Purchase updates raw stock; production consumes per formula                                               | **COMPLETE**          | Both atomic (`index.js:847`, `1027`); stock sufficiency enforced; rollback tested; accounting posted                                                                                                           | Confirm dialogs; browser QA                                                                           |
| **5** Sales & Vouchers      | Counter Sale; Issue Voucher; Return                                                                       | **PARTIAL**           | All three work with stock + accounting. But **no invoice printing**, legacy COGS unreconstructible, `app.sales.tsx` is a dead placeholder                                                                      | Delete/implement `app.sales`; invoice print; decide legacy COGS basis                                 |
| **6** Stock & Accounts      | Live stock + ledger; accounts chart, party ledgers, balances                                              | **PARTIAL**           | Code correct and tested. But **live stock does not reconcile** (19 issues), **no opening balances**, **no adjustments**, **ledger empty so balances are not real**, no P&L or balance sheet                    | Opening-balance + adjustment transactions; reconciliation migration; post legacy vouchers; add P&L/BS |
| **7** Reports & Backup      | Sale/Purchase/General reports with filters; one-click backup/export                                       | **PARTIAL**           | Backup excellent. Reports miss raw materials in the item filter, ignore returns in outstanding, no pagination. **No restore UI**, no retention, no scheduling                                                  | Fix RP-1..RP-4; build restore UI; retention + scheduling; statements                                  |
| **8** Polish & Electron     | **Electron wrapper for a Windows desktop build**; validation, error handling, responsive layout, final QA | **MISSING / BLOCKED** | **Zero Electron code.** No Playwright, so browser QA blocked. No print. No confirmations. No runbook                                                                                                           | All of §18; browser QA; printing; confirmations; logging                                              |

---

## 30. Final risk register

| ID   | Risk                                                                                                         | Severity     | Area          | Current state                              | Impact                                                                                              | Fix required                                                                                                      | Priority |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------ | ------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| R-01 | **Live DB has zero accounting entries**; all 16 documents unposted                                           | **CRITICAL** | Accounting    | `account_vouchers`/`account_ledger` = 0    | No P&L, no balance sheet, no true party balances. Trial balance "balances" only because it is empty | Run `applySchema()` + `ensureChartOfAccounts()` on a verified copy, then `runBackpost()`; agree legacy COGS basis | **P0**   |
| R-02 | **Stock does not reconcile** (raw 990 vs ledger −360; 10 of 18 items unbacked)                               | **CRITICAL** | Stock         | `reconcileStock().ok === false`, 19 issues | Every stock figure is unverified; costing and reordering unreliable                                 | Add opening-balance + adjustment transactions; reviewed reconciliation migration inserting `opening` ledger rows  | **P0**   |
| R-03 | **No receipts, payments, or stock adjustments**                                                              | **CRITICAL** | Accounting    | Confirmed absent                           | Receivables/payables can never be settled; stock can never be corrected                             | Implement receipt, payment and stock-adjustment documents with ledger + accounting posting                        | **P0**   |
| R-04 | **No user management** - one shared admin account                                                            | **CRITICAL** | Security      | No `/api/users*` route; 1 user live        | No accountability; role model defeated; audit meaningless                                           | Implement admin-only user CRUD, deactivation and password reset                                                   | **P0**   |
| R-05 | **Database would be destroyed by an app update** (resolves inside the install dir)                           | **CRITICAL** | Deployment    | `DATA_DIR` defaults to `<src>/../data`     | Total business data loss on first update or reinstall                                               | Set `DATA_DIR` to `%APPDATA%` before `db.js` loads; prove with an automated v1→v2 upgrade test                    | **P0**   |
| R-06 | **No restore UI** - an operator cannot restore                                                               | **CRITICAL** | Backup        | Endpoints exist; no frontend calls them    | Data loss is unrecoverable by the people who own the data                                           | Build a restore screen: verify, preview, explicit confirmation                                                    | **P0**   |
| R-07 | **No confirmation dialogs**; item delete hard-deletes particulars                                            | **HIGH**     | UI / data     | 0 matches for `confirm(`                   | One stray click destroys master data and valuation history                                          | Confirmation modals on every destructive action; refuse item delete when stock exists                             | **P0**   |
| R-08 | **Schema changes never applied to the live DB** (sequences, migration log, unique index, 4 accounts missing) | **HIGH**     | Database      | Verified absent                            | Duplicate postings currently possible in the shipped file; posting would throw on missing accounts  | Run the migration on a verified copy, then live, with a rollback plan                                             | **P0**   |
| R-09 | **Server binds all interfaces** with open CORS and no TLS                                                    | **HIGH**     | Security      | `app.listen(PORT)`                         | API reachable from the LAN; Bearer tokens in cleartext                                              | Bind `127.0.0.1`; restrict CORS; add rate limiting and security headers                                           | **P0**   |
| R-10 | **No `busy_timeout`**                                                                                        | **HIGH**     | Database      | Not set in `db.js`                         | `SQLITE_BUSY` failures under Defender scanning, indexing or any concurrency                         | `db.pragma("busy_timeout = 5000")`                                                                                | **P1**   |
| R-11 | **No schema migration ladder** (`user_version = 0`)                                                          | **HIGH**     | Database      | Create-only `applySchema()`                | Future column changes silently do nothing; upgrades untrustworthy                                   | Numbered migrations in a transaction with a pre-migration backup                                                  | **P1**   |
| R-12 | **No printing or PDF** of any kind                                                                           | **HIGH**     | UI / business | Verified absent                            | A counter-sales business cannot produce an invoice or receipt                                       | Print stylesheet + printable documents + print buttons (+ `printToPDF`)                                           | **P1**   |
| R-13 | **No general audit trail**                                                                                   | **HIGH**     | Compliance    | Only `migration_log` and `backups`         | Cannot answer "who changed this?"; edit/delete history lost                                         | Generic audit table: actor, action, entity, before/after                                                          | **P1**   |
| R-19 | **Reports ignore returns** and mis-filter raw-material purchases                                             | **MEDIUM**   | Reporting     | RP-1, RP-3 verified                        | Wrong outstanding balances; missing purchases                                                       | Fix the SQL; add regression tests                                                                                 | **P2**   |
| R-20 | **No pagination or `LIMIT`** on any list/report                                                              | **MEDIUM**   | Performance   | Verified                                   | Freezes as data grows                                                                               | Pagination + date indexes                                                                                         | **P2**   |
| R-21 | **Backups accumulate forever; no retention or scheduling**                                                   | **MEDIUM**   | Backup        | No pruning code                            | Disk fills; operator may forget to back up                                                          | Retention policy + daily scheduled backup + "last backup" indicator                                               | **P2**   |
| R-22 | **Dual lockfiles** (`bun.lock` + `package-lock.json`)                                                        | **MEDIUM**   | Build         | Both committed                             | Non-reproducible builds                                                                             | Keep one                                                                                                          | **P2**   |
| R-23 | **No graceful shutdown**; no WAL checkpoint on exit                                                          | **MEDIUM**   | Database      | No signal handlers                         | Slower restarts; no clean flush                                                                     | SIGINT/SIGTERM handling, `db.close()`, final checkpoint                                                           | **P2**   |
| R-24 | **Token in `localStorage`**; no security headers                                                             | **MEDIUM**   | Security      | Verified                                   | XSS could exfiltrate a valid session                                                                | httpOnly cookie or hardened headers/CSP                                                                           | **P2**   |
| R-25 | **Dead files** (`page.html` with a foreign path; `phase4-seed.mjs` writing to a foreign DB)                  | **MEDIUM**   | Repo hygiene  | Verified                                   | Misleads maintainers; seed script could mutate a real DB                                            | Delete both                                                                                                       | **P2**   |
| R-26 | **Product naming inconsistent** ("Paint ERP" / "GSN Paints" / `tanstack_start_ts`)                           | **LOW**      | Product       | Verified                                   | Confusing for installers and users                                                                  | Unify before packaging                                                                                            | **P3**   |
| R-27 | **41 unused UI components**                                                                                  | **LOW**      | Repo hygiene  | Verified                                   | Repo noise                                                                                          | NEEDS VERIFICATION before removal                                                                                 | **P3**   |
| R-28 | **Master-data codes still use `Date.now()`**                                                                 | **LOW**      | Data          | 7 code paths                               | Cosmetic collisions on master codes only                                                            | Move to the sequence table for consistency                                                                        | **P3**   |

### 30.1 Risks that can cause financial or data corruption

R-01, R-02, R-03, R-05, R-06, R-07, R-08, R-16 and R-17 are the nine that can
directly cause **financial corruption, stock corruption or data loss**. All nine
must be closed before any real business data is entered.

### 31.2 Must Fix Before Real ERP Use

Business-critical, independent of packaging.

| #   | Exact problem                                       | Module                      | Solution                                                                                                  | Why it matters                                                            | Priority | Verification                                                  |
| --- | --------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| 11  | No opening-balance or stock-adjustment transactions | `schema.sql`, new route, UI | New `ref_type='opening'`/`'adjustment'` documents writing a ledger row whenever stock is set or corrected | Day-one stock cannot be recorded, so the ledger can never be trusted (§6) | P0       | Set opening stock via the UI; `reconcileStock()` → `ok: true` |
| 12  | Live stock unreconciled                             | live DB                     | Reviewed migration inserting `opening` ledger rows for the difference, after a verified backup            | Restores confidence in every stock number                                 | P0       | `GET /api/stock/reconciliation` → `ok: true`                  |
| 13  | No receipts / payments                              | new routes + UI             | Receipt (Dr Cash / Cr Receivable), Payment (Dr Payable / Cr Cash), both ledger- and document-backed       | Receivables and payables can never be settled                             | P0       | Integration test: sale → receipt → receivable reaches zero    |
| 14  | No user management                                  | new routes + UI             | `/api/users` CRUD (admin-only), deactivate, reset password                                                | Accountability; today everyone shares one admin account                   | P0       | Create an operator; verify 403s                               |
| 15  | Live DB has no accounting                           | live DB                     | Apply schema + seed accounts, then `runBackpost()` on a verified copy, review, then live                  | No financial statement is possible today                                  | P0       | Rehearse on a copy, then run live                             |
| 16  | Legacy COGS unknown                                 | `schema.sql`, `backpost.js` | Add a `cost_price` snapshot to `sale_lines`/`return_lines`, written by the sale/return routes             | Makes future COGS exact; legacy needs an agreed manual basis              | P1       | New sale posts exact COGS                                     |
| 17  | No audit trail                                      | new table + middleware      | `audit_log` capturing actor, action, entity, before/after on every write                                  | Answers "who changed this?"                                               | P1       | Edit an item; see the audit row                               |
| 18  | Item delete is destructive and non-atomic           | `index.js:1912`, `2041`     | Transactional delete that refuses when stock exists or the item is referenced                             | Prevents silent loss of master data and valuation                         | P0       | Deleting a stocked item is refused                            |

### 31.3 Must Verify Before Windows 10 Release

| #   | Item                                                                                        | How to verify                          |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| 24  | Installer builds and installs on a **clean Windows 10 VM with no Node and no MSVC runtime** | Manual + CI clean-VM job               |
| 25  | Native module loads (no ABI error)                                                          | Launch the app; check logs             |
| 26  | Data persists across install → run → **update** → run                                       | Automated upgrade test (§31.1 #3)      |
| 27  | Uninstall **does not** delete `%APPDATA%\PaintFlowERP\data`                                 | Manual check                           |
| 28  | SmartScreen / Defender behaviour; decide on code signing                                    | Manual on a clean VM                   |
| 29  | Two instances cannot run simultaneously                                                     | Launch twice                           |
| 30  | The app works with the network disconnected                                                 | Disable the NIC and use the app        |
| 31  | Graceful quit leaves no orphaned `node.exe`; DB checkpointed                                | Task Manager + `PRAGMA wal_checkpoint` |
| 32  | Performance on a low-spec PC (4 GB RAM)                                                     | Manual                                 |
| 33  | Printing works from the packaged app                                                        | Print an invoice to an A4 printer      |
| 34  | A backup taken in the installed app restores correctly in a fresh install                   | Manual drill                           |

### 31.4 Must Verify Before Windows 7 Release

**Recommendation: do not proceed.** If the business insists, the following
minimum applies - all of it extra work on a separate build pipeline:

| #   | Item                                                                            | Note                                 |
| --- | ------------------------------------------------------------------------------- | ------------------------------------ |
| 35  | A formal decision to accept an **unsupported, unpatched** stack                 | Business decision, not technical     |
| 36  | Pin Electron **22.x** (last Windows 7 release; EOL 10 Oct 2023)                 | Separate dependency set              |
| 37  | Rebuild `better-sqlite3` against Electron 22's ABI with an older MSVC toolchain | Separate CI image                    |
| 38  | Verify React 19 / Vite 8 output on Chromium 108                                 | May require downgrading the frontend |
| 39  | A separate installer, update channel, and network isolation                     | Operationally expensive              |
| 40  | Explicit security sign-off accepting ~3 years of unpatched Chromium CVEs        | Documented risk acceptance           |

**My assessment: the cost and risk of (35)-(40) exceed the benefit. Upgrade the
PCs, or serve the ERP from a Windows 10+ host over the LAN (§24.2 Case B).**

### 31.5 Optional Improvements

Delete the dead files (`page.html`, `phase4-seed.mjs`); consolidate the duplicated
supplier/particulars routes; remove the 41 unused UI components (after
verification); unify `bun.lock`/`package-lock.json`; move master-data codes to
the sequence table; add `data-testid` attributes plus Playwright smoke tests; add
pagination and date indexes; add a barcode field and scanner-friendly inputs; add
a first-run admin wizard so setup needs no environment variables; add a
diagnostics/support page; and consider a WASTAGE/scrap document type for paint
production losses.

---

## 32. Recommended implementation order

```text
 1. Fix the live database state        (apply schema, seed accounts, back-post on a copy)
 2. Add stock opening balance + adjustment transactions
 3. Write the stock reconciliation migration; make reconcileStock() pass
 4. Add receipts and payments
 5. Add user management
 6. Add audit trail
 7. Fix non-atomic / destructive item delete; add confirmation dialogs
 8. Build the restore UI; add backup retention + scheduled backup
 9. Add P&L / balance sheet; fix report bugs; add pagination
10. Add printing / PDF
11. Install Playwright; complete browser QA on every screen
12. Harden the server: bind 127.0.0.1, CORS, rate limit, busy_timeout,
    graceful shutdown, file logging
13. Introduce a schema migration ladder (user_version)
14. Electron: main process, preload, BrowserWindow, single-instance lock,
    graceful child shutdown, health-check wait
15. Windows data-path handling (%APPDATA%) + automated upgrade test
16. Switch the Nitro preset so the frontend can be served locally
17. Rebuild better-sqlite3 for Electron (@electron/rebuild)
18. Configure electron-builder + NSIS; add version, icon, product name
19. Windows 10 install/upgrade/uninstall testing on a clean VM
20. Code signing decision
21. Windows 7 feasibility decision (recommended: no)
22. Controlled pilot with real data on one PC, with daily backups
```

**Sequencing rationale:** steps 1-9 are business-correctness work that must happen
regardless of packaging, and they carry every CRITICAL risk. Packaging (14-18)
only makes sense once the data underneath is trustworthy, because an installer
would otherwise ship a product that silently loses money. Step 22 is
deliberately last: it is the first time real data enters the system.
| 19 | No confirmation dialogs | all routes | Confirmation modal on every destructive action | One click currently destroys data | P0 | Click delete; confirm dialog appears |
| 20 | No restore UI | `app.backup.tsx` | Restore screen: list, verify, preview row counts, explicit confirm | An operator can back up but never recover | P0 | Restore a copy in a test environment and verify |
| 21 | No backup retention or scheduling | `backup.js` | Keep last N verified backups; auto-backup on start if older than 24 h; show "last backup" | Protects against disk fill and operator forgetfulness | P1 | Age the DB; confirm auto-backup runs |
| 22 | No P&L / balance sheet | new reporting | Ledger-derived statements | Needed to file taxes and satisfy a bank | P1 | Statements tie to the trial balance |
| 23 | Reports ignore returns; raw purchases hidden by the item filter | `index.js:1745`, `2254` | Fix the SQL; add regression tests | Wrong numbers shown to the user | P2 | Test with a returned sale and a raw purchase |

---

## 31. EXACTLY WHAT IS LEFT

### 31.1 Must Fix Before Electron

Prerequisites - doing them later would mean reworking the Electron layer.

| #                                                                      | Exact problem                                                             | Module                                     | Solution                                                                                  | Why it matters                                                         | Priority                                                                       | Verification                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1                                                                      | Build output is a Cloudflare Worker, not a Node server                    | `vite.config.ts` / Nitro                   | Set the Nitro preset to `node-server` (or convert to a static SPA)                        | Electron needs something servable locally; today there is nothing      | P0                                                                             | `npm run build`, start the output, `curl` it                                             |
| 2                                                                      | `better-sqlite3` compiled for system Node, not Electron                   | `server/node_modules`                      | Add `@electron/rebuild` as `postinstall`; pin the Electron version                        | The module will not load in Electron otherwise                         | P0                                                                             | Launch the packaged app; confirm the DB opens                                            |
| 3                                                                      | Database resolves inside the install directory                            | `server/src/db.js`                         | Resolve `DATA_DIR` from `app.getPath('userData')` and set it **before** importing `db.js` | Otherwise every update destroys the user's data                        | P0                                                                             | Automated v1→v2 upgrade test asserting data survives                                     |
| 4                                                                      | No graceful shutdown                                                      | `server/src/index.js`                      | SIGINT/SIGTERM handler → `db.close()` + `wal_checkpoint(TRUNCATE)`                        | Prevents WAL bloat and unclean exits on every close                    | P1                                                                             | Quit the app; confirm clean exit and a checkpointed DB                                   |
| 5                                                                      | Server binds all interfaces                                               | `index.js:2368`                            | `app.listen(PORT, "127.0.0.1", ...)`                                                      | Removes LAN exposure from a desktop app                                | P0                                                                             | `netstat` shows 127.0.0.1 only                                                           |
| 6                                                                      | No logging                                                                | new logger + Electron                      | `electron-log` to `%APPDATA%/PaintFlowERP/logs/app.log`                                   | Without it, no support is possible                                     | P1                                                                             | Log file exists with the startup sequence                                                |
| 7                                                                      | No app version                                                            | root `package.json`                        | Add `version`, `name`, `description`, `author`                                            | Required by electron-builder for the installer and Add/Remove Programs | P0                                                                             | Installer builds and lists the right version                                             |
| 8                                                                      | No `main` entry                                                           | root `package.json`                        | Add `main: "electron/main.js"`                                                            | Electron's entry point                                                 | P0                                                                             | `electron .` starts                                                                      |
| 9                                                                      | Product naming inconsistent                                               | `modules.ts`, `__root.tsx`, `package.json` | Unify on one name                                                                         | Confusing in the installer and Start Menu                              | P1                                                                             | Visual check                                                                             |
| 10                                                                     | No app icon                                                               | `build/icon.ico`                           | Create a 256x256 multi-resolution `.ico`                                                  | Required for a professional installer                                  | P1                                                                             | Installer shows the icon                                                                 |
| R-14                                                                   | **Electron not started; native module ABI mismatch pending**              | **HIGH**                                   | Deployment                                                                                | 0 of 22 prerequisites present                                          | Cannot package until the Nitro preset and `better-sqlite3` rebuild are handled | Implement §18 in the recommended order                                                   | **P1** |
| R-15                                                                   | **No logging or crash diagnostics**                                       | **HIGH**                                   | Support                                                                                   | `console.*` only                                                       | Packaged app leaves no trace; "it won't open" is undiagnosable                 | `electron-log` + startup diagnostic window + diagnostics page                            | **P1** |
| R-16                                                                   | **Item delete is not atomic and ignores stock** (`index.js:1912`, `2041`) | **HIGH**                                   | Data integrity                                                                            | Two/three bare DELETEs                                                 | Partial deletes; destruction of valuation history                              | Wrap in a transaction; refuse when stock exists                                          | **P1** |
| R-17                                                                   | **Legacy COGS unreconstructible**; gross profit overstated historically   | **HIGH**                                   | Accounting                                                                                | No cost snapshot on `sale_lines`/`return_lines`                        | Historical P&L cannot be trusted                                               | Add a cost snapshot for future lines; agree an approved legacy basis or formally exclude | **P1** |
| R-18                                                                   | **Browser QA never performed**                                            | **HIGH**                                   | QA                                                                                        | No Playwright/Cypress                                                  | No screen has been rendered by any test                                        | Install Playwright; add per-route smoke tests                                            | **P1** |
| **Complete: 2 of 8. Partial: 4 (1, 5, 6, 7). Missing/blocked: 1 (8).** |

### 29.1 Overall readiness against the brief's criteria

| Criterion                      | Status                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Stock integrity                | **NOT ACCEPTABLE**                                                                               |
| Accounting integrity           | **NOT ACCEPTABLE** (engine good, data empty)                                                     |
| Backup / restore               | **PARTIAL** (backup excellent, restore has no UI)                                                |
| Security                       | **PARTIAL** (auth good; no user management; LAN exposure)                                        |
| Business workflow completeness | **NOT ACCEPTABLE** (no receipts/payments/adjustments/opening balances)                           |
| Browser validation             | **BLOCKED**                                                                                      |
| Deployment architecture        | **NOT ACCEPTABLE** (data in install dir; two unsupervised processes)                             |
| Electron compatibility         | **NOT STARTED**                                                                                  |
| Server request log             | **NO**                                                                                           |
| Database error log             | **NO**                                                                                           |
| Startup log                    | **Partial** - `console.log` at boot (`index.js:2369-2370`)                                       |
| Crash log                      | **NO**                                                                                           |
| Backup log                     | **Partial** - `backups` records successes, nothing about failures                                |
| Migration log                  | **Y** - `migration_log` (back-post only)                                                         |
| Frontend error reporting       | **Partial** - SSR errors rendered by `error-page.ts`; runtime errors only in the browser console |

Logging is exclusively `console.log` / `console.error`. Under Electron, stdout
from a packaged app is typically discarded, so **once packaged there would be no
diagnostic record at all**.

### 28.2 How would an operator diagnose "the ERP is not opening"?

**Today: they cannot.** There is no log, no crash dialog and no diagnostics. The
most likely failure - the Express child process failing to start, or the native
module failing to load - would produce a blank window or "Cannot reach the local
server", and the operator would be told to open a command prompt that a factory
worker will not have.

### 28.3 Recommended support strategy

1. A file logger writing to `%APPDATA%\PaintFlowERP\logs\app.log` with daily
   rotation (e.g. `electron-log`).
2. **A visible startup diagnostic window**: capture child stdout/stderr and, if
   the API is not healthy within N seconds, show the last ~30 log lines with a
   "Copy details" button rather than a stack-trace dump.
3. **`uncaughtException` / `unhandledRejection` capture** to the log with
   timestamps.
4. **A Support/Diagnostics page**: app version, Electron version, Node version,
   DB path, DB size, last successful backup date and `PRAGMA integrity_check`,
   all copyable into one block.
5. **A first-run wizard** creating the admin account in the UI, so setup never
   depends on environment variables or a command prompt.

| Scenario                          | Current behaviour                                                                                                               | Risk         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Replacing the `.exe` / folder** | **Would destroy the database** if `DATA_DIR` is not set (§19.4)                                                                 | **CRITICAL** |
| **Uninstalling**                  | No uninstaller; a default one would delete the install tree, which today holds the DB and all backups                           | **CRITICAL** |
| **Reinstalling**                  | A fresh DB would be created; the user's data appears to vanish                                                                  | **CRITICAL** |
| **Upgrading the schema**          | `applySchema()` is create-only; it **cannot add columns or alter constraints**, so a future column change silently does nothing | **HIGH**     |
| **Restoring a backup**            | Works, but CLI-only with no UI, and the safety copy is inside the install tree                                                  | High         |
| **Crash mid-transaction**         | Safe - WAL guarantees atomicity; verified by test B3                                                                            | Low          |
| **Power failure**                 | Safe for committed transactions; **not tested**                                                                                 | Low-Med      |
| **App closed mid-transaction**    | Safe (rollback); no clean `db.close()`, so no final checkpoint                                                                  | Low          |
| **Disk full**                     | Writes fail with `SQLITE_FULL`, surfaced as a raw message. **No pre-flight free-space check**                                   | Medium       |
| **Two app instances**             | No single-instance lock; two processes contend on the same DB                                                                   | Medium       |

### 26.1 The single most important data-safety requirement

> **Will an application update accidentally delete the user's ERP database?**

**Yes, under today's defaults**, because the database resolves to a path inside
the application directory. Fixing this and then **proving** it with an explicit
v1 -> v2 upgrade test is the top packaging requirement, and it must be an
automated test rather than a manual check.

### 24.2 Correct architecture for each case

**Case A - Single PC (recommended, matches current design):**

```text
One Windows PC
  Electron app
   |- BrowserWindow -> http://127.0.0.1:<port>
   `- child process: Express + SQLite
       DB at %APPDATA%\PaintFlowERP\data\paint-erp.db
```

Bind Express to **`127.0.0.1` only** so it is unreachable from the network -
a one-word change (`app.listen(PORT, "127.0.0.1", ...)`) that should be treated
as a **must-fix** before packaging.

**Case B - Multiple PCs over LAN (would require a different deployment):**

```text
Server PC (dedicated machine)
  |- Express + SQLite (single writer, local disk - never a share)
  `- bound to the LAN interface behind HTTPS, with auth + rate limiting

Client PCs
  `- Browser -> https://server:port   (or a thin Electron shell loading that URL)
```

This does **not** require sharing the `.db` file. It would additionally need TLS,
a connection pool, a busy timeout, WAL coordination, role separation and
centralised logging. **None of this exists today**, so LAN operation is
classified **NOT SUPPORTED** in its current form.

### 24.3 Explicit statement

**If Electron is adopted, it should be adopted for a single-PC install.** Electron
does not create LAN capability; it removes the need for the end user to install
Node and to start two servers from a command prompt. 2. **`asarUnpack` for the native module.** `better_sqlite3.node` is a native
binary and **cannot be loaded from inside an asar archive**. This is the most
common packaging mistake for SQLite/Electron apps. 3. **`npmRebuild: true`** rebuilds native modules for the Electron ABI
automatically, addressing Blocker 2. 4. **It can ship `server/` as `extraResources`**, keeping the API as a child
process exactly as it works today - no backend rewrite needed. 5. Best-documented and most widely used, so tooling support is not a risk.

**Forge** is acceptable, but NSIS-via-`electron-builder` has the lower-friction
path and the better `asarUnpack` story.

### 22.1 Configuration decisions

| Decision         | Recommendation                                    | Rationale                                                                                   |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Installer format | **NSIS `.exe`**                                   | Familiar to non-technical staff; supports shortcuts, upgrade, uninstall                     |
| Portable `.exe`  | Also produce one                                  | Factories often run from USB or locked-down PCs                                             |
| Architecture     | **x64 only**                                      | Electron no longer ships 32-bit Windows binaries                                            |
| `appId`          | `com.paintflow.erp`                               | Required; `package.json` has no name/version                                                |
| `productName`    | `PaintFlow ERP`                                   | Sidebar says "Paint ERP", page title says "GSN Paints" - unify                              |
| `asar`           | `true` + `asarUnpack: ["**/*.node"]`              | Native module must be on disk                                                               |
| `extraResources` | `server/` + server `node_modules`                 | API runs as a child process                                                                 |
| Auto-update      | **Defer.** Prefer "download new version"          | An auto-updater silently replacing an app that owns a business database is a data-loss risk |
| Uninstall        | **Must NOT delete `%APPDATA%\PaintFlowERP\data`** | Data must survive uninstall/reinstall                                                       |
| Code signing     | **Required for real distribution**                | Avoids SmartScreen warnings                                                                 |

### 22.2 Database migration strategy across versions

- Introduce `PRAGMA user_version` and a numbered migration list.
- Each release runs pending migrations inside one transaction.
- **Always take a verified backup before migrating**, and abort with a clear
  message rather than migrating destructively.
- Keep the last N verified backups; prune older ones deliberately.

### 22.3 Backups and updates

- Backups must live in `%APPDATA%\PaintFlowERP\backups`, outside the install
  tree, so an update or uninstall cannot destroy them.
- Recommend a scheduled daily backup (on app start if the last is older than
  24 h) **plus** a prompt to copy the latest backup to removable media.

### 19.3 What must change

1. **Set `DATA_DIR` (or `DB_PATH`) before `db.js` is imported.** `db.js` reads the
   env at module load, so main must assign it **before** the first `import` of
   any server module, or load server modules via lazy dynamic `import()`.
2. **Ensure the directory exists** before opening the database (`db.js` already
   does `mkdirSync(DATA_DIR, {recursive:true})`; verify `backups/` and
   `restored/` land in the new location).
3. **Move backups out of the install tree.** `BACKUP_DIR` defaults under
   `DATA_DIR`, so fixing `DATA_DIR` fixes this - but it must be verified.
4. **Write logs to `logs/`**, not to a discarded Electron stdout.
5. **Add a real `package.json` `version`** - required for the installer, the
   Programs & Features list, and update logic.
6. **Add a migration ladder** (`user_version`) so a new installer can migrate an
   existing user database instead of relying on `CREATE TABLE IF NOT EXISTS`.

### 19.4 Will an application update delete the user's database?

**With today's defaults, yes.** If `DATA_DIR` is not set before `db.js` loads in
the packaged app, the DB resolves to a path inside `resources/`, and an Electron
auto-update (or any "replace the folder" approach) would replace or remove it.

**This is a CRITICAL risk and the single most important packaging requirement.**
Mitigation is item 1 above, and it must be proven by an explicit test: install v1,
create data, upgrade to v2, confirm the data survives.

---

## 20. Windows 10 compatibility

### 20.1 Classification: `LIKELY` (not verified)

Nothing has been packaged, installed or run on Windows 10, so VERIFIED cannot be
claimed. Component-level evidence:

| Factor                         | Finding                                                                                                                                                                            | Assessment                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Electron platform support      | Official README: _"Windows (Windows 10 and up): Electron provides x64 (amd64) and arm64 binaries for Windows."_                                                                    | **Supported**                |
| Node runtime                   | Electron bundles its own Node; system Node irrelevant at runtime                                                                                                                   | **No external Node needed**  |
| `better-sqlite3` native module | Must be **rebuilt for Electron's ABI**                                                                                                                                             | **Blocker** (§18.2)          |
| Visual C++ runtime             | A compiled native module typically needs the MSVC redistributable; `electron-builder` usually bundles it, but this **must be verified on a clean VM with no VS runtime installed** | **NOT VERIFIED - high risk** |
| Filesystem permissions         | `%APPDATA%` is always user-writable; no admin rights needed                                                                                                                        | **OK**                       |
| Path handling                  | `path.join` / `fileURLToPath` used correctly; no POSIX-only assumptions                                                                                                            | **OK**                       |
| Long paths                     | Backup names are long but under a short `%APPDATA%` path                                                                                                                           | **OK**                       |
| Defender / SmartScreen         | An unsigned installer triggers "Windows protected your PC". **Code signing** is needed to avoid a frightening first run for non-technical staff                                    | **NOT VERIFIED**             |
| Startup behaviour              | Must verify: no console window, single instance, no orphaned `node` processes                                                                                                      | **NOT VERIFIED**             |
| 32-bit x86                     | Electron no longer ships 32-bit Windows binaries                                                                                                                                   | **x64 only**                 |

### 20.2 Windows 10 verdict

**LIKELY to work** once Blocker 2 (native rebuild) and Blocker 3 (data path) are
resolved. The two genuine unknowns are the MSVC redistributable and
SmartScreen/code-signing behaviour. Both are standard and solvable, but neither
can be claimed without a real install test on a clean VM.
One-line Nitro config change, but never done and never tested.

#### Blocker 2 - `better-sqlite3` is compiled for the wrong ABI (CRITICAL)

`server/node_modules/better-sqlite3/build/Release/better_sqlite3.node` loads under
system Node 22. **Electron ships a different Node ABI**; a module built for
Node 22 will not load inside Electron and must be rebuilt against Electron's
headers.

**Required change:** add `@electron/rebuild` (or `electron-rebuild`) as a
`postinstall` step, and pin the Electron version so rebuilds are reproducible.
Must be verified on a clean CI machine, not just the developer's PC.

#### Blocker 3 - The database lives inside the install directory (CRITICAL)

```js
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "paint-erp.db");
```

Shipped inside `resources/app/`, the business database becomes
`resources/app/server/data/paint-erp.db` - **inside a folder Windows replaces on
every update and that uninstallers delete.** The env override makes the fix easy,
but **no production configuration sets it**.

#### Blocker 4 - Two processes, unsupervised (HIGH)

Electron must spawn the Express API, wait for `/api/health`, resolve a free port,
pass it to the renderer, and on quit terminate the child and close the database
cleanly. None of this exists.
| **Windows packaging/install** | - | - | - | **NONE - absent** |
| Migration against the real DB | **Y** (isolated copy) | - | - | **PARTIAL** |

### 16.3 What "52/52 passing" proves - and does not

**Proves:** the accounting and stock engines are internally consistent, the
transaction boundaries are sound, auth/roles work, backup and restore round-trip,
and numbering cannot collide.

**Does NOT prove:** that any screen renders, that any form submits correctly, that
reports show the right numbers, that the app installs on Windows, that the shipped
database is correct, or that a non-technical operator can use it.

`52/52` is a **backend** result. The app has 16 UI screens and **0% of them have
been rendered by any automated test.**

---

## 17. Build audit

| Check                               | Result                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                     | **PASS**, exit 0                                                                                                                                            |
| Output                              | `.output/` with `public/assets/*` per-route chunks and `server/`                                                                                            |
| **Is the output runnable by Node?** | **NO.** Cloudflare Worker bundle. No `listen()`, no `node:http`.                                                                                            |
| Backend "build"                     | **None.** `server/` has no build step; runs from source via `node src/index.js`. Electron would ship Node source + `node_modules`.                          |
| Production startup end-to-end       | **NOT VERIFIED.** `npm start` boots the API; the SSR server must start separately.                                                                          |
| Database init at boot               | **Yes** - `applySchema()`, `ensureChartOfAccounts()`, `ensureCurrentFinancialYear()`, `cleanupExpiredSessions()`, `ensureInitialAdminUser()` run on import. |
| Missing dependencies                | None observed; all imports resolve.                                                                                                                         |
| Native modules                      | `better-sqlite3` compiled locally for **system Node**, **not** for Electron.                                                                                |
| Production API URL                  | Hardcoded default `http://localhost:3001/api`; overridable only via build-time `VITE_API_URL`. In Electron the port should be dynamic.                      |
| Asset paths                         | Absolute (`/favicon.svg`, `/assets/...`) - fine for HTTP serving; needs care with a custom protocol handler.                                                |
| Runs without dev tooling?           | **NO.** Requires Node + npm installed today. Electron is exactly what would remove that.                                                                    |
| Formula/BOM                         | Strongest input handling (per-line errors surfaced)                                                                                                         |
| Purchase line editor                | **Card grid, not a `<table>`** - inconsistent with the other 13 screens                                                                                     |
| Loading states                      | Present on most screens                                                                                                                                     |
| Empty states                        | Present and readable (Items, Accounts, Stock, Reports, Backup)                                                                                              |
| Error display                       | Present on most screens                                                                                                                                     |
| Global network failure              | Throws `Cannot reach the local server at ...` telling the user to run `cd server && npm start` - **meaningless in a packaged desktop app**                  |
| Session expiry                      | Custom event clears session and returns to login - correct                                                                                                  |
| Toasts                              | `sonner` is a dependency but **no route imports `Toaster`** - unused                                                                                        |

### 14.3 Destructive actions - a real problem

**There is not a single confirmation dialog in the entire application** (grep for
`confirm(` / `window.confirm` across all routes: **0 matches**). Every Delete
button fires immediately, including `DELETE /api/items/:id`, which
**hard-deletes all particulars**. A single stray click destroys master data with
no undo and no audit record. **Must be fixed before release.**

### 14.4 Responsive layout

Tailwind breakpoints are used and tables sit in `overflow-x-auto` containers.
`sidebar.tsx` has a responsive pattern but is **unused** - `app.tsx` implements
its own sidebar. **NOT VERIFIED in a real browser.**

### 14.5 Print and export (CRITICAL for a physical-goods business)

| Capability                  | Status                                       |
| --------------------------- | -------------------------------------------- |
| `window.print()` anywhere   | **NONE**                                     |
| `@media print` CSS anywhere | **NONE**                                     |
| PDF generation              | **NONE**                                     |
| CSV / Excel export          | **NONE** (only download is the DB backup)    |
| Invoice / receipt printing  | **NONE**                                     |
| `data-testid` attributes    | **NONE** - makes automated UI testing harder |

A paint factory selling over the counter has **no way to print a sale receipt or
invoice**.
| --- | --- |
| Copy-only restore to a new file | **Implemented and tested** |
| Refuses to target the live DB over HTTP | **Correct** - `restoreInPlace` deliberately not exposed |
| In-place restore | **Implemented, CLI-only**, requires exact token `RESTORE-OVER-LIVE` **and** retains a safety copy |
| Corrupt backup | **Rejected**, no output file written (tested) |
| Path traversal | **Blocked** (tested) |
| Round-trip proven | **Yes**, on an isolated database (test 43) |

**However:**

| #   | Gap                                                                                                                                                                                                                                   | Severity     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| R-1 | **NO RESTORE UI.** `app.backup.tsx` offers only "Create backup" and a history table. `/api/backup/restore` and `/api/backup/verify` are **never called by any frontend code** (grep-verified). An operator physically cannot restore. | **Critical** |
| R-2 | **No restore drill / documented procedure.**                                                                                                                                                                                          | High         |
| R-3 | In-place restore is CLI-only, so a normal operator needs a terminal.                                                                                                                                                                  | High         |
| R-4 | **No guaranteed automatic pre-restore backup** beyond the in-place safety copy (itself inside the install tree).                                                                                                                      | Medium       |
| R-5 | **No scheduled verification of existing backups on disk.**                                                                                                                                                                            | Medium       |

**Explicit classification requested by the brief:** restore functionality is
**NOT MISSING** at the API layer - it is implemented and tested. It is **MISSING
from the product UI**, which is the equivalent problem for the user.

### 12.4 Operational risk

A factory that adopts this and clicks "Create backup" believes it is protected.
It is protected only against accidental data-entry error. It is **not** protected
against: disk failure (backup on the same disk), Windows reinstall (backup inside
the install folder), ransomware (backups writable in place), or an operator
needing to roll back (no UI).
---

## 10. Database safety audit

### 10.1 Single local Windows PC

| Control               | Status                                                    |
| --------------------- | --------------------------------------------------------- |
| WAL mode              | **Enabled** (`db.js`) - concurrent readers during a write |
| Foreign keys          | **ON**; `foreign_key_check` = 0 violations                |
| Transactions          | Correct for all multi-table writes (§11)                  |
| Rollback              | Verified by test B3                                       |
| Corruption handling   | `PRAGMA integrity_check` on backup and restore            |
| Backups               | WAL-safe `db.backup()`; verified; corrupt files deleted   |
| **busy_timeout**      | **NOT SET** - the biggest robustness gap for one PC       |
| **Schema versioning** | **NONE** (`user_version = 0`)                             |
| WAL checkpointing     | Only in `restoreInPlace`; no routine checkpoint/size cap  |
| Single connection     | Acceptable for one PC                                     |

**Assessment: usable, but `busy_timeout` and a migration ladder must be added
before it can be called reliable.** On Windows, Defender real-time scanning of
`.db`/`.db-wal` is a well-known cause of transient `SQLITE_BUSY`; without a busy
timeout the app surfaces a raw error to the operator.

### 10.2 Multiple computers over a LAN - NOT SUPPORTED, must not be attempted

| Blocker                     | Detail                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| SQLite over a network share | **Fundamentally unsafe.** SQLite relies on file locking that is unreliable over SMB; corruption is a likely outcome. |
| No `busy_timeout`           | Guaranteed `SQLITE_BUSY` under real concurrency                                                                      |
| No connection pooling       | One synchronous connection serialises everything                                                                     |
| Single-writer design        | One process expected                                                                                                 |
| Server binds all interfaces | Makes accidental LAN exposure likely, and it is **unauthenticated at the transport layer**                           |
| No transport encryption     | Bearer tokens in cleartext over HTTP                                                                                 |
| Single-instance lock        | **MISSING** - two instances on one PC will fight over the same DB file                                               |

**Correct LAN architecture, if ever needed:** run the Express + SQLite API on
**one** designated machine and have clients point at it over HTTP(S) - never share
the `.db` file over the network. Even then the app needs pooling, a busy
timeout, and TLS before it would be appropriate. **This audit therefore
classifies the application as single-PC-only.**
(`admin`, role `admin`).

**Consequence:** in the shipped product _every_ operator must log in as the
single admin account. That defeats the role model (every operation is
admin-permitted by default), destroys accountability, and makes "log out"
meaningless from an audit perspective.

### 8.2 No general audit trail

No record of who performed a transaction. `purchases.created_by` and
`sales.created_by` are populated for creates, but there is **no edit or delete
audit**, and several master entities are hard-deleted (§11).

### 7.4 Legacy back-posting - honest assessment

`backpost.js` is genuinely well designed: dry-run, per-document transaction,
idempotency re-check inside the transaction, audit row in the same transaction,
refusal of unreconstructable documents, and `revertBackpost()`.

But its output is bounded by the data:

| Limitation                                                                  | Consequence                              |
| --------------------------------------------------------------------------- | ---------------------------------------- |
| `sale_lines` / `return_lines` have **no cost column**                       | Legacy COGS unreconstructible            |
| `stock_ledger.rate` on sale/return rows is the **sale** rate, not unit cost | Cannot be used as cost                   |
| No `opening` balance ledgers exist                                          | Inventory accounts would start from zero |
| 2 returns have no line rows                                                 | Unknown cost effect                      |
| Production `overhead_cost` is always 0                                      | Overheads cannot be capitalised          |

The back-post correctly posts the **revenue side only** for legacy sales and
returns and reports the omission. **Gross profit for legacy periods is therefore
overstated**, stated in code comments and the audit trail rather than hidden.
That is the right engineering decision, but the accounting is **not audit-grade**
for historical periods.

### 7.5 Idempotency and duplicate protection

- Application-level: `hasVoucher(ref_type, ref_id)` re-checked inside the
  transaction. Good.
- Storage-level: partial unique index `idx_vouchers_ref_unique`. **Present in
  `schema.sql`, MISSING from the live DB.** Until `applySchema()` runs against the
  shipped file, duplicate posting is possible there.

### 7.6 Financial-year handling

- Single year live: `2026-2027`, `2026-07-01..2027-06-30`, current, open.
- **`assertPostingAllowed()` returns early if a date matches no year.** Purchases
  and productions are dated **2025-01-01 / 2025-01-02**, outside the only defined
  year - those legacy documents sit in **no financial period** and are entirely
  unprotected by the closed-year guard. Sales/returns dated `2026-10-04` are
  inside the current year.
- Year rollover is atomic and tested.

### 7.7 Accounting verdict

**Engine: sound. Data: empty. Completeness: materially incomplete.**
**timestamp-derived default names** from the old `Date.now()`-based create
routes. This is **synthetic test data, not real business history.**

4. **`balance_after` is computed from `stock_qty`, not from the ledger.**
   Every write does `UPDATE ... stock_qty = stock_qty ± qty` and then stores that
   new `stock_qty` into `balance_after`. `balance_after` is therefore _not_ an
   independent check - it always agrees with `stock_qty` by construction, so the
   column can never detect a divergence.

### 6.4 Can the ERP guarantee "every stock movement has a ledger entry"?

**No - not currently, and not by design.**

| Movement                                 | Ledger written? | Atomic with stock?    | Enforced?                  |
| ---------------------------------------- | --------------- | --------------------- | -------------------------- |
| Purchase (raw / finished)                | **Yes**         | Yes (`index.js:847`)  | Yes                        |
| Production consumption                   | **Yes**         | Yes (`index.js:1027`) | Yes                        |
| Production output                        | **Yes**         | Yes                   | Yes                        |
| Counter sale                             | **Yes**         | Yes (`index.js:1244`) | Yes                        |
| Issue voucher                            | **Yes**         | Yes (`index.js:1424`) | Yes                        |
| Returns (both types)                     | **Yes**         | Yes (`index.js:1530`) | Yes                        |
| **Opening stock set at master creation** | **NO**          | n/a                   | **No such concept**        |
| **Manual adjustment**                    | **NO**          | n/a                   | **Feature does not exist** |
| **Direct DB edit / seed script**         | **NO**          | n/a                   | Outside the app            |

**Risk classification: HIGH (data integrity).** Within the transaction
workflows the invariant holds and is enforced by transactions. It breaks
precisely where stock is _set_ rather than _moved_ - which is exactly what a
factory does on day one, and exactly what makes stock take-on impossible to
record accurately.

### 6.5 The finished-stock delta of 10

Finished stock 660 vs ledger 650. Two returns in the live DB have
**no line rows at all** (`returns` 5, `return_lines` 3), so their stock effect
is unknown. Consistent with cause 1/3 - synthetic data, partially written.

### 6.6 Recommended remedy (no data was changed by this audit)

1. Add an **opening-balance** transaction (`ref_type='opening'`) that writes a
   ledger row whenever a stock balance is established.
2. Add a **stock-adjustment** transaction with mandatory reason, approver, and
   audit row.
3. Write a **one-off reconciliation migration** that, for every item with a
   non-zero `stock_qty` and no/short ledger, inserts a single dated
   `opening` ledger row for the difference - with the operator's explicit
   approval and after a verified backup.
4. Until then, treat the live stock figures as **unverified** and do not rely on
   `reconcileStock()` passing as a release gate.
   | 33 | **Audit log** | **-** | P | P | - | Y (admin) | - | - | - | - | P (`migration_log` only) | - | NV | **NO general audit trail** |
   | 34 | **Multi-company** | **-** | **-** | **-** | - | - | - | - | - | - | - | - | NV | **MISSING / out of scope** (single-site ERP) |
   | 35 | **Print / PDF** | **-** | **-** | - | - | - | - | - | - | - | - | - | - | NV | **MISSING - see §27** |

### 5.1 Notable authorization observation

**Any authenticated user (role `user`) can create, edit, and delete Items,
Purchases, Productions, Sales, Issue Vouchers and Returns.** Only master-data
administration and destructive system operations are admin-gated. That is a
defensible design for a small single-site factory, but it means there is **no
read-only accountant role** and no separation of duties. For a business where
one person both enters sales and checks the books, that is a control weakness
worth noting - not a vulnerability, since server-side enforcement is real.

### 5.2 Notable UI observation

`app.accounts.tsx` still displays the empty-state text _"Add them in Setup /
Masters when Phase 3 is available."_ Phase 3 **is** available. Stale UI text
indicates the screens have not been revisited since the earlier phase work.

### 4.2 Weaknesses identified

| #                           | Weakness                                                                                                                                                                                | Severity                                                                   | Evidence                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| A-1                         | **Two servers must be started and coordinated.** Nothing supervises the Express process; if it dies the UI shows only "Cannot reach the local server at ...".                           | High (ops)                                                                 | `api.ts:66-71`                                    |
| A-2                         | **Build target contradicts the offline requirement.** Cloudflare Workers is a cloud preset; `README.md` forbids cloud dependency.                                                       | High                                                                       | `.output/server/wrangler.json`                    |
| A-3                         | **Single synchronous SQLite connection, no pool, no `busy_timeout`.** One long write blocks everything; concurrent access yields immediate `SQLITE_BUSY`.                               | High (concurrency)                                                         | `db.js` (only `journal_mode`, `foreign_keys`)     |
| A-4                         | **Server binds all interfaces** (`app.listen(PORT)` with no host) -> the API is reachable from the LAN. Combined with wide-open `cors()`, any host on the network can attempt requests. | High (security)                                                            | `index.js:2368`, `index.js:109`                   |
| A-5                         | **No graceful shutdown.** No `SIGINT`/`SIGTERM` handler, no `db.close()`, no WAL checkpoint on exit.                                                                                    | Medium                                                                     | `index.js:2368-2371` is the last code in the file |
| A-6                         | **No structured logging.** Only `console.log`/`console.error`; no log file, no rotation, no request log, no crash log.                                                                  | High (support)                                                             | whole backend                                     |
| A-7                         | **Error handler leaks internals** - `err.message` returned to the client verbatim.                                                                                                      | Low                                                                        | `index.js:2363-2366`                              |
| A-8                         | **No schema migration ladder.** `user_version = 0`; schema evolution is only `CREATE TABLE IF NOT EXISTS`, which cannot add columns or alter constraints on an existing DB.             | High                                                                       | `db.js:17-20`, `schema.sql`                       |
| A-9                         | **Monolithic route file** (81 KB / 80 routes), no controller/service separation.                                                                                                        | Medium                                                                     | `index.js`                                        |
| A-10                        | **Auth token in `localStorage`** - readable by any XSS. No httpOnly cookie. The CSRF middleware in `start.ts` protects only TanStack _server functions_, **not** the Express API.       | Medium                                                                     | `api.ts:22,37`, `start.ts:23-25`                  |
| A-11                        | **No service layer**; business logic embedded in route handlers.                                                                                                                        | Medium                                                                     | `index.js`                                        |
| A-12                        | `app.use(cors())` with no origin allow-list.                                                                                                                                            | Medium                                                                     | `index.js:109`                                    |
| `productions.overhead_cost` | **DEAD COLUMN**                                                                                                                                                                         | Always inserted as `0` (index.js:1090); back-post refuses to capitalise it | nothing                                           | Clarify or remove | Low |

| Item                    | Finding                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json` name     | `tanstack_start_ts` - **template default, never renamed**                                                                                        |
| `package.json` version  | **`undefined`** - no version field at all                                                                                                        |
| `main` field            | absent (fine for web, **required** for Electron)                                                                                                 |
| Frontend build          | `vite build` -> exit 0                                                                                                                           |
| Build output            | `.output/` (Nitro), incl. `.output/server/wrangler.json`                                                                                         |
| **Deployment target**   | **Cloudflare Workers** - `main: index.mjs`, `compatibility_date`, assets binding, `nodejs_compat` flag, `.wrangler/deploy/config.json` generated |
| Node listener in output | **None.** `index.mjs` (17,835 B) has no `listen(`/`node:http` - it is a worker `fetch` handler                                                   |
| Lock files              | **`bun.lock` (141 KB) AND `package-lock.json` (159 KB) both committed**                                                                          |
| Native deps             | `better-sqlite3@11.10.0`, `build/Release/better_sqlite3.node` (**locally compiled**, no prebuild dir)                                            |
| Env files               | **No `.env`, no `.env.example`**, no `VITE_API_URL` file; default hardcoded `http://localhost:3001/api`                                          |
| Root `test` script      | **absent** - tests live only under `server/`                                                                                                     |
| Server scripts          | `start`, `dev`, `init-db`, `backup`, `test`                                                                                                      |

### 3.1 Frontend (verified)

| Area              | Files                                                                                                                                                                                                                                 | Notes                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Router / shell    | `src/router.tsx`, `src/routes/__root.tsx`, `src/routeTree.gen.ts` (generated)                                                                                                                                                         | TanStack Start **file-based + SSR**                         |
| Server entry      | `src/server.ts`, `src/start.ts`                                                                                                                                                                                                       | Nitro/h3 fetch handler; error-page wrapper; CSRF middleware |
| Routes (16)       | `index`, `app`, `app.index`, `app.items`, `app.formula`, `app.setup`, `app.purchase`, `app.production`, `app.counter-sale`, `app.issue-voucher`, `app.returns`, `app.stock`, `app.accounts`, `app.reports`, `app.backup`, `app.sales` | `app.sales.tsx` is a **16-line placeholder**                |
| Shared components | `formula-bom-modal.tsx`, `module-placeholder.tsx`                                                                                                                                                                                     |                                                             |
| UI kit            | 45 files in `src/components/ui/` (shadcn-style)                                                                                                                                                                                       | **41 unused by any route**                                  |
| Lib               | `api.ts`, `auth.tsx`, `modules.ts`, `utils.ts`, `error-capture.ts`, `error-page.ts`, `lovable-error-reporting.ts`                                                                                                                     |                                                             |
| Hooks             | `use-mobile.tsx`                                                                                                                                                                                                                      | Only consumed by the unused `sidebar.tsx`                   |

There are **no** service or state-store layers beyond `api.ts`/`auth.tsx`.
No `react-query` hooks wrapping API calls - screens call `apiGet`/`apiPost`
directly inside `useEffect`.

- `better-sqlite3` ships as a **locally compiled `better_sqlite3.node`** built
  against system Node 22's ABI. Electron uses a different ABI; it must be rebuilt
  or it will fail to load.
- The database path is **relative to the server source directory**, so after
  installation the user's business database would live inside a replaceable
  program folder.
- The server **binds all network interfaces** and has **no graceful shutdown**.

Underneath Electron, the ERP is missing entire accounting workflows (**no
receipts, payments, stock adjustments, opening balances, transfers, wastage,
journal vouchers, expense/income entry, or banking**), has **no user-management
capability at all** (one hard-coded admin; no way to create an operator), **no
printing or PDF export of any kind**, and a **live stock position its own
reconciliation endpoint reports as unreconcilable**.

### Honest headline

| Question                            | Answer                                                |
| ----------------------------------- | ----------------------------------------------------- |
| Does it build?                      | **Yes** — VERIFIED.                                   |
| Do tests pass?                      | **Yes, 52/52** — VERIFIED (I read every test name).   |
| Is TypeScript / lint clean?         | **Yes** — VERIFIED.                                   |
| Is the accounting data trustworthy? | **No** — zero accounting rows exist.                  |
| Is the stock data trustworthy?      | **No** — reconciliation `ok: false`, 19 issues.       |
| Can an operator restore a backup?   | **No UI**; API works but is unreachable from the app. |
| Is Electron ready?                  | **Not started.**                                      |
| Is Windows 10 ready?                | **NOT VERIFIED** — nothing packaged or run.           |
| Is Windows 7 ready?                 | **Not viable** on a supported Electron.               |
