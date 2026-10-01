# Rust Save Parser PoC

Production-parser experiment for FM26 Manager Room.

The first milestone intentionally implements only the save container layer:

- memory-map the `.fm` file;
- parse the trailer directory;
- locate named sections;
- selectively decompress one section with native Zstd;
- benchmark the operation.

It does **not** yet duplicate player/club/finance parsing. Python `fmsave` remains the correctness oracle while Rust readers are added incrementally.

## Build

```bash
cargo build --manifest-path parser/rust/Cargo.toml --release
```

## Benchmark

```bash
parser/rust/target/release/fm26-manager-room-parser bench Career.fm game_db
```

The benchmark reports directory-index time separately from section decompression time.
