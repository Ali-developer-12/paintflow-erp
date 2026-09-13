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
