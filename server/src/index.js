import express from "express";
import cors from "cors";
import fs from "node:fs";
import db, { applySchema, DB_PATH } from "./db.js";
import { createSession, destroySession, hashPassword, requireAuth, verifyPassword } from "./auth.js";
import { calculateProductionRequirements } from "./phase4-logic.js";

applySchema();

if (db.prepare("SELECT 1 FROM users LIMIT 1").get() === undefined) {
  const { hash, salt } = hashPassword("admin123");
  db.prepare(
    "INSERT INTO users (username, password_hash, password_salt, full_name, role) VALUES (?, ?, ?, ?, ?)",
  ).run("admin", hash, salt, "System Administrator", "admin");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3001;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: DB_PATH, time: new Date().toISOString() });
});

// ---------- Auth ----------
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const user = db
    .prepare("SELECT * FROM users WHERE username = ? AND is_active = 1")
    .get(String(username).trim());
  if (!user) return res.status(401).json({ error: "Invalid username or password" });

  let ok = false;
  try {
    ok = verifyPassword(password, user.password_hash, user.password_salt);
  } catch {
    ok = false;
  }
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  const session = createSession(user.id);
  res.json({
    token: session.token,
    expires_at: session.expires_at,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/factory-items", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM factory_items WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

// ---------- Phase 3: Setup / Masters ----------
app.get("/api/setup/employees", requireAuth, (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM employees WHERE is_active = 1 ORDER BY name ASC")
    .all();
  res.json(rows);
});

app.post("/api/setup/employees", requireAuth, (req, res) => {
  const { name, designation = "", phone = "", address = "", salary = 0 } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Employee name is required" });
  }

  const row = db
    .prepare(
      "INSERT INTO employees (code, name, designation, phone, address, salary, join_date, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, date('now'), 1, datetime('now'))",
    )
    .run(`EMP-${Date.now()}`, String(name).trim(), String(designation || ""), String(phone || ""), String(address || ""), Number(salary || 0));

  const result = db.prepare("SELECT * FROM employees WHERE id = ?").get(row.lastInsertRowid);
  res.status(201).json(result);
});

app.put("/api/setup/employees/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, designation = "", phone = "", address = "", salary = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Employee name is required" });

  db.prepare(
    "UPDATE employees SET name = ?, designation = ?, phone = ?, address = ?, salary = ? WHERE id = ?",
  ).run(String(name).trim(), String(designation || ""), String(phone || ""), String(address || ""), Number(salary || 0), id);

  res.json(db.prepare("SELECT * FROM employees WHERE id = ?").get(id));
});

