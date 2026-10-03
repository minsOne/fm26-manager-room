# FM26 Manager Room — Current Status

Updated: 2026-10-03

## Shipped on main

### Real-save data path
- Native Rust FM26 save parser
- Managed club / squad detection
- Player names, CA/PA, visible attributes, hidden/personality values
- Position ratings and footedness
- Contracts and wages
- Recent match-history minutes
- Club finances
- Upcoming fixtures
- Stage / competition name resolution where verified
- Native Manager Room snapshot JSON
- Per-UID field parity tests against pinned `fmsave` reference

### macOS Companion
- Staged private copy before parsing
- Save-change detection during import
- Last-good snapshot preservation
- Parser time/output limits
- Loopback-only read-only HTTP API
- Exact Host / Origin checks
- In-place save watcher
- Persisted pinned-save selection
- Stable backend career selection ID
- `doctor`, `pin-save`, `selection`, `unpin-save`
- installable macOS release package
- `manager-room start` product flow
- safe uninstall with optional data purge

### Real-data web UI
- No implicit demo fallback
- Stale / unknown values stay explicit
- Same-career refresh preserves tab, selected player, search, formation and fixture
- Role Fit review from verified inputs
- Squad Depth review
- Recruitment depth review
- Guarded Matchday review
  - unique review lineup
  - known unavailability exclusion
  - unknown fatigue / medical / registration blocks final selection
  - workload signals are review-only

## In validation / next merge

### Guarded Training review
PR #54
- verified Role Fit + CA/PA + age + observed role gaps
- unknown PA or incomplete role data remains data shortage
- no invented FM26 individual-focus state
- no automatic training change

## Next implementation order

1. **Training review merge**
2. **Development history**
   - persist same-career snapshots
   - compare CA / selected attributes over dates
   - growth/stall only when two comparable observations exist
3. **Playing-Time Manager**
   - distinguish retained appearance history from complete team-match history
   - add team recent-five denominator before dissatisfaction-risk logic
4. **Recruitment full index**
   - full external candidate search
   - replacement / upgrade comparisons
   - registration / homegrown constraints when verified
5. **World Economy / Saudi**
   - club → nation → competition mapping
   - time-series finance / transfer-spend signals
   - no market-health claim from budget snapshots alone
6. **AI Coach**
   - actual model integration
   - function calls over local snapshot / analysis tools
   - explicit data-sharing controls
7. **Live Bridge**
   - runtime-only fatigue, current training state and other data that saves do not prove
8. **Safe Writer**
   - world-balance fields only
   - version guard
   - preview → explicit approval → apply → read-back → rollback
   - player CA/PA/attributes remain read-only

## Evidence boundary

A passing CI proves the tested save/layout/path only. It does not mean every FM26 build or the user's live Mac installation has been verified.

The read-only save path is the production baseline. Runtime writes remain disabled until build-specific verification exists.
