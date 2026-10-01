# Guarded real-data browser preview

Follow-up to #32. Based on main d9a13306b55d6e551574c40ed99cdcae85bd8b45; does not overwrite any native-parser or macOS reliability feature branch.

## Separation of real data and demonstration

`apps/web/index.html` now opens a guarded, read-only real-data view. It never substitutes demo data for a failed request. The existing prototype and its heuristic engines remain at `demo.html`, explicitly labeled as example data. Its provider refuses to load real snapshots. This is deliberate isolation, not a claim that all legacy recommendation algorithms are corrected.

The guarded view presents source observations in all 14 room tabs. Automated best-XI, focus assignment, transfer recommendations, economy overheating and model chat remain withheld where the required inputs or validated models are not available. No game write path is added.

## Data rules

- Native flat schema versions 1/2 and nested real fmsave/Rust snapshots are normalized; invalid source, date, arrays, IDs and ability ranges are rejected.
- Explicit `Known=false` is authoritative. Unknown PA remains null even if the parser substitutes CA. Missing fatigue/injury risk/history are never promoted to a measured zero.
- A recorded zero with a positive known flag is preserved. Incomplete history is a lower-bound observation, not all appearances or the team's last five fixtures.
- A single snapshot is not stagnation. Growth comparisons require different dates with an explicit shared save lineage.
- Unknown currency/amount validity is not formatted as euros or assumed zero salary. A raw wage can be inspected separately as unverified.
- Game date, capture timestamp and response-received timestamp are distinct. Missing capture time and game build remain missing; database version is not executable build.
- Coach Confidence in the real view is evidence coverage (numerator/denominator), not a calibrated probability. Availability/registration and build support remain explicit missing prerequisites.

## Refresh session

- Poll every five seconds after the previous request finishes while the document is visible; manual refresh and visibility resume share the in-flight request.
- Timeout covers reading the body, with a 32 MiB snapshot and 64 KiB parser-status response limit. Requests use loopback-only HTTP endpoints, no credentials and no redirects.
- Read `/api/parser` as well as `/api/snapshot`: a failed import can coexist with an HTTP-200 previous snapshot. Missing parser API is visibly marked.
- Preserve the last valid snapshot on HTTP failure, invalid JSON, malformed data or parser failure, with a stale/error banner. No silent demo switch.
- Same-career revisions preserve tab, selected player, search, selected fixture and analysis-only formation. Connection-setting drafts are not overwritten by polling.
- A different save/manager/club requires explicit browser acceptance. Without a backend save ID, save-name + manager + club is a conservative proxy and can collide; backend selected-file pinning and stable career identity are still needed.
- This cache is in-memory, not durable browser snapshot storage. Save observations are not sent to an external AI.

## Tests and evidence limits

`node --test apps/web/tests/real-data.test.js` executes 61 synthetic regression tests: unknowns, validation, failure retention, explicit career switching, bounded body reads, empty rooms and HTML escaping. The full existing web test suite also runs in CI.

`tools/test_real_preview.py` tests browser tab navigation, refresh state retention, stale data, parser failures, career acceptance, script injection, a narrow mobile viewport and explicit demo isolation. It mocks the Bridge using synthetic real-shaped snapshots. It does not exercise FM26, the Swift Companion, real memory offsets or Safari/private-network permissions.

The local execution environment blocks browser navigation by policy. Browser interaction tests are therefore assigned to the dedicated GitHub Actions workflow; its actual run result is authoritative, not the presence of a test script.

## Still open in #32

- Per-UID named-field parity and in-game validation of raw attribute scaling, hidden indexing, identity, money periods/units and contract dates.
- Native explicit known/build/lineage coverage, complete last-five-team-match histories and backend selected-save pinning.
- Hardened macOS ingestion integration and an actual `.fm -> Swift/Rust -> local API -> supported browser` test on Mac.
- Replace the quarantined heuristic/demo algorithms with constraint-aware real recommendations as their prerequisites become validated.
- Full candidate index, verified role/focus catalogue, real AI provider and experimental World Balance writer remain independent milestones.
