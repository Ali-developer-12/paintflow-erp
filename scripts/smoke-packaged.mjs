#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const createServer = require("node:net").createServer;
const appArgumentIndex = process.argv.indexOf("--app");
const packagedAppPath =
  appArgumentIndex >= 0 ? path.resolve(process.argv[appArgumentIndex + 1] || "") : null;
const admin = {
  fullName: "Smoke Test Administrator",
  username: `smokeadmin${Date.now()}`,
  password: "SmokeTestPass123!",
};
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gsn-paints-smoke-"));
const userDataDirectory = path.join(tempDirectory, "user-data");
const backupPath = path.join(tempDirectory, "GSN-Paints-smoke-backup.db");
const customerBeforeBackup = `Smoke Customer A ${Date.now()}`;
const customerAfterBackup = `Smoke Customer B ${Date.now()}`;
const observedRequests = [];
let activeRun;

if (appArgumentIndex >= 0 && !packagedAppPath.endsWith(".app")) {
  throw new Error("--app must point to a macOS .app bundle");
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a local debugging port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function launchApplication(debugPort) {
  const env = {
    ...process.env,
    GSN_SMOKE_AUTOMATION: "1",
    GSN_SMOKE_BACKUP_PATH: backupPath,
    GSN_SMOKE_DEBUG_PORT: String(debugPort),
    GSN_SMOKE_USER_DATA_DIR: userDataDirectory,
  };

  if (packagedAppPath) {
    return spawn(path.join(packagedAppPath, "Contents", "MacOS", "GSN Paints"), [], {
      cwd: rootDirectory,
      env,
      stdio: "inherit",
    });
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(npm, ["run", "electron:dev"], {
    cwd: rootDirectory,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", async (event) => {
      const text =
        typeof event.data === "string"
          ? event.data
          : Buffer.from(await event.data.arrayBuffer()).toString("utf8");
      const message = JSON.parse(text);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params);
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Electron closed its DevTools connection"));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  async evaluate(fn, argument) {
    const expression = `(${fn.toString()})(${JSON.stringify(argument)})`;
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          "Electron page evaluation failed",
      );
    }
    return response.result?.value;
  }

  async close() {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }
}

async function connectToApplication(child, debugPort) {
  const deadline = Date.now() + 180_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Electron exited before its debugging endpoint was ready (${child.exitCode})`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
      if (!target) throw new Error("Electron has not opened a page target yet");
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      const connection = new CdpConnection(socket);
      await connection.send("Page.enable");
      await connection.send("Runtime.enable");
      await connection.send("Network.enable");
      return connection;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Electron did not open its local debugging endpoint: ${lastError?.message || ""}`,
  );
}

async function waitForExit(child, timeoutMs = 20_000) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Electron smoke process did not exit after its windows were closed"));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && child.exitCode === null) {
      throw new Error(`Could not stop Electron process tree: ${result.stderr || result.status}`);
    }
  } else if (!child.kill("SIGTERM")) {
    throw new Error("Could not signal the Electron smoke process");
  }
  await waitForExit(child, 10_000);
}

async function healthAt(origin) {
  const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3_000) });
  assert.equal(response.status, 200, "the API health endpoint must respond successfully");
  return response.json();
}

function observePage(connection) {
  connection.on("Network.requestWillBeSent", ({ request }) => {
    observedRequests.push(request.url);
  });
}

async function waitForPage(connection, predicate, message, timeoutMs = 60_000, argument) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await connection.evaluate(predicate, argument);
    if (value) return value;
    await delay(150);
  }
  throw new Error(message);
}

async function clickText(connection, selector, text) {
  const clicked = await connection.evaluate(
    ({ selector: elementSelector, text: expectedText }) => {
      const element = [...document.querySelectorAll(elementSelector)].find(
        (candidate) => candidate.innerText.trim() === expectedText,
      );
      if (!element) return false;
      element.click();
      return true;
    },
    { selector, text },
  );
  assert.equal(clicked, true, `Could not find ${selector} named "${text}"`);
}

