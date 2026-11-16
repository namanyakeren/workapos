#!/usr/bin/env bash
# Build a Debian installer (.deb) for the WORKAPOS touchscreen terminal.
# Prerequisites on Debian 12+: see README.md (Rust, Node 20+, Tauri deps).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules ]]; then
  npm ci
fi

npm run build
npm run tauri build -- --bundles deb

echo
echo "Installer dibuat di:"
find "$ROOT/src-tauri/target/release/bundle/deb" -maxdepth 1 -name '*.deb' -print
echo
echo "Pasang dengan: sudo apt install ./src-tauri/target/release/bundle/deb/workapos-terminal_*.deb"