app.delete("/api/setup/employees/:id", requireAuth, (req, res) => {
  db.prepare("UPDATE employees SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/customers", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/customers", requireAuth, (req, res) => {
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Customer name is required" });

  const row = db
    .prepare(
      "INSERT INTO customers (code, name, phone, address, opening_balance, credit_limit, is_active, created_at) VALUES (?, ?, ?, ?, ?, 0, 1, datetime('now'))",
    )
    .run(`CUST-${Date.now()}`, String(name).trim(), String(phone || ""), String(address || ""), Number(opening_balance || 0));

  res.status(201).json(db.prepare("SELECT * FROM customers WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/customers/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Customer name is required" });

  db.prepare(
    "UPDATE customers SET name = ?, phone = ?, address = ?, opening_balance = ? WHERE id = ?",
  ).run(String(name).trim(), String(phone || ""), String(address || ""), Number(opening_balance || 0), id);

  res.json(db.prepare("SELECT * FROM customers WHERE id = ?").get(id));
});

app.delete("/api/setup/customers/:id", requireAuth, (req, res) => {
  db.prepare("UPDATE customers SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/suppliers", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/suppliers", requireAuth, (req, res) => {
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Supplier name is required" });

  const row = db
    .prepare(
      "INSERT INTO suppliers (code, name, phone, address, opening_balance, account_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, NULL, 1, datetime('now'))",
    )
    .run(`SUP-${Date.now()}`, String(name).trim(), String(phone || ""), String(address || ""), Number(opening_balance || 0));

  res.status(201).json(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/suppliers/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Supplier name is required" });

  db.prepare(
    "UPDATE suppliers SET name = ?, phone = ?, address = ?, opening_balance = ? WHERE id = ?",
  ).run(String(name).trim(), String(phone || ""), String(address || ""), Number(opening_balance || 0), id);

  res.json(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id));
});

app.delete("/api/setup/suppliers/:id", requireAuth, (req, res) => {
  db.prepare("UPDATE suppliers SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/transporters", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM transporters WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/transporters", requireAuth, (req, res) => {
  const { name, phone = "", vehicle_no = "", address = "" } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Transporter name is required" });

  const row = db
    .prepare(
      "INSERT INTO transporters (code, name, phone, vehicle_no, address, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))",
    )
    .run(`TR-${Date.now()}`, String(name).trim(), String(phone || ""), String(vehicle_no || ""), String(address || ""));

  res.status(201).json(db.prepare("SELECT * FROM transporters WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/transporters/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = "", vehicle_no = "", address = "" } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Transporter name is required" });

  db.prepare(
    "UPDATE transporters SET name = ?, phone = ?, vehicle_no = ?, address = ? WHERE id = ?",
  ).run(String(name).trim(), String(phone || ""), String(vehicle_no || ""), String(address || ""), id);

  res.json(db.prepare("SELECT * FROM transporters WHERE id = ?").get(id));
});

app.delete("/api/setup/transporters/:id", requireAuth, (req, res) => {
  db.prepare("UPDATE transporters SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/accounts", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      "SELECT a.*, p.name AS parent_name FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id WHERE a.is_active = 1 ORDER BY a.code ASC",
    )
    .all();
  res.json(rows);
});

app.post("/api/setup/accounts", requireAuth, (req, res) => {
  const { code = "", name = "", type = "Asset", parent_id = null, opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Account name is required" });

  const row = db
    .prepare(
      "INSERT INTO accounts (code, name, type, parent_id, opening_balance, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))",
    )
    .run(String(code || `ACC-${Date.now()}`), String(name).trim(), String(type || "Asset"), parent_id ? Number(parent_id) : null, Number(opening_balance || 0));

  res.status(201).json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/accounts/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { code = "", name = "", type = "Asset", parent_id = null, opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Account name is required" });

  db.prepare(
    "UPDATE accounts SET code = ?, name = ?, type = ?, parent_id = ?, opening_balance = ? WHERE id = ?",
  ).run(String(code || `ACC-${id}`), String(name).trim(), String(type || "Asset"), parent_id ? Number(parent_id) : null, Number(opening_balance || 0), id);

  res.json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});

app.delete("/api/setup/accounts/:id", requireAuth, (req, res) => {
  db.prepare("UPDATE accounts SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/factory-items", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM factory_items WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/factory-items", requireAuth, (req, res) => {
  const { name, unit = "KG", rate = 0, stock = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Factory item name is required" });

  const row = db
    .prepare(
      "INSERT INTO factory_items (code, name, unit, rate, stock_qty, min_qty, max_qty, is_active, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, 1, datetime('now'))",
    )
    .run(`MAT-${Date.now()}`, String(name).trim(), String(unit || "KG"), Number(rate || 0), Number(stock || 0));

  res.status(201).json(db.prepare("SELECT * FROM factory_items WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/factory-items/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, unit = "KG", rate = 0, stock = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Factory item name is required" });

  db.prepare(
    "UPDATE factory_items SET name = ?, unit = ?, rate = ?, stock_qty = ? WHERE id = ?",
  ).run(String(name).trim(), String(unit || "KG"), Number(rate || 0), Number(stock || 0), id);

  res.json(db.prepare("SELECT * FROM factory_items WHERE id = ?").get(id));
});

app.delete("/api/setup/factory-items/:id", requireAuth, (req, res) => {
  db.prepare("UPDATE factory_items SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/financial-years", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM financial_years ORDER BY start_date DESC").all();
  res.json(rows);
});

app.post("/api/setup/new-year-posting", requireAuth, (req, res) => {
  const yearLabel = req.body?.name || new Date().getFullYear();
  const startDate = `${yearLabel}-01-01`;
  const endDate = `${yearLabel}-12-31`;
  const exists = db.prepare("SELECT * FROM financial_years WHERE name = ?").get(String(yearLabel));

  if (exists) {
    return res.status(400).json({ error: "Financial year already exists" });
  }

  db.prepare("UPDATE financial_years SET is_current = 0 WHERE is_current = 1").run();
  const row = db
    .prepare(
      "INSERT INTO financial_years (name, start_date, end_date, is_closed, is_current, created_at) VALUES (?, ?, ?, 0, 1, datetime('now'))",
    )
    .run(String(yearLabel), startDate, endDate);

  const inserted = db.prepare("SELECT * FROM financial_years WHERE id = ?").get(row.lastInsertRowid);
  res.status(201).json(inserted);
});

app.get("/api/stock/particulars", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT ip.*, i.name AS item_name, i.code AS item_code
       FROM item_particulars ip
       JOIN items i ON i.id = ip.item_id
       WHERE i.is_active = 1
       ORDER BY i.name ASC, ip.type ASC`,
    )
    .all();
  res.json(rows);
});

app.get("/api/particulars", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT ip.*, i.name AS item_name, i.code AS item_code
       FROM item_particulars ip
       JOIN items i ON i.id = ip.item_id
       ORDER BY i.name ASC, ip.type ASC`,
    )
    .all();
  res.json(rows);
});

// ---------- Phase 6: Stock & Accounts views ----------
app.get("/api/suppliers", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/suppliers", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Supplier name is required" });

  const existing = db.prepare("SELECT * FROM suppliers WHERE name = ? AND is_active = 1").get(name);
  if (existing) return res.status(200).json(existing);

  const insert = db
    .prepare(
      "INSERT INTO suppliers (code, name, contact_person, phone, email, address, city, ntn, opening_balance, account_id, is_active, created_at) VALUES (?, ?, '', '', '', '', '', '', 0, NULL, 1, datetime('now'))",
    )
    .run(`SUP-${Date.now()}`, name);

  const row = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(insert.lastInsertRowid);
  res.status(201).json(row);
});

app.get("/api/stock/summary", requireAuth, (_req, res) => {
  const rows = db.prepare(
    `SELECT fi.id, fi.name, fi.code, fi.unit, fi.stock_qty, fi.min_qty, fi.max_qty, 'raw' AS stock_type
     FROM factory_items fi WHERE fi.is_active = 1
     UNION ALL
     SELECT ip.id, TRIM(i.name || CASE WHEN COALESCE(ip.type, '') = '' THEN '' ELSE ' / ' || ip.type END), i.code, COALESCE(ip.weight_unit, ''), ip.stock_qty, ip.min_qty, ip.max_qty, 'finished'
     FROM item_particulars ip JOIN items i ON i.id = ip.item_id WHERE i.is_active = 1
     ORDER BY name COLLATE NOCASE ASC`,
  ).all();
  res.json(rows);
});

app.get("/api/stock/ledger", requireAuth, (req, res) => {
  const { item_id: itemId, stock_type: stockType, from, to } = req.query;
  const filters = [];
  const params = [];
  if (stockType === "raw" || stockType === "finished") {
    filters.push("sl.stock_type = ?"); params.push(stockType);
  }
  if (itemId) {
    filters.push("((sl.stock_type = 'raw' AND sl.factory_item_id = ?) OR (sl.stock_type = 'finished' AND sl.particular_id = ?))");
    params.push(Number(itemId), Number(itemId));
  }
  if (from) { filters.push("sl.date >= ?"); params.push(String(from)); }
  if (to) { filters.push("sl.date <= ?"); params.push(String(to)); }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT sl.*, COALESCE(fi.name, TRIM(i.name || CASE WHEN COALESCE(ip.type, '') = '' THEN '' ELSE ' / ' || ip.type END)) AS item_name,
            COALESCE(fi.unit, ip.weight_unit, '') AS unit
     FROM stock_ledger sl
     LEFT JOIN factory_items fi ON fi.id = sl.factory_item_id
     LEFT JOIN item_particulars ip ON ip.id = sl.particular_id
     LEFT JOIN items i ON i.id = ip.item_id
     ${where}
     ORDER BY sl.date ASC, sl.id ASC`,
  ).all(...params);
  res.json(rows);
});

app.get("/api/accounts", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM accounts WHERE is_active = 1 ORDER BY code ASC, id ASC").all());
});

app.get("/api/accounts/parties/:partyType", requireAuth, (req, res) => {
  const partyType = req.params.partyType;
  if (partyType !== "supplier" && partyType !== "customer") return res.status(400).json({ error: "Invalid party type" });
  const table = partyType === "supplier" ? "suppliers" : "customers";
  res.json(db.prepare(`SELECT id, name, opening_balance, account_id FROM ${table} WHERE is_active = 1 ORDER BY name COLLATE NOCASE`).all());
});

app.get("/api/accounts/party-ledger", requireAuth, (req, res) => {
  const partyType = String(req.query.party_type || "");
  const partyId = Number(req.query.party_id || 0);
  if ((partyType !== "supplier" && partyType !== "customer") || !partyId) return res.status(400).json({ error: "Choose a valid party" });
  const table = partyType === "supplier" ? "suppliers" : "customers";
  const party = db.prepare(`SELECT id, name, opening_balance, account_id FROM ${table} WHERE id = ? AND is_active = 1`).get(partyId);
  if (!party) return res.status(404).json({ error: "Party not found" });
  const transactions = [];
  const opening = Number(party.opening_balance || 0);
  if (opening) transactions.push({ date: "", reference: "Opening balance", narration: "Opening balance", debit: partyType === "customer" ? opening : 0, credit: partyType === "supplier" ? opening : 0 });
  if (partyType === "supplier") {
    db.prepare("SELECT date, voucher_no, net_total, paid_amount, remarks FROM purchases WHERE supplier_id = ? ORDER BY date ASC, id ASC").all(partyId)
      .forEach((row) => transactions.push({ date: row.date, reference: row.voucher_no, narration: row.remarks || "Purchase", debit: Number(row.paid_amount || 0), credit: Number(row.net_total || 0) }));
  } else {
    db.prepare("SELECT date, voucher_no, net_total, paid_amount, remarks FROM sales WHERE customer_id = ? ORDER BY date ASC, id ASC").all(partyId)
      .forEach((row) => transactions.push({ date: row.date, reference: row.voucher_no, narration: row.remarks || "Sale", debit: Number(row.net_total || 0), credit: Number(row.paid_amount || 0) }));
  }
  if (party.account_id) {
    db.prepare("SELECT al.date, av.voucher_no, al.debit, al.credit, al.narration FROM account_ledger al LEFT JOIN account_vouchers av ON av.id = al.voucher_id WHERE al.account_id = ? ORDER BY al.date ASC, al.id ASC").all(party.account_id)
      .forEach((row) => transactions.push({ date: row.date, reference: row.voucher_no || "Journal", narration: row.narration || "Account entry", debit: Number(row.debit || 0), credit: Number(row.credit || 0) }));
  }
  let balance = opening;
  const isSupplier = partyType === "supplier";
  const rows = transactions.map((row) => { balance += isSupplier ? row.credit - row.debit : row.debit - row.credit; return { ...row, balance }; });
  res.json({ party, balance, rows });
});

// ---------- Phase 4: Purchase & Production ----------
app.get("/api/purchases", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ORDER BY p.id DESC`,
    )
    .all();
  res.json(rows);
});

app.post("/api/purchases", requireAuth, (req, res) => {
  const { date = new Date().toISOString().slice(0, 10), supplier_id, supplier_name, bill_no = "", remarks = "", lines = [] } = req.body || {};
  const normalizedLines = Array.isArray(lines) ? lines : [];

  if (normalizedLines.length === 0) {
    return res.status(400).json({ error: "At least one purchase line is required" });
  }

  if (normalizedLines.some((line) => Number(line?.qty) <= 0 || !Number.isFinite(Number(line?.qty)))) {
    return res.status(400).json({ error: "Quantity must be greater than 0" });
  }

  let effectiveSupplierId = Number(supplier_id || 0);
  if (!effectiveSupplierId && supplier_name) {
    const trimmedName = String(supplier_name).trim();
    if (!trimmedName) return res.status(400).json({ error: "Supplier name is required" });

    const existing = db.prepare("SELECT * FROM suppliers WHERE name = ? AND is_active = 1").get(trimmedName);
    if (existing) {
      effectiveSupplierId = Number(existing.id);
    } else {
      const insert = db
        .prepare(
          "INSERT INTO suppliers (code, name, contact_person, phone, email, address, city, ntn, opening_balance, account_id, is_active, created_at) VALUES (?, ?, '', '', '', '', '', '', 0, NULL, 1, datetime('now'))",
        )
        .run(`SUP-${Date.now()}`, trimmedName);
      effectiveSupplierId = Number(insert.lastInsertRowid);
    }
  }

  if (!effectiveSupplierId) {
    return res.status(400).json({ error: "Supplier selection is required" });
  }

  const subTotal = normalizedLines.reduce((sum, line) => sum + Number(line.amount || line.qty * line.rate || 0), 0);
  const voucherNo = `PUR-${Date.now()}`;

  try {
    const purchaseInsert = db
      .prepare(
        "INSERT INTO purchases (voucher_no, date, supplier_id, transporter_id, bill_no, remarks, sub_total, discount, tax, freight, net_total, paid_amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, NULL, datetime('now'))",
      )
      .run(voucherNo, String(date), effectiveSupplierId, null, String(bill_no || ""), String(remarks || ""), Number(subTotal || 0), Number(subTotal || 0));

    const purchaseId = Number(purchaseInsert.lastInsertRowid);
    const lineInsert = db.prepare(
      "INSERT INTO purchase_lines (purchase_id, factory_item_id, particular_id, description, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );

    normalizedLines.forEach((line) => {
      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const amount = Number(line.amount ?? qty * rate);
      const description = String(line.description || line.name || "");

      lineInsert.run(
        purchaseId,
        line.factory_item_id != null ? Number(line.factory_item_id) : null,
        line.particular_id != null ? Number(line.particular_id) : null,
        description,
        qty,
        rate,
        amount,
      );

      if (line.factory_item_id != null) {
        const raw = db.prepare("SELECT stock_qty, name FROM factory_items WHERE id = ?").get(Number(line.factory_item_id));
        const nextQty = Number(raw?.stock_qty || 0) + qty;
        db.prepare("UPDATE factory_items SET stock_qty = ? WHERE id = ?").run(nextQty, Number(line.factory_item_id));
        db.prepare(
          "INSERT INTO stock_ledger (date, stock_type, factory_item_id, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))",
        ).run(String(date), "raw", Number(line.factory_item_id), null, "purchase", purchaseId, voucherNo, qty, rate, nextQty, `Purchase ${voucherNo}`);
      }

      if (line.particular_id != null) {
        const particular = db.prepare("SELECT stock_qty FROM item_particulars WHERE id = ?").get(Number(line.particular_id));
        const nextQty = Number(particular?.stock_qty || 0) + qty;
        db.prepare("UPDATE item_particulars SET stock_qty = ? WHERE id = ?").run(nextQty, Number(line.particular_id));
        db.prepare(
          "INSERT INTO stock_ledger (date, stock_type, factory_item_id, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))",
        ).run(String(date), "finished", null, Number(line.particular_id), "purchase", purchaseId, voucherNo, qty, rate, nextQty, `Purchase ${voucherNo}`);
      }
    });

    const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchaseId);
    const savedLines = db.prepare("SELECT * FROM purchase_lines WHERE purchase_id = ? ORDER BY id ASC").all(purchaseId);
    res.status(201).json({ purchase, lines: savedLines });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to save purchase" });
  }
});

app.get("/api/productions", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, i.name AS item_name, ip.type AS particular_type
       FROM productions p
       JOIN item_particulars ip ON ip.id = p.particular_id
       JOIN items i ON i.id = ip.item_id
       ORDER BY p.id DESC`,
    )
    .all();
  res.json(rows);
});

app.post("/api/productions", requireAuth, (req, res) => {
  const { date = new Date().toISOString().slice(0, 10), particular_id, batch_quantity, remarks = "" } = req.body || {};
  const particularId = Number(particular_id || 0);
  const producedQty = Number(batch_quantity || 0);

  if (!particularId || !Number.isFinite(producedQty) || producedQty <= 0) {
    return res.status(400).json({ error: "Please select a valid item and batch quantity" });
  }

  const formula = db.prepare("SELECT * FROM formulas WHERE particular_id = ?").get(particularId);
  if (!formula) {
    return res.status(400).json({ error: "No formula found for this particular. Create a Formula/BOM first." });
  }

  const formulaLines = db
    .prepare("SELECT * FROM formula_lines WHERE formula_id = ? ORDER BY sort_order ASC, id ASC")
    .all(formula.id);

  if (formulaLines.length === 0) {
    return res.status(400).json({ error: "This formula has no material lines yet." });
  }

  const batchSize = Number.isFinite(Number(formula.batch_size)) ? Number(formula.batch_size) : 1;
  const calculation = calculateProductionRequirements(formulaLines, producedQty, batchSize);

  for (const line of calculation.lines) {
    if (!line.factory_item_id) {
      return res.status(400).json({ error: `Material ${line.material_name || "unknown"} is missing a raw material reference.` });
    }

    const qtyRequired = Number(line.qtyRequired || 0);
    if (!Number.isFinite(qtyRequired) || qtyRequired < 0) {
      return res.status(400).json({ error: `Invalid material quantity for ${line.material_name || "unknown"}.` });
    }

    const item = db.prepare("SELECT id, name, stock_qty FROM factory_items WHERE id = ?").get(Number(line.factory_item_id));
    if (!item) {
      return res.status(400).json({ error: `Raw material not found: ${line.material_name || "unknown"}` });
    }

    if (Number(item.stock_qty || 0) < qtyRequired) {
      return res.status(400).json({
        error: `Insufficient stock for ${item.name}. Available ${Number(item.stock_qty || 0)}, required ${qtyRequired}.`,
      });
    }
  }

  const productionVoucherNo = `PRO-${Date.now()}`;
  const particular = db.prepare("SELECT * FROM item_particulars WHERE id = ?").get(particularId);
  const currentStock = Number(particular?.stock_qty || 0);
  const safeBatchMultiplier = Number.isFinite(Number(calculation.batchMultiplier)) ? Number(calculation.batchMultiplier) : 0;
  const safeTotalMaterialCost = Number.isFinite(Number(calculation.totalMaterialCost)) ? Number(calculation.totalMaterialCost) : 0;

  const productionInsert = db
    .prepare(
      "INSERT INTO productions (voucher_no, date, particular_id, batches, produced_qty, material_cost, overhead_cost, total_cost, remarks, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, datetime('now'))",
    )
    .run(productionVoucherNo, String(date), particularId, safeBatchMultiplier, producedQty, safeTotalMaterialCost, safeTotalMaterialCost, String(remarks || ""));

  const productionId = Number(productionInsert.lastInsertRowid);
  const consumptionInsert = db.prepare(
    "INSERT INTO production_consumptions (production_id, factory_item_id, material_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?)",
  );

  for (const line of calculation.lines) {
    const factoryItemId = Number(line.factory_item_id || 0);
    const qtyRequired = Number.isFinite(Number(line.qtyRequired)) ? Number(line.qtyRequired) : 0;
    const rate = Number.isFinite(Number(line.rate)) ? Number(line.rate) : 0;
    const amount = Number.isFinite(Number(line.amount)) ? Number(line.amount) : 0;

    db.prepare("UPDATE factory_items SET stock_qty = stock_qty - ? WHERE id = ?").run(qtyRequired, factoryItemId);
    db.prepare(
      "INSERT INTO stock_ledger (date, stock_type, factory_item_id, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, datetime('now'))",
    ).run(
      String(date),
      "raw",
      factoryItemId,
      null,
      "production",
      productionId,
      productionVoucherNo,
      qtyRequired,
      rate,
      Number(db.prepare("SELECT stock_qty FROM factory_items WHERE id = ?").get(factoryItemId).stock_qty),
      `Production ${productionVoucherNo}`,
    );

    consumptionInsert.run(productionId, factoryItemId, String(line.material_name || ""), qtyRequired, rate, amount);
  }

  db.prepare("UPDATE item_particulars SET stock_qty = ? WHERE id = ?").run(currentStock + producedQty, particularId);
  db.prepare(
    "INSERT INTO stock_ledger (date, stock_type, factory_item_id, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, datetime('now'))",
  ).run(String(date), "finished", null, particularId, "production", productionId, productionVoucherNo, producedQty, currentStock + producedQty, `Produced ${producedQty}`);

  const production = db.prepare("SELECT * FROM productions WHERE id = ?").get(productionId);
  const consumptions = db.prepare("SELECT * FROM production_consumptions WHERE production_id = ? ORDER BY id ASC").all(productionId);

  res.status(201).json({ production, consumptions, calculation });
});

// ---------- Phase 5: Sales & Vouchers ----------
app.get("/api/sales", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, COALESCE(SUM(sl.amount),0) AS total_amount
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN sale_lines sl ON sl.sale_id = s.id
       GROUP BY s.id, c.name
       ORDER BY s.date DESC, s.id DESC`,
    )
    .all();
  res.json(rows);
});

