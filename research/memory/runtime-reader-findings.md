# Runtime Reader Findings — 2026-10-01

## Goal

Determine the safest technical path for reading FM26 data before implementing Manager Room features or a World Balance writer.

## What existing public projects demonstrate

### FMSuperScout
- Uses an in-game BepInEx / IL2CPP plugin plus a local web app.
- Detects `GameAssembly.dll` and `game_plugin.dll`.
- Scans memory for FM database objects and validates candidate player records with CA/PA ranges.
- Uses build/version checks and notes that the native database module may load after the BepInEx chainloader.
- Explicitly states that its game-memory behavior is read-only.

### FM AI Assistent
- Uses external process readers on Windows and Linux.
- Loads player, staff, club and competition data from RAM into an atomic local snapshot.
- Demonstrates that club data can include reputation, nation, balance, transfer budget, payroll budget and facilities.
- Uses build-gated root/offset profiles and a managed-club pointer chain.

## Important feasibility result

Club financial data is demonstrably readable from the FM26 runtime. That is enough to justify the Manager Room architecture:

```text
FM26
  ↓ read-only first
Runtime Reader
  ↓
Local Snapshot
  ↓
Manager Room / Economy Room
```

The Saudi World Balance feature does **not** require player ability editing.

## Architecture decision

Start with an **external read-only companion** rather than an injected writer.

Reasons:
1. Easier failure isolation.
2. Clear OS-level permission boundary.
3. Unknown FM builds can fail closed.
4. The same domain/API can later accept an optional in-process adapter if needed.
5. A writer can be added only for verified, whitelisted world-balance fields.

## Clean-room policy

- Do not copy third-party reverse-engineered source into this repository unless its license and reuse terms are explicit and compatible.
- Treat public code as feasibility/research evidence.
- Independently reproduce addresses/field mappings against our own FM26 build and test saves.
- Store build-specific mappings as data profiles, not scattered constants.

## Immediate PoC

The first code under `companion/reader` performs:

- FM26 process discovery
- module discovery
- file/product version capture
- SHA-256 fingerprinting
- runtime policy evaluation

The verified-write profile list intentionally starts empty.

## Next experiment

On a machine running FM26:

1. Load a save.
2. Run `fm26-reader probe --pretty`.
3. Record executable, `GameAssembly.dll`, and `game_plugin.dll` hashes.
4. Confirm the game plugin is only visible after the save/database is loaded.
5. Store the output as a local research artifact (do not commit user-specific paths).
6. Implement read-only process memory access for that build.
