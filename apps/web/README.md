# Manager Room Web

Static, build-free ES-module frontend for FM26 Manager Room.

## Real save UI

`index.html` reads the local macOS Companion (`http://127.0.0.1:8765` by
default). Connection failures never substitute demo data. A failed import
retains the previous snapshot with a stale warning; a new career requires
explicit acceptance.

Verified inputs support player observations, role-fit comparison, squad depth,
recruitment gap review, guarded Matchday assignment, positional bench coverage
and schedule-aware rotation review. Matchday offers Best XI, Balanced,
Development and Protect Key Players modes for up to five fixtures.
Fixture-specific hard starter locks and rest directives constrain XI/bench selection.
Conflicts require explicit resolution and defer subsequent rotation plans.

Role Fit and workload-adjusted selection utility are separate. Planned starter
reservations are explicitly hypothetical 90-minute blocks, not observed minutes,
fatigue predictions or medical minute caps. Missing injury/eligibility/history
inputs and unverified competition rules keep final decisions deferred.

See [rotation methodology and limits](../../docs/schedule-aware-rotation.md).
Training, medical, development, finance and AI screens show available observations
and limitations; their presence does not imply production-ready recommendations
or external AI integration. Game writes remain disabled.

## Demo

`demo.html` uses `data/mockSnapshot.js` to illustrate the broader product goals.
It never reads the real Bridge. Its recommendations and numbers are examples.

## Local preview

```bash
cd apps/web
python3 -m http.server 8080
```

Open http://127.0.0.1:8080 with the Companion running. Use `demo.html` explicitly
when you want sample data.

## Test

```bash
npm test
npm run check
```