app.post("/api/sales", requireAuth, (req, res) => {
  const { customer_id, remarks = "", lines = [] } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: "Customer is required" });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "At least one sale line is required" });

  let total = 0;
  const lineData = [];
  for (const line of lines) {
    const particularId = Number(line.particular_id);
    const qty = Number(line.qty || 0);
    const rate = Number(line.rate || 0);
    if (!particularId || qty <= 0 || rate < 0) {
      return res.status(400).json({ error: "Invalid sale line data" });
    }

    const particular = db.prepare("SELECT * FROM item_particulars WHERE id = ?").get(particularId);
    if (!particular) return res.status(400).json({ error: "Invalid item line" });
    if (qty > Number(particular.stock_qty || 0)) {
      return res.status(400).json({ error: `Insufficient stock for ${particularId}` });
    }

    const amount = qty * rate;
    total += amount;
    lineData.push({ particularId, qty, rate, amount, description: String(line.description || "") });
  }

  const voucherNo = `SL-${Date.now()}`;
  const sale = db
    .prepare(
      "INSERT INTO sales (voucher_no, date, customer_id, sale_type, remarks, sub_total, discount, tax, net_total, paid_amount, created_by, created_at) VALUES (?, date('now'), ?, 'counter', ?, ?, 0, 0, ?, 0, ?, datetime('now'))",
    )
    .run(voucherNo, Number(customer_id), String(remarks || ""), total, total, req.user?.id ?? null);

  const insertLine = db.prepare(
    "INSERT INTO sale_lines (sale_id, particular_id, description, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?)",
  );

  for (const line of lineData) {
    db.prepare("UPDATE item_particulars SET stock_qty = stock_qty - ? WHERE id = ?").run(line.qty, line.particularId);
    db.prepare("INSERT INTO stock_ledger (date, stock_type, particular_id, ref_type, ref_id, ref_no, qty_out, rate, balance_after, remarks) VALUES (?, 'finished', ?, 'sale', ?, ?, ?, ?, (SELECT stock_qty FROM item_particulars WHERE id = ?), ?)")
      .run(
        new Date().toISOString().slice(0, 10),
        line.particularId,
        sale.lastInsertRowid,
        voucherNo,
        line.qty,
        line.rate,
        line.particularId,
        String(remarks || "Sale"),
      );
    insertLine.run(sale.lastInsertRowid, line.particularId, line.description, line.qty, line.rate, line.amount);
  }

  res.status(201).json({ id: sale.lastInsertRowid, voucher_no: voucherNo, total });
});

