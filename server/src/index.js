import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db, { applySchema, DB_PATH, closeDatabase } from "./db.js";
import {
  cleanupExpiredSessions,
  createSession,
  destroySession,
  ensureInitialAdminUser,
  hashPassword,
  requireAuth,
  requireRole,
  verifyPassword,
} from "./auth.js";
import { calculateProductionRequirements } from "./phase4-logic.js";
import {
  ACCOUNT_CODES,
  ensureChartOfAccounts,
  postAccountVoucher,
  reconcileStock,
  requireAccountIdByCode,
  resolvePartyAccountId,
  trialBalance,
} from "./accounting.js";
import { round2 } from "./accounting-core.js";
import {
  assertPostingAllowed,
  closeAndOpenYear,
  ensureCurrentFinancialYear,
  listYears,
} from "./years.js";
import { BACKUP_DIR, createBackup, listBackups, verifyDatabaseFile } from "./backup.js";
import { DOC_PREFIX, nextUniqueVoucherNo } from "./vouchers.js";
import { backpostReport, runBackpost, revertBackpost } from "./backpost.js";
import { resolveBackup, restoreToNewFile } from "./restore.js";
import { HOST, PORT, ALLOWED_ORIGINS, APP_NAME, APP_VERSION } from "./config.js";
import { logger } from "./logger.js";
import { recordAuditLog } from "./audit.js";
import { sendRouteError } from "./http-errors.js";
import { runMigrations, TARGET_SCHEMA_VERSION } from "./migrations.js";
import erpRoutes from "./erp-routes.js";
import { finiteNumber, validateNumericPayload } from "./validation.js";

applySchema();
ensureChartOfAccounts();
runMigrations(db);
ensureCurrentFinancialYear();
cleanupExpiredSessions();
const sessionCleanupTimer = setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
sessionCleanupTimer.unref();
ensureInitialAdminUser();

function validateFactoryMaterial(factoryItemId, label = "Factory item") {
  const id = Number(factoryItemId || 0);
  if (!id || !Number.isFinite(id)) {
    throw new Error(`${label} is required`);
  }
  const row = db.prepare("SELECT id, name, is_active FROM factory_items WHERE id = ?").get(id);
  if (!row || Number(row.is_active) !== 1) {
    throw new Error(`${label} is not available or inactive`);
  }
  return row;
}

function validateFormulaPayload(particularId, payload) {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!lines.length) {
    throw new Error("Formula must contain at least one valid material line");
  }

  const batchSize = finiteNumber(payload?.batch_size ?? 1, "Batch size", { min: Number.EPSILON });
  const seenMaterials = new Set();
  let totalCost = 0;

  for (const [index, line] of lines.entries()) {
    const materialId = Number(line?.factory_item_id ?? 0);
    if (!materialId) {
      throw new Error(`Formula line ${index + 1} must reference a valid raw material`);
    }
    validateFactoryMaterial(materialId, `Formula line ${index + 1} raw material`);
    if (seenMaterials.has(materialId)) {
      throw new Error("Duplicate raw-material entries are not allowed in the same formula");
    }
    seenMaterials.add(materialId);

    const value = finiteNumber(line?.value ?? 0, `Formula line ${index + 1} quantity`, {
      min: Number.EPSILON,
    });
    const rate = finiteNumber(line?.rate ?? 0, `Formula line ${index + 1} rate`, {
      min: 0,
    });
    const computed = value * rate;
    totalCost += computed;
  }

  const existingParticular = db
    .prepare("SELECT id, item_id FROM item_particulars WHERE id = ?")
    .get(Number(particularId));
  if (!existingParticular) {
    throw new Error("Formula particular not found");
  }

  return { batchSize, totalCost };
}

const app = express();
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(APP_DIR, "../../dist");

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json({ limit: "5mb" }));

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "PUT") return next();
  try {
    validateNumericPayload(req.body);
    next();
  } catch (error) {
    sendRouteError(res, error, 400, "Invalid numeric input");
  }
});

const loginAttempts = new Map();
const usernameLoginFailures = new Map();
function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, resetTime: now + 60000 };
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + 60000;
  } else {
    record.count++;
  }
  loginAttempts.set(ip, record);
  if (record.count > 30) {
    return res
      .status(429)
      .json({ error: "Too many login attempts. Please wait a minute before trying again." });
  }
  next();
}

app.use(erpRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    schema_version: TARGET_SCHEMA_VERSION,
    db: DB_PATH,
    time: new Date().toISOString(),
  });
});

app.get("/api/settings/company-name", requireAuth, (_req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'company_name' LIMIT 1").get();
  res.json({ company_name: row?.value ?? "Paint Factory" });
});

// ---------- Auth ----------
app.get("/api/auth/status", (_req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  res.json({ needsSetup: userCount === 0 });
});

app.post("/api/auth/setup", loginRateLimiter, (req, res) => {
  const username = String(req.body?.username || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  const fullName = String(req.body?.full_name || "").trim();
  if (username.length < 3 || !/^[a-z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: "Username must be at least 3 characters and valid" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const result = db
      .transaction(() => {
        const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
        if (userCount > 0) return null;

        const { hash, salt } = hashPassword(password);
        const insert = db
          .prepare(
            "INSERT INTO users (username, password_hash, password_salt, full_name, role, is_active) VALUES (?, ?, ?, ?, 'admin', 1)",
          )
          .run(username, hash, salt, fullName);
        const userId = Number(insert.lastInsertRowid);
        const session = createSession(userId);
        return {
          token: session.token,
          expires_at: session.expires_at,
          user: {
            id: userId,
            username,
            full_name: fullName,
            role: "admin",
          },
        };
      })
      .immediate();

    if (!result) return res.status(403).json({ error: "Administrator setup is already complete" });
    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to create administrator");
  }
});

app.post("/api/auth/login", loginRateLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });

  const normalizedUsername = String(username).trim().toLowerCase();
  const now = Date.now();
  const lockout = usernameLoginFailures.get(normalizedUsername);
  if (lockout?.lockedUntil && now < lockout.lockedUntil) {
    recordAuditLog(db, {
      username: normalizedUsername,
      action: "LOGIN_LOCKED",
      entity: "auth",
      details: { ip_address: req.ip },
      ipAddress: req.ip,
    });
    return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
  }
  if (lockout?.lockedUntil && now >= lockout.lockedUntil) {
    usernameLoginFailures.delete(normalizedUsername);
  }
  const activeFailureRecord = usernameLoginFailures.get(normalizedUsername);
  if (
    activeFailureRecord &&
    !activeFailureRecord.lockedUntil &&
    now - activeFailureRecord.windowStarted >= 5 * 60 * 1000
  ) {
    usernameLoginFailures.delete(normalizedUsername);
  }

  const user = db
    .prepare("SELECT * FROM users WHERE lower(username) = ? AND is_active = 1")
    .get(normalizedUsername);

  let ok = false;
  if (user) {
    try {
      ok = verifyPassword(password, user.password_hash, user.password_salt);
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    const previousFailures = usernameLoginFailures.get(normalizedUsername);
    const failures = (previousFailures?.failures || 0) + 1;
    usernameLoginFailures.set(
      normalizedUsername,
      failures >= 5
        ? { failures, windowStarted: now, lockedUntil: now + 5 * 60 * 1000 }
        : { failures, windowStarted: previousFailures?.windowStarted || now },
    );
    recordAuditLog(db, {
      username: normalizedUsername,
      action: "LOGIN_FAILED",
      entity: "auth",
      details: { ip_address: req.ip, failures },
      ipAddress: req.ip,
    });
    return res.status(401).json({ error: "Invalid username or password" });
  }

  usernameLoginFailures.delete(normalizedUsername);
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
  const rows = db
    .prepare("SELECT * FROM factory_items WHERE is_active = 1 ORDER BY name ASC")
    .all();
  res.json(rows);
});

// ---------- Phase 3: Setup / Masters ----------
app.get("/api/setup/employees", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM employees WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/employees", requireAuth, requireRole("admin"), (req, res) => {
  const { name, designation = "", phone = "", address = "", salary = 0 } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Employee name is required" });
  }

  const row = db
    .prepare(
      "INSERT INTO employees (code, name, designation, phone, address, salary, join_date, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, date('now'), 1, datetime('now'))",
    )
    .run(
      `EMP-${Date.now()}`,
      String(name).trim(),
      String(designation || ""),
      String(phone || ""),
      String(address || ""),
      Number(salary || 0),
    );

  const result = db.prepare("SELECT * FROM employees WHERE id = ?").get(row.lastInsertRowid);
  res.status(201).json(result);
});

