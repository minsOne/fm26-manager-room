# Named-field validation and native snapshot fixes

This increment starts from main `d9a13306b55d6e551574c40ed99cdcae85bd8b45`.
It does not silently merge PR #35 or the macOS reliability branches.

## Correctness boundary

The old aggregate checks remain useful but cannot detect permutations of players or
attribute labels. `tools/verify_snapshot_fields.py` compares the actual emitted
**managed squad** against the pinned fmsave reference by UID and named field.
It checks all 52 attribute names, the 15 uncollapsed position ratings, decoded
personality/hidden values, feet, dates/ages, abilities and range codes, condition/
sharpness, values, available contract fields and availability flags.

This is not a full-world player audit and is not in-game verification. The ID is the
reader's UID, not a claim that every FM identity field has been mapped. Agreement
between two reverse-engineered readers can still reproduce a shared interpretation
error. Keep build coverage and in-game verification as independent release gates.

## Product changes

- Age uses month/day birthdays instead of comparing ordinals from different years.
  Example: 2000-03-01 has ordinal 61; 2037-03-01 has ordinal 60 but the birthday has arrived.
- Hidden attribute values reuse the named attribute map, avoiding a second offset table.
- Add birthDate, ageKnown, paRangeCode, positionRatings, feet and raw fitness observations.
- Add value/wage/personality/fitness availability flags. Schema-2 numeric placeholders
  remain for compatibility; they are not evidence when their Known flag is false.
- Fitness display rounding is explicitly half-up; raw values are exported separately.

## Automated tests

Python comparator regressions deliberately swap players or attributes while keeping
aggregate sums unchanged, corrupt a hidden field, alter known flags, use boolean
numbers, duplicate IDs, remove a player or provide an empty reference. All must fail.
Reports include check counts, field paths and opaque record tokens, not player names,
private paths, raw saves or detailed player values.

Rust regressions cover leap/non-leap birthdays, Feb 29, contract month boundaries,
foot-byte exclusion, named hidden fields, positional deduplication and scaling.

`Snapshot Field Parity` runs the comparator against a public FM26 save on Linux and
macOS. On macOS it additionally starts the real Swift Companion with the native
parser, checks the HTTP snapshot against the native output, then imports an invalid
save in a private test directory and checks that the last good snapshot survives.
The source save must remain unchanged. Only sanitized reports are uploaded; the save
and player snapshot are deleted. Fixture download failure is a failure, not a pass.

The integration harness is restricted to an isolated GitHub macOS runner. It does
not exercise Safari, a running FM process, a personal Mac, the hardened v2 companion
branch, game-state writes, or the future AI provider. Record CI results at their exact
commit, rather than inferring successful integration from a build alone.