app.get("/api/issue-vouchers", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT iv.*, c.name AS customer_name, COUNT(ivl.id) AS line_count
       FROM issue_vouchers iv
       LEFT JOIN customers c ON c.id = iv.customer_id
       LEFT JOIN issue_voucher_lines ivl ON ivl.voucher_id = iv.id
       GROUP BY iv.id, c.name
       ORDER BY iv.date DESC, iv.id DESC`,
    )
    .all();
  res.json(rows);
});

app.post("/api/issue-vouchers", requireAuth, (req, res) => {
  const { voucher_no, date, customer_id, remarks = "", lines = [] } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: "Customer is required" });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "At least one issue line is required" });

  const voucherNo = String(voucher_no || `IV-${Date.now()}`);
  const issue = db
    .prepare(
      "INSERT INTO issue_vouchers (voucher_no, date, customer_id, transporter_id, remarks, created_by, created_at) VALUES (?, ?, ?, NULL, ?, ?, datetime('now'))",
    )
    .run(voucherNo, String(date || new Date().toISOString().slice(0, 10)), Number(customer_id), String(remarks || ""), req.user?.id ?? null);

  const insertLine = db.prepare(
    "INSERT INTO issue_voucher_lines (voucher_id, particular_id, size, shade, in_stock, qty) VALUES (?, ?, ?, ?, ?, ?)",
  );

  for (const line of lines) {
    const particularId = Number(line.particular_id);
    const qty = Number(line.qty || 0);
    const particular = db.prepare("SELECT * FROM item_particulars WHERE id = ?").get(particularId);
    if (!particular) return res.status(400).json({ error: "Invalid issue item" });
    if (qty > Number(particular.stock_qty || 0)) return res.status(400).json({ error: `Insufficient stock for ${line.size || particularId}` });

    db.prepare("UPDATE item_particulars SET stock_qty = stock_qty - ? WHERE id = ?").run(qty, particularId);
    insertLine.run(issue.lastInsertRowid, particularId, String(line.size || particular.type || ""), String(line.shade || particular.weight_unit || ""), Number(particular.stock_qty || 0), qty);
    db.prepare("INSERT INTO stock_ledger (date, stock_type, particular_id, ref_type, ref_id, ref_no, qty_out, rate, balance_after, remarks) VALUES (?, 'finished', ?, 'issue', ?, ?, ?, 0, 0, (SELECT stock_qty FROM item_particulars WHERE id = ?), ?)")
      .run(new Date().toISOString().slice(0, 10), particularId, issue.lastInsertRowid, voucherNo, qty, particularId, String(remarks || "Issue voucher"));
  }

  res.status(201).json({ id: issue.lastInsertRowid, voucher_no: voucherNo });
});

app.get("/api/returns", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS customer_name, s.name AS supplier_name
       FROM returns r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       ORDER BY r.date DESC, r.id DESC`,
    )
    .all();
  res.json(rows);
});

