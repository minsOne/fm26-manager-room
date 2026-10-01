# Rust managed-club Quick Snapshot — 2026-10-01

## Result

The native Rust parser now produces a managed-club player snapshot directly from a real FM26
`.fm` save, without the Python conversion step in the runtime path.

Public FC St. Helens test save:

- save: 229.5 MiB
- players in database: 38,209
- managed club: FC St. Helens
- managed players emitted: **60**
- managed CA sum: **5,131**
- managed current wage sum: **321,195**
- source: `rust-native`

The CI compares the generated JSON against the MIT `fmsave` reference and asserts:

- managed club UID
- managed club name
- manager name
- managed player count
- managed player UID sum
- managed CA sum
- managed wage sum
- managed player-name hash

All checks pass on the public real save.

## Native data currently included

For each managed player:

- uid
- display name
- age
- nation id
- positions
- CA / PA and PA-known flag
- transfer value
- current weekly wage
- 52 scaled player attributes
- eight personality attributes
- consistency / important matches / injury proneness / versatility / dirtiness
- condition
- match sharpness
- current contract end
- months remaining
- squad-status raw code and label

## Performance context

On the same CI run:

- Python `fmsave.players()`: **~7.87 s**
- Rust player/person/club/contract semantic core: **~0.516 s**

This is not yet the complete Manager Room snapshot. Fixtures, recent-match minutes and finances
remain separate native milestones.

## Next

1. Native fixture reader for next-match and schedule planning.
2. Native player-match-history reader for recent 14-day / last-five minutes.
3. Native finance reader for Economy / Saudi market health.
4. Emit the final Manager Room snapshot schema directly from Rust.
5. Wire the Swift macOS companion to execute/use the native parser.
