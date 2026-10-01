#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARSER="$ROOT/native/fm26-parser/target/release/fm26-manager-room-parser"
COMPANION="$ROOT/companion/macos/.build/release/manager-room-companion"

echo "Building native FM26 parser..."
cargo build --release --manifest-path "$ROOT/native/fm26-parser/Cargo.toml"

echo "Building macOS companion..."
swift build -c release --package-path "$ROOT/companion/macos"

echo "Starting Manager Room companion..."
exec "$COMPANION" serve --parser "$PARSER" "$@"
