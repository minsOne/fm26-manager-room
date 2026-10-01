# macOS Companion

The macOS Companion is the local, read-only bridge between FM26 save files and Manager Room.

## Production flow

```text
FM26 writes Career.fm
  -> save-directory watcher
  -> native Rust parser
  -> atomic snapshot.json
  -> localhost API
  -> Manager Room web UI
```

## Default FM26 save folder

```text
~/Library/Application Support/Sports Interactive/Football Manager 26/games
```

Use `--save-dir` when FM's user-data folder has been customized.

## Development run

From the repository root:

```bash
bash scripts/run-macos.sh
```

The companion listens on `http://127.0.0.1:8765`.

## Manual commands

Build:

```bash
cargo build --release --manifest-path native/fm26-parser/Cargo.toml
swift build -c release --package-path companion/macos
```

Parse one save:

```bash
companion/macos/.build/release/manager-room-companion \
  parse "/path/to/Career.fm" \
  --parser native/fm26-parser/target/release/fm26-manager-room-parser
```

Serve and watch:

```bash
companion/macos/.build/release/manager-room-companion \
  serve \
  --parser native/fm26-parser/target/release/fm26-manager-room-parser
```

Options:
- `--save /path/to/Career.fm`
- `--save-dir /custom/games`
- `--no-watch`
- `--port 8765`
- `--parser /path/to/fm26-manager-room-parser`

The parser can also be supplied through `FM26_MANAGER_ROOM_PARSER`.

## HTTP API

- `GET /api/health`
- `GET /api/parser`
- `GET /api/runtime`
- `GET /api/snapshot`

All non-GET/OPTIONS methods return **405**. This companion remains read-only.
