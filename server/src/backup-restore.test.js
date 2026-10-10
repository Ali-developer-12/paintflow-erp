import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReadableStream } from "node:stream/web";
import test from "node:test";
import { serverRuntimeEnv, serverRuntimePath } from "./test-runtime.js";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  consumeRestoreTicket,
  issueRestoreTicket,
  MAX_BACKUP_BYTES,
  RESTORE_TICKET_TTL_MS,
} from "./backup-restore.js";
import { getFreePort } from "./test-utils.js";

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("bootstrap creates missing data, backup, and log directories recursively", async () => {
  const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "paintflow-config-"));
  const dataDirectory = path.join(baseDirectory, "missing", "nested", "data");
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    DB_PATH: process.env.DB_PATH,
    BACKUP_DIR: process.env.BACKUP_DIR,
    LOGS_DIR: process.env.LOGS_DIR,
  };
  try {
    process.env.DATA_DIR = dataDirectory;
    process.env.DB_PATH = path.join(dataDirectory, "paint-erp.db");
    process.env.BACKUP_DIR = path.join(dataDirectory, "backups");
    process.env.LOGS_DIR = path.join(dataDirectory, "logs");
    const { ensureRuntimeDirs } = await import(`./config.js?test=${Date.now()}`);
    const directories = ensureRuntimeDirs();
    assert.equal(fs.existsSync(directories.dataDir), true);
    assert.equal(fs.existsSync(directories.backupDir), true);
    assert.equal(fs.existsSync(directories.logsDir), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(baseDirectory, { recursive: true, force: true, maxRetries: 10 });
  }
});

