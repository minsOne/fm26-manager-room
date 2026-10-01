# Rust parser benchmark — 2026-10-01

## Goal

Measure whether replacing Python hot-path binary parsing with Rust is materially useful for
FM26 Manager Room on large saves.

## Fixture

Public FC St. Helens FM26 challenge save used by the existing real-save smoke test.

- File size: **229.5 MiB**
- `game_db` decompressed size: **155.5 MiB**
- Players accepted by the reference reader: **38,209**

The benchmark executes on the same GitHub Linux runner for the Python/Rust timing comparison.
A separate `macos-latest` job verifies the Rust crate builds successfully for macOS arm64.

## Results

Representative successful run: GitHub Actions run `36869140208`.

| Operation | Python / fmsave | Rust native core |
| --- | ---: | ---: |
| Container index | 2.515 ms | 0.475 ms |
| Decompress `game_db` | 299.126 ms | 236.540 ms |
| Player reader / native player-core scan | **9,063.701 ms** | **361.369 ms** |

Derived ratios:

- Zstd / section decompression: **1.26×**
- Player hot path: **25.08×**

## Important interpretation

The decompressor is **not** the main bottleneck. Python already delegates Zstd work to native
code, so replacing only decompression with Rust provides little benefit.

The large win is in record-heavy work:

- marker / completeness scans;
- binary field reads;
- candidate validation;
- record iteration;
- Python object construction and relationship work.

The Rust timing is currently the native player-core scan, not yet a complete semantic
replacement for every object that `fmsave.players()` builds (names, person blocks, contracts,
club joins and suspensions are still to be ported). The 25.08× figure must therefore not be
presented as the final end-to-end speedup. It establishes that the hot path is worth moving.

## Correctness parity

The benchmark fails if the Rust and Python readers disagree. On the real save all of these
checks passed:

- player count: **38,209**
- current ability aggregate
- raw potential ability aggregate
- all 15 position-rating aggregates
- all 52 non-foot raw attribute aggregates
- raw left-foot aggregate
- raw right-foot aggregate
- transfer-value aggregate
- raw match-sharpness aggregate
- raw condition aggregate
- height aggregate

This catches both missing/extra records and many offset/order mistakes while the semantic Rust
reader is developed.

## Decision

Use a native Rust parser core for production.

Keep `fmsave` as:

1. a MIT-licensed format-research reference;
2. a correctness oracle in CI;
3. a fallback reader while Rust coverage grows.

Do **not** spend engineering time replacing the Zstd implementation merely for speed.

## Next native milestones

1. Decode player core records into a stable Rust model.
2. Port person/name blocks.
3. Port team/club joins.
4. Port contracts.
5. Add managed-club Quick Load.
6. Port fixtures and per-match minute history.
7. Port club finances.
8. Generate Manager Room snapshot JSON directly from Rust.
9. Add incremental snapshot diffing.
10. Keep BepInEx Bridge for runtime-only data and controlled writes.