async function fillLabel(connection, label, value) {
  const filled = await connection.evaluate(
    ({ labelText, inputValue }) => {
      const normalizedLabel = labelText.trim().toLowerCase();
      const labelElement = [...document.querySelectorAll("label")].find(
        (candidate) =>
          candidate.innerText.trim().replace(/\s+/g, " ").toLowerCase() === normalizedLabel,
      );
      const input = labelElement?.htmlFor
        ? document.getElementById(labelElement.htmlFor)
        : labelElement?.querySelector("input");
      if (!(input instanceof HTMLInputElement)) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        input,
        inputValue,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { labelText: label, inputValue: value },
  );
  assert.equal(filled, true, `Could not find input labelled "${label}"`);
}

async function setupOrLogin(connection, expectedStage = null) {
  const stage = await waitForPage(
    connection,
    (expectedStage) => {
      const dashboard = [...document.querySelectorAll("a")].some(
        (link) => link.innerText.trim() === "Dashboard",
      );
      if (dashboard) return "Dashboard";
      const headings = [...document.querySelectorAll("h1, h2, h3")].map((element) =>
        element.innerText.trim(),
      );
      return expectedStage
        ? headings.find((text) => text === expectedStage)
        : headings.find((text) => ["Create administrator account", "Sign in"].includes(text));
    },
    "The setup or sign-in page did not load",
    60_000,
    expectedStage,
  );
  if (stage === "Dashboard") return;
  if (expectedStage) assert.equal(stage, expectedStage);
  if (stage === "Create administrator account") {
    await fillLabel(connection, "Full name", admin.fullName);
    await fillLabel(connection, "Username", admin.username);
    await fillLabel(connection, "Password", admin.password);
    await clickText(connection, "button", "Create administrator");
  } else {
    await fillLabel(connection, "Username", admin.username);
    await fillLabel(connection, "Password", admin.password);
    await clickText(connection, "button", "Unlock");
  }
  await waitForPage(
    connection,
    () => [...document.querySelectorAll("a")].some((link) => link.innerText.trim() === "Dashboard"),
    "The administrator did not reach the dashboard",
  );
}

async function getCustomerNames(connection, origin) {
  return connection.evaluate(async (apiOrigin) => {
    const token = localStorage.getItem("paint-erp.token");
    const response = await fetch(`${apiOrigin}/api/setup/customers`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`Customer list failed (${response.status})`);
    const customers = await response.json();
    return customers.map((customer) => customer.name);
  }, origin);
}

async function addCustomer(connection, origin, name) {
  const result = await connection.evaluate(
    async ({ apiOrigin, customerName }) => {
      const token = localStorage.getItem("paint-erp.token");
      const response = await fetch(`${apiOrigin}/api/setup/customers`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: customerName }),
      });
      return { status: response.status, body: await response.json() };
    },
    { apiOrigin: origin, customerName: name },
  );
  assert.equal(
    result.status,
    201,
    `customer creation must succeed: ${JSON.stringify(result.body)}`,
  );
}

