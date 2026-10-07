import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import db, { DATA_DIR, DB_PATH } from "./db.js";
import { BACKUP_DIR, verifyDatabaseFile } from "./backup.js";

export const RESTORE_DIR = process.env.RESTORE_DIR
  ? path.resolve(process.env.RESTORE_DIR)
  : path.join(DATA_DIR, "restored");

// Resolve a backup by its logged id (or exact file name). The client can never
// supply an arbitrary filesystem path.
export function resolveBackup(identifier) {
  const row = db
    .prepare("SELECT id, file_path, size_bytes, created_at FROM backups WHERE id = ?")
    .get(Number(identifier));
  if (row) {
    if (!fs.existsSync(row.file_path)) {
      throw new Error(`Backup file for id ${identifier} is missing from disk`);
    }
    return row;
  }

  // Fall back to an exact file name inside BACKUP_DIR only.
  const name = path.basename(String(identifier));
  const candidate = path.join(BACKUP_DIR, name);
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep)) {
    throw new Error("Invalid backup reference");
  }
  if (!fs.existsSync(resolved)) throw new Error(`Backup "${name}" not found`);
  return {
    id: null,
    file_path: resolved,
    size_bytes: fs.statSync(resolved).size,
    created_at: null,
  };
}

// Verify a candidate database file without touching the live database.
export function verifyCandidate(filePath) {
  return verifyDatabaseFile(filePath);
}

// Restore into a NEW directory. This is the safe default: the live database is
// never written to. The caller receives the new path.
export function restoreToNewFile(identifier) {
  const backup = resolveBackup(identifier);
  const check = verifyDatabaseFile(backup.file_path);
  if (!check.ok) throw new Error(`Backup failed integrity check: ${check.result}`);

  fs.mkdirSync(RESTORE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(RESTORE_DIR, `restored-${stamp}.db`);

  // Copy, then verify the COPY actually opened and matches structurally.
  fs.copyFileSync(backup.file_path, target);
  const targetCheck = verifyDatabaseFile(target);
  if (!targetCheck.ok) {
    fs.unlinkSync(target);
    throw new Error(`Restored copy failed integrity check: ${targetCheck.result}`);
  }

  const tables = new Database(target, { readonly: true });
  let tableCount = 0;
  try {
    tableCount = tables
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get().c;
  } finally {
    tables.close();
  }

  return {
    ok: true,
    mode: "copy",
    restored_to: target,
    source_backup: backup.file_path,
    integrity: targetCheck,
    tables: tableCount,
    note: "Live database was not modified.",
  };
}

// In-place restore is deliberately hard to trigger: it refuses unless the caller
// passes an exact confirmation token, and it always keeps a safety copy first.
export const INPLACE_CONFIRM_TOKEN = "RESTORE-OVER-LIVE";

export function restoreInPlace(identifier, { confirm } = {}) {
  if (confirm !== INPLACE_CONFIRM_TOKEN) {
    throw new Error(
      `Refusing to overwrite the live database. Pass confirm="${INPLACE_CONFIRM_TOKEN}" to proceed.`,
    );
  }
  const backup = resolveBackup(identifier);
  const check = verifyDatabaseFile(backup.file_path);
  if (!check.ok) throw new Error(`Backup failed integrity check: ${check.result}`);

  // Safety copy of the current live database before touching it.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safety = path.join(DATA_DIR, `pre-restore-${stamp}.db`);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  fs.copyFileSync(DB_PATH, safety);

  fs.copyFileSync(backup.file_path, DB_PATH);
  // Remove stale WAL/SHM so the restored file is read on its own.
  for (const suffix of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${DB_PATH}${suffix}`);
    } catch {
      /* nothing to remove */
    }
  }

  const after = verifyDatabaseFile(DB_PATH);
  if (!after.ok) {
    fs.copyFileSync(safety, DB_PATH);
    throw new Error(`Restore produced an invalid database and was rolled back: ${after.result}`);
  }

  return {
    ok: true,
    mode: "in-place",
    restored_to: DB_PATH,
    safety_copy: safety,
    integrity: after,
    note: "Live database replaced. Safety copy retained.",
  };
}

// CLI entry point.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const backupArg = args.find((a) => !a.startsWith("--"));
  const inPlace = args.includes("--in-place");
  const confirmArg = args.find((a) => a.startsWith("--confirm="));

  if (!backupArg) {
    console.error("Usage: npm run restore -- <backup-id-or-file> [--in-place --confirm=TOKEN]");
    process.exitCode = 1;
  } else {
    try {
      const result = inPlace
        ? restoreInPlace(backupArg, { confirm: confirmArg?.split("=")[1] })
        : restoreToNewFile(backupArg);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error("Restore failed:", error.message);
      process.exitCode = 1;
    }
  }
}
