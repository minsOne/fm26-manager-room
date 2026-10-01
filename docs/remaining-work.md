# Remaining Work Plan

Updated: 2026-10-01

## Current production path

```text
FM26 .fm save
  -> Rust native parser
  -> Manager Room snapshot
  -> Swift macOS Companion
  -> localhost API
  -> Web UI / analysis engines
```

Python `fmsave` remains the CI correctness oracle and fallback while native coverage is completed.

## P0 — Finish native save-reader productization

### 1. Stage / Competition reader
Issue #19

Done when:
- managed upcoming fixtures have competition id/name from native Rust;
- supported round/knockout metadata is joined without guessing;
- public-save parity matches fmsave.

### 2. Swift Companion -> Rust parser
Issue #20

Done when:
- macOS Companion invokes `fm26-manager-room-parser snapshot <save.fm>`;
- atomic snapshot replacement is automatic;
- parser status/duration is visible via the local API;
- production path does not require Python.

### 3. Save-folder watcher / automatic refresh
Issue #21

Done when:
- FM26 save writes are detected;
- partial writes are ignored/debounced;
- the previous valid snapshot remains available on parse failure;
- Manager Room refreshes automatically after a save.

## P1 — Real Economy Room

### 4. World economy mapping
Issue #22

Done when:
- club -> nation -> competition/league joins are native;
- Saudi Pro League is identified structurally;
- real finance data drives financial power / concentration / distortion metrics;
- Coach Confidence reflects data coverage and build trust.

## P2 — Runtime-only data

### 5. macOS BepInEx live bridge
Issue #23

Read-only first. Use it only for runtime state not reliably available from saves:
- fatigue/current runtime condition;
- individual training focus;
- currently loaded save/club;
- other verified transient states.

Unknown builds remain fail-closed.

## P3 — Controlled write experiments

### 6. World Balance Safe Writer
Issue #24

Only after a verified runtime profile exists.

Mandatory:
```text
build guard
-> rollback snapshot
-> exact preview
-> explicit approval
-> apply
-> read-back verify
-> rollback on mismatch
```

Player CA/PA/attributes and match-result editing remain permanently out of scope.

## Performance target

Current real-save benchmark (~229.5 MiB public FM26 save):
- native semantic player/club/contract/match-history/finance/fixture work is approximately sub-second on CI;
- complete snapshot path target on Apple Silicon: ~1–2 seconds after final native joins are complete;
- UI analysis after snapshot load should be effectively immediate.

## Order of execution

1. Merge stable semantic Rust reader.
2. Implement #19.
3. Implement #20.
4. Implement #21.
5. Implement #22.
6. Implement #23.
7. Implement #24.
