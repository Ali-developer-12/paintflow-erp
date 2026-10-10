#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION_REQUIRED="22"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to build GSN Paints for macOS." >&2
  exit 1
fi

node_version="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_version" != "$NODE_VERSION_REQUIRED" ] && [ "$node_version" -lt 22 ]; then
  echo "Node.js 22+ is recommended for the GSN Paints build. Current: $(node -v)" >&2
  exit 1
fi

if ! command -v xcode-select >/dev/null 2>&1; then
  echo "Xcode Command Line Tools are required. Install them with: xcode-select --install" >&2
  exit 1
fi

npm ci
npm --prefix server ci
npm run build
npm run dist:mac

printf '\nBuilt artifacts:\n'
find release -maxdepth 2 -type f \( -iname '*.dmg' -o -iname '*.zip' -o -iname '*.tar.gz' \) -print | sort

printf '\nSHA-256\n'
find release -maxdepth 2 -type f \( -iname '*.dmg' -o -iname '*.zip' \) -print | sort | xargs -I{} sh -c 'shasum -a 256 "$1"' _ {}
