# FM26 Manager Room

FM26 Manager Room is an open-source, macOS-first assistant for Football Manager 2026 focused on squad management, matchday review, player development, recruitment and long-term world balance.

> Player CA/PA and attributes are read-only. The current integrated product path is read-only; experimental game writes are not enabled.

## Current working path

```text
FM26 .fm save
    ↓
Native Rust parser
    ↓
macOS Swift Companion
    ↓
validated snapshot + read-only localhost API
    ↓
Manager Room web UI
```

The parser and Companion are tested against a public FM26 save on Linux/macOS CI. The integrated macOS test passes a real save through Rust → Swift → localhost HTTP → Chromium and Playwright WebKit while retaining the last good snapshot on parse failure.

## macOS quick start

Requirements: Rust/Cargo and a Swift toolchain/Xcode command-line tools.

```bash
git clone https://github.com/minsOne/fm26-manager-room.git
cd fm26-manager-room
bash scripts/install-macos.sh
```

Diagnose the local installation:

```bash
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" doctor
```

Pin the exact save you want to follow:

```bash
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" \
  pin-save "/path/to/My Career.fm"
```

Start the local read-only service:

```bash
"$HOME/Library/Application Support/FM26ManagerRoom/bin/manager-room" serve
```

Open the UI:

https://minsone.github.io/fm26-manager-room/

The pinned watcher ignores newer neighboring saves but detects in-place updates to the selected save.

## Implemented read-only data path

Validated or parity-checked in the current pipeline includes:
- managed squad identity and names
- CA / PA availability
- 52 named attributes
- hidden/personality values exposed by the parser
- original position ratings and web positions
- left/right foot values
- condition and match sharpness availability
- current contract core fields and wage availability
- recent retained match-history minutes
- managed club finance snapshot
- upcoming managed-club fixtures
- safe stale/last-good behavior across failed imports

Unknown values remain unknown instead of being converted to healthy/zero defaults.

## Guarded web UI

The default web app is the real-data, read-only view. It:
- never silently falls back to demo data after a connection failure
- preserves the last valid snapshot
- surfaces parser errors even when the previous snapshot still returns HTTP 200
- preserves tab/player/search/fixture/analysis-formation state across same-career refreshes
- uses the Companion's persisted selection ID as the preferred career identity
- keeps unvalidated automatic recommendations gated

The legacy visual/heuristic prototype remains at `demo.html`.

## Product principles

- **Manager first** — surface decisions and missing evidence before raw tables.
- **Evidence before certainty** — unknown data stays unknown.
- **Read broadly, write narrowly** — player ability data is never a write target.
- **Version-safe experiments** — any future writer must be build-gated, previewed, verified and reversible.
- **AI interprets; deterministic systems calculate** — model chat must not invent source data or numeric truth.

## Planned rooms

Manager Room, Matchday, Squad, Tactics, Training, Development, Medical, Recruitment, Transfers, Contracts, Economy, Reports and AI Coach are represented in the UI. Their production recommendation logic is enabled only as the required inputs and models are validated.

## Write policy

Player data remains read-only:
- CA / PA
- visible attributes
- hidden/personality attributes
- player profile data
- match/development history

Possible future controlled-write research is limited to explicitly verified management/world-balance fields such as selected club finance controls. Any write path must implement:

```text
version guard → preview → explicit approval → apply → read-back verification → rollback
```

No such game writer is enabled in the current integrated build.

## Research notes

- `research/save-format/` — real-save parsing experiments
- `research/performance/` — Rust parser benchmarks
- `docs/integrated-read-only.md` — integrated evidence and boundaries
- `docs/pinned-save.md` — deterministic save selection
- `companion/macos/README.md` — local setup and commands

## Scope boundaries

Current CI evidence is reference equivalence on public FM26 fixtures, not proof for every FM26 build or every in-game field. Playwright WebKit is not installed Safari, and user-Mac/running-FM behavior still requires real-device validation.
