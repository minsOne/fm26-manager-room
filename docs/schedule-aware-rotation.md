# Schedule-aware Matchday and rotation review

This read-only iteration connects the selected real fixture to the Matchday
review and a sequence of at most five future fixtures. It uses normalized native
snapshot inputs. No game file, attributes, CA, PA or match results are changed.

## Calendar and assignment

- Fixtures are sorted by UTC calendar date and stable ID. Past fixtures are excluded.
- An absent selected ID defers review; it never silently switches to another fixture.
- Calendar gaps are elapsed days. Rest days are `max(0, gap - 1)`; an unavailable
  neighbor stays unknown. The last displayed match can still use a later fixture
  outside the five-match horizon to detect congestion.
- A gap of four days or less on either side flags calendar congestion. This is
  a policy threshold, not a verified physiological recovery rule.
- Same-day schedules require time/team verification and cannot establish eligibility.
- Each fixture gets a global maximum-weight unique-player assignment. Fixtures
  are planned sequentially, not jointly optimized across the complete horizon.
- Known injured or ineligible players are excluded conservatively throughout the
  scenario. Current positive availability does not predict availability on a future date.
- Bench review excludes that fixture's XI and prioritizes verified positional coverage.
  Nine is a review capacity, not a verified competition-specific bench allowance.

## Manager directives

The Matchday UI supports hard starter locks by formation slot and rest directives
for the selected fixture. A lock reserves that player before globally optimizing
remaining slots; resting players are excluded from both XI and bench. The engine
accepts an optional `constraintsByFixture` Map of fixture ID to
`{lockedStarters: {slotId: playerUid}, restIds: [playerUid], minuteCaps: {playerUid: 60}, substitutions: {slotId: {minute: 60, playerId: playerUid}}}` for rotation review.
Direct Matchday review accepts the same directive record as `options.constraints`.

Duplicate locks, lock/rest collisions, missing players, obsolete formation slots,
known unavailable locked players, unverified locked roles and malformed directives
produce explicit conflicts. No constraint is silently relaxed. The conflicting
fixture emits neither XI nor bench and makes no minute reservations; later fixtures
are deferred. Earlier valid drafts retain their hypothetical reservations.

Unknown medicine does not prevent an evidence-based review lock, but remains
unknown and cannot pass final decision gates. Refreshing a career retains directives
and validates them against new evidence: a disappeared/injured player can therefore
turn a previously valid lock into a conflict.

Directives are isolated by fixture, retained across same-career refresh, mode and
formation changes, and reset when accepting a different career, changing Bridge or
reloading the page. Obsolete slot locks remain visible and removable after formation
changes. Rest-panel expansion also survives edits. These are in-memory browser
preferences, not persisted match instructions or game writes.

## Selection utility

Role Fit remains the existing 0–100 Manager Room heuristic. Selection utility
adds the following policy adjustments and is bounded to 1–100. CA is only an
assignment tie-breaker. Neither score is a calibrated confidence/probability.

| Input | Balanced / Development | Protect Key Players | Best XI |
|---|---|---|---|
| Recorded recent 14-day minutes >= 300, fixture within 3 days of snapshot | −10 if congested, otherwise −4 | 1.5× penalty | No adjustment |
| Snapshot condition <= 85, fixture within 3 days | −8 | 1.5× penalty | No adjustment |
| Earlier planned appearances within 4 days | −12 per 90-minute reservation, capped at −24 before weights | 1.5× penalty | No adjustment |
| Verified fixture importance >= 75 | Halve workload penalties, rounded | Halve workload penalties, rounded | No adjustment |
| Development mode, verified age <= 21 | +4; add up to +6 from verified PA − CA (`floor(headroom / 5)`) | No youth bonus | No youth bonus |

Protect currently strengthens workload protection for every candidate. It does
not infer which players are key players from an unverified squad-status mapping.
Unknown importance is not treated as an easy fixture. Missing PA is never
replaced with CA; a verified young age can receive the base development preference
without a fabricated headroom estimate. Partial recorded minutes remain a lower
bound. Unknown minutes cause no numeric penalty, but remain visible and defer
load-aware final decisions; absence of a penalty is not a healthy/unused status.

## Observed versus planned minutes

Without a directive, each selected starter reserves a hypothetical 90 minutes.
Manager minute caps are fixture-specific integer plans from 0 to 90, not medical
limits. Zero excludes a player from XI and bench; zero plus a starter lock conflicts.
Blank removes a cap. A cap below 90 schedules a replacement at that minute unless
an earlier explicit substitution time is supplied. Explicit times are integers 1–89;
an incoming-only directive requires a time or a short outgoing cap.

Explicit incoming players are reserved outside the XI. Remaining replacement slots
are assigned globally to unique verified-role candidates outside the XI/rest list,
respecting each incoming player's cap. Outgoing and incoming durations sum to 90
per filled slot. Requested substitutes are included in the review bench even when
they do not qualify for its 65-point coverage threshold; coverage remains separate.
More than nine replacements conflicts with the review capacity, not a verified rule.

Duplicate incoming players, starter/sub collisions, unavailable or missing incoming
players, unverified roles, obsolete slots and invalid/exceeded caps or times conflict.
If no replacement can cover the remaining minutes, that fixture and downstream
reservations are withheld; earlier valid drafts remain. The UI exposes the gap.
Only one substitution per slot is modeled: no chains, re-entry, extra time or stoppage
time. Competition substitution counts/windows remain unverified and require review.
Unselected players reserve zero **planned** minutes; actual future time is unknown.
Observed recent minutes are preserved separately, including nulls. Reservations
are never added to the observed history or written back to the snapshot.

We do not decay the observed 14-day total into a future rolling window: the
snapshot lacks a validated per-match timeline. Current condition is not projected
into future recovery. Medical minute caps remain unknown; manager-supplied times are explicitly plans.
No automatic substitutions are generated from missing fatigue/injury data.

## Decision gates and remaining work

Unknown/omitted injury, eligibility, condition, fatigue or injury risk is never
promoted to a known value. Build support, stale data, future match-day checks,
unverified fixture importance and incomplete workload history are surfaced as
decision gaps. Competition-specific registration/bench/substitution rules are
not verified yet, so rotation plans remain review-only even with otherwise
complete synthetic inputs. A snapshot update retains fixture/mode selection;
accepting a different career or changing Bridge resets them.

Remaining P1 work includes validated competition-specific eligibility,
per-match timeline windows, and runtime medical evidence. This iteration is not
a claim that the complete Matchday feature is production-ready.

## Validation

Node regression tests cover unique assignment, observed/planned separation,
all four modes, date boundaries, missing selected fixtures, unknowns, stale data,
source immutability, hard locks/rest, conflict gating, capped minute conservation, explicit/automatic unique substitutes,
missing coverage deferral and UI escaping. Synthetic
Chromium tests exercise lock/rest and minute-plan conflict resolution and retained/reset state.
The integrated macOS workflow uses
the actual public FM26 save, Rust/Swift API, UID/field audit and Chromium/WebKit
to verify real rotation plans, hard manager directives, minute splits and selection retention after
a real save reimport.
CI evidence does not replace the user's actual Mac/FM26 validation.
