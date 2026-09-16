# Phase 1 Progress

## Progress — [Your Name]

Phase 2 is complete for Items + Formula/BOM in scope. The work completed in the route shell, the items route, and server endpoints reuses the existing tables `items`, `item_particulars`, `formulas`, `formula_lines`, and `factory_items`; no new tables were invented and no schema migration was required. The only deviation observed during verification was that the formula line write depends on an existing `factory_items` parent row (`factory_item_id` foreign key), so the example `Solvent` factory row was seeded in the existing database to satisfy the line insert path. Phase 4 has not started yet.

Formula/BOM route repair note: the sidebar route target `/app/formula` previously pointed to a real URL without a matching page file, which produced the visible "Not Found" state. A shared Formula/BOM modal component was extracted from the Items Master page and a new route page in `src/routes/app.formula.tsx` now lists formula-backed particulars, supports opening the same modal editor, and includes a direct Items Master jump path for particulars without a formula. The Express API in `server/src/index.js` now includes a `/api/formulas` list endpoint and `/api/formulas/unassigned` discovery endpoint so the standalone page can render from the existing database tables rather than from a synthetic placeholder.

Documentation note: the Formula/BOM material dropdown is intentionally limited to existing `factory_items` rows. Those rows are populated later in the Phase 3 data/master setup work, so the dropdown dependency on `factory_items` should be read as a known sequencing dependency rather than a bug in the modal or route implementation.

Phase 1 is complete for the requested handoff. The backend in `server/` provides an Express API backed by a SQLite database, and the frontend uses the existing design system and shared app shell. All sidebar placeholder routes relevant to Phase 1 now render safely inside the current app layout without crashing.

## Architecture Summary

- Backend: Express API and local SQLite database in `server/`
- Database: SQLite schema and init scripts in `server/src/schema.sql` and `server/src/init-db.js`
- Frontend: Vite + TanStack Router + React UI shell using the shared design system in `src/components/ui/`

## Phase 4 Progress

Phase 4 is complete for the requested Purchase + Production scope. The UI now includes a purchase voucher screen that accepts raw materials or finished items, calculates item totals, writes purchase header/line records, and updates stock plus stock ledger rows. The production screen relies on a real Formula/BOM definition, calculates required raw materials by batch multiplier, validates stock before reducing inventory, and records ledger entries for each input consumed and each finished good produced.

Production calculation logic: the server-side helper in `server/src/phase4-logic.js` multiplies each formula line by the batch multiplier (`batchQty / batchSize`) and adds the resulting material quantities and costs. This keeps the logic isolated from route handlers, easy to read, and ready for unit testing later.

Temporary supplier shim: the purchase screen includes a simple inline "add supplier name" fallback when the `suppliers` table is empty because Phase 3 supplier CRUD is not yet implemented. This is intentional and should be removed once the real supplier management UI is added in Phase 3.

Phase 6 is not started yet.

## Phase Checklist

- [x] Phase 2: Items & Formula/BOM
- [ ] Phase 3: Setup / Masters (Employees, Customers, Suppliers, Transporters, Account Chart, Factory Items)
- [x] Phase 4: Purchase & Production
- [ ] Phase 5: Sales & Vouchers (Counter Sale, Issue Voucher, Return)
- [ ] Phase 6: Stock & Accounts
- [ ] Phase 7: Reports & Backup
- [ ] Phase 8: Electron desktop packaging & polish