app.post("/api/returns", requireAuth, (req, res) => {
  const { return_type = "customer", customer_id = null, supplier_id = null, remarks = "", lines = [] } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "At least one return line is required" });
  if (return_type === "customer" && !customer_id) return res.status(400).json({ error: "Customer is required" });
  if (return_type === "supplier" && !supplier_id) return res.status(400).json({ error: "Supplier is required" });

  const voucherNo = `RT-${Date.now()}`;
  const returnRow = db
    .prepare(
      "INSERT INTO returns (voucher_no, date, return_type, customer_id, supplier_id, remarks, net_total, created_by, created_at) VALUES (?, date('now'), ?, ?, ?, ?, 0, ?, datetime('now'))",
    )
    .run(voucherNo, String(return_type), return_type === "customer" ? Number(customer_id) : null, return_type === "supplier" ? Number(supplier_id) : null, String(remarks || ""), req.user?.id ?? null);

  let total = 0;
  const insertLine = db.prepare(
    "INSERT INTO return_lines (return_id, particular_id, factory_item_id, description, qty, rate, amount) VALUES (?, ?, NULL, ?, ?, ?, ?)",
  );

  for (const line of lines) {
    const particularId = Number(line.particular_id);
    const qty = Number(line.qty || 0);
    const rate = Number(line.rate || 0);
    const amount = qty * rate;
    total += amount;
    if (!particularId || qty <= 0) return res.status(400).json({ error: "Invalid return line" });

    if (return_type === "customer") {
      db.prepare("UPDATE item_particulars SET stock_qty = stock_qty + ? WHERE id = ?").run(qty, particularId);
    } else {
      db.prepare("UPDATE item_particulars SET stock_qty = stock_qty - ? WHERE id = ?").run(qty, particularId);
    }

    insertLine.run(returnRow.lastInsertRowid, particularId, String(line.description || ""), qty, rate, amount);
  }

  db.prepare("UPDATE returns SET net_total = ? WHERE id = ?").run(total, returnRow.lastInsertRowid);
  res.status(201).json({ id: returnRow.lastInsertRowid, voucher_no: voucherNo, total });
});

