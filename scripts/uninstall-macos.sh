#!/bin/bash
set -euo pipefail

PREFIX="${FM26_MANAGER_ROOM_HOME:-$HOME/Library/Application Support/FM26ManagerRoom}"
SHIM_DIR="${FM26_MANAGER_ROOM_SHIM_DIR:-$HOME/.local/bin}"
PURGE=0

usage() {
  cat <<'EOF'
Usage: scripts/uninstall-macos.sh [--purge-data]

Removes installed FM26 Manager Room binaries and the PATH shim.
By default snapshot.json and selection.json are preserved.
Use --purge-data to remove the whole Manager Room application-support directory.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-data) PURGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

BIN="$PREFIX/bin"
SHIM="$SHIM_DIR/manager-room"
TARGET="$BIN/manager-room"

if [[ -L "$SHIM" ]]; then
  LINK_TARGET="$(readlink "$SHIM" || true)"
  if [[ "$LINK_TARGET" == "$TARGET" ]]; then
    rm -f "$SHIM"
  fi
fi

rm -f "$BIN/manager-room" "$BIN/fm26-manager-room-parser"
rmdir "$BIN" 2>/dev/null || true

if [[ "$PURGE" -eq 1 ]]; then
  case "$PREFIX" in
    ""|"/"|"$HOME")
      echo "Refusing to purge unsafe path: $PREFIX" >&2
      exit 3
      ;;
  esac
  rm -rf "$PREFIX"
  echo "Removed binaries and user data from: $PREFIX"
else
  echo "Removed installed binaries."
  echo "Preserved user data in: $PREFIX"
fi