app.put("/api/setup/employees/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { name, designation = "", phone = "", address = "", salary = 0 } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Employee name is required" });

  db.prepare(
    "UPDATE employees SET name = ?, designation = ?, phone = ?, address = ?, salary = ? WHERE id = ?",
  ).run(
    String(name).trim(),
    String(designation || ""),
    String(phone || ""),
    String(address || ""),
    Number(salary || 0),
    id,
  );

  res.json(db.prepare("SELECT * FROM employees WHERE id = ?").get(id));
});

app.delete("/api/setup/employees/:id", requireAuth, requireRole("admin"), (req, res) => {
  db.prepare("UPDATE employees SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/customers", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/customers", requireAuth, requireRole("admin"), (req, res) => {
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Customer name is required" });

  const row = db
    .prepare(
      "INSERT INTO customers (code, name, phone, address, opening_balance, credit_limit, is_active, created_at) VALUES (?, ?, ?, ?, ?, 0, 1, datetime('now'))",
    )
    .run(
      `CUST-${Date.now()}`,
      String(name).trim(),
      String(phone || ""),
      String(address || ""),
      Number(opening_balance || 0),
    );

  res.status(201).json(db.prepare("SELECT * FROM customers WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/customers/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Customer name is required" });

  db.prepare(
    "UPDATE customers SET name = ?, phone = ?, address = ?, opening_balance = ? WHERE id = ?",
  ).run(
    String(name).trim(),
    String(phone || ""),
    String(address || ""),
    Number(opening_balance || 0),
    id,
  );

  res.json(db.prepare("SELECT * FROM customers WHERE id = ?").get(id));
});

app.delete("/api/setup/customers/:id", requireAuth, requireRole("admin"), (req, res) => {
  db.prepare("UPDATE customers SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/suppliers", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/suppliers", requireAuth, requireRole("admin"), (req, res) => {
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Supplier name is required" });

  const row = db
    .prepare(
      "INSERT INTO suppliers (code, name, phone, address, opening_balance, account_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, NULL, 1, datetime('now'))",
    )
    .run(
      `SUP-${Date.now()}`,
      String(name).trim(),
      String(phone || ""),
      String(address || ""),
      Number(opening_balance || 0),
    );

  res.status(201).json(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/suppliers/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = "", address = "", opening_balance = 0 } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Supplier name is required" });

  db.prepare(
    "UPDATE suppliers SET name = ?, phone = ?, address = ?, opening_balance = ? WHERE id = ?",
  ).run(
    String(name).trim(),
    String(phone || ""),
    String(address || ""),
    Number(opening_balance || 0),
    id,
  );

  res.json(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id));
});

app.delete("/api/setup/suppliers/:id", requireAuth, requireRole("admin"), (req, res) => {
  db.prepare("UPDATE suppliers SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/transporters", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM transporters WHERE is_active = 1 ORDER BY name ASC").all();
  res.json(rows);
});

app.post("/api/setup/transporters", requireAuth, requireRole("admin"), (req, res) => {
  const { name, phone = "", vehicle_no = "", address = "" } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Transporter name is required" });

  const row = db
    .prepare(
      "INSERT INTO transporters (code, name, phone, vehicle_no, address, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))",
    )
    .run(
      `TR-${Date.now()}`,
      String(name).trim(),
      String(phone || ""),
      String(vehicle_no || ""),
      String(address || ""),
    );

  res
    .status(201)
    .json(db.prepare("SELECT * FROM transporters WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/transporters/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = "", vehicle_no = "", address = "" } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Transporter name is required" });

  db.prepare(
    "UPDATE transporters SET name = ?, phone = ?, vehicle_no = ?, address = ? WHERE id = ?",
  ).run(
    String(name).trim(),
    String(phone || ""),
    String(vehicle_no || ""),
    String(address || ""),
    id,
  );

  res.json(db.prepare("SELECT * FROM transporters WHERE id = ?").get(id));
});

app.delete("/api/setup/transporters/:id", requireAuth, requireRole("admin"), (req, res) => {
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

app.post("/api/setup/accounts", requireAuth, requireRole("admin"), (req, res) => {
  const {
    code = "",
    name = "",
    type = "Asset",
    parent_id = null,
    opening_balance = 0,
  } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Account name is required" });

  const row = db
    .prepare(
      "INSERT INTO accounts (code, name, type, parent_id, opening_balance, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))",
    )
    .run(
      String(code || `ACC-${Date.now()}`),
      String(name).trim(),
      String(type || "Asset"),
      parent_id ? Number(parent_id) : null,
      Number(opening_balance || 0),
    );

  res.status(201).json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(row.lastInsertRowid));
});

app.put("/api/setup/accounts/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const {
    code = "",
    name = "",
    type = "Asset",
    parent_id = null,
    opening_balance = 0,
  } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ error: "Account name is required" });

  db.prepare(
    "UPDATE accounts SET code = ?, name = ?, type = ?, parent_id = ?, opening_balance = ? WHERE id = ?",
  ).run(
    String(code || `ACC-${id}`),
    String(name).trim(),
    String(type || "Asset"),
    parent_id ? Number(parent_id) : null,
    Number(opening_balance || 0),
    id,
  );

  res.json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});

app.delete("/api/setup/accounts/:id", requireAuth, requireRole("admin"), (req, res) => {
  db.prepare("UPDATE accounts SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/factory-items", requireAuth, (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM factory_items WHERE is_active = 1 ORDER BY name ASC")
    .all();
  res.json(rows);
});

app.post("/api/setup/factory-items", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { name, unit = "KG", rate = 0, stock = 0, min_qty = 0, max_qty = 0 } = req.body || {};
    if (!name || !String(name).trim())
      return res.status(400).json({ error: "Factory item name is required" });

    const rateValue = finiteNumber(rate, "Rate", { min: 0 });
    const stockQty = finiteNumber(stock, "Stock quantity", { min: 0 });
    const minQty = finiteNumber(min_qty, "Minimum stock", { min: 0 });
    const maxQty = finiteNumber(max_qty, "Maximum stock", { min: 0 });
    if (maxQty > 0 && maxQty < minQty) {
      return res.status(400).json({ error: "Maximum stock cannot be lower than minimum stock" });
    }

    const row = db
      .prepare(
        "INSERT INTO factory_items (code, name, unit, rate, stock_qty, min_qty, max_qty, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))",
      )
      .run(
        `MAT-${Date.now()}`,
        String(name).trim(),
        String(unit || "KG").trim(),
        rateValue,
        stockQty,
        minQty,
        maxQty,
      );

    res
      .status(201)
      .json(db.prepare("SELECT * FROM factory_items WHERE id = ?").get(row.lastInsertRowid));
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to save factory item");
  }
});

app.put("/api/setup/factory-items/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, unit = "KG", rate = 0, stock = 0, min_qty = 0, max_qty = 0 } = req.body || {};
    if (!name || !String(name).trim())
      return res.status(400).json({ error: "Factory item name is required" });

    const rateValue = finiteNumber(rate, "Rate", { min: 0 });
    const stockQty = finiteNumber(stock, "Stock quantity", { min: 0 });
    const minQty = finiteNumber(min_qty, "Minimum stock", { min: 0 });
    const maxQty = finiteNumber(max_qty, "Maximum stock", { min: 0 });
    if (maxQty > 0 && maxQty < minQty) {
      return res.status(400).json({ error: "Maximum stock cannot be lower than minimum stock" });
    }

    db.prepare(
      "UPDATE factory_items SET name = ?, unit = ?, rate = ?, stock_qty = ?, min_qty = ?, max_qty = ? WHERE id = ?",
    ).run(
      String(name).trim(),
      String(unit || "KG").trim(),
      rateValue,
      stockQty,
      minQty,
      maxQty,
      id,
    );

    res.json(db.prepare("SELECT * FROM factory_items WHERE id = ?").get(id));
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to update factory item");
  }
});

app.delete("/api/setup/factory-items/:id", requireAuth, requireRole("admin"), (req, res) => {
  db.prepare("UPDATE factory_items SET is_active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/setup/financial-years", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM financial_years ORDER BY start_date DESC").all();
  res.json(rows);
});

app.post("/api/setup/new-year-posting", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const result = closeAndOpenYear({
      name: req.body?.name,
      startDate: req.body?.start_date || null,
      endDate: req.body?.end_date || null,
      userId: req.user?.id ?? null,
      notes: req.body?.notes || "",
    });
    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to post the new year");
  }
});

