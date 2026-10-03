#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packaging must run on macOS." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-dev}"
OUT="${2:-$ROOT/dist}"
ARCH="$(uname -m)"
NAME="fm26-manager-room-${VERSION}-macos-${ARCH}"
STAGE="$OUT/$NAME"
PARSER="$ROOT/native/fm26-parser/target/release/fm26-manager-room-parser"
COMPANION="$ROOT/companion/macos/.build/release/manager-room-companion"

rm -rf "$STAGE"
mkdir -p "$STAGE/bin"

if [[ ! -x "$PARSER" || ! -x "$COMPANION" ]]; then
  echo "Release binaries are missing. Build Rust and Swift release targets first." >&2
  exit 3
fi

install -m 755 "$PARSER" "$STAGE/bin/fm26-manager-room-parser"
install -m 755 "$COMPANION" "$STAGE/bin/manager-room"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"

codesign --force --sign - "$STAGE/bin/fm26-manager-room-parser" >/dev/null
codesign --force --sign - "$STAGE/bin/manager-room" >/dev/null
codesign --verify "$STAGE/bin/fm26-manager-room-parser"
codesign --verify "$STAGE/bin/manager-room"

cat > "$STAGE/install.sh" <<'INSTALL'
#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${FM26_MANAGER_ROOM_HOME:-$HOME/Library/Application Support/FM26ManagerRoom}"
BIN="$PREFIX/bin"

mkdir -p "$BIN"
chmod 700 "$PREFIX" "$BIN"
install -m 755 "$HERE/bin/fm26-manager-room-parser" "$BIN/fm26-manager-room-parser"
install -m 755 "$HERE/bin/manager-room" "$BIN/manager-room"

codesign --verify "$BIN/fm26-manager-room-parser"
codesign --verify "$BIN/manager-room"

echo "Installed to: $BIN"
echo "Next:"
echo "  \"$BIN/manager-room\" doctor"
echo "  \"$BIN/manager-room\" pin-save \"/path/to/My Career.fm\""
echo "  \"$BIN/manager-room\" serve"
echo "  open https://minsone.github.io/fm26-manager-room/"
INSTALL
chmod 755 "$STAGE/install.sh"

cat > "$STAGE/README.txt" <<EOF
FM26 Manager Room $VERSION — macOS $ARCH

READ-ONLY STATUS
This package reads FM26 save files. It does not write player CA/PA/attributes or modify the game.

INSTALL
  ./install.sh

THEN
  "$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" doctor
  "$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" pin-save "/path/to/My Career.fm"
  "$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" serve

OPEN
  https://minsone.github.io/fm26-manager-room/

SECURITY / SIGNING
The binaries are ad-hoc signed for local integrity checks but are NOT Apple-notarized.
macOS may require normal user approval for downloaded, non-notarized software.
Do not disable Gatekeeper or remove quarantine attributes to run this package.

SOURCE
  https://github.com/minsOne/fm26-manager-room
EOF

mkdir -p "$OUT"
rm -f "$OUT/$NAME.zip" "$OUT/$NAME.zip.sha256"
(
  cd "$OUT"
  /usr/bin/zip -qry "$NAME.zip" "$NAME"
)
(
  cd "$OUT"
  /usr/bin/shasum -a 256 "$NAME.zip" > "$NAME.zip.sha256"
)

echo "$OUT/$NAME.zip"
echo "$OUT/$NAME.zip.sha256"
