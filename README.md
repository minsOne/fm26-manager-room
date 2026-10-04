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

Requirements: macOS 13+, native Apple Silicon (Intel also supported), Rust/Cargo,
and Swift 6+/Xcode command-line tools. If missing, install Xcode tools with
`xcode-select --install` and Rust from https://rustup.rs. Reopen Terminal afterwards.

```bash
git clone https://github.com/minsOne/fm26-manager-room.git
cd fm26-manager-room
./install.sh
export PATH="$HOME/.local/bin:$PATH"
manager-room select-save
manager-room start
```

`select-save` opens the macOS file chooser and pins one career. You can also use
`manager-room select-save "/path/to/Career.fm"` for a noninteractive selection.
Cancelling or choosing an invalid file preserves the previous selection.

`start` parses that career, verifies the local API, runs the Companion in the
background, and opens https://minsone.github.io/fm26-manager-room/ in your browser.
The launch URL selects the correct loopback port, even with older saved web settings.
Closing Terminal does not stop the managed service.

```bash
manager-room doctor                  # actionable installation/save/port/API checks
manager-room doctor --deep --online  # private real parser test and Pages network probe
manager-room stop                    # stop only the managed service
```

After installation, add `export PATH="$HOME/.local/bin:$PATH"` to your `~/.zshrc`
if you want `manager-room` available in new terminal sessions. Without changing
PATH, use `"$HOME/.local/bin/manager-room"` for each command.

Stop before selecting another career; then `select-save` and `start` again.
For a **new game**, especially when reusing a filename, use
`manager-room select-save "/path/to/New Career.fm" --new-career` while stopped.
It creates a fresh career ID so previous observations and match directives cannot
silently carry over. The UI separately asks before accepting a new career or a
backwards game date. [Career observations and limits](docs/career-observations.md).
Use `serve` for a foreground development service and `start --no-open` for a
headless launch. `--port 18765` supports an occupied default port; supply the
same port to `doctor`. See [macOS Companion](companion/macos/README.md).

The watcher ignores newer neighboring saves and detects in-place updates to the
pinned file. Failed parsing preserves the last valid snapshot and displays the error.
No game writes are enabled.

The macOS install CI tests the installed commands with both synthetic failures and
an actual public FM26 save. CI does **not** establish installed Safari permissions,
running-FM autosave behavior, latency, CPU, memory or battery cost on your Mac.
Follow [the real-Mac verification checklist](docs/macos-validation.md) once after installation.

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

## Current remaining work

See [the consolidated tracker](docs/remaining-work.md) for implemented features,
blocked data/real-Mac/provider validation, and remaining product work. Local career
observations enable CA/attribute change reports; training/candidate/Coach reviews
are explicitly evidence-only and do not certify medical, eligibility or AI results.

## Research notes

- `research/save-format/` — real-save parsing experiments
- `research/performance/` — Rust parser benchmarks
- `docs/integrated-read-only.md` — integrated evidence and boundaries
- `docs/pinned-save.md` — deterministic save selection
- `companion/macos/README.md` — local setup and commands

## Scope boundaries

Current CI evidence is reference equivalence on public FM26 fixtures, not proof for every FM26 build or every in-game field. Playwright WebKit is not installed Safari, and user-Mac/running-FM behavior still requires real-device validation.