app.get("/api/setup/year-postings", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT yp.*, fy.name AS from_year_name, ty.name AS to_year_name, u.username AS posted_by_username
       FROM year_postings yp
       LEFT JOIN financial_years fy ON fy.id = yp.from_year_id
       LEFT JOIN financial_years ty ON ty.id = yp.to_year_id
       LEFT JOIN users u ON u.id = yp.posted_by
       ORDER BY yp.id DESC`,
    )
    .all();
  res.json(rows);
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

app.post("/api/suppliers", requireAuth, requireRole("admin"), (req, res) => {
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
  const rows = db
    .prepare(
      `SELECT fi.id, fi.name, fi.code, fi.unit, fi.stock_qty, fi.min_qty, fi.max_qty, 'raw' AS stock_type
     FROM factory_items fi WHERE fi.is_active = 1
     UNION ALL
     SELECT ip.id, TRIM(i.name || CASE WHEN COALESCE(ip.type, '') = '' THEN '' ELSE ' / ' || ip.type END), i.code, COALESCE(ip.weight_unit, ''), ip.stock_qty, ip.min_qty, ip.max_qty, 'finished'
     FROM item_particulars ip JOIN items i ON i.id = ip.item_id WHERE i.is_active = 1
     ORDER BY name COLLATE NOCASE ASC`,
    )
    .all();
  res.json(rows);
});

app.get("/api/stock/ledger", requireAuth, (req, res) => {
  const { item_id: itemId, stock_type: stockType, from, to } = req.query;
  const filters = [];
  const params = [];
  if (stockType === "raw" || stockType === "finished") {
    filters.push("sl.stock_type = ?");
    params.push(stockType);
  }
  if (itemId) {
    filters.push(
      "((sl.stock_type = 'raw' AND sl.factory_item_id = ?) OR (sl.stock_type = 'finished' AND sl.particular_id = ?))",
    );
    params.push(Number(itemId), Number(itemId));
  }
  if (from) {
    filters.push("sl.date >= ?");
    params.push(String(from));
  }
  if (to) {
    filters.push("sl.date <= ?");
    params.push(String(to));
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT sl.*, COALESCE(fi.name, TRIM(i.name || CASE WHEN COALESCE(ip.type, '') = '' THEN '' ELSE ' / ' || ip.type END)) AS item_name,
            COALESCE(fi.unit, ip.weight_unit, '') AS unit
     FROM stock_ledger sl
     LEFT JOIN factory_items fi ON fi.id = sl.factory_item_id
     LEFT JOIN item_particulars ip ON ip.id = sl.particular_id
     LEFT JOIN items i ON i.id = ip.item_id
     ${where}
     ORDER BY sl.date ASC, sl.id ASC`,
    )
    .all(...params);
  res.json(rows);
});

app.get("/api/accounts", requireAuth, (_req, res) => {
  res.json(
    db.prepare("SELECT * FROM accounts WHERE is_active = 1 ORDER BY code ASC, id ASC").all(),
  );
});

app.get("/api/accounts/parties/:partyType", requireAuth, (req, res) => {
  const partyType = req.params.partyType;
  if (partyType !== "supplier" && partyType !== "customer")
    return res.status(400).json({ error: "Invalid party type" });
  const table = partyType === "supplier" ? "suppliers" : "customers";
  res.json(
    db
      .prepare(
        `SELECT id, name, opening_balance, account_id FROM ${table} WHERE is_active = 1 ORDER BY name COLLATE NOCASE`,
      )
      .all(),
  );
});

