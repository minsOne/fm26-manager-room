# World Balance

World Balance is intended to correct long-save economic distortions without editing player ability.

## Initial target: Saudi market overheating

Candidate metrics:
- Transfer spending share
- Wage inflation
- Financial power vs sporting power gap
- Age profile of imported stars
- Outbound transfer rate
- Top-club concentration

## Candidate controlled fields
- Transfer budget
- Wage budget
- Max wage
- Club balance
- Club reputation
- Competition reputation

## Required workflow

1. Detect anomaly
2. Show evidence
3. Recommend preset
4. Preview exact before/after values
5. Require explicit approval
6. Apply through version-validated writer
7. Read back values
8. Store rollback snapshot

### Implemented review workflow

The real UI accepts scoped actual cash-flow transcriptions, compares like-period/currency samples and same-club wage spending, and exports ±10% managed-finance proposals with in-memory apply/readback/reversal validation. See [decision evidence](decision-evidence.md). These are raw-unit review artifacts; `writeEnabled` is false. There are still zero validated game-write profiles and no real game-file rollback implementation.
