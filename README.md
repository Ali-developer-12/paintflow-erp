# PaintFlow ERP

Lovable AI — Build Prompt: Paint Factory ERP (Full Project)

Paste this as your project prompt / first message in Lovable.

PROJECT OVERVIEW

Build a full ERP (Enterprise Resource Planning) system for a paint manufacturing/trading business. I have attached screenshots of the legacy system this replaces — match the same information density (two-panel item lists, dense data grids, lots of fields visible at once), but the visual design itself should be fully modern — clean modern SaaS UI, modern typography, good spacing, modern components (cards, tabs, modals, toasts) — do not copy the old beige/blue 90s look. Modernize the look, keep the density and functionality.

Database: I need this to run offline with a local SQLite (or MySQL) database, not a cloud database. I understand your sandbox environment may not be able to actually run a Node+Express+ SQLite or MySQL backend live in preview — that's fine, it's not a blocker. Build the project with that architecture anyway (real Express + SQLite/MySQL backend code, not mocked), even if you can't fully preview/run the backend inside Lovable's sandbox. I will run and test the backend myself outside Lovable (locally or in another tool). Prioritize generating correct, complete, working code over having a live preview.

Tech stack:

Frontend: React + TypeScript + Tailwind CSS (modern UI, your choice of component library)

Backend: Node.js + Express

Database: SQLite (via better-sqlite3) preferred; MySQL is an acceptable alternative if that's easier for you to scaffold correctly — pick one and be consistent, don't mix

Desktop packaging (later phase): Electron, same codebase

No cloud database, no Supabase, no Firebase, no external hosting dependency

CORE MODULES (full scope)

Login / Lock screen — username+password check against local users table

Items Master — Item list (left) + Particulars grid (right): Type, Weight/Unit, Cost Price, W.S. Price, Sale Price, Stock, Min, Max, Formula Code

Formula / BOM — per item-particular: raw material lines (name, value, rate, cost value), auto-calculated totals

Setup / Masters — Employees, Customers, Suppliers, Transporters, Account Chart, Factory Items (raw materials), New Year Posting

Purchase — purchase entry against suppliers, updates raw material stock

Production — consumes raw materials per Formula, produces finished goods, updates stock

Counter Sale — sale entry against customers, deducts stock

Issue Voucher — Voucher No, Date, Customer, Remarks, item lines (Size/Shade/In Stock/Qty)

Return — customer/supplier returns, adjusts stock and accounts

Stock — live stock view + stock ledger (full movement history)

Accounts — chart of accounts, customer/supplier ledgers, balances

Reports — Sale, Purchase, General Reports (filterable by date, party, item)

Backup — one-click export/copy of the database file

PHASE PLAN (build strictly in this order — do not skip ahead)

Phase 1 — Foundation

Express + SQLite (or MySQL) backend scaffold, full database schema for ALL 13 modules created now, even for modules with no UI yet

Modern login screen, app shell/navigation (sidebar or top nav) listing all modules

Phase 2 — Items & Formula

Modern two-panel Items Master screen (list + editable particulars grid)

Formula/BOM modal with auto-calculated totals

Phase 3 — Setup / Masters

Employees, Customers, Suppliers, Transporters, Account Chart, Factory Items — full CRUD, modern forms and tables

Phase 4 — Purchase & Production

Purchase entry (updates raw material stock)

Production entry (consumes raw materials per Formula, produces finished goods)

Phase 5 — Sales & Vouchers

Counter Sale screen

Issue Voucher screen (Voucher No, Date, Customer, Remarks, item grid)

Return screen

Phase 6 — Stock & Accounts

Live stock dashboard + stock ledger

Accounts module: chart of accounts, party ledgers, balances

Phase 7 — Reports & Backup

Sale/Purchase/General Reports with filters

One-click database backup/export

Phase 8 — Desktop Packaging & Polish

Electron wrapper for a Windows desktop build

Validation, error handling, responsive layout, final QA pass

CRITICAL INSTRUCTION — CREDIT / PROGRESS TRACKING

Maintain a file in the project root named PROGRESS.md. Update it:

Immediately after completing each phase, or any meaningful chunk of work within a phase

Whenever you sense you are running low on credits/context for the current session, before doing anything else, write to PROGRESS.md:

Which phases are fully complete

Which phase is in progress, and exactly what has been done in it so far

What remains, as a clear checklist, so a fresh session can resume without re-reading the whole codebase

Any decisions, assumptions, or deviations from this prompt, and why (including any sandbox limitations you hit with the backend/database)

Any known bugs or incomplete features

Exact commands needed to run the project outside Lovable (install, init-db, start)

Never let a session end silently without updating PROGRESS.md. Always read PROGRESS.md first at the start of a new session before making any changes.

CRITICAL INSTRUCTION — GITHUB

Connect this project to GitHub and push after every phase is completed, and after any PROGRESS.md update. Use clear commit messages, e.g. "Phase 2 complete: Items + Formula module" or "Progress update: mid Phase 4, production module in progress".

Add a .gitignore excluding node_modules/ and the real local database file (don't commit actual business data — only code and schema).

If GitHub is not connected yet, ask me to connect it before proceeding past Phase 1.

BOUNDARIES / WHAT NOT TO DO

Do not use a cloud database, cloud auth, or cloud storage service, even if it would be easier to preview — the target architecture is local SQLite/MySQL, full stop.

Do not silently fall back to a different architecture (e.g. IndexedDB, localStorage, Supabase) without asking me first and explaining why.

Do not invent new modules or rename existing ones without asking.

Do not skip full database schema design in Phase 1, even for modules without UI yet.

Do not remove or rewrite PROGRESS.md history — only append/update status.

Do not mark a phase "complete" unless its screens are functional and wired to real backend endpoints and the real database schema (not static/mock data).

Ask before making destructive database changes once real data may exist.

FIRST RESPONSE EXPECTED FROM YOU

Confirm the tech stack, the modern-UI direction, and the phase plan above.

Tell me clearly whether your sandbox can run the Express + SQLite/MySQL backend live, or only generate the code for me to run elsewhere — either is fine, I just want to know which.

Create PROGRESS.md with Phase 1 marked "in progress" and an empty checklist for the rest.

Begin Phase 1.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6337c550-3e6f-4d6b-b88c-20800f99a047).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