app.get("/api/accounts/party-ledger", requireAuth, (req, res) => {
  const partyType = String(req.query.party_type || "");
  const partyId = Number(req.query.party_id || 0);
  if ((partyType !== "supplier" && partyType !== "customer") || !partyId)
    return res.status(400).json({ error: "Choose a valid party" });
  const table = partyType === "supplier" ? "suppliers" : "customers";
  const party = db
    .prepare(
      `SELECT id, name, opening_balance, account_id FROM ${table} WHERE id = ? AND is_active = 1`,
    )
    .get(partyId);
  if (!party) return res.status(404).json({ error: "Party not found" });
  const isSupplier = partyType === "supplier";
  const opening = Number(party.opening_balance || 0);
  const transactions = [];
  let source = "documents";

  // Party balances must derive from a single authoritative source. When the
  // party is mapped to an account, the account ledger wins; mixing it with the
  // raw purchase/sale documents double counts the same money.
  if (party.account_id) {
    source = "account_ledger";
    const accountOpening = Number(
      db.prepare("SELECT opening_balance FROM accounts WHERE id = ?").get(party.account_id)
        ?.opening_balance || 0,
    );
    const openingTotal = opening + accountOpening;
    if (openingTotal) {
      transactions.push({
        date: "",
        reference: "Opening balance",
        narration: "Opening balance",
        debit: isSupplier ? 0 : openingTotal,
        credit: isSupplier ? openingTotal : 0,
      });
    }
    db.prepare(
      "SELECT al.date, av.voucher_no, al.debit, al.credit, al.narration FROM account_ledger al LEFT JOIN account_vouchers av ON av.id = al.voucher_id WHERE al.account_id = ? ORDER BY al.date ASC, al.id ASC",
    )
      .all(party.account_id)
      .forEach((row) =>
        transactions.push({
          date: row.date,
          reference: row.voucher_no || "Journal",
          narration: row.narration || "Account entry",
          debit: Number(row.debit || 0),
          credit: Number(row.credit || 0),
        }),
      );
  } else {
    if (opening) {
      transactions.push({
        date: "",
        reference: "Opening balance",
        narration: "Opening balance",
        debit: isSupplier ? 0 : opening,
        credit: isSupplier ? opening : 0,
      });
    }
    const documentSql =
      partyType === "supplier"
        ? "SELECT date, voucher_no, net_total, paid_amount, remarks FROM purchases WHERE supplier_id = ? ORDER BY date ASC, id ASC"
        : "SELECT date, voucher_no, net_total, paid_amount, remarks FROM sales WHERE customer_id = ? ORDER BY date ASC, id ASC";
    db.prepare(documentSql)
      .all(partyId)
      .forEach((row) =>
        transactions.push({
          date: row.date,
          reference: row.voucher_no,
          narration: row.remarks || (isSupplier ? "Purchase" : "Sale"),
          debit: isSupplier ? Number(row.paid_amount || 0) : Number(row.net_total || 0),
          credit: isSupplier ? Number(row.net_total || 0) : Number(row.paid_amount || 0),
        }),
      );
  }

  let balance = opening;
  const rows = transactions.map((row) => {
    balance += isSupplier ? row.credit - row.debit : row.debit - row.credit;
    return { ...row, balance: round2(balance) };
  });
  res.json({ party, source, balance: round2(balance), rows });
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
  const {
    date = new Date().toISOString().slice(0, 10),
    supplier_id,
    bill_no = "",
    remarks = "",
    paid_amount = 0,
    payment_mode = "cash",
    lines = [],
  } = req.body || {};
  const normalizedLines = Array.isArray(lines) ? lines : [];

  if (normalizedLines.length === 0) {
    return res.status(400).json({ error: "At least one purchase line is required" });
  }

  // Supplier must come from the real supplier master (no temporary shim).
  const supplierId = Number(supplier_id || 0);
  if (!supplierId) {
    return res.status(400).json({ error: "Supplier selection is required" });
  }
  const supplier = db
    .prepare("SELECT id, name FROM suppliers WHERE id = ? AND is_active = 1")
    .get(supplierId);
  if (!supplier) {
    return res.status(400).json({ error: "Supplier not found in the supplier master" });
  }

  let subTotal = 0;
  const validatedLines = [];
  for (const [index, line] of normalizedLines.entries()) {
    const qty = Number(line?.qty ?? 0);
    const rate = Number(line?.rate ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: `Line ${index + 1} quantity must be greater than 0` });
    }
    if (!Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ error: `Line ${index + 1} rate cannot be negative` });
    }
    const factoryItemId =
      line?.factory_item_id != null && line.factory_item_id !== ""
        ? Number(line.factory_item_id)
        : null;
    const particularId =
      line?.particular_id != null && line.particular_id !== "" ? Number(line.particular_id) : null;
    if (!factoryItemId && !particularId) {
      return res
        .status(400)
        .json({ error: `Line ${index + 1} must reference a raw material or finished item` });
    }
    if (factoryItemId) {
      const raw = db
        .prepare("SELECT id, is_active FROM factory_items WHERE id = ?")
        .get(factoryItemId);
      if (!raw || Number(raw.is_active) !== 1) {
        return res.status(400).json({ error: `Line ${index + 1} raw material not found` });
      }
    }
    if (particularId) {
      const particular = db
        .prepare("SELECT id FROM item_particulars WHERE id = ?")
        .get(particularId);
      if (!particular) {
        return res.status(400).json({ error: `Line ${index + 1} finished item variant not found` });
      }
    }
    const amount = round2(qty * rate);
    subTotal += amount;
    validatedLines.push({
      factoryItemId,
      particularId,
      description: String(line?.description || line?.name || ""),
      qty,
      rate,
      amount,
    });
  }

  const netTotal = round2(subTotal);
  if (netTotal <= 0) {
    return res.status(400).json({ error: "Purchase total must be greater than 0" });
  }
  const paid = Number(paid_amount || 0);
  if (!Number.isFinite(paid) || paid < 0 || paid > netTotal) {
    return res.status(400).json({ error: "Paid amount must be between 0 and the net total" });
  }
  try {
    const result = db.transaction(() => {
      assertPostingAllowed(String(date));
      // Generated inside the transaction so the counter is consumed atomically.
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.purchase);

      const purchaseInsert = db
        .prepare(
          "INSERT INTO purchases (voucher_no, date, supplier_id, transporter_id, bill_no, remarks, sub_total, discount, tax, freight, net_total, paid_amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, datetime('now'))",
        )
        .run(
          voucherNo,
          String(date),
          supplierId,
          null,
          String(bill_no || ""),
          String(remarks || ""),
          Number(subTotal || 0),
          Number(netTotal || 0),
          Number(paid || 0),
          req.user?.id ?? null,
        );

      const purchaseId = Number(purchaseInsert.lastInsertRowid);
      const lineInsert = db.prepare(
        "INSERT INTO purchase_lines (purchase_id, factory_item_id, particular_id, description, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const ledgerInsert = db.prepare(
        "INSERT INTO stock_ledger (date, stock_type, factory_item_id, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))",
      );

      let rawValue = 0;
      let finishedValue = 0;

      for (const line of validatedLines) {
        lineInsert.run(
          purchaseId,
          line.factoryItemId,
          line.particularId,
          line.description,
          line.qty,
          line.rate,
          line.amount,
        );

        if (line.factoryItemId) {
          const raw = db
            .prepare("SELECT stock_qty FROM factory_items WHERE id = ?")
            .get(line.factoryItemId);
          const nextQty = Number(raw?.stock_qty || 0) + line.qty;
          db.prepare("UPDATE factory_items SET stock_qty = ? WHERE id = ?").run(
            nextQty,
            line.factoryItemId,
          );
          ledgerInsert.run(
            String(date),
            "raw",
            line.factoryItemId,
            null,
            "purchase",
            purchaseId,
            voucherNo,
            line.qty,
            line.rate,
            nextQty,
            `Purchase ${voucherNo}`,
          );
          rawValue += line.amount;
        }

        if (line.particularId) {
          const particular = db
            .prepare("SELECT stock_qty FROM item_particulars WHERE id = ?")
            .get(line.particularId);
          const nextQty = Number(particular?.stock_qty || 0) + line.qty;
          db.prepare("UPDATE item_particulars SET stock_qty = ? WHERE id = ?").run(
            nextQty,
            line.particularId,
          );
          ledgerInsert.run(
            String(date),
            "finished",
            null,
            line.particularId,
            "purchase",
            purchaseId,
            voucherNo,
            line.qty,
            line.rate,
            nextQty,
            `Purchase ${voucherNo}`,
          );
          finishedValue += line.amount;
        }
      }

      // Double-entry: debit inventory, credit payable and/or cash.
      const entries = [];
      if (rawValue > 0) {
        entries.push({
          account_id: requireAccountIdByCode(ACCOUNT_CODES.rawInventory),
          debit: round2(rawValue),
          credit: 0,
        });
      }
      if (finishedValue > 0) {
        entries.push({
          account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
          debit: round2(finishedValue),
          credit: 0,
        });
      }
      if (paid > 0) {
        entries.push({
          account_id: requireAccountIdByCode(
            payment_mode === "bank" ? ACCOUNT_CODES.bank : ACCOUNT_CODES.cash,
          ),
          debit: 0,
          credit: round2(paid),
        });
      }
      if (netTotal - paid > 0) {
        entries.push({
          account_id: resolvePartyAccountId("supplier", supplierId),
          debit: 0,
          credit: round2(netTotal - paid),
        });
      }
      postAccountVoucher({
        voucherNo: `AV-${voucherNo}`,
        date: String(date),
        voucherType: "purchase",
        refType: "purchase",
        refId: purchaseId,
        narration: `Purchase ${voucherNo} from ${supplier.name}`,
        createdBy: req.user?.id ?? null,
        entries,
      });

      return {
        purchase: db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchaseId),
        lines: db
          .prepare("SELECT * FROM purchase_lines WHERE purchase_id = ? ORDER BY id ASC")
          .all(purchaseId),
      };
    })();

    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to save purchase");
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
  const {
    date = new Date().toISOString().slice(0, 10),
    particular_id,
    batch_quantity,
    remarks = "",
  } = req.body || {};
  const particularId = Number(particular_id || 0);
  const producedQty = Number(batch_quantity || 0);

  if (!particularId || !Number.isFinite(producedQty) || producedQty <= 0) {
    return res.status(400).json({ error: "Please select a valid item and batch quantity" });
  }

  try {
    const result = db.transaction(() => {
      assertPostingAllowed(String(date));

      const formula = db
        .prepare("SELECT * FROM formulas WHERE particular_id = ?")
        .get(particularId);
      if (!formula) {
        throw new Error("No formula found for this particular. Create a Formula/BOM first.");
      }

      const formulaLines = db
        .prepare("SELECT * FROM formula_lines WHERE formula_id = ? ORDER BY sort_order ASC, id ASC")
        .all(formula.id);

      if (formulaLines.length === 0) {
        throw new Error("This formula has no material lines yet.");
      }

      const batchSize = Number.isFinite(Number(formula.batch_size))
        ? Number(formula.batch_size)
        : 1;
      const calculation = calculateProductionRequirements(formulaLines, producedQty, batchSize);

      for (const line of calculation.lines) {
        if (!line.factory_item_id) {
          throw new Error(
            `Material ${line.material_name || "unknown"} is missing a raw material reference.`,
          );
        }

        const qtyRequired = Number(line.qtyRequired || 0);
        if (!Number.isFinite(qtyRequired) || qtyRequired < 0) {
          throw new Error(`Invalid material quantity for ${line.material_name || "unknown"}.`);
        }

        const item = db
          .prepare("SELECT id, name, stock_qty FROM factory_items WHERE id = ?")
          .get(Number(line.factory_item_id));
        if (!item) {
          throw new Error(`Raw material not found: ${line.material_name || "unknown"}`);
        }

        if (Number(item.stock_qty || 0) < qtyRequired) {
          throw new Error(
            `Insufficient stock for ${item.name}. Available ${Number(item.stock_qty || 0)}, required ${qtyRequired}.`,
          );
        }
      }

      const productionVoucherNo = nextUniqueVoucherNo(DOC_PREFIX.production);
      const particular = db
        .prepare("SELECT * FROM item_particulars WHERE id = ?")
        .get(particularId);
      const currentStock = Number(particular?.stock_qty || 0);
      const safeBatchMultiplier = Number.isFinite(Number(calculation.batchMultiplier))
        ? Number(calculation.batchMultiplier)
        : 0;
      const safeTotalMaterialCost = Number.isFinite(Number(calculation.totalMaterialCost))
        ? Number(calculation.totalMaterialCost)
        : 0;

      const productionInsert = db
        .prepare(
          "INSERT INTO productions (voucher_no, date, particular_id, batches, produced_qty, material_cost, overhead_cost, total_cost, remarks, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))",
        )
        .run(
          productionVoucherNo,
          String(date),
          particularId,
          safeBatchMultiplier,
          producedQty,
          safeTotalMaterialCost,
          safeTotalMaterialCost,
          String(remarks || ""),
          req.user?.id ?? null,
        );

      const productionId = Number(productionInsert.lastInsertRowid);
      const consumptionInsert = db.prepare(
        "INSERT INTO production_consumptions (production_id, factory_item_id, material_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?)",
      );

      for (const line of calculation.lines) {
        const factoryItemId = Number(line.factory_item_id || 0);
        const qtyRequired = Number.isFinite(Number(line.qtyRequired))
          ? Number(line.qtyRequired)
          : 0;
        const rate = Number.isFinite(Number(line.rate)) ? Number(line.rate) : 0;
        const amount = Number.isFinite(Number(line.amount)) ? Number(line.amount) : 0;

        db.prepare("UPDATE factory_items SET stock_qty = stock_qty - ? WHERE id = ?").run(
          qtyRequired,
          factoryItemId,
        );
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
          Number(
            db.prepare("SELECT stock_qty FROM factory_items WHERE id = ?").get(factoryItemId)
              .stock_qty,
          ),
          `Production ${productionVoucherNo}`,
        );

        consumptionInsert.run(
          productionId,
          factoryItemId,
          String(line.material_name || ""),
          qtyRequired,
          rate,
          amount,
        );
      }

      db.prepare("UPDATE item_particulars SET stock_qty = ? WHERE id = ?").run(
        currentStock + producedQty,
        particularId,
      );
      db.prepare(
        "INSERT INTO stock_ledger (date, stock_type, factory_item_id, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, datetime('now'))",
      ).run(
        String(date),
        "finished",
        null,
        particularId,
        "production",
        productionId,
        productionVoucherNo,
        producedQty,
        currentStock + producedQty,
        `Produced ${producedQty}`,
      );

      // Double-entry: finished goods inventory up, raw material inventory down.
      if (safeTotalMaterialCost > 0) {
        postAccountVoucher({
          voucherNo: `AV-${productionVoucherNo}`,
          date: String(date),
          voucherType: "journal",
          refType: "production",
          refId: productionId,
          narration: `Production ${productionVoucherNo}`,
          createdBy: req.user?.id ?? null,
          entries: [
            {
              account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
              debit: round2(safeTotalMaterialCost),
              credit: 0,
            },
            {
              account_id: requireAccountIdByCode(ACCOUNT_CODES.rawInventory),
              debit: 0,
              credit: round2(safeTotalMaterialCost),
            },
          ],
        });
      }

      return {
        production: db.prepare("SELECT * FROM productions WHERE id = ?").get(productionId),
        consumptions: db
          .prepare("SELECT * FROM production_consumptions WHERE production_id = ? ORDER BY id ASC")
          .all(productionId),
        calculation,
      };
    })();

    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to save production");
  }
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
  const {
    date = new Date().toISOString().slice(0, 10),
    customer_id,
    remarks = "",
    paid_amount = 0,
    payment_mode = "cash",
    lines = [],
  } = req.body || {};
  const customerId = Number(customer_id || 0);
  if (!customerId) return res.status(400).json({ error: "Customer is required" });
  const customer = db
    .prepare("SELECT id, name FROM customers WHERE id = ? AND is_active = 1")
    .get(customerId);
  if (!customer)
    return res.status(400).json({ error: "Customer not found in the customer master" });
  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ error: "At least one sale line is required" });

  try {
    const result = db.transaction(() => {
      assertPostingAllowed(String(date));
      let total = 0;
      let totalCost = 0;
      const lineData = [];
      for (const line of lines) {
        const particularId = Number(line.particular_id);
        const qty = Number(line.qty || 0);
        const rate = Number(line.rate || 0);
        if (!particularId || qty <= 0 || rate < 0) {
          throw new Error("Invalid sale line data");
        }

        const particular = db
          .prepare("SELECT * FROM item_particulars WHERE id = ?")
          .get(particularId);
        if (!particular) throw new Error("Invalid item line");
        if (qty > Number(particular.stock_qty || 0)) {
          throw new Error(`Insufficient stock for ${particularId}`);
        }

        const costPrice = Number(particular.cost_price);
        if (!Number.isFinite(costPrice) || costPrice <= 0) {
          throw new Error("Item has no cost price; set the cost first");
        }
        const amount = round2(qty * rate);
        const cost = round2(qty * costPrice);
        total += amount;
        totalCost += cost;
        lineData.push({
          particularId,
          qty,
          rate,
          amount,
          cost,
          costPrice,
          description: String(line.description || ""),
        });
      }

      const netTotal = round2(total);
      const paid = Number(paid_amount || 0);
      if (!Number.isFinite(paid) || paid < 0 || paid > netTotal) {
        throw new Error("Paid amount must be between 0 and the sale total");
      }

      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.sale);
      const sale = db
        .prepare(
          "INSERT INTO sales (voucher_no, date, customer_id, sale_type, remarks, sub_total, discount, tax, net_total, paid_amount, created_by, created_at) VALUES (?, ?, ?, 'counter', ?, ?, 0, 0, ?, ?, ?, datetime('now'))",
        )
        .run(
          voucherNo,
          String(date),
          customerId,
          String(remarks || ""),
          netTotal,
          netTotal,
          round2(paid),
          req.user?.id ?? null,
        );

      const insertLine = db.prepare(
        "INSERT INTO sale_lines (sale_id, particular_id, description, qty, rate, cost_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const ledgerInsert = db.prepare(
        "INSERT INTO stock_ledger (date, stock_type, particular_id, ref_type, ref_id, ref_no, qty_out, rate, balance_after, remarks) VALUES (?, 'finished', ?, 'sale', ?, ?, ?, ?, (SELECT stock_qty FROM item_particulars WHERE id = ?), ?)",
      );

      for (const line of lineData) {
        db.prepare("UPDATE item_particulars SET stock_qty = stock_qty - ? WHERE id = ?").run(
          line.qty,
          line.particularId,
        );
        ledgerInsert.run(
          String(date),
          line.particularId,
          sale.lastInsertRowid,
          voucherNo,
          line.qty,
          line.rate,
          line.particularId,
          String(remarks || "Sale"),
        );
        insertLine.run(
          sale.lastInsertRowid,
          line.particularId,
          line.description,
          line.qty,
          line.rate,
          line.costPrice || 0,
          line.amount,
        );
      }

      // Double-entry: receivable/cash up, sales up; COGS up, finished stock down.
      const entries = [];
      if (netTotal - paid > 0) {
        entries.push({
          account_id: resolvePartyAccountId("customer", customerId),
          debit: round2(netTotal - paid),
          credit: 0,
        });
      }
      if (paid > 0) {
        entries.push({
          account_id: requireAccountIdByCode(
            payment_mode === "bank" ? ACCOUNT_CODES.bank : ACCOUNT_CODES.cash,
          ),
          debit: round2(paid),
          credit: 0,
        });
      }
      entries.push({
        account_id: requireAccountIdByCode(ACCOUNT_CODES.sales),
        debit: 0,
        credit: netTotal,
      });
      entries.push({
        account_id: requireAccountIdByCode(ACCOUNT_CODES.costOfGoodsSold),
        debit: round2(totalCost),
        credit: 0,
      });
      entries.push({
        account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
        debit: 0,
        credit: round2(totalCost),
      });
      postAccountVoucher({
        voucherNo: `AV-${voucherNo}`,
        date: String(date),
        voucherType: "sale",
        refType: "sale",
        refId: Number(sale.lastInsertRowid),
        narration: `Sale ${voucherNo} to ${customer.name}`,
        createdBy: req.user?.id ?? null,
        entries,
      });

      return { id: sale.lastInsertRowid, voucher_no: voucherNo, total: netTotal };
    })();

    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to save sale");
  }
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

