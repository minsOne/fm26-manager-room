# FM26 native parser core

Rust performance track for Manager Room.

## Current scope

The first native milestone intentionally targets the expensive binary hot path:

1. memory-map the `.fm` file;
2. parse the FM26 trailer directory;
3. decompress only `game_db`;
4. scan player-record candidates using the known 26.3.2 layout;
5. emit timing and scan statistics as JSON.

This is **not yet the semantic replacement** for `fmsave`. The Python MIT parser remains the correctness oracle while the Rust implementation grows reader by reader.

## Run

```bash
cargo run --release --manifest-path native/fm26-parser/Cargo.toml -- \
  bench /path/to/career.fm
```

## Why this shape

A language rewrite only matters if it accelerates the expensive work. Manager Room therefore benchmarks native container/decompression/scanning first before duplicating every high-level record type.

## Safety

Read-only. The crate never modifies the save file.
