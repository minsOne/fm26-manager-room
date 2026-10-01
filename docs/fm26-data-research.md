# FM26 Data Research

Research questions:

- What stable identifiers exist for players, clubs, competitions, and fixtures?
- Which runtime objects expose finance data?
- Can current fitness/fatigue, agreed playing time, and training state be read reliably?
- Which values are saved vs runtime-only?
- What changes between FM26 builds?
- Can world-balance finance fields be modified safely through game-owned setters/methods rather than raw offset writes?

## Rule

Do not implement a writer from an inferred offset until a version guard, read-back verification, and rollback path exist.