// An issue voucher is a stock-delivery document only: it deducts finished stock
// and writes stock_ledger rows, but posts no financial voucher. Financial value
// is captured by Counter Sale, so the two meanings are never mixed.
app.post("/api/issue-vouchers", requireAuth, (req, res) => {
  const {
    voucher_no,
    date = new Date().toISOString().slice(0, 10),
    customer_id,
    remarks = "",
    lines = [],
  } = req.body || {};
  const customerId = Number(customer_id || 0);
  if (!customerId) return res.status(400).json({ error: "Customer is required" });
  const customer = db
    .prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1")
    .get(customerId);
  if (!customer)
    return res.status(400).json({ error: "Customer not found in the customer master" });
  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ error: "At least one issue line is required" });

  try {
    const result = db.transaction(() => {
      assertPostingAllowed(String(date));
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.issue);

      const issue = db
        .prepare(
          "INSERT INTO issue_vouchers (voucher_no, date, customer_id, transporter_id, remarks, created_by, created_at) VALUES (?, ?, ?, NULL, ?, ?, datetime('now'))",
        )
        .run(
          voucherNo,
          String(date || new Date().toISOString().slice(0, 10)),
          Number(customer_id),
          String(remarks || ""),
          req.user?.id ?? null,
        );

      const insertLine = db.prepare(
        "INSERT INTO issue_voucher_lines (voucher_id, particular_id, size, shade, in_stock, qty) VALUES (?, ?, ?, ?, ?, ?)",
      );

      for (const line of lines) {
        const particularId = Number(line.particular_id);
        const qty = Number(line.qty || 0);
        if (!particularId) throw new Error("Invalid issue item");
        if (!Number.isFinite(qty) || qty <= 0)
          throw new Error("Issue quantity must be greater than 0");
        const particular = db
          .prepare("SELECT * FROM item_particulars WHERE id = ?")
          .get(particularId);
        if (!particular) throw new Error("Invalid issue item");
        if (qty > Number(particular.stock_qty || 0))
          throw new Error(`Insufficient stock for ${line.size || particularId}`);

        db.prepare("UPDATE item_particulars SET stock_qty = stock_qty - ? WHERE id = ?").run(
          qty,
          particularId,
        );
        insertLine.run(
          issue.lastInsertRowid,
          particularId,
          String(line.size || particular.type || ""),
          String(line.shade || particular.weight_unit || ""),
          Number(particular.stock_qty || 0),
          qty,
        );
        const issueRate = Number(line.rate ?? particular.sale_price ?? 0) || 0;
        db.prepare(
          "INSERT INTO stock_ledger (date, stock_type, particular_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks) VALUES (?, 'finished', ?, 'issue', ?, ?, 0, ?, ?, (SELECT stock_qty FROM item_particulars WHERE id = ?), ?)",
        ).run(
          String(date),
          particularId,
          issue.lastInsertRowid,
          voucherNo,
          qty,
          issueRate,
          particularId,
          String(remarks || "Issue voucher"),
        );
      }

      return { id: issue.lastInsertRowid, voucher_no: voucherNo };
    })();

    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to save issue voucher");
  }
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
  const {
    date = new Date().toISOString().slice(0, 10),
    return_type = "customer",
    customer_id = null,
    supplier_id = null,
    remarks = "",
    lines = [],
  } = req.body || {};
  if (return_type !== "customer" && return_type !== "supplier") {
    return res.status(400).json({ error: "Return type must be customer or supplier" });
  }
  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ error: "At least one return line is required" });

  const returnType = return_type;
  const customerId = returnType === "customer" ? Number(customer_id) : null;
  const supplierId = returnType === "supplier" ? Number(supplier_id) : null;
  if (returnType === "customer" && !customerId)
    return res.status(400).json({ error: "Customer is required" });
  if (returnType === "supplier" && !supplierId)
    return res.status(400).json({ error: "Supplier is required" });

  try {
    const result = db.transaction(() => {
      assertPostingAllowed(String(date));
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.return);

      const returnRow = db
        .prepare(
          "INSERT INTO returns (voucher_no, date, return_type, customer_id, supplier_id, remarks, net_total, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now'))",
        )
        .run(
          voucherNo,
          String(date),
          returnType,
          customerId,
          supplierId,
          String(remarks || ""),
          req.user?.id ?? null,
        );

      let total = 0;
      let returnedCost = 0;
      const insertLine = db.prepare(
        "INSERT INTO return_lines (return_id, particular_id, factory_item_id, description, qty, rate, cost_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );

      for (const line of lines) {
        const qty = finiteNumber(line?.qty ?? 0, "Return quantity", { min: Number.EPSILON });
        const rate = finiteNumber(line?.rate ?? 0, "Return rate", { min: 0 });
        const amount = qty * rate;
        total += amount;

        if (returnType === "customer") {
          const particularId = Number(line?.particular_id ?? 0);
          if (!particularId)
            throw new Error("Customer return line must include a valid item variant");
          const particular = db
            .prepare("SELECT id, stock_qty, cost_price FROM item_particulars WHERE id = ?")
            .get(particularId);
          if (!particular) throw new Error("Customer return item variant not found");
          const costPrice = Number(particular.cost_price);
          if (!Number.isFinite(costPrice) || costPrice <= 0) {
            throw new Error("Item has no cost price; set the cost first");
          }
          returnedCost += qty * costPrice;

          db.prepare("UPDATE item_particulars SET stock_qty = stock_qty + ? WHERE id = ?").run(
            qty,
            particularId,
          );
          db.prepare(
            "INSERT INTO stock_ledger (date, stock_type, particular_id, factory_item_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, 'finished', ?, NULL, 'return', ?, ?, ?, 0, ?, ?, ?, datetime('now'))",
          ).run(
            String(date),
            particularId,
            returnRow.lastInsertRowid,
            voucherNo,
            qty,
            rate,
            Number(
              db.prepare("SELECT stock_qty FROM item_particulars WHERE id = ?").get(particularId)
                .stock_qty,
            ),
            String(remarks || "Customer return"),
          );
          insertLine.run(
            returnRow.lastInsertRowid,
            particularId,
            null,
            String(line.description || ""),
            qty,
            rate,
            costPrice,
            amount,
          );
          continue;
        }

        const factoryItemId = Number(line?.factory_item_id ?? 0);
        if (!factoryItemId)
          throw new Error("Supplier return line must include a valid raw material");
        const factoryItem = db
          .prepare(
            "SELECT id, name, stock_qty, rate FROM factory_items WHERE id = ? AND is_active = 1",
          )
          .get(factoryItemId);
        if (!factoryItem) throw new Error("Supplier return raw material not found");
        const costPrice = Number(factoryItem.rate);
        if (!Number.isFinite(costPrice) || costPrice <= 0) {
          throw new Error("Item has no cost price; set the cost first");
        }
        if (Number(factoryItem.stock_qty || 0) < qty) {
          throw new Error(
            `Insufficient raw stock for ${factoryItem.name}. Available ${Number(factoryItem.stock_qty || 0)}, requested ${qty}.`,
          );
        }

        db.prepare("UPDATE factory_items SET stock_qty = stock_qty - ? WHERE id = ?").run(
          qty,
          factoryItemId,
        );
        db.prepare(
          "INSERT INTO stock_ledger (date, stock_type, particular_id, factory_item_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at) VALUES (?, 'raw', NULL, ?, 'return', ?, ?, 0, ?, ?, ?, ?, datetime('now'))",
        ).run(
          new Date().toISOString().slice(0, 10),
          factoryItemId,
          returnRow.lastInsertRowid,
          voucherNo,
          qty,
          rate,
          Number(
            db.prepare("SELECT stock_qty FROM factory_items WHERE id = ?").get(factoryItemId)
              .stock_qty,
          ),
          String(remarks || "Supplier return"),
        );
        insertLine.run(
          returnRow.lastInsertRowid,
          null,
          factoryItemId,
          String(line.description || ""),
          qty,
          rate,
          costPrice,
          amount,
        );
      }

      const netTotal = round2(total);
      db.prepare("UPDATE returns SET net_total = ? WHERE id = ?").run(
        netTotal,
        returnRow.lastInsertRowid,
      );

      // Double-entry reversal for the returned value.
      const entries = [];
      if (returnType === "customer") {
        entries.push({
          account_id: requireAccountIdByCode(ACCOUNT_CODES.salesReturns),
          debit: netTotal,
          credit: 0,
        });
        entries.push({
          account_id: resolvePartyAccountId("customer", customerId),
          debit: 0,
          credit: netTotal,
        });
        entries.push({
          account_id: requireAccountIdByCode(ACCOUNT_CODES.finishedInventory),
          debit: round2(returnedCost),
          credit: 0,
        });
        entries.push({
          account_id: requireAccountIdByCode(ACCOUNT_CODES.costOfGoodsSold),
          debit: 0,
          credit: round2(returnedCost),
        });
      } else {
        entries.push({
          account_id: resolvePartyAccountId("supplier", supplierId),
          debit: netTotal,
          credit: 0,
        });
        entries.push({
          account_id: requireAccountIdByCode(ACCOUNT_CODES.rawInventory),
          debit: 0,
          credit: netTotal,
        });
      }

      if (entries.length > 0) {
        postAccountVoucher({
          voucherNo: `AV-${voucherNo}`,
          date: String(date),
          voucherType: "return",
          refType: "return",
          refId: Number(returnRow.lastInsertRowid),
          narration: `Return ${voucherNo}`,
          createdBy: req.user?.id ?? null,
          entries,
        });
      }

      return { id: returnRow.lastInsertRowid, voucher_no: voucherNo, total: netTotal };
    })();

    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to save return");
  }
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

  if (from) {
    sql += " AND s.date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND s.date <= ?";
    params.push(to);
  }
  if (party) {
    sql += " AND s.customer_id = ?";
    params.push(party);
  }
  if (item) {
    sql += " AND sl.particular_id = ?";
    params.push(item);
  }

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

  if (from) {
    sql += " AND p.date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND p.date <= ?";
    params.push(to);
  }
  if (party) {
    sql += " AND p.supplier_id = ?";
    params.push(party);
  }
  if (item) {
    sql += " AND pl.particular_id = ?";
    params.push(item);
  }

  sql += " GROUP BY p.id, s.name ORDER BY p.date DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/reports/general", requireAuth, (req, res) => {
  const from = req.query.from ? String(req.query.from) : "";
  const to = req.query.to ? String(req.query.to) : "";
  const item = req.query.item ? Number(req.query.item) : null;
  const stockType = req.query.stock_type ? String(req.query.stock_type) : "";

  let sql = `SELECT sl.id, sl.date, sl.ref_type, sl.ref_no, sl.stock_type, sl.qty_in, sl.qty_out, sl.balance_after,
                    ip.id AS particular_id, i.name AS item_name,
                    fi.id AS factory_item_id, fi.name AS factory_item_name
             FROM stock_ledger sl
             LEFT JOIN item_particulars ip ON ip.id = sl.particular_id
             LEFT JOIN items i ON i.id = ip.item_id
             LEFT JOIN factory_items fi ON fi.id = sl.factory_item_id
             WHERE 1 = 1`;
  const params = [];

  if (from) {
    sql += " AND sl.date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND sl.date <= ?";
    params.push(to);
  }
  if (stockType === "raw" || stockType === "finished") {
    sql += " AND sl.stock_type = ?";
    params.push(stockType);
  }
  if (item) {
    sql += " AND (sl.particular_id = ? OR sl.factory_item_id = ?)";
    params.push(item, item);
  }

  sql += " ORDER BY sl.date DESC, sl.id DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/backup/export", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const backup = await createBackup(_req.user?.id ?? null);
    if (!backup.integrity?.ok) {
      return res
        .status(500)
        .json({ error: "Backup integrity check failed", detail: backup.integrity });
    }
    res.download(backup.file_path, backup.file_name);
  } catch (error) {
    sendRouteError(res, error, 500, "Backup failed");
  }
});

