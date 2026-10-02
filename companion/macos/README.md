# macOS Companion

The macOS Companion is the local, read-only bridge between FM26 save files and Manager Room.

## Recommended install

From the repository root:

```bash
bash scripts/install-macos.sh
```

The installer builds the native Rust parser and Swift Companion, installs both under:

```text
~/Library/Application Support/FM26ManagerRoom/bin
```

and ad-hoc signs the locally built binaries.

Run diagnostics:

```bash
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" doctor
```

Pin the career save you actually want Manager Room to follow:

```bash
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" \
  pin-save "/path/to/My Career.fm"
```

Inspect or clear the selection:

```bash
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" selection
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" unpin-save
```

Start the local service:

```bash
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" serve
```

Then open:

```text
https://minsone.github.io/fm26-manager-room/
```

## Production flow

```text
Pinned Career.fm
  -> save watcher
  -> private staged copy
  -> native Rust parser
  -> validated atomic snapshot.json
  -> read-only localhost API
  -> guarded Manager Room web UI
```

A pinned selection watches only that file. A newer neighboring `.fm` file is ignored. In-place writes to the selected file are detected and re-parsed.

## Default FM26 save folder

```text
~/Library/Application Support/Sports Interactive/Football Manager 26/games
```

If no save has been pinned and no explicit `--save` or `--save-dir` is supplied, the compatibility fallback still follows the newest save in the default folder. Pinning is recommended.

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

Serve:

```bash
companion/macos/.build/release/manager-room-companion \
  serve \
  --parser native/fm26-parser/target/release/fm26-manager-room-parser
```

Useful options:
- `--save /path/to/Career.fm`
- `--save-dir /custom/games`
- `--no-watch`
- `--port 8765`
- `--parser /path/to/fm26-manager-room-parser`
- `--snapshot-file /isolated/snapshot.json`

The parser can also be supplied through `FM26_MANAGER_ROOM_PARSER`.
Tests and custom installations can isolate all local Manager Room state with `FM26_MANAGER_ROOM_HOME`.

## HTTP API

- `GET /api/health`
- `GET /api/parser`
- `GET /api/runtime`
- `GET /api/snapshot`

Only IPv4 loopback is bound. Browser origins are explicitly allow-listed, private-network preflight is supported, and non-GET/OPTIONS methods are rejected.

This companion remains read-only.
