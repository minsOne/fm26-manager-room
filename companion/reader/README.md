# Runtime Reader PoC

This module starts the FM26 runtime-access work with a deliberately small, read-only probe.

## Current scope

```text
FM26 process
  ↓
process discovery
  ↓
module discovery
  ├─ fm.exe
  ├─ GameAssembly.dll
  └─ game_plugin.dll
  ↓
file/product version + SHA-256 fingerprint
  ↓
runtime access policy
```

Unknown builds are **read-only**. Write access remains disabled until a build is explicitly verified.

## Why this comes first

The project eventually wants to read club finances and possibly apply tightly scoped world-balance changes. Hardcoded offsets without build validation are too risky. The first PoC therefore establishes a reproducible build fingerprint before any data offsets are added.

## Run

Requires .NET 8 on Windows.

```bash
dotnet run --project src/Fm26.ManagerRoom.Reader -- probe --pretty
```

Expected output shape:

```json
{
  "processId": 12345,
  "processName": "fm",
  "executable": {
    "name": "fm.exe",
    "fileVersion": "...",
    "sha256": "..."
  },
  "gameAssembly": {
    "name": "GameAssembly.dll",
    "sha256": "..."
  },
  "gamePlugin": {
    "name": "game_plugin.dll",
    "sha256": "..."
  },
  "policy": {
    "mode": "ReadOnly",
    "reason": "Unknown FM26 build fingerprint. Read-only probing is allowed; writes are blocked."
  }
}
```

## Next

1. Verify the probe against a real FM26 process.
2. Add a platform-neutral `IProcessMemoryReader` abstraction.
3. Implement Windows read-only memory access.
4. Independently map club/team pointers.
5. Validate balance / transfer budget / payroll budget against in-game values.
6. Only then research a Safe Writer.

## Clean-room rule

Public FM26 tools are useful evidence that these capabilities are feasible, but runtime offsets and implementation code must be independently validated before entering this repository.
