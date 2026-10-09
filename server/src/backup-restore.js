import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { TARGET_SCHEMA_VERSION } from "./schema-version.js";

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
export const RESTORE_TICKET_TTL_MS = 10 * 60 * 1000;

let activeRestoreTicket = null;

const REQUIRED_TABLES = [
  "users",
  "settings",
  "accounts",
  "financial_years",
  "items",
  "item_particulars",
  "customers",
  "suppliers",
  "purchases",
  "productions",
  "sales",
  "returns",
];

const COUNT_TABLES = {
  users: "users",
  customers: "customers",
  suppliers: "suppliers",
  items: "items",
};

export function looksLikeGsnBackup(filePath) {
  if (!fs.existsSync(filePath)) throw new Error("Backup file is missing");
  let database;
  try {
    database = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("Backup failed SQLite integrity check");

    const schemaVersion = Number(database.pragma("user_version", { simple: true }) || 0);
    if (schemaVersion > TARGET_SCHEMA_VERSION) {
      throw new Error("This backup was created by a newer version of GSN Paints");
    }

    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (REQUIRED_TABLES.some((table) => !tables.has(table))) {
      throw new Error("This file is not a GSN Paints backup");
    }

    const admin = database
      .prepare("SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1")
      .get();
    if (!admin) throw new Error("This backup has no active administrator");

    const count = (table) =>
      Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    const company = database
      .prepare("SELECT value FROM settings WHERE key = 'company_name' LIMIT 1")
      .get();
    const vouchers = [
      "purchases",
      "productions",
      "sales",
      "returns",
      "customer_receipts",
      "supplier_payments",
      "issue_vouchers",
      "account_vouchers",
    ].reduce((sum, table) => sum + (tables.has(table) ? count(table) : 0), 0);

    return {
      company_name: String(company?.value || "Paint Factory"),
      backup_date: fs.statSync(filePath).mtime.toISOString(),
      counts: {
        ...Object.fromEntries(
          Object.entries(COUNT_TABLES).map(([key, table]) => [key, count(table)]),
        ),
        vouchers,
      },
      schema_version: schemaVersion,
    };
  } catch (error) {
    if (error instanceof Error && /not a database|SQLITE_NOTADB/i.test(error.message)) {
      throw new Error("This file is not a GSN Paints backup");
    }
    if (error instanceof Error) throw error;
    throw new Error("This file is not a GSN Paints backup");
  } finally {
    database?.close();
  }
}

export function issueRestoreTicket(stagedFile, now = Date.now()) {
  const token = crypto.randomBytes(32).toString("hex");
  activeRestoreTicket = {
    token,
    stagedFile,
    expiresAt: now + RESTORE_TICKET_TTL_MS,
  };
  return token;
}

export function consumeRestoreTicket(token, now = Date.now()) {
  if (!activeRestoreTicket || activeRestoreTicket.token !== token) return null;
  const ticket = activeRestoreTicket;
  activeRestoreTicket = null;
  if (ticket.expiresAt <= now) return { expired: true, stagedFile: ticket.stagedFile };
  return { expired: false, stagedFile: ticket.stagedFile };
}
