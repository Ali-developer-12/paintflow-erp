#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:?Usage: verify-macos-package.sh <arm64|x64> <app-path> <dmg-path> <zip-path>}"
APP_PATH="${2:?Missing .app path}"
DMG_PATH="${3:?Missing .dmg path}"
ZIP_PATH="${4:?Missing .zip path}"

case "$ARCH" in
  arm64) EXPECTED_ARCH="arm64" ;;
  x64) EXPECTED_ARCH="x86_64" ;;
  *)
    echo "Unsupported macOS architecture: $ARCH" >&2
    exit 1
    ;;
esac

verify_app() {
  local app_path="$1"
  local executable="$app_path/Contents/MacOS/GSN Paints"
  local sqlite="$app_path/Contents/Resources/app.asar.unpacked/server/electron-runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

  if [ ! -d "$app_path" ]; then
    echo "Missing app bundle: $app_path" >&2
    exit 1
  fi
  if [ ! -x "$executable" ]; then
    echo "Missing executable: $executable" >&2
    find "$app_path/Contents/MacOS" -maxdepth 1 -type f -print >&2
    exit 1
  fi
  if [ ! -f "$sqlite" ]; then
    echo "Missing unpacked better-sqlite3 native module: $sqlite" >&2
    find "$app_path/Contents/Resources" -path '*better-sqlite3*' -print >&2
    exit 1
  fi
  file "$executable" "$sqlite"
  lipo "$executable" -verify_arch "$EXPECTED_ARCH"
  lipo "$sqlite" -verify_arch "$EXPECTED_ARCH"
  local executable_archs
  local sqlite_archs
  executable_archs="$(lipo "$executable" -archs)"
  sqlite_archs="$(lipo "$sqlite" -archs)"
  test "$executable_archs" = "$EXPECTED_ARCH"
  test "$sqlite_archs" = "$EXPECTED_ARCH"
  codesign --verify --deep --strict --verbose=2 "$app_path"
  codesign -dv --verbose=2 "$app_path" 2>&1
}

echo "Checking ${ARCH} app bundle: $APP_PATH"
verify_app "$APP_PATH"

mount_point="$(mktemp -d)"
mounted=0
cleanup() {
  if [ "$mounted" -eq 1 ]; then
    hdiutil detach "$mount_point" -quiet
  fi
  rm -rf "$mount_point"
}
trap cleanup EXIT
hdiutil attach "$DMG_PATH" -readonly -nobrowse -mountpoint "$mount_point"
mounted=1
test -d "$mount_point/GSN Paints.app"
echo "DMG contains GSN Paints.app"
verify_app "$mount_point/GSN Paints.app"
hdiutil detach "$mount_point" -quiet
mounted=0

zip_root="$(mktemp -d)"
cleanup_zip() {
  rm -rf "$zip_root"
}
trap 'cleanup; cleanup_zip' EXIT
ditto -x -k "$ZIP_PATH" "$zip_root"
test -d "$zip_root/GSN Paints.app"
echo "ZIP contains GSN Paints.app"
verify_app "$zip_root/GSN Paints.app"
echo "PASS ${ARCH}: app, DMG, ZIP, executable, native SQLite architecture, and code signature verified"
