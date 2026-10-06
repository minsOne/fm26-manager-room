# macOS Companion

The macOS Companion is the local, read-only bridge between FM26 save files and Manager Room.

## Recommended install

From the repository root, on macOS 13+ with Rust and Swift 6+:

```bash
./install.sh
export PATH="$HOME/.local/bin:$PATH"
manager-room select-save
manager-room start
```

Binaries are built natively (Apple Silicon preferred), ad-hoc signed and installed
in `~/Library/Application Support/FM26ManagerRoom/bin`. A shim is created under
`~/.local/bin`. The installer rejects Rosetta builds on Apple Silicon and explains
missing tools. Use `"$HOME/.local/bin/manager-room"` if PATH is not configured.

`select-save` opens a native file picker. `select-save "/path/to/Career.fm"` and
`pin-save "/path/to/Career.fm"` are noninteractive equivalents. The choice is
persisted and invalid selections/cancellation leave it intact. Stop the managed
service before changing/clearing the choice.

```bash
manager-room selection
manager-room doctor
manager-room doctor --deep --online
manager-room stop
manager-room unpin-save
```

`doctor` prints actionable checks for OS, architecture, binaries, the selected
save, snapshot permissions, port and local API. `--json` produces a machine-readable
report; a failed required check exits 4. `--installation-only` allows an installation
check before selecting a career. `--deep` privately stages and validates the career
without replacing the live snapshot. `--online` adds a bounded GitHub Pages network
probe; browser local-network permission and CORS still require browser verification.
Runtime/FM status is informational; it does not enable runtime reads or writes.

`start` launches a background Companion, waits for its first successful parse and
verified HTTP identity, then opens the web UI. The browser URL carries the chosen
loopback port. `--no-open` skips the browser. `stop` verifies PID, process birth and
instance identity before sending SIGTERM; stale state never authorizes killing an
unrelated process. Start/stop/selection mutations use an exclusive lock.
Duplicate starts reuse a healthy managed service; stop before changing its options.

```bash
manager-room start --port 18765
manager-room doctor --port 18765
manager-room stop
manager-room serve --open-web  # foreground development alternative
```

State: `selection.json`, `snapshot.json`, `service.json`; log: `companion.log` under
the application home. Logs rotate between launches above 5 MiB. A startup parse
failure stops the new service and retains the previous snapshot. `start` requires
an explicit or pinned save (or an explicit save directory); it does not silently
choose a different career. `serve` retains the legacy directory fallback.

```bash
bash scripts/uninstall-macos.sh              # stop, remove binaries, preserve state
bash scripts/uninstall-macos.sh --purge-data # also remove local state
```

See [real-Mac validation](../../docs/macos-validation.md) before treating CI results
as evidence of your own running-FM and browser environment.

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
- `--open-web`

The parser can also be supplied through `FM26_MANAGER_ROOM_PARSER`.
Tests and custom installations can isolate all local Manager Room state with `FM26_MANAGER_ROOM_HOME`.

## HTTP API

- `GET /api/health`
- `GET /api/parser`
- `GET /api/runtime`
- `GET /api/snapshot`
- `GET /api/actions` — local capabilities and per-process request token
- `GET /auth/callback` — one-use OAuth callback, no Origin, exact `127.0.0.1` Host
- `POST /api/actions` — bounded candidate search, ChatGPT account/model controls, Coach preview and explicitly confirmed AI send

Only IPv4 loopback is bound. Browser origins are explicitly allow-listed and private-network preflight is supported. POST is accepted only on `/api/actions` with the exact allowed Origin, a per-process token, fixed bounded length and JSON content type; other routes accept GET/OPTIONS only.

Start Companion normally and use **AI Coach → Continue with ChatGPT** for API-key-free sign-in. Approve plan usage, refresh the model list and select a model. Tokens stay in Keychain; account/model changes require a fresh preview. Actual eligibility and plan usage need user-Mac validation.

For API-key mode, use `manager-room start --model YOUR_MODEL_ID` for local web Coach previews. To permit paid AI requests, configure `OPENAI_API_KEY` locally and restart with `--enable-web-coach`. Every request still needs a separate preview and explicit web confirmation. Details: [web actions](../../docs/external-candidates-and-coach.md#web-search-and-coach-setup).

This companion remains read-only.

### Same-path new game

Stop the managed service, then run `manager-room select-save "/path/to/New Career.fm" --new-career` and start again. The flag forces a fresh selection UUID even for the same path. Without it, reselecting the same path preserves the ID. Browser observations and directives are isolated when the new ID is accepted. A rollback or changed parser metadata is also held for a separate observation baseline.
