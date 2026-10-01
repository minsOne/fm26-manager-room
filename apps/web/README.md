# Manager Room Web

Static, build-free ES-module frontend for the FM26 Manager Room.

## Implemented screens

- Manager Room / action center
- Matchday lineup, bench optimizer and minute plan
- Squad depth / position health / succession
- Tactics formation + In/Out of Possession role editor
- Training advisor
- Development and loan planning
- Medical workload board
- Recruitment priorities / targets / upgrade finder / shadow squad
- Transfer advisor
- Contract risks
- Economy / Saudi World Balance preview
- Reports / confidence calibration / decision journal
- AI Coach
- Manager philosophy and macOS Bridge settings
- Player detail modal with CA/PA, hidden attributes, role fits and training recommendation

## Data source

The UI first tries the local macOS companion at:

```
http://127.0.0.1:8765/api/snapshot
```

If unavailable, the app falls back to `data/mockSnapshot.js`.

## Local preview

```bash
cd apps/web
python3 -m http.server 8080
```

Then open http://127.0.0.1:8080.

## Test

```bash
npm test
npm run check
```