app.get("/api/backup/list", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ directory: BACKUP_DIR, backups: listBackups() });
});

// ---------- Phase 2: Items & Formula/BOM ----------
app.get("/api/items", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM items WHERE is_active = 1 ORDER BY id ASC").all();
  res.json(rows);
});

app.post("/api/items", requireAuth, requireRole("admin", "accountant"), (req, res) => {
  try {
    const { code = "", name = "", category = "", remarks = "" } = req.body || {};
    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      return res.status(400).json({ error: "Item name is required" });
    }

    const normalizedCode = String(code || "").trim();
    if (normalizedCode) {
      const existing = db
        .prepare("SELECT id FROM items WHERE code = ? AND is_active = 1")
        .get(normalizedCode);
      if (existing) {
        return res.status(409).json({ error: "Item code already exists" });
      }
    }

    const insert = db
      .prepare(
        "INSERT INTO items (code, name, category, remarks, is_active, created_at) VALUES (?, ?, ?, ?, 1, datetime('now'))",
      )
      .run(
        normalizedCode || `ITEM-${Date.now()}`,
        trimmedName,
        String(category || "").trim(),
        String(remarks || "").trim(),
      );

    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(insert.lastInsertRowid);
    res.status(201).json(row);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to save item");
  }
});

app.put("/api/items/:id", requireAuth, requireRole("admin", "accountant"), (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { code = "", name = "", category = "", remarks = "" } = req.body || {};
    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      return res.status(400).json({ error: "Item name is required" });
    }

    const normalizedCode = String(code || "").trim();
    if (normalizedCode) {
      const existing = db
        .prepare("SELECT id FROM items WHERE code = ? AND id != ? AND is_active = 1")
        .get(normalizedCode, itemId);
      if (existing) {
        return res.status(409).json({ error: "Item code already exists" });
      }
    }

    db.prepare(
      "UPDATE items SET code = ?, name = ?, category = ?, remarks = ? WHERE id = ? AND is_active = 1",
    ).run(
      normalizedCode || `ITEM-${itemId}`,
      trimmedName,
      String(category || "").trim(),
      String(remarks || "").trim(),
      itemId,
    );

    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(itemId);
    res.json(row);
  } catch (error) {
    sendRouteError(res, error, 400, "Unable to update item");
  }
});

