# Integrated read-only Manager Room

## Included work

The integration tree combines main after PR #36 (`e2d9384`), hardened macOS ingestion from PR #34 (`0d40d5b`), and the guarded browser from PR #35 (`b5f7646`). Source commits are retained as parents; no branch is force-updated. Further fixes make explicit native availability flags authoritative for age, personality, last-five records, contract end and contradictory wage metadata. Original position ratings, feet and PA range codes survive normalization.

## Local development

```bash
cargo build --release --manifest-path native/fm26-parser/Cargo.toml
swift build --package-path companion/macos -c release
companion/macos/.build/release/manager-room-companion serve --parser "$PWD/native/fm26-parser/target/release/fm26-manager-room-parser" --save-dir "/absolute/path/to/a/dedicated/save-folder"
```

In a second terminal:

```bash
python3 -m http.server 8080 --bind 127.0.0.1 --directory apps/web
```

Open `http://127.0.0.1:8080/` on the same Mac. The default Companion output remains under Application Support/FM26ManagerRoom. `--snapshot-file /absolute/path/snapshot.json` selects an isolated store for testing; it does not create or touch the default store. Do not run tests against a personal snapshot store. All game access remains read-only.

The current watcher follows an explicit `--save` or persisted `select-save`/`pin-save` choice and ignores neighboring careers. `--save-dir` explicitly opts into newest-file directory selection. Selection precedence is `--save` → `--save-dir` → persisted pin → default directory; managed `start` requires an explicit selection instead of silently falling back. The browser uses the persisted selection ID as its preferred career identity. Stop before changing a managed career. See [current installation commands](../README.md#macos-quick-start) and [real-Mac validation](macos-validation.md).

## Integration test

`Integrated Manager Room` builds the actual Swift and Rust binaries on macOS and runs all web, native conversion, comparator and Companion core regressions. It downloads one public fixture privately, audits managed-squad named fields against pinned fmsave and serves the actual snapshot through the hardened API. Chromium and Playwright WebKit load the real UI from local port 8080 and talk cross-origin to the real API. No Bridge interception or rewritten snapshot is used.

Checks include all 14 tabs, normalized attributes/hidden values for every published player, selection persistence after an in-place save rewrite, an intentionally invalid private save copy, automatic stale/error display, restoration and retry, API shutdown, mobile width and original-file digest preservation. Only sanitized reports are uploaded; no real player JSON, screenshots, logs or saves are redistributed.

## Evidence limits

A passing test validates integration for this fixture and CI Mac, not every game build, every world player or game-screen truth. Pinned fmsave warns about its fallback layout for the 26.2.0 fixture. Playwright WebKit is not the installed Safari browser. Local HTTP origins do not validate public HTTPS Pages-to-loopback browser permission flows. No running FM process or user's Mac is tested. Reported timings are individual warm CI observations, not cold-start or percentile guarantees.

No automatic XI/training/transfer/economy recommendation, live-memory adapter, external AI provider or game writer is enabled by this integration. Missing runtime data remains unavailable. main merge and Pages deployment must be confirmed independently of test-file presence.
