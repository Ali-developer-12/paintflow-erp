import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronRuntime = require("electron");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script with `npm run test:electron`");

const install = spawnSync(process.execPath, [npmCli, "run", "native:electron"], {
  cwd: serverDirectory,
  stdio: "inherit",
  env: process.env,
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);

const selectedTests = process.argv.slice(2).filter((argument) => argument.endsWith(".test.js"));
const testFiles = selectedTests.length
  ? selectedTests
  : [
      "accounting-core.test.js",
      "phase4-logic.test.js",
      "erp-flow.test.js",
      "backup-restore.test.js",
      "final-scenario.test.js",
      "erp-extended.test.js",
      "security-hardening.test.js",
      "stage3-onboarding-integrity.test.js",
    ];

const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    ...testFiles.map((file) => path.join(serverDirectory, "src", file)),
  ],
  {
    cwd: serverDirectory,
    stdio: "inherit",
    env: {
      ...process.env,
      GSN_SERVER_NODE: electronRuntime,
      GSN_ELECTRON_SQLITE_MODULE: path.join(
        serverDirectory,
        "electron-runtime",
        "node_modules",
        "better-sqlite3",
      ),
    },
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
