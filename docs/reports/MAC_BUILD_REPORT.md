# GSN Paints macOS build report

## Build inputs

- Electron: `22.3.27` (pinned in `package.json`)
- Chromium: `108` (Electron 22 runtime)
- Electron native-module ABI: `110`
- better-sqlite3 for Electron: `9.6.0` in `server/electron-runtime/package.json`
- Minimum macOS: `10.13` (High Sierra and newer, per the pinned Electron release's platform support)
- App icon: `build/icon.png`, 1024 x 1024 pixels

## SQLite binary evidence

The public better-sqlite3 v9.6.0 GitHub release provides both Electron ABI 110 macOS assets:

- [darwin-arm64 prebuild](https://github.com/WiseLibs/better-sqlite3/releases/download/v9.6.0/better-sqlite3-v9.6.0-electron-v110-darwin-arm64.tar.gz)
- [darwin-x64 prebuild](https://github.com/WiseLibs/better-sqlite3/releases/download/v9.6.0/better-sqlite3-v9.6.0-electron-v110-darwin-x64.tar.gz)

The build uses the existing pinned dependency version. macOS verification checks the Electron executable and unpacked SQLite module with `file` and `lipo`; a wrong architecture fails the build.

## Build and test evidence

Windows preparation checks completed with Node.js `v22.23.2` and npm `11.11.1`:

- Server suite: 88/88 passed, 0 failed, 0 skipped in system Node (two runs).
- Electron-Node server suite: 88/88 passed, 0 failed, 0 skipped.
- `npx tsc --noEmit`: passed.
- `npx eslint .`: passed.
- `npm run build`: passed.
- `npm run test:e2e`: 4/4 passed.
- `npm run smoke:packaged`: passed using a fresh temporary database; it created the first administrator, restarted with data intact, created and restored a backup, confirmed post-backup data was rolled back, observed loopback-only renderer requests, and exited without leaving the app or API running.
- The workflow and electron-builder YAML parsed successfully; all referenced npm scripts and packaging paths exist, and the runner matrix and packaging settings passed assertions.

No macOS package has been built yet. The workflow file is prepared to build arm64 on GitHub's documented `macos-15` runner and x64 on `macos-15-intel`, then verify the app, native SQLite module, signatures, mounted DMG, ZIP, and packaged smoke flow. These are configured checks, not completed macOS-runner results. GitHub CLI is not installed in the Windows environment, so no Actions run or downloadable artifact has been inspected here.

None of the Windows checks is a hands-on test on a customer's Mac.

## What this does not prove

- The app is ad-hoc signed unless the required Apple signing and notarization secrets are configured. Ad-hoc signing is not notarization; macOS can show a first-launch warning.
- The bundled Chromium version is 108 because Electron 22 is intentionally kept pinned.
- There is no automatic updater.
- There are separate DMG and ZIP downloads for Apple Silicon (arm64) and Intel (x64).
- A real owner-side Mac check is still needed for installation, first run, backup, restore, and Gatekeeper behavior. Use [MAC_TEST_CHECKLIST.md](../MAC_TEST_CHECKLIST.md).
