import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFreePort } from "../server/src/test-utils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admin = { username: "stage4admin", password: "StageFourPass123!" };
const suppliersName = "Stage 4 Supplier";
const customerName = "Stage 4 Customer";
const rawMaterialName = "Stage 4 Binder";
let dataDir;
let apiPort;
let uiPort;
let apiUrl;
let uiUrl;
let apiProcess;
let uiProcess;
const useBuiltApp = process.env.PAINTFLOW_E2E_BUILT === "1";

function captureOutput(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return () => output.trim();
}

async function waitFor(url, child, name) {
  let lastStatus = "no response";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited before becoming ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      lastStatus = String(response.status);
      if (response.ok) return;
    } catch {
      lastStatus = "connection refused";
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `${name} did not become ready at ${url} (last response: ${lastStatus}, pid: ${child.pid})${child.output() ? `:\n${child.output()}` : ""}`,
  );
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paintflow-stage4-e2e-"));
  apiPort = await getFreePort();
  uiPort = apiPort;
  if (!useBuiltApp) {
    uiPort = await getFreePort();
    while (uiPort === apiPort) uiPort = await getFreePort();
  }
  apiUrl = `http://127.0.0.1:${apiPort}/api`;
  uiUrl = `http://127.0.0.1:${uiPort}`;
  const serverEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    DATA_DIR: dataDir,
    DB_PATH: path.join(dataDir, "paint-erp.db"),
    BACKUP_DIR: path.join(dataDir, "backups"),
    LOGS_DIR: path.join(dataDir, "logs"),
    ALLOWED_ORIGINS: `http://127.0.0.1:${uiPort}`,
  };
  delete serverEnv.PAINT_ERP_ADMIN_USERNAME;
  delete serverEnv.PAINT_ERP_ADMIN_PASSWORD;
  apiProcess = spawn(process.execPath, [path.join(root, "server", "src", "index.js")], {
    cwd: root,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.output = captureOutput(apiProcess);
  await waitFor(`${apiUrl}/health`, apiProcess, "API");

  if (useBuiltApp) return;

  uiProcess = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "vite", "bin", "vite.js"),
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(uiPort),
      "--strictPort",
    ],
    {
      cwd: root,
      env: { ...process.env, VITE_API_URL: apiUrl },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  uiProcess.output = captureOutput(uiProcess);
  await waitFor(uiUrl, uiProcess, "Vite development server");
});

test.afterAll(async () => {
  await stop(uiProcess);
  await stop(apiProcess);
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
});

