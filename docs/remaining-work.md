# Release readiness and remaining work

Updated: 2026-10-01. Status is expressed as implementation, validation, integration and release gates, not completion percentages.

## Scope and non-goals

Manager Room is a **read-only manager assistant** with a separately gated, experimental World Balance writer. Player CA/PA/attributes and match-result editing are out of scope. A game-facing training/alias automation is not considered implemented just because its web controls exist.

The save-reader route is Rust -> snapshot -> macOS Companion -> browser. Python fmsave is a pinned reference/fallback, not proof of ground truth: matching a reverse-engineered reader can reproduce the same wrong interpretation.

## Audit baseline

- Web rooms and deterministic recommendation engines exist, but demo screens are not evidence of working real-save features.
- The native semantic reader contains players, person data, team/club joins, current contracts, retained match history, finance and managed upcoming fixtures. Coverage is partial and build dependent.
- PR #27 implements the macOS parser/watcher route on `feature/macos-native-snapshot`, targeting the semantic-reader branch. Main and these feature branches have diverged: integrate deliberately, never overwrite main with the feature tree.
- Stage/Competition and quick-snapshot branches already exist. Review their actual code and tests instead of duplicating the work.
- AI Coach is currently a rule-based prototype. A real model connection, live game bridge and game writer remain separate delivery gates.
- A historical sub-second Rust benchmark is a particular workload on a CI machine. It does not measure Mac staging, validation, file publication, HTTP transfer, browser rendering or full fmsave parity. No product-wide speed guarantee follows from it.

## P0 — Blockers before a real-save preview release

| Work | Existing tracker | Acceptance gate |
| --- | --- | --- |
| Reliable native import | #20, PR #27 | Private stable input copy; serialized runs; timeout and output limits; validate shape/IDs/ranges; previous snapshot survives any failed run; original save never overwritten. |
| Reliable save refresh | #21, PR #27 | Detect both atomic replacement and in-place writes; wait for stability; coalesce repeated events; bounded retry; user can pin a specific career instead of silently switching to the newest unrelated save. |
| Local API boundary | PR #27 + reliability follow-up | Bind only loopback; exact Host and Origin allowlist; bounded complete HTTP headers; reject writes/opaque origins; correct CORS for the supported frontend; Safari/Chrome smoke test. Local-user malware is outside this boundary. |
| Real-data truthfulness | New release gate | Unknown fatigue, PA, training focus, missing histories and injury risk must stay unknown. No `0 = safe`, no automatic demo fallback after an import failure, no guessed normality. Stale snapshots and save dates visible. |
| Attribute and identity correctness | #4, native-reader tests | Compare per UID and named field, not only counts/aggregate sums. Verify raw-to-1..20 scaling, hidden-field indexing, stable UID vs database ID, leap-year ages, loan ownership and contract units against in-game examples. |
| Browser import integration | #20 / #21 | Refresh after a successful snapshot revision without losing selected player/tab/tactic; show error and previous snapshot on failure; handle no upcoming fixtures, no managed club and unavailable league data. |
| Release integration | This document | Reconcile dependent branches, pass tests on exact final SHA, build on macOS, run a real save locally through the full pipeline, then deploy. Only merged/deployed code counts as shipped. |

### Implemented in the reliability follow-up

- File-backed stdout/stderr prevents pipe backpressure deadlocks; a deadline and output-size checks stop runaway parser jobs.
- Parser receives a temporary copy; input inode/size/modification time are checked before and after import. Normal concurrent FM saves are rejected; this is not an adversarial filesystem-integrity proof.
- Strict snapshot source/container/date/ID/CA/PA checks run before atomic publication. Structural validation is not semantic verification.
- A polling watcher detects in-place writes, imports one candidate at a time, skips unchanged signatures and retries failures. It does not create FM folders on a misconfigured path.
- Loopback bind, exact browser origins/Host checks, bounded headers, write rejection, and proper JSON nulls in health output.
- Portable Swift core tests use synthetic snapshots and fake parser executables. Network.framework is exercised separately by the macOS HTTP smoke test. Neither replaces a real FM26/macOS end-to-end test.

