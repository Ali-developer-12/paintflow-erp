#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/verify-mac-bundle.mjs <zip-or-app-path>");
  process.exit(1);
}
const resolved = path.resolve(target);
if (!fs.existsSync(resolved)) {
  console.error(`Missing file: ${resolved}`);
  process.exit(1);
}

const zipBase = path.basename(resolved);
console.log(`Verifying bundle: ${resolved}`);
console.log(`Name: ${zipBase}`);

const entries = execSync(
  `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $z = [System.IO.Compression.ZipFile]::OpenRead('${resolved.Replace("\\", "\\\\")}'); foreach($e in $z.Entries) { Write-Output $e.FullName } ; $z.Dispose() }"`,
  { encoding: "utf8" },
);
const lines = entries.split(/\r?\n/).filter(Boolean);
if (!lines.some((line) => line === "GSN Paints.app/" || line.startsWith("GSN Paints.app/"))) {
  console.error("Bundle must contain a top-level GSN Paints.app directory.");
  process.exit(1);
}
if (!lines.some((line) => line.includes("GSN Paints.app/Contents/Info.plist"))) {
  console.error("Missing Info.plist in the app bundle.");
  process.exit(1);
}
if (lines.some((line) => /\.db|\.env|source map|\.output|node_modules\\.bin|tests\//i.test(line))) {
  console.error("Bundle contains forbidden development or data files.");
  process.exit(1);
}
console.log(`Zip entries checked: ${lines.length}`);
console.log("Verification passed: structure is present and forbidden payloads were not found.");