async function waitForHealth(baseUrl, child, previousInstanceId = null) {
  const deadline = Date.now() + 30_000;
  let lastError = "server did not respond";
  while (Date.now() < deadline) {
    if (child.spawnError) {
      throw new Error(`Server supervisor failed to start: ${child.output()}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`Supervisor exited with code ${child.exitCode}: ${child.output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const health = await response.json();
        if (!previousInstanceId || health.instance_id !== previousInstanceId) return health;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(`Server did not become ready: ${lastError}\n${child.output()}`);
}

async function jsonRequest(baseUrl, route, { token, method = "GET", body, raw, purpose } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (raw) {
    headers["Content-Type"] = "application/octet-stream";
    if (purpose) headers["X-Backup-Purpose"] = purpose;
  } else if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
  });
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  return { response, result };
}

function setCompanyName(dbPath, name) {
  const database = new Database(dbPath);
  try {
    database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('company_name', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(name);
  } finally {
    database.close();
  }
}

function getCompanyName(dbPath) {
  const database = new Database(dbPath, { readonly: true });
  try {
    return database.prepare("SELECT value FROM settings WHERE key = 'company_name'").get()?.value;
  } finally {
    database.close();
  }
}

function startSupervisor(dataDir, port) {
  const child = spawn(serverRuntimePath(), ["src/run.js"], {
    cwd: serverDirectory,
    env: serverRuntimeEnv({
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      DB_PATH: path.join(dataDir, "paint-erp.db"),
      BACKUP_DIR: path.join(dataDir, "backups"),
      LOGS_DIR: path.join(dataDir, "logs"),
      ALLOWED_ORIGINS: "http://127.0.0.1:4173",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.spawnError = null;
  child.once("error", (error) => {
    child.spawnError = error;
    output += `\nFailed to spawn server supervisor: ${error.stack || error.message}`;
  });
  child.output = () => output;
  return child;
}

async function stopSupervisor(child) {
  if (!child || child.exitCode !== null || child.spawnError) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (!child.kill("SIGTERM")) return;
  await exited;
}

async function inspect(baseUrl, token, contents) {
  return jsonRequest(baseUrl, "/backup/inspect", {
    token,
    method: "POST",
    body: contents,
    raw: true,
  });
}

function oversizedInspect(port, token) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/backup/inspect",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(MAX_BACKUP_BYTES + 1),
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.setTimeout(3000, () => request.destroy(new Error("Oversized inspect timed out")));
    request.on("error", reject);
    request.end();
  });
}

test("backup APIs safely inspect, snapshot, restore, restart, and roll back", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paintflow-backup-restore-"));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const dbPath = path.join(dataDir, "paint-erp.db");
  let child = startSupervisor(dataDir, port);
  t.after(async () => {
    await stopSupervisor(child);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
  });

  await waitForHealth(baseUrl, child);
  const setup = await jsonRequest(baseUrl, "/auth/setup", {
    method: "POST",
    body: { username: "backupadmin", password: "BackupPass123!", full_name: "Backup Admin" },
  });
  assert.equal(setup.response.status, 201);
  let adminToken = setup.result.token;

  const createdUser = await jsonRequest(baseUrl, "/users", {
    token: adminToken,
    method: "POST",
    body: { username: "backupuser", password: "BackupUser123!", role: "user" },
  });
  assert.equal(createdUser.response.status, 201);
  const userLogin = await jsonRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: "backupuser", password: "BackupUser123!" },
  });
  assert.equal(userLogin.response.status, 200);

  const deniedSnapshot = await jsonRequest(baseUrl, "/backup/snapshot", {
    token: userLogin.result.token,
  });
  assert.equal(deniedSnapshot.response.status, 403);
  const deniedInspect = await inspect(baseUrl, userLogin.result.token, Buffer.from("not a backup"));
  assert.equal(deniedInspect.response.status, 403);
  const deniedApply = await jsonRequest(baseUrl, "/backup/restore-apply", {
    token: userLogin.result.token,
    method: "POST",
    body: { ticket: "no-ticket", confirm: "RESTORE" },
  });
  assert.equal(deniedApply.response.status, 403);
  assert.equal(await oversizedInspect(port, adminToken), 413);

  const abortController = new AbortController();
  let uploadController;
  const interruptedBody = new ReadableStream({
    start(controller) {
      uploadController = controller;
      controller.enqueue(new TextEncoder().encode("partial upload"));
    },
  });
  const interruptedUpload = fetch(`${baseUrl}/backup/inspect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: interruptedBody,
    duplex: "half",
    signal: abortController.signal,
  });
  await sleep(50);
  abortController.abort();
  uploadController.error(new Error("test upload aborted"));
  await assert.rejects(interruptedUpload);
  const stagingDirectory = path.join(dataDir, "restore-staging");
  for (let attempts = 0; attempts < 50; attempts++) {
    if (!fs.existsSync(stagingDirectory) || fs.readdirSync(stagingDirectory).length === 0) break;
    await sleep(10);
  }
  assert.deepEqual(fs.existsSync(stagingDirectory) ? fs.readdirSync(stagingDirectory) : [], []);

  setCompanyName(dbPath, "Company A");
  const snapshotResponse = await fetch(`${baseUrl}/backup/snapshot`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = Buffer.from(await snapshotResponse.arrayBuffer());
  assert.equal(snapshot.subarray(0, 16).toString("binary"), "SQLite format 3\0");
  assert.equal(Number(snapshotResponse.headers.get("Content-Length")), snapshot.length);
  const temporarySnapshotDirectory = path.join(dataDir, "tmp");
  for (
    let attempts = 0;
    attempts < 50 && fs.readdirSync(temporarySnapshotDirectory).length;
    attempts++
  ) {
    await sleep(10);
  }
  assert.deepEqual(fs.readdirSync(temporarySnapshotDirectory), []);

  const confirm = await jsonRequest(baseUrl, "/backup/confirm", {
    token: adminToken,
    method: "POST",
    body: { file_name: "GSN-Paints-Backup_test.db", size_bytes: snapshot.length },
  });
  assert.equal(confirm.response.status, 200);
  const database = new Database(dbPath, { readonly: true });
  try {
    assert.ok(database.prepare("SELECT value FROM settings WHERE key = 'last_backup_at'").get());
    assert.ok(database.prepare("SELECT id FROM audit_log WHERE action = 'BACKUP_CREATE'").get());
  } finally {
    database.close();
  }

  const randomText = await inspect(baseUrl, adminToken, Buffer.from("not SQLite"));
  assert.equal(randomText.response.status, 400);
  assert.match(randomText.result.error, /GSN Paints backup|SQLite/i);
  assert.equal(fs.existsSync(path.join(dataDir, "restore-staging", "staged.db")), false);

  const notGsnPath = path.join(dataDir, "not-gsn.db");
  const notGsn = new Database(notGsnPath);
  notGsn.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
  notGsn.close();
  const notGsnResult = await inspect(baseUrl, adminToken, fs.readFileSync(notGsnPath));
  assert.equal(notGsnResult.response.status, 400);

  const noAdminPath = path.join(dataDir, "no-admin.db");
  fs.writeFileSync(noAdminPath, snapshot);
  const noAdmin = new Database(noAdminPath);
  noAdmin.pragma("foreign_keys = OFF");
  noAdmin.exec("DELETE FROM sessions; DELETE FROM users;");
  noAdmin.close();
  const noAdminResult = await inspect(baseUrl, adminToken, fs.readFileSync(noAdminPath));
  assert.equal(noAdminResult.response.status, 400);
  assert.match(noAdminResult.result.error, /active administrator/);

  const newerPath = path.join(dataDir, "newer.db");
  fs.writeFileSync(newerPath, snapshot);
  const newer = new Database(newerPath);
  newer.pragma("user_version = 999");
  newer.close();
  const newerResult = await inspect(baseUrl, adminToken, fs.readFileSync(newerPath));
  assert.equal(newerResult.response.status, 400);
  assert.match(newerResult.result.error, /newer version/);

  const replaceInspection = await jsonRequest(baseUrl, "/backup/inspect", {
    token: adminToken,
    method: "POST",
    body: snapshot,
    raw: true,
    purpose: "replace",
  });
  assert.equal(replaceInspection.response.status, 200);
  assert.equal(replaceInspection.result.ticket, undefined);
  assert.equal(replaceInspection.result.summary.company_name, "Company A");

  const restoreInspection = await inspect(baseUrl, adminToken, snapshot);
  assert.equal(restoreInspection.response.status, 200);
  assert.equal(restoreInspection.result.summary.company_name, "Company A");
  assert.ok(restoreInspection.result.ticket);
  const wrongConfirmation = await jsonRequest(baseUrl, "/backup/restore-apply", {
    token: adminToken,
    method: "POST",
    body: { ticket: restoreInspection.result.ticket, confirm: "NO" },
  });
  assert.equal(wrongConfirmation.response.status, 400);

  setCompanyName(dbPath, "Company B");
  const previousInstanceId = (await waitForHealth(baseUrl, child)).instance_id;
  const restore = await jsonRequest(baseUrl, "/backup/restore-apply", {
    token: adminToken,
    method: "POST",
    body: { ticket: restoreInspection.result.ticket, confirm: "RESTORE" },
  });
  assert.equal(restore.response.status, 200);
  assert.deepEqual(restore.result, { ok: true, restarting: true });

  const restartedHealth = await waitForHealth(baseUrl, child, previousInstanceId);
  assert.notEqual(restartedHealth.instance_id, previousInstanceId);
  assert.equal(getCompanyName(dbPath), "Company A");
  const oldSession = await jsonRequest(baseUrl, "/auth/me", { token: adminToken });
  assert.equal(oldSession.response.status, 401);
  const firstStatus = await jsonRequest(baseUrl, "/auth/status");
  assert.equal(firstStatus.result.lastRestore.ok, true);
  assert.ok(firstStatus.result.lastRestore.at);
  const secondStatus = await jsonRequest(baseUrl, "/auth/status");
  assert.equal(secondStatus.result.lastRestore, null);

  const safetyDirectory = path.join(dataDir, "pre-restore");
  const safetyFiles = fs.readdirSync(safetyDirectory).filter((name) => name.endsWith(".db"));
  assert.equal(safetyFiles.length, 1);
  assert.equal(getCompanyName(path.join(safetyDirectory, safetyFiles[0])), "Company B");

  const newLogin = await jsonRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: "backupadmin", password: "BackupPass123!" },
  });
  assert.equal(newLogin.response.status, 200);
  adminToken = newLogin.result.token;
  const rollbackInspection = await inspect(baseUrl, adminToken, snapshot);
  assert.equal(rollbackInspection.response.status, 200);
  const stagedPath = path.join(dataDir, "restore-staging", "staged.db");
  fs.writeFileSync(stagedPath, Buffer.from("corrupted after inspect"));

  setCompanyName(dbPath, "Company B2");
  const beforeRollbackInstance = (await waitForHealth(baseUrl, child)).instance_id;
  const rollbackRequest = await jsonRequest(baseUrl, "/backup/restore-apply", {
    token: adminToken,
    method: "POST",
    body: { ticket: rollbackInspection.result.ticket, confirm: "RESTORE" },
  });
  assert.equal(rollbackRequest.response.status, 200);
  await waitForHealth(baseUrl, child, beforeRollbackInstance);
  assert.equal(getCompanyName(dbPath), "Company B2");
  const rollbackStatus = await jsonRequest(baseUrl, "/auth/status");
  assert.equal(rollbackStatus.result.lastRestore.ok, false);
  assert.match(rollbackStatus.result.lastRestore.error, /GSN Paints backup|SQLite/i);
  assert.equal(fs.existsSync(stagedPath), false);
});

test("restore tickets expire and can only be consumed once", () => {
  const expired = issueRestoreTicket("expired-stage.db", 1000);
  assert.deepEqual(consumeRestoreTicket(expired, 1000 + RESTORE_TICKET_TTL_MS), {
    expired: true,
    stagedFile: "expired-stage.db",
  });
  const singleUse = issueRestoreTicket("single-stage.db", 1000);
  assert.deepEqual(consumeRestoreTicket(singleUse, 1001), {
    expired: false,
    stagedFile: "single-stage.db",
  });
  assert.equal(consumeRestoreTicket(singleUse, 1002), null);
});
