# Python fmsave reader profile

Date: 2026-10-01

Environment:
- macOS GitHub Actions runner
- same public FC St. Helens FM26 save used by the Rust benchmark
- 38,209 players
- 37,661 fixtures

## Result

| Stage | Time | Rows | Share of 17.9s |
| --- | ---: | ---: | ---: |
| open | 15 ms | — | 0.1% |
| managed_clubs | 1,862 ms | 1 | 10.4% |
| players | **6,143 ms** | 38,209 | **34.3%** |
| managed squad filter | 8 ms | 60 | ~0% |
| clubs | 0.95 ms | 17,672 | ~0% (cached after earlier reads) |
| finances | 742 ms | 10,548 | 4.1% |
| fixtures | **6,846 ms** | 37,661 | **38.2%** |
| player_match_stats | 1,725 ms | 26,087 | 9.6% |
| training | 259 ms | 5 | 1.4% |
| total | **17,917 ms** | | |

`players()` + `fixtures()` account for approximately **72.5%** of total reader time.

## Optimization decision

Do not rewrite the whole parser first.

Port in this order:

1. **Fixtures hot path**
   - or avoid world fixtures entirely for Quick Load;
   - Manager Room only needs managed-club upcoming fixtures.
2. **Players hot path**
   - first build a managed-club-only fast path;
   - full-world player index can load later for Recruitment.
3. **Match stats**
   - only managed-squad rows are needed for daily rotation.
4. Finances can stay in Python initially; 0.74s is not the dominant cost.

## Product implication

A Quick Load path that avoids 37,661 world fixtures and 38,209 full player model construction can plausibly reduce first-screen latency dramatically **even before** a complete Rust rewrite.

Rust should target scanner loops and selective reads, not Zstd: the separate container benchmark showed only a 1.03x Rust/Python difference for indexing + decompression.
