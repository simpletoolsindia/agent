#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"

BIN_NAME=${HARNESS_BIN_NAME:-harness}
BIN_DIR=${HARNESS_INSTALL_BIN_DIR:-"$HOME/.local/bin"}
VERSION=$(node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); console.log(pkg.version);")

printf 'Harness version: %s\n' "$VERSION"
printf 'Repository: %s\n' "$ROOT_DIR"
printf 'Node: %s\n' "$(node --version)"
printf 'Command link: %s\n' "$BIN_DIR/$BIN_NAME"

if [ -x "dist/src/cli/main.js" ]; then
  npm run cli -- --version
else
  printf '%s\n' "CLI is not built yet. Run ./install.sh first."
fi
