#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION_REQUIRED="22"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to build GSN Paints for macOS." >&2
  exit 1
fi

MAC_ARCH="${MAC_ARCH:-$(node -p "process.arch")}"
case "$MAC_ARCH" in
  arm64|x64) ;;
  *)
    echo "MAC_ARCH must be arm64 or x64. Current: $MAC_ARCH" >&2
    exit 1
    ;;
esac

node_version="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_version" != "$NODE_VERSION_REQUIRED" ]; then
  echo "Node.js 22 is required for the GSN Paints build. Current: $(node -v)" >&2
  exit 1
fi

if ! command -v xcode-select >/dev/null 2>&1; then
  echo "Xcode Command Line Tools are required. Install them with: xcode-select --install" >&2
  exit 1
fi

npm ci
npm --prefix server ci
npm_config_arch="$MAC_ARCH" npm run native:electron --prefix server
npm run build
npx electron-builder --mac dmg zip --"$MAC_ARCH" --publish never

printf '\nBuilt artifacts:\n'
find release -maxdepth 2 -type f \( -iname '*.dmg' -o -iname '*.zip' \) -print | sort

printf '\nSHA-256\n'
find release -maxdepth 2 -type f \( -iname '*.dmg' -o -iname '*.zip' \) -print | sort | xargs -I{} sh -c 'shasum -a 256 "$1"' _ {}
