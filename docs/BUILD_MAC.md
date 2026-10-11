# GSN Paints macOS build guide

This project is prepared for a macOS build but this Windows machine cannot produce or run a real DMG. The repository includes a cross-platform Electron codebase and a macOS packaging workflow; the actual DMG build must happen on a Mac or a GitHub Actions macOS runner.

## Option A: GitHub Actions (recommended when the owner approves a private repo)

1. Push the `gsn-mac` branch to a GitHub repo where the owner is permitted to run Actions.
2. Open the repository in GitHub and go to Actions.
3. Select the workflow `build-mac` and click `Run workflow`.
4. Download the generated artifacts from the action run: the DMG, ZIP, and any SHA-256 report.
5. Verify the package, then test the app on the target Mac.

## Option B: Build on any Mac

1. Install Xcode Command Line Tools: `xcode-select --install`.
2. Install Node.js 22 LTS.
3. Open Terminal in the project folder.
4. Run `chmod +x scripts/build-mac.sh`.
5. Run `./scripts/build-mac.sh`.
6. Review the produced files in `release/`.

The script builds for the Mac's native architecture by default. To build the other supported architecture, run `MAC_ARCH=arm64 ./scripts/build-mac.sh` or `MAC_ARCH=x64 ./scripts/build-mac.sh` as appropriate. The GitHub Actions workflow produces separate arm64 and x64 DMGs.

## Option C: Ask a friend with a Mac

1. Send the repo or a ZIP of the current working tree.
2. Ask them to run `./scripts/build-mac.sh`.
3. Have them send back the DMG and the output files.
4. Verify the app with the checklist in `MAC_TEST_CHECKLIST.md`.

## Apple Silicon vs Intel

- Apple Silicon: `Apple menu > About This Mac` shows `Chip: Apple M...`
- Intel: `Apple menu > About This Mac` shows `Processor: Intel`

Use the matching DMG for the target machine (arm64 for Apple Silicon, x64 for Intel Macs).

## Gatekeeper

The current packaging config does not sign or notarize the app. macOS may block or warn on first launch. The user can open it with:

- right-click the app and choose Open, or
- System Settings > Privacy & Security > Open Anyway, or
- `xattr -dr com.apple.quarantine "/Applications/GSN Paints.app"`

A Developer ID Application certificate and Apple notarization are required for a trusted, warning-free installation.

## Current status

The Windows environment here cannot create or validate a real macOS DMG. That step is intentionally left as a Mac/CI task.
