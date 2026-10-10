import { test, expect } from "@playwright/test";
import { serverRuntimeEnv, serverRuntimePath } from "./server-runtime.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFreePort } from "../server/src/test-utils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admin = { username: "backupflowadmin", password: "BackupFlowPass123!" };
let dataDir;
let port;
let baseUrl;
let serverProcess;
let serverOutput = "";

async function waitForServer(previousInstanceId = null) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Server supervisor exited: ${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const health = await response.json();
        if (!previousInstanceId || health.instance_id !== previousInstanceId) return health;
      }
    } catch {
      // The server may be between the old and new process during a restore.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready: ${serverOutput}`);
}

async function signIn(page) {
  const setupStatus = page.waitForResponse(
    (response) =>
      response.url() === `${baseUrl}/api/auth/status` && response.request().method() === "GET",
    { timeout: 60_000 },
  );
  await page.goto(baseUrl);
  await setupStatus;
  await expect(
    page.getByRole("heading", { name: /Create administrator account|Sign in/ }),
  ).toBeVisible();
  const setup = await page.getByRole("heading", { name: "Create administrator account" }).count();
  if (setup) {
    await page.getByLabel("Full name").fill("Backup Flow Administrator");
    await page.getByLabel("Username").fill(admin.username);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Create administrator" }).click();
  } else {
    await page.getByLabel("Username").fill(admin.username);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

async function createCustomer(request, token, name) {
  const response = await request.post(`${baseUrl}/api/setup/customers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(response.status()).toBe(201);
}

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paintflow-backup-ui-"));
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const serverEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    DB_PATH: path.join(dataDir, "paint-erp.db"),
    BACKUP_DIR: path.join(dataDir, "backups"),
    LOGS_DIR: path.join(dataDir, "logs"),
    ALLOWED_ORIGINS: baseUrl,
  };
  delete serverEnv.PAINT_ERP_ADMIN_USERNAME;
  delete serverEnv.PAINT_ERP_ADMIN_PASSWORD;
  serverProcess = spawn(serverRuntimePath, [path.join(root, "server", "src", "run.js")], {
    cwd: root,
    env: serverRuntimeEnv(serverEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  await waitForServer();
});

test.afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = new Promise((resolve) => serverProcess.once("exit", resolve));
    serverProcess.kill("SIGTERM");
    await exited;
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
});

test("File System Access flow creates, replaces, rejects invalid files, and restores", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const state = { bytes: new Uint8Array(), createdName: "", opened: 0 };
    const makeHandle = (name, valid) => ({
      name,
      async getFile() {
        const bytes = valid ? state.bytes : new TextEncoder().encode("not a backup");
        return new File([bytes], name, { lastModified: Date.now() - 60_000 });
      },
      async createWritable() {
        const chunks = [];
        return {
          async write(chunk) {
            chunks.push(new Uint8Array(chunk));
          },
          async close() {
            const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            state.bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              state.bytes.set(chunk, offset);
              offset += chunk.length;
            }
            state.createdName = name;
          },
          async abort() {},
        };
      },
    });
    const directory = {
      async getFileHandle(name) {
        const handle = makeHandle(name, true);
        state.createdName = name;
        return handle;
      },
    };
    Object.defineProperty(window, "__backupMock", { value: state, configurable: true });
    Object.defineProperty(window, "showDirectoryPicker", {
      value: async () => directory,
      configurable: true,
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      value: async () => {
        state.opened += 1;
        return [makeHandle("owner-backup.db", state.opened !== 2)];
      },
      configurable: true,
    });
  });

  await signIn(page);
  await page.goto(`${baseUrl}/app/backup`);
  await expect(page.getByRole("heading", { name: "Backup & Restore" })).toBeVisible();
  await page.getByRole("button", { name: "Create Backup" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Choose a folder" }).click();
  await expect(page.getByRole("status")).toContainText("Backup created successfully.");
  const createdName = await page.evaluate(() => window.__backupMock.createdName);
  expect(createdName).toMatch(/^GSN-Paints-Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/);
  await expect(page.getByTestId("last-backup")).not.toContainText("never");

  await page.getByRole("button", { name: "Create Backup" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose an existing backup file" })
    .click();
  const replacementDialog = page.getByRole("dialog", { name: "Replace backup file?" });
  await expect(replacementDialog).toBeVisible();
  await expect(replacementDialog).toContainText(
    "This file will be replaced. Its old content will be lost.",
  );
  await replacementDialog.getByRole("button", { name: "Replace file" }).click();
  await expect(page.getByRole("status")).toContainText("Backup replaced successfully.");

  await page.getByRole("button", { name: "Create Backup" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose an existing backup file" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "This file is not a GSN Paints backup — nothing was changed.",
  );

  const token = await page.evaluate(() => localStorage.getItem("paint-erp.token"));
  await createCustomer(request, token, "Must Be Replaced");
  await page.getByRole("button", { name: "Restore Backup" }).click();
  const summaryDialog = page.getByRole("dialog", { name: "Restore Backup" });
  await expect(summaryDialog).toContainText("Customers: 0");
  await summaryDialog.getByLabel("Type RESTORE to continue").fill("RESTORE");
  const beforeRestore = await (await request.get(`${baseUrl}/api/health`)).json();
  await summaryDialog.getByRole("button", { name: "Restore Backup" }).click();
  await expect(page.getByRole("status")).toContainText("Restoring… the app is restarting");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("status")).toContainText("Backup restored successfully.");
  await expect(page.getByRole("status")).toContainText("credentials saved in this backup");
  const restarted = await waitForServer(beforeRestore.instance_id);
  expect(restarted.instance_id).not.toBe(beforeRestore.instance_id);
  await page.getByLabel("Username").fill(admin.username);
  await page.getByLabel("Password").fill("WrongBackupPass123!");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText(/Use the credentials saved in the selected backup/)).toBeVisible();
  await signIn(page);
  const restoredToken = await page.evaluate(() => localStorage.getItem("paint-erp.token"));
  const customers = await request.get(`${baseUrl}/api/setup/customers`, {
    headers: { Authorization: `Bearer ${restoredToken}` },
  });
  expect(await customers.json()).toEqual([]);
});

test("desktop backup bridge saves a verified snapshot through the native save dialog", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "paintflowDesktop", {
      value: {
        async saveBackup(fileName, token) {
          Object.defineProperty(window, "__desktopBackup", {
            value: { fileName, token },
            configurable: true,
          });
          return { canceled: false, fileName, sizeBytes: 1024 };
        },
      },
      configurable: true,
    });
  });
  await signIn(page);
  await page.goto(`${baseUrl}/app/backup`);
  expect(await page.evaluate(() => typeof window.paintflowDesktop?.saveBackup)).toBe("function");
  await page.getByRole("button", { name: "Create Backup" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Choose where to save" }).click();
  await expect(page.getByRole("status")).toContainText("Backup created successfully.");
  const savedBackup = await page.evaluate(() => window.__desktopBackup);
  expect(savedBackup.fileName).toMatch(/^GSN-Paints-Backup_.*\.db$/);
  expect(savedBackup.token).toBeTruthy();
  expect(Object.keys(savedBackup).sort()).toEqual(["fileName", "token"]);
});

test("fallback download and file upload restore the fresh database", async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
    Object.defineProperty(window, "showOpenFilePicker", { value: undefined, configurable: true });
  });
  await signIn(page);
  await page.goto(`${baseUrl}/app/backup`);
  await expect(page.getByText(/File System Access is unavailable/)).toBeVisible();

  await page.getByRole("button", { name: "Create Backup" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Download backup" }).click();
  const download = await downloadPromise;
  const backupPath = path.join(dataDir, "fallback-backup.db");
  await download.saveAs(backupPath);
  await expect(page.getByRole("status")).toContainText("Backup download started.");
  const token = await page.evaluate(() => localStorage.getItem("paint-erp.token"));
  await createCustomer(request, token, "Fallback Must Be Replaced");

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore Backup" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(backupPath);
  const summaryDialog = page.getByRole("dialog", { name: "Restore Backup" });
  await expect(summaryDialog).toContainText("Customers: 0");
  await summaryDialog.getByLabel("Type RESTORE to continue").fill("RESTORE");
  const beforeRestore = await (await request.get(`${baseUrl}/api/health`)).json();
  await summaryDialog.getByRole("button", { name: "Restore Backup" }).click();
  await expect(page.getByRole("status")).toContainText("Restoring… the app is restarting");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("status")).toContainText("Backup restored successfully.");
  const restarted = await waitForServer(beforeRestore.instance_id);
  expect(restarted.instance_id).not.toBe(beforeRestore.instance_id);
  await signIn(page);
  const restoredToken = await page.evaluate(() => localStorage.getItem("paint-erp.token"));
  const customers = await request.get(`${baseUrl}/api/setup/customers`, {
    headers: { Authorization: `Bearer ${restoredToken}` },
  });
  expect(await customers.json()).toEqual([]);
});