app.delete("/api/items/:id", requireAuth, requireRole("admin"), (req, res) => {
  const itemId = Number(req.params.id);
  db.prepare("UPDATE items SET is_active = 0 WHERE id = ?").run(itemId);
  db.prepare("DELETE FROM item_particulars WHERE item_id = ?").run(itemId);
  res.json({ ok: true });
});

app.get("/api/items/:id/particulars", requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  const rows = db
    .prepare("SELECT * FROM item_particulars WHERE item_id = ? ORDER BY sort_order ASC, id ASC")
    .all(itemId);
  res.json(rows);
});

app.post(
  "/api/items/:id/particulars",
  requireAuth,
  requireRole("admin", "accountant"),
  (req, res) => {
    try {
      const itemId = Number(req.params.id);
      const item = db.prepare("SELECT id FROM items WHERE id = ? AND is_active = 1").get(itemId);
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

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

      const costPrice = finiteNumber(cost_price, "Cost price", { min: 0 });
      const wholesalePrice = finiteNumber(ws_price, "Wholesale price", { min: 0 });
      const salePrice = finiteNumber(sale_price, "Sale price", { min: 0 });
      const stockQty = finiteNumber(stock_qty, "Opening stock", { min: 0 });
      const minQty = finiteNumber(min_qty, "Minimum stock", { min: 0 });
      const maxQty = finiteNumber(max_qty, "Maximum stock", { min: 0 });
      if (maxQty > 0 && maxQty < minQty) {
        return res.status(400).json({ error: "Maximum stock cannot be lower than minimum stock" });
      }

      const insert = db
        .prepare(
          "INSERT INTO item_particulars (item_id, type, weight_unit, cost_price, ws_price, sale_price, stock_qty, min_qty, max_qty, formula_code, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM item_particulars WHERE item_id=?), 1), datetime('now'))",
        )
        .run(
          itemId,
          String(type || "").trim(),
          String(weight_unit || "").trim(),
          costPrice,
          wholesalePrice,
          salePrice,
          stockQty,
          minQty,
          maxQty,
          String(formula_code || "").trim(),
          itemId,
        );

      const row = db
        .prepare("SELECT * FROM item_particulars WHERE id = ?")
        .get(insert.lastInsertRowid);
      res.status(201).json(row);
    } catch (error) {
      sendRouteError(res, error, 400, "Unable to save particular");
    }
  },
);

app.put(
  "/api/items/:id/particulars/:particularId",
  requireAuth,
  requireRole("admin", "accountant"),
  (req, res) => {
    try {
      const itemId = Number(req.params.id);
      const particularId = Number(req.params.particularId);
      const item = db.prepare("SELECT id FROM items WHERE id = ? AND is_active = 1").get(itemId);
      const particular = db
        .prepare("SELECT id FROM item_particulars WHERE id = ? AND item_id = ?")
        .get(particularId, itemId);
      if (!item || !particular) {
        return res.status(404).json({ error: "Particular not found" });
      }

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

      const costPrice = finiteNumber(cost_price, "Cost price", { min: 0 });
      const wholesalePrice = finiteNumber(ws_price, "Wholesale price", { min: 0 });
      const salePrice = finiteNumber(sale_price, "Sale price", { min: 0 });
      const stockQty = finiteNumber(stock_qty, "Opening stock", { min: 0 });
      const minQty = finiteNumber(min_qty, "Minimum stock", { min: 0 });
      const maxQty = finiteNumber(max_qty, "Maximum stock", { min: 0 });
      if (maxQty > 0 && maxQty < minQty) {
        return res.status(400).json({ error: "Maximum stock cannot be lower than minimum stock" });
      }

      db.prepare(
        "UPDATE item_particulars SET type = ?, weight_unit = ?, cost_price = ?, ws_price = ?, sale_price = ?, stock_qty = ?, min_qty = ?, max_qty = ?, formula_code = ? WHERE id = ? AND item_id = ?",
      ).run(
        String(type || "").trim(),
        String(weight_unit || "").trim(),
        costPrice,
        wholesalePrice,
        salePrice,
        stockQty,
        minQty,
        maxQty,
        String(formula_code || "").trim(),
        particularId,
        itemId,
      );

      const row = db.prepare("SELECT * FROM item_particulars WHERE id = ?").get(particularId);
      res.json(row);
    } catch (error) {
      sendRouteError(res, error, 400, "Unable to update particular");
    }
  },
);

app.delete(
  "/api/items/:id/particulars/:particularId",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const itemId = Number(req.params.id);
    const particularId = Number(req.params.particularId);
    db.prepare("DELETE FROM item_particulars WHERE id = ? AND item_id = ?").run(
      particularId,
      itemId,
    );
    db.prepare("DELETE FROM formulas WHERE particular_id = ?").run(particularId);
    db.prepare(
      "DELETE FROM formula_lines WHERE formula_id IN (SELECT id FROM formulas WHERE particular_id = ?)",
    ).run(particularId);
    res.json({ ok: true });
  },
);