// ---------- Phase 7: Reports & Backup ----------
app.get("/api/reports/sales", requireAuth, (req, res) => {
  const from = req.query.from ? String(req.query.from) : "";
  const to = req.query.to ? String(req.query.to) : "";
  const party = req.query.party ? Number(req.query.party) : null;
  const item = req.query.item ? Number(req.query.item) : null;

  let sql = `SELECT s.id, s.voucher_no, s.date, c.name AS party_name, SUM(sl.amount) AS total_amount
             FROM sales s
             LEFT JOIN customers c ON c.id = s.customer_id
             LEFT JOIN sale_lines sl ON sl.sale_id = s.id
             WHERE 1 = 1`;
  const params = [];

  if (from) { sql += " AND s.date >= ?"; params.push(from); }
  if (to) { sql += " AND s.date <= ?"; params.push(to); }
  if (party) { sql += " AND s.customer_id = ?"; params.push(party); }
  if (item) { sql += " AND sl.particular_id = ?"; params.push(item); }

  sql += " GROUP BY s.id, c.name ORDER BY s.date DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/reports/purchases", requireAuth, (req, res) => {
  const from = req.query.from ? String(req.query.from) : "";
  const to = req.query.to ? String(req.query.to) : "";
  const party = req.query.party ? Number(req.query.party) : null;
  const item = req.query.item ? Number(req.query.item) : null;

  let sql = `SELECT p.id, p.voucher_no, p.date, s.name AS party_name, SUM(pl.amount) AS total_amount
             FROM purchases p
             LEFT JOIN suppliers s ON s.id = p.supplier_id
             LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
             WHERE 1 = 1`;
  const params = [];

  if (from) { sql += " AND p.date >= ?"; params.push(from); }
  if (to) { sql += " AND p.date <= ?"; params.push(to); }
  if (party) { sql += " AND p.supplier_id = ?"; params.push(party); }
  if (item) { sql += " AND pl.particular_id = ?"; params.push(item); }

  sql += " GROUP BY p.id, s.name ORDER BY p.date DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/reports/general", requireAuth, (req, res) => {
  const from = req.query.from ? String(req.query.from) : "";
  const to = req.query.to ? String(req.query.to) : "";
  const item = req.query.item ? Number(req.query.item) : null;

  let sql = `SELECT sl.id, sl.date, sl.ref_type, sl.ref_no, sl.qty_in, sl.qty_out, sl.balance_after, ip.id AS particular_id, i.name AS item_name
             FROM stock_ledger sl
             LEFT JOIN item_particulars ip ON ip.id = sl.particular_id
             LEFT JOIN items i ON i.id = ip.item_id
             WHERE 1 = 1`;
  const params = [];

  if (from) { sql += " AND sl.date >= ?"; params.push(from); }
  if (to) { sql += " AND sl.date <= ?"; params.push(to); }
  if (item) { sql += " AND sl.particular_id = ?"; params.push(item); }

  sql += " ORDER BY sl.date DESC, sl.id DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/backup/export", requireAuth, (_req, res) => {
  const fileName = `paint-erp-backup-${new Date().toISOString().slice(0, 10)}.db`;
  const buffer = fs.readFileSync(DB_PATH);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.send(buffer);
});

// ---------- Phase 2: Items & Formula/BOM ----------
app.get("/api/items", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM items WHERE is_active = 1 ORDER BY id ASC").all();
  res.json(rows);
});

app.post("/api/items", requireAuth, (req, res) => {
  const { code = "", name = "", category = "", remarks = "" } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Item name is required" });
  }

  const insert = db
    .prepare(
      "INSERT INTO items (code, name, category, remarks, is_active, created_at) VALUES (?, ?, ?, ?, 1, datetime('now'))",
    )
    .run(String(code || `ITEM-${Date.now()}`), String(name).trim(), String(category || ""), String(remarks || ""));

  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(insert.lastInsertRowid);
  res.status(201).json(row);
});

app.put("/api/items/:id", requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  const { code = "", name = "", category = "", remarks = "" } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Item name is required" });
  }

  db.prepare(
    "UPDATE items SET code = ?, name = ?, category = ?, remarks = ? WHERE id = ? AND is_active = 1",
  ).run(String(code || `ITEM-${itemId}`), String(name).trim(), String(category || ""), String(remarks || ""), itemId);

  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(itemId);
  res.json(row);
});

