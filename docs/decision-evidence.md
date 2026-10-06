# Game-screen decision evidence

The **게임 근거** room accepts observations transcribed by the manager from FM. This is a usable bridge for fields the native parser does not yet expose, **not automatic extraction or an assertion that the supplied facts are true**. Native snapshots remain immutable. Each row names its source screen in `reference`.

## Workflow and boundaries

1. Connect the pinned save and a healthy parser. Open **게임 근거 → 현재 커리어 입력 틀 열기**.
2. Keep the generated envelope and `scope` unchanged. Add only observations you actually checked to the relevant lists below. Unused lists stay `[]`.
3. Review the JSON, then click **이 내용으로 근거 전체 교체**. Alternatively select a JSON file, review it, and submit. Merely selecting a file does not replace evidence.
4. Review the corresponding matchday/medical, training/development, recruitment/transfers/contracts, reports, and economy rooms. Export evidence to retain a copy.

One file per browser/Bridge, at most 1 MiB and 1,000 rows per list. Replacement persists before changing the current view; validation/quota failure preserves the old file. Files are local and are not sent to AI. Scope includes career ID, observation lineage, game date, parser source, DB version and build. New games, rollback branches, new observations, changed versions or dates deactivate previous evidence. Old files remain exportable. Review every fact again before moving it into a new scope. Same-day later saves can still make transcriptions outdated; recheck the game screen before acting.

An incomplete or mismatched file is rejected as a whole. Unknown means JSON `null`, never `0`, an empty string, or a guessed default. Extra fields, duplicate IDs, invalid dates, wrong competition IDs, unsupported sources, mixed/overlapping club finance periods, and number-like strings are rejected. Candidate offers require that the candidate currently be loaded; reload/reimport that candidate page before reusing an evidence packet that references it.

## Registration and medical observations

Example **row** for `eligibility` (replace IDs and facts with the values on screen):

```json
{"playerId":"7","fixtureId":"m1","competitionId":"3","registered":false,"exempt":true,"suspended":false,"workPermit":true,"otherRulesClear":null,"reference":"FM > Competition > Registration and match eligibility"}
```

Use the exact string IDs shown in the room. A competition ID must exist in the fixture snapshot; a name or stage ID is not interchangeable. Registration is satisfied by `registered:true` **or** `exempt:true`. Registration failure requires both to be false; other combinations remain unknown. Suspension, permission failure or another unmet rule blocks. `otherRulesClear` means the manager checked the other applicable rules; the engine does not implement every competition rule.

Example `medical` row:

```json
{"playerId":"7","injured":null,"fatigueLabel":"Tired","riskLabel":"High","reference":"FM > Medical Centre, checked today"}
```

Fatigue/risk are literal screen labels, not a converted 0–100 scale or probability. Injury `true` excludes the player; unknown/negative injury observations never replace missing native medical fields. A blocked row removes the player from the relevant fixture's review XI and bench; a hard lock then becomes a conflict. Positive transcription does not mark native eligibility as verified. Conservative injury exclusions persist across the displayed horizon until a new observation is entered; future recovery is not predicted.

## Training and growth

`catalogue` contains only actual focus items you verified in your FM build, with the snapshot's named attribute keys:

```json
{"id":"passing-focus","name":"Passing","attributes":["passing","vision","technique"],"reference":"FM > Individual training > Focus catalogue"}
```

`assignments` connects the player's current focus and the date that continuous assignment began:

```json
{"playerId":"7","focusId":"passing-focus","since":"2037-07-01","reference":"FM > Individual training > Current assignment"}
```

The engine matches this supplied catalogue against the role's lowest observed core attributes. It shows the current assignment and matching alternatives; missing role evidence yields no recommendation. It compares named attribute observations only when both the **exact start date** and current date exist in the same archive lineage. A same-day assignment produces no growth result. Change `since` when the assignment changes. Differences are observations during that period, not proof of training causation, a predicted growth amount, or an intensity prescription.

## Buying, loans, sales and release

An `offers` row uses `kind` = `buy`, `loan-out`, `sell`, or `release`:

```json
{"id":"offer-1","playerId":"7","kind":"loan-out","club":"Other FC","expires":"2037-07-10","interest":true,"registration":null,"contractClear":true,"currency":"GBP","fee":100000,"weeklyWage":2000,"feeThreshold":90000,"maxWeeklyWage":2500,"facility":16,"minFacility":15,"promisedMinutes":60,"minMinutes":45,"reference":"FM offer and destination club screens"}
```

