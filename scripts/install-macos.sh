#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "FM26 Manager Room macOS installer must run on macOS." >&2
  exit 2
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) echo "Apple Silicon detected (native arm64)." ;;
  x86_64)
    if [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == "1" ]]; then
      echo "Run this installer from a native Apple Silicon terminal, without Rosetta." >&2
      exit 2
    fi
    echo "Intel Mac detected; building for x86_64." ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 2 ;;
esac
if [[ "$(sw_vers -productVersion | cut -d. -f1)" -lt 13 ]]; then
  echo "macOS 13 or later is required." >&2; exit 2
fi

for tool in cargo swift install; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required build tool not found: $tool" >&2
    case "$tool" in
      cargo) echo "Install Rust from https://rustup.rs, reopen Terminal, then retry." >&2 ;;
      swift) echo "Install Xcode command-line tools: xcode-select --install" >&2 ;;
    esac
    exit 3
  fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${FM26_MANAGER_ROOM_HOME:-$HOME/Library/Application Support/FM26ManagerRoom}"
BIN="$PREFIX/bin"
SHIM_DIR="${FM26_MANAGER_ROOM_SHIM_DIR:-$HOME/.local/bin}"
PARSER_BUILD="$ROOT/native/fm26-parser/target/release/fm26-manager-room-parser"
COMPANION_BUILD="$ROOT/companion/macos/.build/release/manager-room-companion"

echo "Building Rust parser..."
cargo build --locked --release --manifest-path "$ROOT/native/fm26-parser/Cargo.toml"

echo "Building macOS companion..."
swift build --package-path "$ROOT/companion/macos" -c release

if [[ -e "$SHIM_DIR/manager-room" && ! -L "$SHIM_DIR/manager-room" ]]; then
  echo "Refusing to replace an existing file: $SHIM_DIR/manager-room" >&2; exit 4
fi
if [[ -x "$BIN/manager-room" ]]; then
  "$BIN/manager-room" stop
fi
mkdir -p "$BIN" "$SHIM_DIR"
chmod 700 "$PREFIX" "$BIN"
install -m 755 "$PARSER_BUILD" "$BIN/fm26-manager-room-parser"
install -m 755 "$COMPANION_BUILD" "$BIN/manager-room"
ln -sfn "$BIN/manager-room" "$SHIM_DIR/manager-room"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$BIN/fm26-manager-room-parser" >/dev/null
  codesign --force --sign - "$BIN/manager-room" >/dev/null
fi

echo
echo "Installed:"
echo "  $BIN/manager-room"
echo "  $BIN/fm26-manager-room-parser"
echo "  $SHIM_DIR/manager-room -> $BIN/manager-room"
echo
if [[ ":$PATH:" != *":$SHIM_DIR:"* ]]; then
  echo "Add this to your shell profile:"
  echo "  export PATH=\"$SHIM_DIR:\$PATH\""
  echo
fi
echo "Next:"
echo "  1. export PATH=\"$SHIM_DIR:\$PATH\""
echo "  2. manager-room select-save"
echo "  3. manager-room doctor --deep"
echo "  4. manager-room start"
