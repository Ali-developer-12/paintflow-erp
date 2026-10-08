import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { logger } from "./logger.js";
import { publicErrorMessage, sendRouteError } from "./http-errors.js";
import { validateNumericPayload } from "./validation.js";

test("the server defaults to loopback when HOST is unset", () => {
  const env = { ...process.env };
  delete env.HOST;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import('./config.js').then(({ HOST }) => console.log(HOST))",
    ],
    { cwd: new URL(".", import.meta.url), env, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "127.0.0.1");
});

test("production route errors are generic while full error details are logged", () => {
  const priorEnvironment = process.env.NODE_ENV;
  const originalLogger = logger.error;
  const thrown = new Error("SQLITE_CONSTRAINT: failed at C:\\private\\data.db");
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
  assert.equal(publicErrorMessage(new Error("ENOENT: C:\\private\\database.db")), "Request failed");
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
