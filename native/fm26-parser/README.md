# FM26 native parser core

Production save-reader track for Manager Room.

## Current native coverage

- FM26 container directory + targeted Zstd sections
- player records: UID, CA/PA, positions, attributes, feet, transfer value, condition, sharpness, height
- names / birth date / nation / personality / traits
- clubs / teams / affiliate-team joins
- current contracts / wages / dates / squad status
- retained match history and recent minutes
- club finance chains
- managed-club auto detection
- managed upcoming fixtures
- Manager Room snapshot JSON

The parser is **read-only**.

## Manager Room snapshot

The normal product command requires only the save path:

```bash
native/fm26-parser/target/release/fm26-manager-room-parser snapshot "/path/to/Career.fm" --pretty
```

The parser detects the in-game date and managed club from the save. `--clock YYYY-MM-DD` and
`--club-uid N` remain optional diagnostic overrides.

## Benchmark

```bash
cargo run --release --manifest-path native/fm26-parser/Cargo.toml -- \
  bench "/path/to/Career.fm"
```

## Correctness policy

The public-save CI compares native output with the MIT-licensed `fmsave` reference.
Speed improvements are accepted only when parity gates pass.

Python remains the correctness oracle/fallback during the remaining native-reader work, but it
is not required by the intended macOS production path.

## Third-party notice

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