app.delete("/api/items/:id", requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  db.prepare("UPDATE items SET is_active = 0 WHERE id = ?").run(itemId);
  db.prepare("DELETE FROM item_particulars WHERE item_id = ?").run(itemId);
  res.json({ ok: true });
});

app.get("/api/items/:id/particulars", requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  const rows = db
    .prepare(
      "SELECT * FROM item_particulars WHERE item_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .all(itemId);
  res.json(rows);
});

app.post("/api/items/:id/particulars", requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  const {
    type = "",
    weight_unit = "",
    cost_price = 0,
    ws_price = 0,
    sale_price = 0,
    stock_qty = 0,
    min_qty = 0,
    max_qty = 0,
    formula_code = "",
  } = req.body || {};

  const insert = db
    .prepare(
      "INSERT INTO item_particulars (item_id, type, weight_unit, cost_price, ws_price, sale_price, stock_qty, min_qty, max_qty, formula_code, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM item_particulars WHERE item_id=?), 1), datetime('now'))",
    )
    .run(
      itemId,
      String(type || ""),
      String(weight_unit || ""),
      Number(cost_price || 0),
      Number(ws_price || 0),
      Number(sale_price || 0),
      Number(stock_qty || 0),
      Number(min_qty || 0),
      Number(max_qty || 0),
      String(formula_code || ""),
      itemId,
    );

  const row = db.prepare("SELECT * FROM item_particulars WHERE id = ?").get(insert.lastInsertRowid);
  res.status(201).json(row);
});

app.put("/api/items/:id/particulars/:particularId", requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  const particularId = Number(req.params.particularId);
  const {
    type = "",
    weight_unit = "",
    cost_price = 0,
    ws_price = 0,
    sale_price = 0,
    stock_qty = 0,
    min_qty = 0,
    max_qty = 0,
    formula_code = "",
  } = req.body || {};

  db.prepare(
    "UPDATE item_particulars SET type = ?, weight_unit = ?, cost_price = ?, ws_price = ?, sale_price = ?, stock_qty = ?, min_qty = ?, max_qty = ?, formula_code = ? WHERE id = ? AND item_id = ?",
  ).run(
    String(type || ""),
    String(weight_unit || ""),
    Number(cost_price || 0),
    Number(ws_price || 0),
    Number(sale_price || 0),
    Number(stock_qty || 0),
    Number(min_qty || 0),
    Number(max_qty || 0),
    String(formula_code || ""),
    particularId,
    itemId,
  );

  const row = db.prepare("SELECT * FROM item_particulars WHERE id = ?").get(particularId);
  res.json(row);
});

