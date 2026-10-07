import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const APP_NAME = "PaintFlow ERP";
export const APP_VERSION = "1.0.0";

export const HOST = process.env.HOST || "127.0.0.1";
export const PORT = Number.parseInt(process.env.PORT || "3001", 10);

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "paint-erp.db");
export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
export const LOGS_DIR = process.env.LOGS_DIR || path.join(DATA_DIR, "logs");

export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ];

export const BUSY_TIMEOUT_MS = Number.parseInt(process.env.BUSY_TIMEOUT_MS || "5000", 10);
export const BACKUP_RETENTION_COUNT = Number.parseInt(
  process.env.BACKUP_RETENTION_COUNT || "10",
  10,
);
