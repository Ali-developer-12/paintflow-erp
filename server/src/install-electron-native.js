import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this installer with `npm run native:electron`");

const result = spawnSync(
  process.execPath,
  [npmCli, "ci", "--prefix", path.join(serverDirectory, "electron-runtime")],
  {
    cwd: serverDirectory,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_runtime: "electron",
      npm_config_target: "22.3.27",
    },
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
