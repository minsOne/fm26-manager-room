# FM26 Manager Room

FM26 Manager Room is an open-source assistant for Football Manager 2026 focused on squad management, matchday decisions, player development, recruitment, and long-term world balance.

> This project is **not a player cheat editor**. Player data is treated as read-only. Controlled write operations are reserved for explicitly supported world-balance and repetitive-management workflows.

## Product principles

- **Manager first**: surface decisions, not raw data.
- **Coach confidence**: every recommendation should expose confidence, evidence, uncertainty, risk, and the proposed action.
- **Read broadly, write narrowly**: player attributes/CA/PA stay read-only.
- **World balance over player editing**: controlled changes may target problematic league/club economics such as transfer budget, wage budget, max wage, club balance, or competition reputation.
- **Explainable recommendations**: deterministic scoring engines calculate fit/priority; AI explains and converses over those results.
- **Version-safe runtime access**: write features must be guarded by FM version/build checks and support rollback.

## Planned rooms

- **Manager Room** — today's must-review items, next match, squad risks
- **Matchday Room** — lineup, bench, rotation, minute plan, opponent fit
- **Squad Room** — depth, position health, emergency cover, succession
- **Tactics Room** — in-possession/out-of-possession role fit and chemistry
- **Training Room** — individual training recommendations and change queue
- **Development Room** — youth growth, snapshots, pathway, loan timing
- **Medical Room** — workload, fatigue, injury risk, rest recommendations
- **Recruitment Room** — squad gaps, target profiles, replacement/upgrade search
- **Transfer Room** — sell/loan advisor, market interest, pathway impact
- **Contract Room** — expiry, wage structure, renewal priorities
- **Economy Room** — market inflation monitor and controlled world rebalance
- **AI Coach** — context-aware conversation across every room

## Architecture direction

```text
FM26
 └─ Local Companion / Runtime Plugin
      ├─ Reader
      ├─ Version Guard
      ├─ Snapshot Store
      └─ Safe Writer (whitelist only)
              ↓
        Local Domain API
              ↓
     Analysis / Recommendation Engine
      ├─ Role Fit
      ├─ Rotation Planner
      ├─ Training Advisor
      ├─ Development Advisor
      ├─ Recruitment Advisor
      ├─ Coach Confidence
      └─ World Balance
              ↓
          Manager Room Web
              ↕
            AI Coach
```

## Write policy

### Read-only player data

- CA / PA
- Visible attributes
- Hidden attributes
- Player profile data
- Match and development history

### Candidate controlled writes

- Individual training (only after runtime field mapping is verified)
- Position training (only after runtime field mapping is verified)
- Rest / workload actions (only after runtime field mapping is verified)
- Club transfer budget
- Club wage budget
- Club max wage
- Club balance
- Club / competition reputation

All write operations must support **preview → explicit approval → apply → read-back verification → rollback**.

## Initial milestones

### M0 — Feasibility
- Read FM26 runtime/build information
- Read player and club identifiers
- Read current squad and fixtures
- Locate club finance data
- Capture snapshots without modifying the game

### M1 — Manager Room MVP
- Manager Room dashboard
- Player detail and stat visualization
- Role fit
- Matchday selection
- Rotation planner
- Coach Confidence

### M2 — Player Management
- Training advisor
- Development snapshots
- Playing-time monitoring
- Loan / sell advisor
- Recruitment room

### M3 — World Balance PoC
- Saudi club finance reader
- Market-health metrics
- Rebalance preview
- Whitelisted finance writer
- Read-back verification
- Rollback

## Status

Early research / architecture phase.
