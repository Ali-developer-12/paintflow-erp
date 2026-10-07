import fs from "node:fs";
import path from "node:path";
import { LOGS_DIR } from "./config.js";

fs.mkdirSync(LOGS_DIR, { recursive: true });

const APP_LOG = path.join(LOGS_DIR, "app.log");
const ERROR_LOG = path.join(LOGS_DIR, "crash.log");

function formatLine(level, message, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(sanitizeMeta(meta))}` : "";
  return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
}

function sanitizeMeta(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const safe = Array.isArray(obj) ? [] : {};
  for (const [key, val] of Object.entries(obj)) {
    if (/password|token|secret|salt|hash/i.test(key)) {
      safe[key] = "[REDACTED]";
    } else if (typeof val === "object" && val !== null) {
      safe[key] = sanitizeMeta(val);
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

function appendLog(file, line) {
  try {
    fs.appendFileSync(file, line, "utf8");
  } catch {
    // Fail silently on filesystem write failure to avoid crashing the server
  }
}

export const logger = {
  info(msg, meta) {
    const line = formatLine("info", msg, meta);
    appendLog(APP_LOG, line);
    console.log(`[INFO] ${msg}`);
  },
  warn(msg, meta) {
    const line = formatLine("warn", msg, meta);
    appendLog(APP_LOG, line);
    console.warn(`[WARN] ${msg}`);
  },
  error(msg, meta) {
    const line = formatLine("error", msg, meta);
    appendLog(APP_LOG, line);
    appendLog(ERROR_LOG, line);
    console.error(`[ERROR] ${msg}`);
  },
};

export default logger;
