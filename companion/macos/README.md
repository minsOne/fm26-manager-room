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

Runtime-only state will later come from the separate BepInEx live bridge. The default save path remains read-only.

## Default FM26 save folder

```text
~/Library/Application Support/Sports Interactive/Football Manager 26/games
```

A custom FM user-data location can be supplied with `--save-dir`.

## One-command development run

From the repository root:

```bash
./scripts/run-macos.sh
```

Then open the Manager Room web app. The companion listens on:

```text
http://127.0.0.1:8765
```

## Commands

Build manually:

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

Serve + automatically watch the default FM26 save folder:

```bash
companion/macos/.build/release/manager-room-companion \
  serve \
  --parser native/fm26-parser/target/release/fm26-manager-room-parser
```

Useful options:

- `--save /path/to/Career.fm` — parse a specific save immediately.
- `--save-dir /custom/games` — watch a custom FM save folder.
- `--no-watch` — serve the current snapshot without watching.
- `--port 8765` — change the loopback API port.
- `--parser /path/to/parser` — explicitly locate the Rust binary.

The parser can also be supplied through `FM26_MANAGER_ROOM_PARSER`.

## HTTP API

- `GET /api/health`
- `GET /api/parser`
- `GET /api/runtime`
- `GET /api/snapshot`

`/api/health` includes the current parse state, last parse duration, last save path and last error.

## Safe-write boundary

All HTTP methods other than GET/OPTIONS return **405**. This companion does not expose a memory writer.

A future Safe Writer remains a separate, build-verified capability and must never share the default read-only save path.