function assertLoopbackOnlyRequests() {
  const externalRequests = observedRequests.filter((requestUrl) => {
    let url;
    try {
      url = new URL(requestUrl);
    } catch {
      return false;
    }
    return ["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1";
  });
  assert.deepEqual(externalRequests, [], "the renderer must not make external network requests");
}

async function startRun() {
  const debugPort = await reservePort();
  const child = launchApplication(debugPort);
  let connection;
  try {
    connection = await connectToApplication(child, debugPort);
    observePage(connection);
    await waitForPage(
      connection,
      () => location.href.startsWith("http://127.0.0.1:") && document.readyState !== "loading",
      "Electron did not navigate to its loopback application URL",
    );
    const pageUrl = await connection.evaluate(() => location.href);
    const origin = new URL(pageUrl).origin;
    const title = await connection.evaluate(() => document.title);
    assert.match(title, /GSN Paints/i, "the app window title must be branded");
    await healthAt(origin);
    return { connection, child, origin, stopped: false };
  } catch (error) {
    if (connection) {
      try {
        await connection.send("Page.close");
      } catch (closeError) {
        console.error("Unable to close Electron after smoke startup failed:", closeError.message);
      }
    }
    await connection?.close();
    if (child.exitCode === null) await stopProcessTree(child);
    throw error;
  }
}

async function stopRun(run) {
  if (run.stopped) return;
  run.stopped = true;
  await run.connection.send("Page.close");
  await run.connection.close();
  try {
    await waitForExit(run.child);
  } catch {
    await stopProcessTree(run.child);
  }
  try {
    await fetch(`${run.origin}/api/health`, { signal: AbortSignal.timeout(1_000) });
    throw new Error("The local API remained available after the Electron app exited");
  } catch (error) {
    if (error.message.includes("remained available")) throw error;
  }
}

async function runSmoke() {
  console.log(
    packagedAppPath
      ? `Smoke testing packaged app: ${packagedAppPath}`
      : "Smoke testing npm run electron:dev",
  );

  let run = await startRun();
  activeRun = run;
  const initialSetupStatus = await run.connection.evaluate(async (origin) => {
    const response = await fetch(`${origin}/api/auth/status`);
    return { status: response.status, body: await response.json() };
  }, run.origin);
  assert.equal(initialSetupStatus.status, 200, "the first-run setup status must be available");
  assert.equal(
    initialSetupStatus.body.needsSetup,
    true,
    "the smoke test must start with a fresh database that has no administrator",
  );
  await setupOrLogin(run.connection, "Create administrator account");
  const setupStatus = await run.connection.evaluate(async (origin) => {
    const response = await fetch(`${origin}/api/auth/status`);
    return response.json();
  }, run.origin);
  assert.equal(setupStatus.needsSetup, false, "the first administrator account must be created");
  await addCustomer(run.connection, run.origin, customerBeforeBackup);
  console.log("PASS first-run administrator creation and initial data entry");

  await stopRun(run);
  activeRun = null;
  run = await startRun();
  activeRun = run;
  await setupOrLogin(run.connection);
  let customerNames = await getCustomerNames(run.connection, run.origin);
  assert.ok(customerNames.includes(customerBeforeBackup), "data must persist after an app restart");
  console.log("PASS health check, window title, and data persistence after restart");

  await run.connection.send("Page.navigate", { url: `${run.origin}/app/backup` });
  await waitForPage(
    run.connection,
    () =>
      [...document.querySelectorAll("h1")].some(
        (heading) => heading.innerText === "Backup & Restore",
      ),
    "The Backup & Restore page did not open",
  );
  await clickText(run.connection, "button", "Create Backup");
  await waitForPage(
    run.connection,
    () =>
      [...document.querySelectorAll("section[role=dialog] h2")].some(
        (heading) => heading.innerText === "Create Backup",
      ),
    "The Create Backup dialog did not open",
  );
  await clickText(run.connection, 'section[role="dialog"] button', "Choose where to save");
  await waitForPage(
    run.connection,
    () =>
      [...document.querySelectorAll("[role=status]")].some((status) =>
        status.innerText.includes("Backup created successfully."),
      ),
    "The application did not confirm backup creation",
  );
  const backupBuffer = fs.readFileSync(backupPath);
  assert.equal(
    backupBuffer.subarray(0, 16).toString("binary"),
    "SQLite format 3\0",
    "the created backup must be a SQLite database",
  );
  await addCustomer(run.connection, run.origin, customerAfterBackup);

  await clickText(run.connection, "button", "Restore Backup");
  const documentInfo = await run.connection.send("DOM.getDocument");
  const fileInput = await run.connection.send("DOM.querySelector", {
    nodeId: documentInfo.root.nodeId,
    selector: 'input[type="file"]',
  });
  assert.ok(fileInput.nodeId, "The restore file input must be available");
  await run.connection.send("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [backupPath],
  });
  await waitForPage(
    run.connection,
    () =>
      [...document.querySelectorAll("section[role=dialog] h2")].some(
        (heading) => heading.innerText === "Restore Backup",
      ),
    "The Restore Backup dialog did not open",
  );
  await fillLabel(run.connection, "Type RESTORE to continue", "RESTORE");
  await clickText(run.connection, 'section[role="dialog"] button', "Restore Backup");
  await waitForPage(
    run.connection,
    () =>
      location.pathname === "/" &&
      [...document.querySelectorAll("h2")].some((heading) => heading.innerText === "Sign in"),
    "The application did not return to sign in after restore",
    120_000,
  );
  const restoredNotice = await run.connection.evaluate(() =>
    [...document.querySelectorAll("[role=status]")].some((status) =>
      status.innerText.includes("Backup restored successfully."),
    ),
  );
  assert.equal(restoredNotice, true, "the application must confirm successful restoration");
  await setupOrLogin(run.connection, "Sign in");
  customerNames = await getCustomerNames(run.connection, run.origin);
  assert.ok(customerNames.includes(customerBeforeBackup), "restore must preserve backed-up data");
  assert.ok(!customerNames.includes(customerAfterBackup), "restore must roll back later data");
  assertLoopbackOnlyRequests();
  console.log("PASS backup creation, restore, and rollback of post-backup data");
  console.log("PASS all observed renderer network requests target 127.0.0.1");
  await stopRun(run);
  activeRun = null;
}

try {
  await runSmoke();
  console.log("PASS Electron smoke test completed with no remaining app or API process");
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  if (activeRun) {
    try {
      await stopRun(activeRun);
    } catch (error) {
      console.error("Unable to confirm smoke process shutdown:", error.message);
      process.exitCode = 1;
    }
  }
  try {
    fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 10 });
  } catch (error) {
    console.error(`Unable to remove smoke test directory ${tempDirectory}: ${error.message}`);
    process.exitCode = 1;
  }
}
