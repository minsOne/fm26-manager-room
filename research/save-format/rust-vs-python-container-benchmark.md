# Rust vs Python FM26 container benchmark

Date: 2026-10-01

## Setup

- GitHub Actions: `macos-latest`
- Public FM26 save: FC St. Helens challenge
- Save file: ~230 MB
- Target section: `game_db`
- Compressed `game_db`: 50,065,479 bytes
- Decompressed `game_db`: 163,050,243 bytes
- Rust: `memmap2` + `zstd` crate, release build
- Python: fmsave 0.5.4 container reader + native `backports.zstd`
- Same save and same section in one CI job

## Result

| Operation | Rust | Python | Python/Rust |
| --- | ---: | ---: | ---: |
| Directory index | 1.252 ms | 1.215 ms | 0.97x |
| game_db decompression | 154.696 ms | 158.897 ms | 1.03x |
| Total | 155.954 ms | 160.482 ms | **1.03x** |

The decoded section sizes matched exactly.

## Conclusion

Replacing Python with Rust **does not materially improve the container/index/Zstd layer**. Python fmsave already delegates Zstd decompression to native code, so this part is not the source of the ~19 second Manager Room conversion time.

The remaining cost is therefore dominated by later work:

- locating and validating tens of thousands of player records;
- decoding player/person/attribute structures;
- joining contracts, teams, clubs and identities;
- reading match history and fixtures;
- constructing Python objects;
- converting the complete world database into Manager Room models.

This benchmark changes the optimization priority:

1. Keep the Rust container PoC as a validated base.
2. Profile the Python conversion by reader and transformation stage.
3. Port the hottest scanner/decoder loops to Rust rather than blindly rewriting Zstd/container code.
4. Build Quick Load so the first screen does not require the world database.
5. Keep Python fmsave as the correctness oracle.

## Next benchmark

Measure, independently:

- `managed_clubs()`
- `players()`
- managed-squad filter
- `clubs()`
- `finances()`
- `fixtures()`
- `player_match_stats()`
- normalization / JSON serialization

Then port the dominant scanner first.
