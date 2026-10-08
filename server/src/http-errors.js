import { logger } from "./logger.js";

const INTERNAL_ERROR_PATTERNS = [
  /SQLITE/i,
  /SqliteError/i,
  /database/i,
  /ENOENT/i,
  /constraint failed/i,
  /no such (table|column)/i,
  /SQL error/i,
  /syntax error/i,
  /(?:^|\s)[A-Za-z]:\\/,
  /(?:^|\s)\/(?:[^/\s]+\/)+[^/\s]*/,
  /\s+at\s+.+:\d+:\d+/,
];

export function publicErrorMessage(error, fallback = "Request failed") {
  if (/^SQLITE/i.test(String(error?.code || ""))) return fallback;
  const message = String(error?.message || error || "");
  if (!message || INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }
  return message.replace(/\s+at\s+.*$/s, "").slice(0, 250);
}

export function sendRouteError(res, error, status, fallback) {
  if (status >= 500) {
    logger.error("API request failed", {
      status,
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
    });
  }

  const message =
    status >= 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : publicErrorMessage(error, fallback);
  return res.status(status).json({ error: message });
}
