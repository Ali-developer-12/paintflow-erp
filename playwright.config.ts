import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: true,
    actionTimeout: 15_000,
    viewport: { width: 1366, height: 768 },
  },
});
