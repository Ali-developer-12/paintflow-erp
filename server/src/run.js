import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./index.js", import.meta.url));
const restartTimes = [];
let child;
let shuttingDown = false;

function startServer() {
  child = fork(entry, [], { stdio: "inherit", windowsHide: true });
  child.once("exit", (code, signal) => {
    if (shuttingDown) {
      process.exitCode = code ?? (signal ? 1 : 0);
      return;
    }
    if (code !== 75) {
      process.exitCode = code ?? 1;
      return;
    }

    const now = Date.now();
    while (restartTimes.length && now - restartTimes[0] > 10_000) restartTimes.shift();
    restartTimes.push(now);
    if (restartTimes.length > 3) {
      console.error("Restore restart limit exceeded: more than 3 restarts within 10 seconds.");
      process.exitCode = 1;
      return;
    }

    console.log(`Restarting PaintFlow after database restore (${restartTimes.length}/3).`);
    startServer();
  });
}

function forwardSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child || child.killed) {
    process.exitCode = 0;
    return;
  }
  child.kill(signal);
  const shutdownTimer = setTimeout(() => {
    child?.kill("SIGKILL");
  }, 5000);
  shutdownTimer.unref();
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
startServer();
