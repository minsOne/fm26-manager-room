# Architecture

## Layers

### 1. Runtime / Save Data Access
Responsible for reading FM26 data, build detection, snapshots, and optional guarded writes.

### 2. Domain
Stable models for Player, Club, Competition, Fixture, Contract, TrainingState, Recommendation, Confidence, and WorldBalance.

### 3. Analysis Engine
Deterministic scoring and recommendation logic. AI should not be the source of truth for numeric scoring.

### 4. Web UI
Decision-first Manager Room interface.

### 5. AI Coach
Natural-language orchestration over domain tools and analysis results.

## Safety model for writes

```text
Unsupported build -> READ ONLY
Supported build   -> Preview required
Preview           -> Explicit approval
Apply             -> Read-back verification
Verification fail -> Rollback
```