- Buy targets must be loaded external candidates. Other kinds target managed players.
- `interest`, `registration`, `contractClear`: checked willingness/acceptance, destination registration conditions, and contractual permission respectively. False blocks; null defers. For release, enter true only after checking any applicable settlement/registration condition, including a genuinely inapplicable condition.
- All money in a row uses the **same declared three-letter currency**. No exchange rate conversion. `fee` is guaranteed acquisition/termination cost for buy/release, guaranteed proceeds for sell/loan-out. Do not include uncertain add-ons as guaranteed money.
- `feeThreshold` is the manager's maximum cost for buy/release and minimum proceeds for sell/loan-out. `weeklyWage` is the managed club's **remaining weekly burden**, checked against `maxWeeklyWage`.
- Loan-only checks compare `facility` (verified numeric 1–20, otherwise null) and `promisedMinutes` (manager-transcribed minutes per match, 0–90, otherwise null) against the manager's minimums. A verbal playing-time category must not be fabricated into a minute count.
- Expired offers block. Every required unknown keeps the outcome deferred. Passing these checks is a review candidate, not a recommendation to transact or a claim of future playing time. Contract end clauses, offers and facilities are not automatically parsed.

## Actual match outcomes

Save a review plan from **경기 준비** before the match. After playing it, enter a `results` row with the saved fixture ID and date. Actual IDs may include players who have since left the roster:

```json
{"fixtureId":"m1","date":"2037-07-02","goalsFor":2,"goalsAgainst":1,"starters":["1","2","3","4","5","6","7","8","9","10","11"],"minutes":[{"playerId":"1","minutes":90},{"playerId":"2","minutes":90},{"playerId":"3","minutes":90},{"playerId":"4","minutes":90},{"playerId":"5","minutes":90},{"playerId":"6","minutes":90},{"playerId":"7","minutes":60},{"playerId":"8","minutes":90},{"playerId":"9","minutes":90},{"playerId":"10","minutes":90},{"playerId":"11","minutes":90},{"playerId":"12","minutes":30}],"reference":"FM full-time match report"}
```

Exactly 11 distinct starters, at most 23 minute rows and 0–130 minutes per player. Include explicit zero-minute records for planned players who did not play; omission remains unknown. Scores are from the managed team's perspective and exclude penalty-shootout kicks.

The latest plan saved **on an earlier calendar date** is linked. Same-day plans are excluded because the archive lacks verified kickoff ordering and cannot distinguish hindsight. Report shows observed score, starter overlap and mean absolute planned-minute error with compared/total player counts. It does not call a win a successful recommendation or compute predictive accuracy without an actual pre-match probability model. If multiple prior-day plans exist, archive insertion order selects the latest, independent of subjective helpfulness labels.

## World Balance: actual flows and bounded proposals

`economy` rows are cash-flow observations, not budgets. Use one consistent cash basis and currency per club/period:

```json
{"clubId":"1","leagueId":"saudi-top","currency":"GBP","from":"2037-06-01","through":"2037-06-30","income":20000000,"expenditure":15000000,"transferSpend":8000000,"transferIncome":4000000,"wageSpend":5000000,"reference":"FM finances > Actual income/expenditure, June, cash basis"}
```

The displayed net is income minus expenditure, not accounting profit. Transfer/wage spending cannot exceed total expenditure; transfer receipts cannot exceed total income. Inclusive periods for a club must not overlap. Same-period/currency league comparisons show **share of the supplied sample** only, with club counts. Wage spending change compares the same club/league/currency across adjacent periods of equal days. Zero baselines produce unknown growth, not infinity. Different month lengths deliberately do not compare. Neither sample share nor payroll change is a world overheating index or price inflation measure.

The economy room can export a **review-only** ±10% proposal for a positive integer managed-club balance, allocated/remaining transfer budget, or weekly wage budget. It contains scope, raw-unit before/after and reversal values. Pure in-memory apply/readback/reverse checks reject scope/value drift. The native snapshot and game remain untouched. `writeEnabled` is always false. There is **no validated FM writer profile or real game rollback**; inferred offsets, reputation, CA/PA, attributes and match results cannot be written. This JSON is not a runnable patch or an approval token.

## Verification and remaining work

Node regressions cover scope/schema failures, fixture-specific exclusion and lock conflicts, unknown/exemption cases, training baselines, offer conditions, hindsight-safe outcome linkage and missing minutes, economic cohorts/denominators, proposal drift/rollback, durable import failure, new-career invalidation and HTML escaping. Browser CI covers file preview/submit, connected panels, proposal download, reload persistence and date expiry. Existing public-save macOS integration remains a regression gate for the real reader/UI pipeline.

Still requires actual FM screen comparisons, automatic parser/runtime extraction of these new fields, full competition-rule semantics, trained/calibrated outcome models and a separately validated version-specific writer with disk-level readback and backup recovery. Transcription support does not close those evidence gates.
