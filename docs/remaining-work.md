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
| AI activation/evaluation | Native OpenAI connection, preview and explicit send are implemented; no live project/model configured here | User API key and available model on the Mac; live response evaluation. Web one-player requests are implemented; conversational history is not provided |
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
