# QA Report — Phases 2, 4, and 6

Date: 2026-09-16  
Method: real local Express server and SQLite database exercised over the authenticated HTTP interface. The in-app browser automation surface was unavailable in this session, so visual/click-level assertions are identified below as not executable rather than inferred.

## Summary

| Test # | Area | Result | Notes |
| --- | --- | --- | --- |
| 1 | Login | PASS | `admin / admin123` returned 200 and authenticated admin session. |
| 2 | Login | PASS | Wrong password returned 401 with `Invalid username or password`. |
| 3 | Items | PASS | Created a unique `QA-DELETE-*` item. |
| 4 | Items | PASS | Created its `Can` particular with all requested numeric fields. |
| 5 | Items | PASS | Updated sale price (15 → 18) and stock (4 → 7); subsequent GET returned persisted values. |
| 6 | Items | PASS | Deleted the particular; subsequent GET returned no particulars. |
| 7 | Items | PASS | Deleted the parent item; it no longer appeared in active items. |
| 8 | Items | PASS | Blank name request returned 400 `Item name is required`. |
| 9 | Formula/BOM | PASS | Created `QA-FORMULA-*` item and `Batch` particular. |
| 10 | Formula/BOM | PASS | Stored three formula lines (all against the only available raw material, Solvent). |
| 11 | Formula/BOM | PASS | Initial line arithmetic was 1×10=10, 2×20=40, 3×30=90; total 140. |
| 12 | Formula/BOM | PASS | Edited first value to 2; resulting arithmetic was 20+40+90=150. |
| 13 | Formula/BOM | PASS | Removed third line; persisted arithmetic is 20+40=60. |
| 14 | Formula/BOM | PASS | Fresh GET returned exactly two saved lines, values 2/2 and costs 20/40. |
| 15 | Purchase | PASS | Recorded Solvent starting quantity: 110 KG. |
| 16 | Purchase | PASS | Saved 20 KG @ 80 purchase against shim supplier. |
| 17 | Purchase | PASS | Solvent became 130 KG, exactly +20. |
| 18 | Purchase | PASS | Ledger `PUR-1789580390473`: qty in 20, balance 130. |
| 19 | Purchase | FIXED | Re-test: zero and negative quantities now return 400; purchase and ledger counts remain unchanged. |
| 20 | Production | PASS | Before run: Solvent 130 KG; finished good 0 KG. |
| 21 | Production | PASS | Produced a 10-unit batch. |
| 22 | Production | PASS | Batch multiplier 10/10=1; expected Solvent use 2+2=4 KG. |
| 23 | Production | PASS | Solvent became 126 KG (130−4), exact match. |
| 24 | Production | PASS | Finished good became 10 KG, exact +10. |
| 25 | Production | PASS | Two raw ledger rows (2 KG each, balances 128/126) and one finished row (+10, balance 10). |
| 26 | Production | PASS | 1,000-unit attempt returned 400: requires 200, available 126; remained 126 and production count unchanged. |
| 27 | Production | PASS | Fresh database reads retained 126 KG raw / 10 KG finished quantities. |
| 28 | Stock | PASS | `/stock/summary` showed Solvent 126 and QA finished item 10, matching test observations. |
| 29 | Stock | NOT EXECUTED | Warning color/indicator requires visual UI inspection; browser control was unavailable. |
| 30 | Stock | PASS | Raw-item/date filter returned only five Solvent rows; finished-item/date filter returned only the produced-good row. |
| 31 | Accounts | PASS | Shim supplier ledger contained all purchases with running balance 10,000 → 11,600; the QA purchase contributed 1,600. |
| 32 | Accounts | PASS | Chart endpoint returned the 12 seed accounts without error. |

## Failed or suspicious findings

### F-01 — Zero-quantity purchase is recorded as a real transaction — FIXED

Fix verification (2026-09-16): `POST /api/purchases` now validates every line before any write. Both `qty: 0` and `qty: -1` returned 400 `Quantity must be greater than 0`; purchase count stayed 3 and raw-item ledger count stayed 5. A subsequent valid 1 KG purchase returned 201.

Data cleanup (2026-09-18): manually removed the pre-fix zero-quantity test purchase `PUR-1789580390506`, its line, and its zero-movement stock ledger row; Solvent remains at the correct 127 KG balance.

Severity: Medium

Steps to reproduce:

1. Authenticate as admin.
2. POST `/api/purchases` with supplier `1` and a raw-material line with `qty: 0`, `rate: 80`, `amount: 0`.
3. Inspect `/api/stock/ledger?item_id=1&stock_type=raw`.

Expected: the purchase should be rejected before writing purchase, line, stock, or ledger records.

Actual: request succeeded; `PUR-1789580390506` was created with `qty_in: 0`, `qty_out: 0`, and `balance_after: 130`. It also appears in the supplier ledger as a zero-value purchase.

Likely responsible: `server/src/index.js`, `POST /api/purchases`. It validates only that at least one line exists, not that every saved line has a positive quantity.

### S-01 — Formula header total is stale/zero while line calculations are correct — FIXED

Fix verification (2026-09-16): the server now derives `formulas.total_cost` from the rows it has just stored. Re-saving the two-line formula while deliberately sending `total_cost: 999999` returned persisted line costs 20 and 40 and header total 60.

Severity: Low / suspicious

Steps to reproduce:

1. Save a formula with two persisted lines: 2×10=20 and 2×20=40.
2. GET `/api/formulas/:particularId`.

Expected: formula header `total_cost` should equal the saved line total (60), if that column is intended to be authoritative.

Actual: each `formula_lines.cost_value` is correct (20 and 40), but `formulas.total_cost` is 0 because the client/request does not supply it. The rendered Formula/BOM UI may calculate its displayed total from lines; visual verification was not available.

Likely responsible: `server/src/index.js`, `POST /api/formulas/:particularId`, which persists request `total_cost` instead of deriving it from stored lines.

## Confidence assessment

Phase 2 item CRUD and formula-line persistence are suitable for further user testing: validation, persistence, edit, and delete paths worked. The formula header total should not yet be relied upon for reporting until S-01 is clarified.

Phase 4 production stock logic has the strongest confidence: the exact manual consumption calculation, ledger balances, persistence, and insufficient-stock atomicity all passed. Purchase intake is not ready for unrestricted business use because F-01 allows meaningless zero-quantity documents and ledger rows.

Phase 6 read-side stock and accounts endpoints correctly reflected the exercised Phase 4 data, including filters and supplier running balance. Visual low-stock warning behavior remains unverified because browser automation was unavailable; it needs one click-level QA pass before sign-off.