app.get("/api/formulas", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `
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
    `,
    )
    .all();

  res.json(
    rows.map((row) => ({
      particular_id: row.particular_id,
      item_id: row.item_id,
      item_name: row.item_name,
      type: row.type,
      formula_code: row.formula_code,
      total_value: Number(row.total_value || 0),
      total_cost: Number(row.total_cost || 0),
    })),
  );
});

app.get("/api/formulas/unassigned", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `
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
    `,
    )
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
    .prepare("SELECT * FROM formula_lines WHERE formula_id = ? ORDER BY sort_order ASC, id ASC")
    .all(formula.id);

  res.json({ formula, lines });
});

app.post(
  "/api/formulas/:particularId",
  requireAuth,
  requireRole("admin", "accountant"),
  (req, res) => {
    try {
      const particularId = Number(req.params.particularId);
      const { code = "", batch_size = 1, remarks = "", lines = [] } = req.body || {};
      const payload = {
        batch_size,
        lines,
        remarks,
      };

      const validation = validateFormulaPayload(particularId, payload);
      const normalizedCode = String(code || "").trim();

      const writeFormula = db.transaction(() => {
        let formula = db
          .prepare("SELECT * FROM formulas WHERE particular_id = ?")
          .get(particularId);
        if (formula) {
          db.prepare(
            "UPDATE formulas SET code = ?, batch_size = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?",
          ).run(normalizedCode, validation.batchSize, String(remarks || "").trim(), formula.id);
        } else {
          const insert = db
            .prepare(
              "INSERT INTO formulas (particular_id, code, batch_size, total_cost, remarks, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
            )
            .run(
              particularId,
              normalizedCode,
              validation.batchSize,
              0,
              String(remarks || "").trim(),
            );

          formula = db.prepare("SELECT * FROM formulas WHERE id = ?").get(insert.lastInsertRowid);
        }

        db.prepare("DELETE FROM formula_lines WHERE formula_id = ?").run(formula.id);

        const lineInsert = db.prepare(
          "INSERT INTO formula_lines (formula_id, factory_item_id, material_name, value, rate, cost_value, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );

        const totalCost = lines.reduce((sum, line) => {
          const value = finiteNumber(line?.value ?? 0, "Formula quantity", { min: Number.EPSILON });
          const rate = finiteNumber(line?.rate ?? 0, "Formula rate", { min: 0 });
          return sum + value * rate;
        }, 0);

        for (const [index, line] of lines.entries()) {
          const materialId = Number(line?.factory_item_id ?? 0);
          const factoryItem = validateFactoryMaterial(
            materialId,
            `Formula line ${index + 1} raw material`,
          );
          const value = finiteNumber(line?.value ?? 0, `Formula line ${index + 1} quantity`, {
            min: Number.EPSILON,
          });
          const rate = finiteNumber(line?.rate ?? 0, `Formula line ${index + 1} rate`, {
            min: 0,
          });
          const costValue = value * rate;
          lineInsert.run(
            formula.id,
            materialId,
            String(line?.material_name || factoryItem.name).trim(),
            value,
            rate,
            costValue,
            index + 1,
          );
        }

        db.prepare(
          "UPDATE formulas SET total_cost = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(Number(totalCost), formula.id);

        return db.prepare("SELECT * FROM formulas WHERE id = ?").get(formula.id);
      });

      const fresh = writeFormula();
      const storedLines = db
        .prepare("SELECT * FROM formula_lines WHERE formula_id = ? ORDER BY sort_order ASC, id ASC")
        .all(fresh.id);

      res.json({ formula: fresh, lines: storedLines });
    } catch (error) {
      sendRouteError(res, error, 400, "Unable to save formula");
    }
  },
);

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

// ---------- Phase 6: integrity + trial balance ----------
app.get("/api/stock/reconciliation", requireAuth, (_req, res) => {
  res.json(reconcileStock());
});

app.get("/api/accounts/trial-balance", requireAuth, (_req, res) => {
  res.json(trialBalance());
});

// ---------- Phase 7: additional reports ----------
app.get("/api/reports/production", requireAuth, (req, res) => {
  const from = req.query.from ? String(req.query.from) : "";
  const to = req.query.to ? String(req.query.to) : "";

  let sql = `SELECT p.id, p.voucher_no, p.date, p.batches, p.produced_qty, p.material_cost,
                    p.overhead_cost, p.total_cost, i.name AS item_name, ip.type AS particular_type
             FROM productions p
             JOIN item_particulars ip ON ip.id = p.particular_id
             JOIN items i ON i.id = ip.item_id
             WHERE 1 = 1`;
  const params = [];
  if (from) {
    sql += " AND p.date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND p.date <= ?";
    params.push(to);
  }
  sql += " ORDER BY p.date DESC, p.id DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/reports/outstanding", requireAuth, (_req, res) => {
  const receivables = db
    .prepare(
      `SELECT c.id, c.name,
              COALESCE(c.opening_balance, 0) + COALESCE(SUM(s.net_total - s.paid_amount), 0) AS balance
       FROM customers c
       LEFT JOIN sales s ON s.customer_id = c.id
       WHERE c.is_active = 1
       GROUP BY c.id
       HAVING ABS(balance) > 0.005
       ORDER BY balance DESC`,
    )
    .all();
  const payables = db
    .prepare(
      `SELECT s.id, s.name,
              COALESCE(s.opening_balance, 0) + COALESCE(SUM(p.net_total - p.paid_amount), 0) AS balance
       FROM suppliers s
       LEFT JOIN purchases p ON p.supplier_id = s.id
       WHERE s.is_active = 1
       GROUP BY s.id
       HAVING ABS(balance) > 0.005
       ORDER BY balance DESC`,
    )
    .all();
  res.json({ receivables, payables });
});

// ---------- Phase 1: password change ----------
app.post("/api/auth/change-password", requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Current and new password are required" });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  let ok = false;
  try {
    ok = verifyPassword(current_password, user.password_hash, user.password_salt);
  } catch {
    ok = false;
  }
  if (!ok) return res.status(400).json({ error: "Current password is incorrect" });

  const { hash, salt } = hashPassword(new_password);
  db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(
    hash,
    salt,
    user.id,
  );
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(user.id, req.token);
  res.json({ ok: true });
});

// ---------- Accounting back-post / restore (admin only) ----------
app.get("/api/accounting/backpost-report", requireAuth, requireRole("admin"), (_req, res) => {
  res.json(backpostReport());
});

app.post("/api/accounting/backpost", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const result = runBackpost({
      dryRun: req.body?.dry_run === true,
      userId: req.user?.id ?? null,
    });
    res.json(result);
  } catch (error) {
    sendRouteError(res, error, 400, "Back-post failed");
  }
});

app.post("/api/accounting/backpost/revert", requireAuth, requireRole("admin"), (_req, res) => {
  try {
    res.json(revertBackpost());
  } catch (error) {
    sendRouteError(res, error, 400, "Revert failed");
  }
});

app.get("/api/accounting/migration-log", requireAuth, requireRole("admin"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM migration_log ORDER BY id DESC LIMIT 500").all());
});

// Restore always writes to a separate file. Overwriting the live database is
// deliberately not exposed over HTTP.
app.post("/api/backup/restore", requireAuth, requireRole("admin"), (req, res) => {
  try {
    res.json(restoreToNewFile(req.body?.backup_id ?? req.body?.file_name));
  } catch (error) {
    sendRouteError(res, error, 400, "Restore failed");
  }
});

app.post("/api/backup/verify", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const backup = resolveBackup(req.body?.backup_id ?? req.body?.file_name);
    res.json({
      backup_id: backup.id,
      file_path: backup.file_path,
      ...verifyDatabaseFile(backup.file_path),
    });
  } catch (error) {
    sendRouteError(res, error, 400, "Verification failed");
  }
});

app.use(express.static(WEB_DIR));

app.use((req, res, next) => {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.sendFile(path.join(WEB_DIR, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((err, _req, res, _next) => {
  sendRouteError(res, err, 500, "Internal server error");
});

const server = app.listen(PORT, HOST, () => {
  const address = server.address();
  const host = typeof address === "string" ? address : address?.address || HOST;
  const port = typeof address === "string" ? PORT : address?.port || PORT;
  console.log(`Paint ERP API listening on http://${host}:${port}`);
  console.log(`SQLite database: ${DB_PATH}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use on ${HOST}. Set PORT to an available port.`);
  } else {
    console.error(`Unable to start the PaintFlow server: ${error.message}`);
  }
  closeDatabase();
  process.exitCode = 1;
});

function handleShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info("HTTP server closed.");
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("Forcing shutdown after timeout.");
    closeDatabase();
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
