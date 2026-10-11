#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const cacheDir = path.join(rootDir, ".cache", "mac-crossbuild");
const electronVersion = "22.3.27";
const electronReleaseBase = `https://github.com/electron/electron/releases/download/v${electronVersion}`;
const electronChecksumUrl = `${electronReleaseBase}/SHASUMS256.txt`;
const appVersion = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
const archs = ["arm64", "x64"];

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} -> ${res.status}`);
  return res.text();
}

async function download(url, dest) {
  mkdirp(path.dirname(dest));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url} -> ${res.status}`);
  const fileStream = fs.createWriteStream(dest);
  await pipeline(res.body, fileStream);
}

function hasCommand(cmd) {
  const res = spawnSync(cmd, ["--version"], { shell: true, encoding: "utf8" });
  return res.status === 0;
}

function hasWsl() {
  const res = spawnSync("wsl", ["-l", "-v"], { shell: true, encoding: "utf8" });
  return res.status === 0;
}

async function ensureElectronArtifacts() {
  mkdirp(releaseDir);
  mkdirp(cacheDir);

  const shasumFile = path.join(cacheDir, "SHASUMS256.txt");
  if (!fs.existsSync(shasumFile)) {
    await download(electronChecksumUrl, shasumFile);
  }

  const checksums = fs.readFileSync(shasumFile, "utf8");
  for (const arch of archs) {
    const zipName = `electron-v${electronVersion}-darwin-${arch}.zip`;
    const localZip = path.join(cacheDir, zipName);
    if (!fs.existsSync(localZip)) {
      await download(`${electronReleaseBase}/${zipName}`, localZip);
    }
    const expected = checksums
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().includes(zipName.toLowerCase()));
    if (!expected) {
      console.warn(
        `Warning: no entry for ${zipName} in SHASUMS256.txt; continuing but checksum is not verified.`,
      );
      continue;
    }
    const actual = sha256File(localZip);
    const want = expected.trim().split(/\s+/)[0];
    if (actual !== want.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${zipName}: got ${actual}, expected ${want}`);
    }
    console.log(`Verified ${zipName}: ${actual}`);
  }
}

function ensureRcodesign() {
  const rcodesign = path.join(cacheDir, "rcodesign");
  if (fs.existsSync(rcodesign)) return rcodesign;

  console.log(
    "[warning] rcodesign was not found in .cache/mac-crossbuild. Download it from the apple-codesign GitHub releases and place it at:",
  );
  console.log(`  ${rcodesign}`);
  return null;
}

function ensureBetterSqlitePrebuilds() {
  const notes = [];
  for (const arch of archs) {
    const expected = `better-sqlite3-v${JSON.parse(fs.readFileSync(path.join(rootDir, "server", "package.json"), "utf8")).dependencies["better-sqlite3"]}`;
    notes.push(
      `darwin-${arch}: expected official prebuild from better-sqlite3 release matching Electron ${electronVersion} (ABI 110) and arch ${arch}`,
    );
  }
  return notes;
}

async function main() {
  mkdirp(releaseDir);

  if (!fs.existsSync(path.join(rootDir, "package.json"))) {
    throw new Error("Expected package.json at repo root.");
  }

  console.log("GSN Paints macOS crossbuild from Windows");
  console.log(`Electron version: ${electronVersion}`);
  console.log(`App version: ${appVersion}`);
  console.log(`Release dir: ${releaseDir}`);

  const wslReady = hasWsl();
  if (wslReady) {
    console.log(
      "WSL is available; use it for symlink-safe extraction and final zip creation when possible.",
    );
  } else {
    console.log(
      "WSL is not available. The script will only prepare the artifact plan; the final true macOS bundle must be assembled on a Mac or a WSL-enabled environment.",
    );
  }

  try {
    await ensureElectronArtifacts();
  } catch (error) {
    console.log(
      `[warning] Official Electron macOS zip validation did not complete: ${error.message}`,
    );
  }

  const rcodesign = ensureRcodesign();
  if (rcodesign) {
    console.log(`rcodesign tool path: ${rcodesign}`);
  }

  const prebuildNotes = ensureBetterSqlitePrebuilds();
  for (const note of prebuildNotes) console.log(note);

  console.log("Bundle assembly requirements:");
  console.log("  - rename Electron.app to GSN Paints.app");
  console.log(
    "  - keep the app payload under Contents/Resources/app/ with dist/, electron/, server/, package.json",
  );
  console.log("  - exclude .db, .env, tests, docs, Playwright output, source maps, and .output");
  console.log("  - ad-hoc sign with rcodesign after finalizing the bundle");
  console.log("  - zip only the app bundle with unix metadata preserved");
  console.log("  - release/GSN-Paints-" + appVersion + "-mac-arm64.zip");
  console.log("  - release/GSN-Paints-" + appVersion + "-mac-x64.zip");
  console.log("  - release/SHA256SUMS.txt");

  if (!wslReady) {
    throw new Error(
      "Windows-only bundle creation is blocked without a symlink-preserving extraction path (WSL or equivalent Apple build host).",
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
