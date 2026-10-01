# Public FM26 save smoke test — FC St. Helens 2037

Date: 2026-10-01

## Source

Public FM26 challenge save shared for the FC St. Helens 2037/38 challenge.

The workflow downloads the save only for the duration of the GitHub Actions job. The original `.fm` file is deleted before artifact upload and is not redistributed by this repository.

## Save metadata

- Game: FM26
- Build: `26.2.0+2276383`
- Database version: `26.0.0+0`
- In-game date: `2037-07-01`
- Managed club: **FC St. Helens**
- fmsave: 0.5.4
- fmsave build profile known: **no** — the pinned parser falls back to its 26.3.2 layouts and validates every reader result.

## Manager Room conversion result

The real save was converted successfully into the Manager Room snapshot schema.

| Data | Rows / result |
| --- | ---: |
| Players in save | 38,209 |
| Managed squad players | 60 |
| External candidates retained | 120 |
| Clubs | 17,672 |
| Finance rows | 10,548 |
| Fixtures | 37,661 |
| Upcoming managed-club fixtures retained | 12 |
| Player match-stat rows | 26,087 |
| Training calendars | 5 |
| Tactics | 0 on this build/layout |
| Market groups | 1 with current nation mapping |

Snapshot assertions passed:
- FM26 save identified correctly
- managed club resolved
- at least 11 managed players produced
- upcoming fixtures produced
- finance rows produced
- all emitted CA/PA values are inside 1...200

## fmsave validation

The full validation command ran against the public save. Because this is a 26.2.0 save and the pinned fmsave build profile is 26.3.2, some strict gates fail even though non-strict readers can still return usable rows.

### Passed readers

- clubs
- suspensions
- managed_clubs
- stages
- competitions
- transfer_windows
- competition_rules
- player_match_stats
- player_season_stats
- stadiums
- finances
- sponsorships
- affiliates
- job_vacancies
- staff
- staff_lists
- injury_types
- injuries
- training
- mentoring
- facilities

### Readers with strict validation failures

- players — `team_resolved` 94.82% vs 98% gate
- contracts — `chain_teams_resolved` 95.16% vs 98% gate
- fixtures — `fixture_stadiums_resolved` 95.68% vs 99.8% gate
- league_tables — old-build double-round-robin gate mismatch
- tactics / set_pieces — layout not accepted on this older build

## What this proves

1. A real FM26 `.fm` save can supply most of the Manager Room data on macOS without attaching to the running game.
2. Managed club, squad, CA/PA, attributes/hidden data, contracts, finances, fixtures, match stats and training are available through the save-reader path.
3. Recent minutes can be derived from retained per-match history rather than guessed from season totals.
4. Runtime/BepInEx remains useful for data the save reader does not reliably expose: current fatigue/injury risk, individual training focus and future controlled writes.
5. Build-aware trust levels are necessary. A reader result from an unknown FM build must carry reduced confidence rather than being treated as equally verified.

## Follow-up

- Test a public save written by a fmsave-known/current FM26 build.
- Improve market grouping: this old-build save currently resolves finance rows into only one nation group in our first normalization pass.
- Add reader trust/coverage to Coach Confidence.
- Use raw tactic role bits only after independently mapping them; do not invent role names.
