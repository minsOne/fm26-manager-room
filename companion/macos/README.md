# macOS Companion

The macOS companion is the local bridge between the browser UI and FM26-related data sources.

## Why not task_for_pid?

For a distributable macOS app, attaching to another hardened process through `task_for_pid` is not a reliable foundation. The architecture therefore uses two macOS-friendly inputs:

1. **FM save parser** for durable save state, hidden data and historical snapshots.
2. **BepInEx in-process bridge** for runtime-only state and future whitelisted automation.

The Swift companion exposes that data to the web UI only over a loopback HTTP API.

## Commands

```bash
swift run --package-path companion/macos manager-room-companion probe
swift run --package-path companion/macos manager-room-companion snapshot-path
swift run --package-path companion/macos manager-room-companion serve --port 8765
```

Endpoints:

- `GET /api/health`
- `GET /api/runtime`
- `GET /api/snapshot`

All write requests return **405**. The Safe Writer is a separate future capability and will never share the default read-only path.

## Snapshot path

```
~/Library/Application Support/FM26ManagerRoom/snapshot.json
```

If no real snapshot exists, the web app automatically falls back to its demo snapshot.
