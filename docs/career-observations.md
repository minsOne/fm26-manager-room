# Career observations and new games

The real UI retains small observations locally in this browser: player UID, CA and
available named attributes, one latest observation per game date. It stores no save
file, wages or player names in the observation archive and sends nothing externally.
Review journals additionally retain fixture/slot/player IDs, a copy of missing evidence and a manual assessment, with up to 30 drafts per segment. This is a browser feature, not a change to the native snapshot or save format.

## Identity and lifecycle

A persisted Companion selection ID (or an explicit snapshot save ID) is required.
The archive also separates Bridge origin, managed club and manager. Save-name-only
fallbacks are insufficient to accumulate growth history. Ordinary same-career
refreshes preserve controls. Accepting a different career clears selected players,
search, formation, mode, fixture locks/rests, minute plans and manual rules.

If the game date goes backwards, or source/database/build metadata changes, the UI
holds the incoming snapshot for explicit acceptance. Acceptance creates a separate
observation segment; it never interprets a rollback as loss of development. This
also works after page reload by checking the persisted archive. A same-file new
game with identical manager/date cannot be inferred reliably: use the explicit
new-career command instead of relying on automatic detection.

```bash
manager-room stop
manager-room select-save "/path/to/New Career.fm" --new-career
manager-room start
```

`--new-career` forces a fresh selection UUID even at the same path. Selecting the
same file without that flag preserves the UUID. Changing a managed service's
selection remains forbidden until stopped. Cancelling the picker or selecting an
invalid file retains the current selection. New careers with no decoded upcoming
fixtures can still display the squad; match plans remain deferred.

The settings action “새 관측 구간 시작 · 경기 지정 초기화” creates a new local
baseline and clears browser directives. It does not alter the Companion selection
or game file. Previous segments are retained within the bounds below.

## Persistence and limits

Each Bridge has one versioned localStorage value, committed with one setItem.
The archive retains at most eight career/branch segments, up to 60 observed dates
per segment, and 3 MiB in serialized UTF-8. Old segments then old dates are pruned
under pressure; the current segment is protected. An individually oversized
observation is deferred without deleting prior records. These are sampled records,
not full match histories or a complete growth timeline.

Corrupt or oversized saved archives are not overwritten: the app warns and uses
session memory. Storage access/quota failures are visible and never hide the live
snapshot. Private browsing, clearing site data, changing origins and different
browsers/devices affect availability. No cloud sync or portable history import is
claimed. Parser failures/in-progress imports or missing parser status do not add
observations. A supported parser mapping change must increment the archive format
or provide independently validated migration; database version is not proof of
field semantics.

## Review features

Growth compares the earliest/latest retained observations of the same UID and
segment across distinct dates, including only attributes known at both endpoints.
Zero CA change is not stagnation; CA movement is not proof of training causality.
Missing players are not interpreted as zero CA or a transfer.

Training lists up to three low observed attributes within the player's best
supported role's core attributes. This uses the documented Manager Room heuristic,
not an FM focus catalogue or a training intensity/medical prescription. External
candidate comparisons use only supplied candidates and compare role fit against
internal backups; missing costs, offers and eligibility remain unknown. Reports
aggregate only comparable players. The Coach briefing is deterministic local
text, explicitly not a connected external AI model.

## Evidence

Node regressions cover lineage, rollback/reload, version splits, same-day
replacement, quota/corruption/retention, nulls, session gating, source immutability
and review/UI correctness. Synthetic browser tests advance dates and switch
careers. Real-save Chromium/WebKit tests preserve one-day observations across
reimport and reload, without altering dates or manufacturing growth from the
public save. CLI lifecycle tests verify a new UUID at the same path.

## Review journal

The matchday “현재 검토 계획 보관” action stores the displayed valid draft in the current observation segment, including unresolved evidence. It does not record an executed game action or match result. Reports allow “미평가 / 검토에 도움됨 / 보완 필요” as subjective feedback; no accuracy or success percentage is computed. Journals survive reload, remain separate on a new career/branch, and share archive capacity/error handling.
