#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN_NAME=${HARNESS_BIN_NAME:-harness}
BIN_DIR=${HARNESS_INSTALL_BIN_DIR:-"$HOME/.local/bin"}
LINK_TARGET="$BIN_DIR/$BIN_NAME"
CLI_TARGET="$ROOT_DIR/dist/src/cli/main.js"

if [ ! -e "$LINK_TARGET" ] && [ ! -L "$LINK_TARGET" ]; then
  printf '%s\n' "Harness command is not installed at $LINK_TARGET"
  exit 0
fi

if [ ! -L "$LINK_TARGET" ]; then
  printf '%s\n' "Refusing to remove non-symlink: $LINK_TARGET" >&2
  exit 1
fi

RESOLVED=$(readlink -f "$LINK_TARGET" 2>/dev/null || readlink "$LINK_TARGET")
EXPECTED=$(readlink -f "$CLI_TARGET" 2>/dev/null || printf '%s\n' "$CLI_TARGET")

if [ "$RESOLVED" != "$EXPECTED" ]; then
  printf '%s\n' "Refusing to remove $LINK_TARGET; it points to $RESOLVED, not this clone." >&2
  exit 1
fi

rm "$LINK_TARGET"
printf '%s\n' "Removed $LINK_TARGET"
