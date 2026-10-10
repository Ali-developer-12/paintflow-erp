const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const serverDirectory = path.join(rootDirectory, "server");
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "paintflow-electron-dev-"));
const systemNode = process.env.PAINTFLOW_NODE_EXECUTABLE || "node";
let apiProcess;
let shuttingDown = false;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a development port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function waitFor(url, child, name) {
  const deadline = Date.now() + 60_000;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (child.exitCode !== null) {
        reject(new Error(`${name} exited before becoming ready (code ${child.exitCode})`));
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`${name} did not become ready at ${url}`));
        return;
      }
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }
        setTimeout(poll, 150);
      });
      request.once("error", () => setTimeout(poll, 150));
    };
    poll();
  });
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("close", resolve);
    if (!child.kill()) resolve();
  });
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await stop(apiProcess);
  fs.rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 10 });
}

async function start() {
  const apiPort = await freePort();
  const appUrl = `http://127.0.0.1:${apiPort}`;

  apiProcess = spawn(systemNode, [path.join(serverDirectory, "src", "run.js")], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      DATA_DIR: dataDirectory,
      DB_PATH: path.join(dataDirectory, "paint-erp.db"),
      BACKUP_DIR: path.join(dataDirectory, "backups"),
      LOGS_DIR: path.join(dataDirectory, "logs"),
      ALLOWED_ORIGINS: appUrl,
    },
    stdio: "inherit",
  });
  await waitFor(`${appUrl}/api/health`, apiProcess, "API server");

  const window = new BrowserWindow({
    width: 1366,
    height: 768,
    show: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  ipcMain.handle("paintflow:save-backup", async (event, request) => {
    if (event.sender !== window.webContents)
      throw new Error("Backup request came from an unknown window");
    if (
      !request ||
      typeof request.fileName !== "string" ||
      !(request.contents instanceof Uint8Array) ||
      !Buffer.from(request.contents).subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))
    ) {
      throw new Error("The backup file is invalid");
    }
    const result = await dialog.showSaveDialog(window, {
      title: "Save GSN Paints Backup",
      defaultPath: path.join(os.homedir(), "Downloads", path.basename(request.fileName)),
      filters: [{ name: "GSN Paints backup", extensions: ["db"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, Buffer.from(request.contents));
    return { canceled: false };
  });
  let redirectToBackupAfterAuthentication = true;
  const backupRouteTimer = setInterval(() => {
    if (!redirectToBackupAfterAuthentication || window.isDestroyed()) return;
    window.webContents
      .executeJavaScript(
        'Boolean(localStorage.getItem("paint-erp.token")) && window.location.pathname === "/app"',
      )
      .then((shouldOpenBackup) => {
        if (!shouldOpenBackup || !redirectToBackupAfterAuthentication) return;
        redirectToBackupAfterAuthentication = false;
        clearInterval(backupRouteTimer);
        window.loadURL(`${appUrl}/app/backup`).catch((error) => {
          console.error("Could not open the Backup page:", error);
        });
      })
      .catch((error) => {
        console.error("Could not check the authenticated Electron route:", error);
      });
  }, 250);
  backupRouteTimer.unref();
  window.on("closed", () => clearInterval(backupRouteTimer));
  window.webContents.once("did-finish-load", async () => {
    const support = await window.webContents.executeJavaScript(
      "({showDirectoryPicker: typeof window.showDirectoryPicker, showOpenFilePicker: typeof window.showOpenFilePicker})",
    );
    console.log(
      `File System Access: window.showDirectoryPicker=${support.showDirectoryPicker}; window.showOpenFilePicker=${support.showOpenFilePicker}`,
    );
  });
  await window.loadURL(`${appUrl}/app/backup`);
}

app
  .whenReady()
  .then(start)
  .catch(async (error) => {
    console.error("Electron development app failed to start:", error);
    await shutdown();
    app.exit(1);
  });

app.on("window-all-closed", async () => {
  await shutdown();
  app.quit();
});
