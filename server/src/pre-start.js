import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH, ensureRuntimeDirs } from "./config.js";
import { looksLikeGsnBackup } from "./backup-restore.js";

const pendingPath = path.join(DATA_DIR, "restore-pending.json");
const resultPath = path.join(DATA_DIR, "restore-result.json");
const stageDir = path.join(DATA_DIR, "restore-staging");
const safetyDir = path.join(DATA_DIR, "pre-restore");

function writeResult(result) {
  const temporaryPath = `${resultPath}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    JSON.stringify({ ...result, at: new Date().toISOString() }),
    "utf8",
  );
  fs.renameSync(temporaryPath, resultPath);
}

function verifyIntegrity(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return database.pragma("integrity_check", { simple: true }) === "ok";
  } finally {
    database.close();
  }
}

function clearRestoredSessions(filePath) {
  const database = new Database(filePath, { fileMustExist: true });
  try {
    const hasSessionsTable = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .get();
    if (hasSessionsTable) database.prepare("DELETE FROM sessions").run();
  } finally {
    database.close();
  }
}

function removeDatabaseFiles(basePath) {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${basePath}${suffix}`, { force: true });
  }
}

function writeFailure(error) {
  writeResult({
    ok: false,
    error: error instanceof Error ? error.message : "Restore failed",
  });
}

export function applyPendingRestore() {
  ensureRuntimeDirs();
  if (!fs.existsSync(pendingPath)) return null;

  let pending;
  let previousPath;
  let movedPreviousFiles = false;
  try {
    pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
    const stagePath = path.resolve(pending.staged_file);
    const safetyPath = path.resolve(pending.safety_file);
    const expectedStagePath = path.resolve(stageDir, "staged.db");
    const resolvedSafetyDirectory = path.resolve(safetyDir);
    if (
      stagePath !== expectedStagePath ||
      !safetyPath.startsWith(`${resolvedSafetyDirectory}${path.sep}`) ||
      !fs.existsSync(safetyPath)
    ) {
      throw new Error("Restore staging information is invalid");
    }

    looksLikeGsnBackup(stagePath);
    clearRestoredSessions(stagePath);
    looksLikeGsnBackup(stagePath);
    previousPath = path.join(
      DATA_DIR,
      `paint-erp-previous-${process.pid}-${crypto.randomBytes(8).toString("hex")}`,
    );

    for (const suffix of ["", "-wal", "-shm"]) {
      const livePath = `${DB_PATH}${suffix}`;
      if (fs.existsSync(livePath)) {
        fs.renameSync(livePath, `${previousPath}${suffix}`);
        movedPreviousFiles = true;
      }
    }

    try {
      fs.copyFileSync(stagePath, DB_PATH);
      looksLikeGsnBackup(DB_PATH);
      if (!verifyIntegrity(DB_PATH)) throw new Error("Restored database failed integrity check");
    } catch (error) {
      removeDatabaseFiles(DB_PATH);
      for (const suffix of ["", "-wal", "-shm"]) {
        const oldPath = `${previousPath}${suffix}`;
        if (fs.existsSync(oldPath)) fs.renameSync(oldPath, `${DB_PATH}${suffix}`);
      }
      if (!fs.existsSync(DB_PATH) && fs.existsSync(safetyPath)) {
        fs.copyFileSync(safetyPath, DB_PATH);
      }
      if (!fs.existsSync(DB_PATH) || !verifyIntegrity(DB_PATH)) {
        throw new Error(
          `Restore failed and the previous database could not be recovered: ${error.message}`,
        );
      }
      writeFailure(error);
      return { ok: false, error: error.message };
    }

    removeDatabaseFiles(previousPath);
    writeResult({ ok: true });
    return { ok: true };
  } catch (error) {
    if (movedPreviousFiles && previousPath && !fs.existsSync(DB_PATH)) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const oldPath = `${previousPath}${suffix}`;
        if (fs.existsSync(oldPath)) fs.renameSync(oldPath, `${DB_PATH}${suffix}`);
      }
      if (!fs.existsSync(DB_PATH) && pending?.safety_file && fs.existsSync(pending.safety_file)) {
        fs.copyFileSync(pending.safety_file, DB_PATH);
      }
    }
    if (movedPreviousFiles && (!fs.existsSync(DB_PATH) || !verifyIntegrity(DB_PATH))) {
      throw new Error(
        `Restore startup failed and the previous database could not be verified: ${error.message}`,
      );
    }
    writeFailure(error);
    return { ok: false, error: error instanceof Error ? error.message : "Restore failed" };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(pendingPath, { force: true });
  }
}

export function consumeRestoreResult() {
  if (!fs.existsSync(resultPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } finally {
    fs.rmSync(resultPath, { force: true });
  }
}