app.delete("/api/items/:id/particulars/:particularId", requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  const particularId = Number(req.params.particularId);
  db.prepare("DELETE FROM item_particulars WHERE id = ? AND item_id = ?").run(particularId, itemId);
  db.prepare("DELETE FROM formulas WHERE particular_id = ?").run(particularId);
  db.prepare("DELETE FROM formula_lines WHERE formula_id IN (SELECT id FROM formulas WHERE particular_id = ?)").run(particularId);
  res.json({ ok: true });
});

app.get("/api/formulas", requireAuth, (_req, res) => {
  const rows = db
    .prepare(`
      SELECT
        ip.id AS particular_id,
        ip.item_id,
        i.name AS item_name,
        ip.type,
        ip.formula_code,
        COALESCE(SUM(fl.value), 0) AS total_value,
        COALESCE(SUM(fl.cost_value), 0) AS total_cost
      FROM formulas f
      JOIN item_particulars ip ON ip.id = f.particular_id
      JOIN items i ON i.id = ip.item_id
      LEFT JOIN formula_lines fl ON fl.formula_id = f.id
      GROUP BY f.id, ip.id, ip.item_id, i.name, ip.type, ip.formula_code
      ORDER BY i.name ASC, ip.type ASC
    `)
    .all();

  res.json(rows.map((row) => ({
    particular_id: row.particular_id,
    item_id: row.item_id,
    item_name: row.item_name,
    type: row.type,
    formula_code: row.formula_code,
    total_value: Number(row.total_value || 0),
    total_cost: Number(row.total_cost || 0),
  })));
});

app.get("/api/formulas/unassigned", requireAuth, (_req, res) => {
  const rows = db
    .prepare(`
      SELECT
        ip.id AS particular_id,
        ip.item_id,
        i.name AS item_name,
        ip.type,
        ip.formula_code
      FROM item_particulars ip
      JOIN items i ON i.id = ip.item_id
      LEFT JOIN formulas f ON f.particular_id = ip.id
      WHERE f.id IS NULL
      ORDER BY i.name ASC, ip.type ASC
    `)
    .all();

  res.json(rows);
});

app.get("/api/formulas/:particularId", requireAuth, (req, res) => {
  const particularId = Number(req.params.particularId);
  const formula = db.prepare("SELECT * FROM formulas WHERE particular_id = ?").get(particularId);
  if (!formula) {
    return res.json({ formula: null, lines: [] });
  }

  const lines = db
    .prepare(
      "SELECT * FROM formula_lines WHERE formula_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .all(formula.id);

  res.json({ formula, lines });
});

app.post("/api/formulas/:particularId", requireAuth, (req, res) => {
  const particularId = Number(req.params.particularId);
  const { code = "", batch_size = 1, remarks = "", lines = [] } = req.body || {};

  let formula = db.prepare("SELECT * FROM formulas WHERE particular_id = ?").get(particularId);
  if (formula) {
    db.prepare("UPDATE formulas SET code = ?, batch_size = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?").run(
      String(code || ""),
      Number(batch_size || 1),
      String(remarks || ""),
      formula.id,
    );
  } else {
    const insert = db
      .prepare("INSERT INTO formulas (particular_id, code, batch_size, total_cost, remarks, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(particularId, String(code || ""), Number(batch_size || 1), 0, String(remarks || ""));

    formula = db.prepare("SELECT * FROM formulas WHERE id = ?").get(insert.lastInsertRowid);
  }

  db.prepare("DELETE FROM formula_lines WHERE formula_id = ?").run(formula.id);

  const lineInsert = db.prepare(
    "INSERT INTO formula_lines (formula_id, factory_item_id, material_name, value, rate, cost_value, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  lines.forEach((line, index) => {
    const value = Number(line.value || 0);
    const rate = Number(line.rate || 0);
    const costValue = Number(line.costValue ?? value * rate);
    lineInsert.run(
      formula.id,
      line.factory_item_id ?? null,
      String(line.material_name || ""),
      value,
      rate,
      costValue,
      index + 1,
    );
  });

  const totals = db.prepare("SELECT COALESCE(SUM(value), 0) AS total_value, COALESCE(SUM(cost_value), 0) AS total_cost FROM formula_lines WHERE formula_id = ?").get(formula.id);
  db.prepare("UPDATE formulas SET total_cost = ? WHERE id = ?").run(Number(totals.total_cost), formula.id);

  const fresh = db.prepare("SELECT * FROM formulas WHERE id = ?").get(formula.id);
  const storedLines = db.prepare("SELECT * FROM formula_lines WHERE formula_id = ? ORDER BY sort_order ASC, id ASC").all(formula.id);

  res.json({ formula: fresh, lines: storedLines });
});

// ---------- Dashboard summary (Phase 1) ----------
app.get("/api/dashboard/summary", requireAuth, (_req, res) => {
  const count = (sql) => db.prepare(sql).get().c;
  res.json({
    items: count("SELECT COUNT(*) c FROM items"),
    particulars: count("SELECT COUNT(*) c FROM item_particulars"),
    customers: count("SELECT COUNT(*) c FROM customers"),
    suppliers: count("SELECT COUNT(*) c FROM suppliers"),
    factory_items: count("SELECT COUNT(*) c FROM factory_items"),
    purchases: count("SELECT COUNT(*) c FROM purchases"),
    sales: count("SELECT COUNT(*) c FROM sales"),
    productions: count("SELECT COUNT(*) c FROM productions"),
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Paint ERP API listening on http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});