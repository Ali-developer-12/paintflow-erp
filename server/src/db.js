import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, DB_PATH, BUSY_TIMEOUT_MS, ensureRuntimeDirs } from "./config.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { DATA_DIR, DB_PATH };

ensureRuntimeDirs();

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);

logger.info(
  `Database connected at ${DB_PATH} (journal_mode=WAL, busy_timeout=${BUSY_TIMEOUT_MS}ms)`,
);

export function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(sql);
}

export function closeDatabase() {
  try {
    // Perform a passive WAL checkpoint to flush committed transactions cleanly
    db.pragma("wal_checkpoint(PASSIVE)");
    db.close();
    logger.info("Database closed cleanly with WAL checkpoint.");
  } catch (err) {
    logger.error("Error closing database", { error: err.message });
  }
}

export default db;
