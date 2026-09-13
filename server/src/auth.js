import crypto from "node:crypto";
import db from "./db.js";

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

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.token = token;
  next();
}