test("first run, ERP workflow, role controls, and every sidebar module at 1366x768", async ({
  page,
  request,
}) => {
  const pageErrors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (browserRequest) => {
    if (useBuiltApp && new URL(browserRequest.url()).origin !== new URL(uiUrl).origin) {
      externalRequests.push(browserRequest.url());
    }
  });
  page.on("requestfailed", (request) =>
    pageErrors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  const screenshots = useBuiltApp
    ? path.join(dataDir, "screens")
    : path.join(root, "docs", "reports", "screens");
  fs.mkdirSync(screenshots, { recursive: true });

  const health = await (await request.get(`${apiUrl}/health`)).json();
  expect(health.db).toBe(path.join(dataDir, "paint-erp.db"));
  expect(health.schema_version).toBeGreaterThan(0);
  expect(await (await request.get(`${apiUrl}/auth/status`)).json()).toEqual({ needsSetup: true });
  if (useBuiltApp) {
    for (const route of ["/", "/app/items"]) {
      const response = await request.get(`${uiUrl}${route}`);
      expect(response.ok()).toBeTruthy();
      expect(response.headers()["content-type"]).toContain("text/html");
      expect(await response.text()).toContain('<html lang="en">');
    }
  }

  const browserSetupResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/auth/status` && response.request().method() === "GET",
  );
  await page.goto(uiUrl);
  const statusResponse = await browserSetupResponse;
  expect(statusResponse.ok()).toBeTruthy();
  expect(await statusResponse.json()).toEqual({ needsSetup: true });
  await expect(page.getByRole("heading", { name: "Create administrator account" })).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: path.join(screenshots, "01-first-run.jpg"),
    type: "jpeg",
    quality: 42,
  });
  await page.getByLabel("Full name").fill("Stage Four Administrator");
  await page.getByLabel("Username").fill(admin.username);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Create administrator" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "02-login.jpg"),
    type: "jpeg",
    quality: 42,
  });
  await page.getByLabel("Username").fill(admin.username);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Setup / Masters" }).click();
  await page.getByRole("button", { name: "Customers", exact: true }).click();
  await page.locator("input").first().fill(customerName);
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByText(customerName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Suppliers", exact: true }).click();
  await page.locator("input").first().fill(suppliersName);
  await page.getByRole("button", { name: "Save supplier" }).click();
  await expect(page.getByText(suppliersName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Factory Items", exact: true }).click();
  await page.locator("input").first().fill(rawMaterialName);
  await page.locator('input[type="number"]').first().fill("10");
  await page.getByRole("button", { name: "Save factory item" }).click();
  await expect(page.getByText(rawMaterialName, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Items Master" }).click();
  await page.getByRole("button", { name: "Add Item" }).click();
  await expect(page.getByText("New item", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Add Particular" }).click();
  const itemRow = page.locator("tbody tr").first();
  await itemRow.locator("input").nth(0).fill("1 Gallon");
  await itemRow.locator("input").nth(1).fill("1 Gallon");
  await itemRow.locator("input").nth(2).fill("10");
  await itemRow.locator("input").nth(3).fill("15");
  await itemRow.locator("input").nth(4).fill("25");
  await itemRow.getByRole("button", { name: "Formula" }).click();
  await expect(page.getByText("Formula / BOM", { exact: true }).last()).toBeVisible();
  await page.getByPlaceholder("F-001").fill("STAGE4-FORMULA");
  await page.getByRole("button", { name: "Add Line" }).click();
  const formulaRow = page.locator(".fixed.inset-0 tbody tr").first();
  await expect(formulaRow).toBeVisible();
  await formulaRow.locator("select").selectOption({ label: rawMaterialName });
  await formulaRow.locator('input[type="number"]').nth(0).fill("1");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("New item", { exact: true }).first()).toBeVisible();

  const purchaseDataLoaded = Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/suppliers` && response.request().method() === "GET",
    ),
    page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/factory-items` && response.request().method() === "GET",
    ),
  ]);
  await page.getByRole("link", { name: "Purchase", exact: true }).click();
  await purchaseDataLoaded;
  await page.locator("select").nth(0).selectOption({ label: suppliersName });
  await page
    .locator("select")
    .nth(2)
    .selectOption({ label: `${rawMaterialName} (KG)` });
  await page.locator('input[type="number"]').nth(0).fill("10");
  await page.locator('input[type="number"]').nth(1).fill("10");
  await page.getByRole("button", { name: "Save Purchase" }).click();
  await expect(page.getByText("Purchase recorded successfully.")).toBeVisible();

  await page.getByRole("link", { name: "Production", exact: true }).click();
  await page.locator('input[type="number"]').first().fill("10");
  await page.getByRole("button", { name: "Save Batch" }).click();
  await expect(page.getByText("Production batch saved and stock updated.")).toBeVisible();

  const zeroCostItem = await request.post(`${apiUrl}/items`, {
    headers: {
      Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("paint-erp.token"))}`,
    },
    data: { name: "Uncosted Test Paint" },
  });
  expect(zeroCostItem.ok()).toBeTruthy();
  const zeroCostItemData = await zeroCostItem.json();
  const zeroCostParticular = await request.post(
    `${apiUrl}/items/${zeroCostItemData.id}/particulars`,
    {
      headers: {
        Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("paint-erp.token"))}`,
      },
      data: {
        type: "Can",
        weight_unit: "1 Can",
        cost_price: 0,
        ws_price: 0,
        sale_price: 25,
        stock_qty: 0,
      },
    },
  );
  expect(zeroCostParticular.ok()).toBeTruthy();
  const zeroCostParticularData = await zeroCostParticular.json();
  const setupStock = await request.post(`${apiUrl}/stock/opening`, {
    headers: {
      Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("paint-erp.token"))}`,
    },
    data: {
      item_type: "finished",
      date: new Date().toISOString().slice(0, 10),
      particular_id: zeroCostParticularData.id,
      qty: 1,
      unit_cost: 0,
      remarks: "Stage 4 zero-cost sale UI check",
    },
  });
  expect(setupStock.ok()).toBeTruthy();
  const counterSaleDataLoaded = Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/setup/customers` && response.request().method() === "GET",
    ),
    page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/particulars` && response.request().method() === "GET",
    ),
  ]);
  await page.getByRole("link", { name: "Counter Sale" }).click();
  await counterSaleDataLoaded;
  await page.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: customerName }).click();
  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: /Uncosted Test Paint/ }).click();
  await page.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByRole("alert")).toContainText("Item has no cost price; set the cost first");
  await expect(page.getByRole("alert")).not.toContainText("{");

  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: /New item/ }).click();
  await page.locator('input[type="number"]').nth(0).fill("2");
  await page.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByRole("heading", { name: "Counter Sale" })).toBeVisible();

  const returnDataLoaded = Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/setup/customers` && response.request().method() === "GET",
    ),
    page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/setup/suppliers` && response.request().method() === "GET",
    ),
  ]);
  await page.getByRole("link", { name: "Return", exact: true }).click();
  await returnDataLoaded;
  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: customerName }).click();
  await page.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: /New item/ }).click();
  await page.locator('input[type="number"]').nth(0).fill("1");
  await page.locator('input[type="number"]').nth(1).fill("25");
  await page.getByRole("button", { name: "Save return" }).click();

  await page.getByRole("link", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "New Receipt" }).click();
  await page.locator("select").nth(0).selectOption({ label: customerName });
  await page.locator('input[type="number"]').fill("50");
  await page.getByRole("button", { name: /Post Receipt/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: customerName }).filter({ hasText: "50.00" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Supplier Payments" }).click();
  await page.getByRole("button", { name: "New Payment" }).click();
  await page.locator("select").nth(0).selectOption({ label: suppliersName });
  await page.locator('input[type="number"]').fill("50");
  await page.getByRole("button", { name: /Post Payment/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: suppliersName }).filter({ hasText: "50.00" }),
  ).toBeVisible();

  const currentToken = await page.evaluate(() => localStorage.getItem("paint-erp.token"));
  const userResponse = await request.post(`${apiUrl}/users`, {
    headers: { Authorization: `Bearer ${currentToken}` },
    data: {
      username: "stage4user",
      password: "StageFourUser123!",
      role: "user",
      full_name: "Stage Four User",
    },
  });
  expect(userResponse.ok()).toBeTruthy();
  const accountantResponse = await request.post(`${apiUrl}/users`, {
    headers: { Authorization: `Bearer ${currentToken}` },
    data: {
      username: "stage4accountant",
      password: "StageFourAccount123!",
      role: "accountant",
      full_name: "Stage Four Accountant",
    },
  });
  expect(accountantResponse.ok()).toBeTruthy();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Username").fill("stage4user");
  await page.getByLabel("Password").fill("StageFourUser123!");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByRole("button", { name: "New Receipt" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Supplier Payments" }).click();
  await expect(page.getByRole("button", { name: "New Payment" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Journal Vouchers" }).click();
  await expect(page.getByRole("button", { name: "New Journal Voucher" })).toHaveCount(0);
  await page.getByRole("link", { name: "Items Master" }).click();
  await expect(page.getByRole("button", { name: "Add Item" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Particular" })).toHaveCount(0);
  await expect(page.locator("tbody tr input").first()).toBeDisabled();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Username").fill("stage4accountant");
  await page.getByLabel("Password").fill("StageFourAccount123!");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByRole("button", { name: "New Receipt" })).toBeEnabled();
  await page.getByRole("tab", { name: "Supplier Payments" }).click();
  await expect(page.getByRole("button", { name: "New Payment" })).toBeEnabled();
  await page.getByRole("tab", { name: "Journal Vouchers" }).click();
  await expect(page.getByRole("button", { name: "New Journal Voucher" })).toBeEnabled();
  await page.getByRole("link", { name: "Items Master" }).click();
  await expect(page.getByRole("button", { name: "Add Item" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Particular" })).toBeVisible();
  await expect(page.locator("tbody tr input").first()).toBeEnabled();

  const modules = [
    ["Dashboard", "Dashboard"],
    ["Items Master", "Items Master"],
    ["Formula / BOM", "Formula / BOM"],
    ["Setup / Masters", "Setup / Masters"],
    ["Purchase", "Purchase"],
    ["Production", "Production"],
    ["Counter Sale", "Counter Sale"],
    ["Issue Voucher", "Issue Voucher"],
    ["Return", "Return"],
    ["Stock", "Stock Management & Ledger"],
    ["Accounts", "Financial Accounting & Vouchers"],
    ["Reports", "Business Intelligence & Reports"],
    ["Backup", "Database Backup & Recovery"],
  ];
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Username").fill(admin.username);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  for (const [index, [module, heading]] of modules.entries()) {
    await page.getByRole("link", { name: module, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
    await page.screenshot({
      path: path.join(
        screenshots,
        `${String(index + 3).padStart(2, "0")}-${module.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.jpg`,
      ),
      type: "jpeg",
      quality: 42,
    });
  }

  await page.getByRole("link", { name: "Backup" }).click();
  await page.getByRole("button", { name: "Create Backup Now" }).click();
  await expect(page.getByText(/Backup created|Backup saved|Backup completed/i)).toBeVisible();

  const reconciliation = await request.get(`${apiUrl}/stock/reconciliation`, {
    headers: {
      Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("paint-erp.token"))}`,
    },
  });
  expect(reconciliation.ok()).toBeTruthy();
  const stockCheck = await reconciliation.json();
  expect(stockCheck.ok).toBeTruthy();
  expect(stockCheck.issues).toEqual([]);
  const trial = await request.get(`${apiUrl}/accounts/trial-balance`, {
    headers: {
      Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("paint-erp.token"))}`,
    },
  });
  expect(trial.ok()).toBeTruthy();
  expect((await trial.json()).balanced).toBeTruthy();
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
