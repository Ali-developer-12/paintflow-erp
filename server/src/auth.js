import crypto from "node:crypto";
import db from "./db.js";

export const VALID_USER_ROLES = ["admin", "accountant", "user"];

export function normalizeRole(role) {
  const value = String(role || "user")
    .trim()
    .toLowerCase();
  return VALID_USER_ROLES.includes(value) ? value : "user";
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    expires,
  );
  return { token, expires_at: expires };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.is_active = 1`,
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { id: row.id, username: row.username, full_name: row.full_name, role: row.role };
}

export function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function cleanupExpiredSessions() {
  return db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run().changes;
}

export function ensureInitialAdminUser() {
  const username = String(process.env.PAINT_ERP_ADMIN_USERNAME || "").trim();
  const password = process.env.PAINT_ERP_ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      "No initial admin credentials configured. Set PAINT_ERP_ADMIN_USERNAME and PAINT_ERP_ADMIN_PASSWORD to create an admin user on first run.",
    );
    return null;
  }

  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (existing) {
    const { hash, salt } = hashPassword(password);
    const passwordMatches = verifyPassword(
      password,
      existing.password_hash,
      existing.password_salt,
    );
    if (!passwordMatches || existing.role !== "admin") {
      db.prepare(
        "UPDATE users SET password_hash = ?, password_salt = ?, role = 'admin', is_active = 1, full_name = COALESCE(full_name, ?) WHERE username = ?",
      ).run(hash, salt, "System Administrator", username);
    }
    return { username };
  }

  const { hash, salt } = hashPassword(password);
  db.prepare(
    "INSERT INTO users (username, password_hash, password_salt, full_name, role, is_active) VALUES (?, ?, ?, ?, 'admin', 1)",
  ).run(username, hash, salt, "System Administrator");

  return { username };
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.token = token;
  next();
}

export function requireRole(...allowedRoles) {
  const roles = new Set(
    allowedRoles.flatMap((role) => (typeof role === "string" ? [normalizeRole(role)] : [])),
  );
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const userRole = normalizeRole(req.user.role);
    if (!roles.has(userRole) && userRole !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
