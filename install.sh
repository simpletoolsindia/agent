#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"

BIN_NAME=${HARNESS_BIN_NAME:-harness}
BIN_DIR=${HARNESS_INSTALL_BIN_DIR:-"$HOME/.local/bin"}
LINK_TARGET="$BIN_DIR/$BIN_NAME"
CLI_TARGET="$ROOT_DIR/dist/src/cli/main.js"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "Missing required command: $1" >&2
    exit 1
  fi
}

path_contains() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

require_command node
require_command npm

node -e "const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10); if (major < 20) { console.error('Node.js 20 or newer is required. Current: ' + process.version); process.exit(1); }"

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run build
npm run cli -- --help >/dev/null

mkdir -p "$BIN_DIR"
ln -sfn "$CLI_TARGET" "$LINK_TARGET"
chmod +x "$CLI_TARGET"

cat <<MSG

Agent installed successfully.

Installed command:
  $LINK_TARGET

Next commands:
  $BIN_NAME tui --setup
  $BIN_NAME ai --prompt "Read package.json and explain the scripts"

For local Ollama, use:
  $BIN_NAME tui --model qwen2.5-coder:7b --base-url http://localhost:11434/v1 --api-key ollama
MSG

if ! path_contains "$BIN_DIR"; then
  cat <<MSG

Add this to your shell profile if '$BIN_NAME' is not found:
  export PATH="$BIN_DIR:\$PATH"
MSG
fi