## P1 — Reliable matchday and data joins

1. **Stage/Competition (#19).** Review the existing branch. Resolve fixture -> stage -> competition IDs, competition labels, round/knockout rules only when supported; keep unresolved labels unknown. A stage ID is not a competition name.
2. **Matchday/rotation.** Enforce position/GK eligibility, injuries, suspensions, registration and competition-specific bench limits; support manual locks and an explicit incomplete-XI result. Distinguish single-match ranking from true multi-match planning.
3. **Playing time.** Distinguish last five team matches from a player's last five appearances. Retained history is not guaranteed complete and may omit friendlies/youth/internationals. Do not turn absence from that dataset into a zero-minute fact.
4. **Coach Confidence.** Surface source/build support, missing fields, sample size and disagreement. A heuristic score is not a calibrated success probability. Require outcome samples before reporting accuracy; show the denominator.

## P2 — Development, squad planning and recruitment

- **Training:** verified FM26 focus catalogue; role/position constraints; insufficient-growth-history state; no automatic role assignment from the largest unadjusted attribute score; account for general weaknesses and workloads. A recommendation is not an applied game change.
- **Development:** snapshot lineage per save/manager; persistence and diffing; compare compatible dates/builds only; avoid declaring stagnation from one snapshot or PA headroom as guaranteed growth.
- **Recruitment:** full candidate index rather than a fixed top-120 sample; filters, compare, shortlist, budget and wage fit, registration, actual availability and missing scouting knowledge.
- **Loans/transfers/contracts:** real offers, facilities, playing-time promises, playing level, recall clauses, expiry and wage hierarchy; unknown market interest must not be rendered as no interest. Verify currency and wage period before formatting money.
- **Korean aliases:** local UID-keyed display aliases, search by original/Korean name, generated-player support and user correction first. Bulk game nickname writing is a separate format-validation task.

## P3 — Economy, AI and delivery

- **World Economy (#22):** structural club/nation/league membership; loaded-league and finance coverage; don't assume all 17k clubs have finance rows or identify Saudi by name substring alone. Separate current budgets from actual spending and inflation time series. Show missing data, not a fabricated zero heat score.
- **AI Coach:** a real provider through the local service, credentials outside browser/GitHub, explicit data-sharing consent, bounded context/tools, explainable references to snapshot facts, cancellation and cost controls. Read tools only; model output cannot apply game writes.
- **Packaging:** supported macOS architectures; pinned Rust/Python/Actions dependencies; installer, signing/notarization decisions, setup diagnostics, local static hosting option and browser tests. Measure p50/p95 time and peak memory over multiple saves, separately for cold import and warm refresh.

## P4 — Experimental live bridge and controlled writes

- **Live bridge (#23):** read-only PoC on the user's actual macOS FM26 build; discover only required objects; test suspension/resume and save switching; unknown builds fail closed.
- **World Balance writer (#24):** only verified club/league economy fields, never player ability. Validate setter/field behaviour and persistence, dependencies/caches and ongoing funding before proposing a preset.
- Required workflow: version/profile guard -> immutable before-state and original-save backup -> exact diff preview -> explicit approval -> apply -> read-back -> load/persistence check -> verified recovery path.
- A memory read-back or changing fields back is **not a guaranteed rollback** after game logic has run. File restore and live-state recovery must be tested independently. Do not ship an Apply control until this gate passes.

## Execution order and release labels

1. Land/test the reliability follow-up on PR #27's branch; reconcile the semantic reader and main.
2. Fix unknown/stale data propagation, identity/attribute parity and browser revision refresh.
3. Verify the complete `.fm -> Mac -> API -> browser` route on real saves and publish a read-only preview.
4. Complete #19, matchday constraints, calibration and persistence, then recruitment/development/aliases.
5. Complete economy mapping and real AI integration; package a supported macOS release.
6. Experiment with #23/#24 separately; they must not block the useful read-only assistant.

**Implemented** = code exists. **Validated** = named tests passed at a specific SHA. **Integrated** = merged into the intended branch. **Released** = actual published artifact/site verified. Record these independently.
