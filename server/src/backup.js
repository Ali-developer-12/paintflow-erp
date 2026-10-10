import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "./sqlite.js";
import db, { DATA_DIR, DB_PATH } from "./db.js";

// Backups are configurable but never accept an arbitrary client path: the
// server always writes inside BACKUP_DIR.
export const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(DATA_DIR, "backups");

export function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return BACKUP_DIR;
}

export function verifyDatabaseFile(filePath) {
  // The constructor itself throws for a non-SQLite or unreadable file, so the
  // whole open+check must be guarded, not just the pragma call.
  let probe = null;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });
    const result = probe.pragma("integrity_check", { simple: true });
    return { ok: result === "ok", result: String(result) };
  } catch (error) {
    return { ok: false, result: error.message || "could not open database file" };
  } finally {
    if (probe) {
      try {
        probe.close();
      } catch {
        /* already closed */
      }
    }
  }
}

// WAL-safe snapshot via better-sqlite3's online backup API. Reading the file
// directly (fs.readFileSync) can capture an inconsistent WAL state.
export async function createBackup(userId = null) {
  ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(BACKUP_DIR, `paint-erp-${stamp}.db`);

  await db.backup(filePath);

  const size = fs.statSync(filePath).size;
  const integrity = verifyDatabaseFile(filePath);

  let id = null;
  if (integrity.ok) {
    const row = db
      .prepare(
        "INSERT INTO backups (file_path, size_bytes, created_by, created_at) VALUES (?, ?, ?, datetime('now'))",
      )
      .run(filePath, size, userId ?? null);
    id = Number(row.lastInsertRowid);
  } else {
    // Never leave an unverified file behind claiming to be a good backup.
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }

  return {
    id,
    file_path: filePath,
    file_name: path.basename(filePath),
    size_bytes: size,
    integrity,
  };
}

export function listBackups() {
  return db
    .prepare(
      `SELECT b.id, b.file_path, b.size_bytes, b.created_at, u.username AS created_by_username
       FROM backups b LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.id DESC`,
    )
    .all()
    .map((row) => ({ ...row, file_name: path.basename(row.file_path) }));
}

// CLI: `npm run backup`
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  createBackup()
    .then((result) => {
      console.log(`Backup written: ${result.file_path} (${result.size_bytes} bytes)`);
      console.log(`Integrity: ${result.integrity.ok ? "ok" : result.integrity.result}`);
      console.log(`Source database: ${DB_PATH}`);
    })
    .catch((error) => {
      console.error("Backup failed:", error.message);
      process.exitCode = 1;
    });
}
