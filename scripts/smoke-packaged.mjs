#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gsn-smoke-"));
const dataDir = path.join(tempRoot, "GSN Paints Data");
const userData = path.join(tempRoot, "GSN Paints User Data");
const logDir = path.join(tempRoot, "logs");

console.log("Smoke-check placeholder: this script is prepared for real macOS runner execution.");
console.log({ tempRoot, dataDir, userData, logDir });
console.log(
  "This execution is intentionally limited to Windows validation and cannot prove a macOS DMG build here.",
);
process.exit(0);
