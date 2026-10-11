# Remaining work and evidence gates

This is the current tracker; older integration notes describe their historical
increments and may list work that has since shipped. A visible room is not proof
that its full recommendation engine is enabled.

## Implemented

- Native read-only Rust → macOS Swift → browser data path, pinned save lifecycle,
  safe stale/error retention, CLI installation/doctor/start/stop and public-save CI.
- Named managed-squad parity, retained dated appearances, fixture-based workload,
  role fit/depth, sequential rotation, hard locks/rests, caps, substitutions, manual
  fixture bench/substitution limits and explicit conflict handling.
- Browser-persisted career observations; explicit same-path new-game UUID;
  rollback/version split gates; CA/attribute change views and reports.
- Native query/pagination across decoded external players, direct web search/pagination and validated web page import.
- OpenAI Responses CLI and web Coach with explicit send, exact one-use preview, career/snapshot binding and a locally configured model/key.
- ChatGPT sign-in for the local Companion: OAuth/Keychain account profiles, model discovery, plan-backed Coach, refresh/logout and account-bound approvals. Actual account access remains a separate verification gate.
- Versioned observation export/restore with validation and durable replacement.
- Local review-plan journal with subjective feedback (not verified outcomes).
- Evidence-only role training review, supplied external-candidate comparison and
  local Coach briefing. These are not full automatic training/transfer/AI systems.

## Remaining items requiring unavailable evidence or services

| Item | Current limitation | Evidence needed to complete |
| --- | --- | --- |
| Actual Mac validation | CI WebKit is not installed Safari; no running user FM process | Follow macos-validation.md on the user's Mac, including save latency and energy |
| Automatic competition rules / eligibility | Pinned reference does not establish competition-specific squad rule mapping; club registration is insufficient | Rules and player eligibility screens paired with dates, competition IDs and saves; verified mappings and independent audit |
| Medical/fatigue/injury risk | Unverified runtime values remain unknown | Read-only samples from a supported running FM build, executable identity and screen comparisons |
| Complete appearances | Retained records can omit old, friendly, international and youth matches | Multiple dated saves and the actual game match lists/minute displays |
| Wider parser/build coverage | A public fixture/reference agreement is not universal game truth | Independent save/build matrix and field-by-field game-screen comparisons |
| Full training/development advice | Focus catalogue, current training and longitudinal outcomes not verified | FM26 training catalogue/current assignments, medical inputs and outcome observations |
| Recruitment / loan / sales validation | External search/pagination and UI import are implemented; offers, facilities, interest and registration remain incomplete | Broader candidate/build audit and verified offer/contract/eligibility fields |
| AI activation/evaluation | API-key and ChatGPT-login connections, preview and explicit send are implemented; no live account/plan/model verified here | Actual Mac browser login/Keychain access, account eligibility, token renewal and a completed ChatGPT response (or configured API key/model); live response evaluation. Web one-player requests are implemented; conversational history is not provided |
| Recommendation calibration | No validated recommendation/outcome labels | Persisted decisions and independently defined outcomes; sample coverage before probabilities |
| World Balance metrics | Current budgets are not actual spending or inflation | Nation/league mappings and longitudinal transfer/wage transactions with currency/unit verification |
| Game writer / rollback | No validated writable profiles; current product remains read-only | Build-specific field semantics, preview/read-back/rollback tests and per-write user approval |

These are blocked research/integration items, not completed implementations.
Do not substitute invented values, ordinary web football rules, demo models or
unverified process offsets. No amount of CI against one fixture substitutes for
the missing sources. Work can resume on each gate as its evidence becomes available.

## Further product work

- Automatic multi-device sync/identity reconciliation; portable export/restore is implemented.
- Independently verified outcome capture before calibration; current journals
  contain drafts and subjective feedback, not actual match outcomes.
- Joint multi-fixture optimization, chaining substitutions and supported special
  rules after their constraints are validated; current planner is sequential.
- Versioned migration policy when verified parser attribute semantics change.

Implementation and operational setup for these latest paths: [external candidates and Coach](external-candidates-and-coach.md). Remaining game-data validation is still not replaced by a model response or a manual import.

## Game-screen evidence development

The five decision areas now have a scoped manager-transcription workflow and executable review engines: [input schema and workflow](decision-evidence.md). This adds fixture-specific exclusions, real catalogue/assignment matching, offer condition gates, actual outcome/plan execution comparisons, actual cash-flow sample comparisons and bounded reversible **in-memory** balance proposals. Evidence import is durable, bounded and deactivated on scope changes.

Automatic extraction and official rule/medical verification remain open. Result linkage measures plan execution, not causal recommendation accuracy. World Balance has no supported game writer or real-file recovery profile. These limits must remain visible in completion reports; the new workflow is not evidence that the native parser has learned these fields.

## Matchday display and direct lineup application

- Workload review defaults to registered first-team slot 0. The optional **2군·유스 포함** checkbox includes other resolved team slots; **소속 미확인 포함** is separate. Age, CA and playing-time promises never determine squad membership. The reader publishes `teamId` / `teamSlot`, audited against the pinned reference. Reserve and youth slots are deliberately grouped because their exact labels are not verified across clubs. Updating Companion is required; older snapshots show explicit unknown membership.
- Training CA and PA headers toggle descending/ascending ordering. Missing values stay last, ties retain source order, and browser refresh preserves sort/filter choices. Workload filtering changes only that display, not the optimizer's player pool.
- **Directly applying the proposed XI to FM remains unimplemented.** The current Companion has no validated tactics writer or tested macOS FM UI automation adapter. A successful local computation/export is not game application. Before implementation can be verified, inspect the user's FM build and tactics/team-selection screen, then establish a supported import format or accessible UI controls, identity/slot matching and post-application readback. Do not introduce blind coordinate clicking, inferred save offsets or a button claiming success without observing the selected XI in FM. The user's approval covers this requested integration once a working route is established; another generic permission request is not needed.
- Squad observations now default to the first team and expose separate first/reserve/youth/unknown views with independent CA/PA ordering and age beside names. Nonzero team IDs can be assigned to reserve/youth once using the sample names under team classification settings. These display-only labels persist per browser/Bridge/career/observation lineage; a new game or branch resets them. Unknown metadata stays explicit rather than inferred from player age. Native attribute/personality keys and supported role names are displayed in Korean without changing stored IDs or calculations.
