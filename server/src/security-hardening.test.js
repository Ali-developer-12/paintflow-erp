import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { serverRuntimeEnv, serverRuntimePath } from "./test-runtime.js";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";
import { publicErrorMessage, sendRouteError } from "./http-errors.js";
import { validateNumericPayload } from "./validation.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paint-erp-security-test-"));

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
});

test("the server defaults to loopback when HOST is unset", () => {
  const env = { ...process.env };
  delete env.HOST;
  env.DATA_DIR = dataDir;
  env.DB_PATH = path.join(dataDir, "paint-erp.db");
  env.BACKUP_DIR = path.join(dataDir, "backups");
  env.LOGS_DIR = path.join(dataDir, "logs");
  const result = spawnSync(
    serverRuntimePath(),
    [
      "--input-type=module",
      "--eval",
      "import('./config.js').then(({ HOST }) => console.log(HOST))",
    ],
    { cwd: new URL(".", import.meta.url), env: serverRuntimeEnv(env), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "127.0.0.1");
});

test("the default data directory is under the operating system user data root", () => {
  const userDataRoot = path.join(dataDir, "user-data");
  const env = { ...process.env, LOCALAPPDATA: userDataRoot };
  delete env.DATA_DIR;
  delete env.DB_PATH;
  delete env.BACKUP_DIR;
  delete env.LOGS_DIR;
  const result = spawnSync(
    serverRuntimePath(),
    [
      "--input-type=module",
      "--eval",
      "import('./config.js').then(({ DATA_DIR }) => console.log(DATA_DIR))",
    ],
    { cwd: new URL(".", import.meta.url), env: serverRuntimeEnv(env), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(userDataRoot, "PaintFlow ERP"));
});

test("a busy listen port exits with an actionable message", async () => {
  const occupiedServer = net.createServer();
  await new Promise((resolve, reject) => {
    occupiedServer.once("error", reject);
    occupiedServer.listen(0, "127.0.0.1", resolve);
  });
  const address = occupiedServer.address();
  assert.ok(address && typeof address !== "string");
  const serverDir = new URL(".", import.meta.url);
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(address.port),
    DATA_DIR: path.join(dataDir, "busy-port"),
    DB_PATH: path.join(dataDir, "busy-port", "paint-erp.db"),
    BACKUP_DIR: path.join(dataDir, "busy-port", "backups"),
    LOGS_DIR: path.join(dataDir, "busy-port", "logs"),
  };

  let result;
  try {
    result = spawnSync(
      serverRuntimePath(),
      [fileURLToPath(new URL("./index.js", import.meta.url))],
      {
        cwd: serverDir,
        env: serverRuntimeEnv(env),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
  } finally {
    await new Promise((resolve, reject) =>
      occupiedServer.close((error) => (error ? reject(error) : resolve())),
    );
  }

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, new RegExp(`Port ${address.port} is already in use`));
  assert.match(result.stderr, /Set PORT to an available port/);
});

test("background server timers do not keep the process alive", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("./index.js", import.meta.url)), "utf8");
  assert.match(
    source,
    /const sessionCleanupTimer = setInterval\([\s\S]*?\);\s*sessionCleanupTimer\.unref\(\);/,
  );
  assert.match(source, /setTimeout\([\s\S]*?\}\s*,\s*5000\)\.unref\(\);/);
});

test("production route errors are generic while full error details are logged", () => {
  const priorEnvironment = process.env.NODE_ENV;
  const originalLogger = logger.error;
  const thrown = new Error("SQLITE_CONSTRAINT: failed at /private/data.db");
  let logged;
  let response;
  const res = {
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      response = body;
      return this;
    },
  };

  try {
    process.env.NODE_ENV = "production";
    logger.error = (message, metadata) => {
      logged = { message, metadata };
    };
    sendRouteError(res, thrown, 500, "Request failed");
  } finally {
    logger.error = originalLogger;
    if (priorEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorEnvironment;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(response, { error: "Internal server error" });
  assert.equal(logged?.metadata?.message, thrown.message);
  assert.equal(logged?.metadata?.stack, thrown.stack);
});

test("validation errors hide SQL details and filesystem paths", () => {
  assert.equal(
    publicErrorMessage(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed")),
    "Request failed",
  );
  assert.equal(publicErrorMessage(new Error("ENOENT: /private/database.db")), "Request failed");
  assert.equal(
    publicErrorMessage(new Error("Amount must be a valid number")),
    "Amount must be a valid number",
  );
});

test("shared numeric validation rejects invalid and negative nonnegative fields", () => {
  assert.throws(
    () => validateNumericPayload({ lines: [{ qty: "Infinity" }] }),
    /must be a valid number/,
  );
  assert.throws(() => validateNumericPayload({ rate: -1 }), /out of range/);
  assert.doesNotThrow(() => validateNumericPayload({ opening_balance: -10, adjustment_qty: -2 }));
});
