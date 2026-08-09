#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "Missing required command: $1" >&2
    exit 1
  fi
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

cat <<'MSG'

Agent installed successfully.

Next commands:
  npm run tui -- --setup
  npm run cli -- ai --prompt "Read package.json and explain the scripts"

For local Ollama, use:
  npm run tui -- --model qwen2.5-coder:7b --base-url http://localhost:11434/v1 --api-key ollama
MSG
