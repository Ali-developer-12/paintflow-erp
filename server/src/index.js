import express from "express";
import cors from "cors";
import db, { applySchema, DB_PATH } from "./db.js";
import { createSession, destroySession, requireAuth, verifyPassword } from "./auth.js";

applySchema();

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
  const { code = "", batch_size = 1, total_cost = 0, remarks = "", lines = [] } = req.body || {};

  let formula = db.prepare("SELECT * FROM formulas WHERE particular_id = ?").get(particularId);
  if (formula) {
    db.prepare("UPDATE formulas SET code = ?, batch_size = ?, total_cost = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?").run(
      String(code || ""),
      Number(batch_size || 1),
      Number(total_cost || 0),
      String(remarks || ""),
      formula.id,
    );
  } else {
    const insert = db
      .prepare("INSERT INTO formulas (particular_id, code, batch_size, total_cost, remarks, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(particularId, String(code || ""), Number(batch_size || 1), Number(total_cost || 0), String(remarks || ""));

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
