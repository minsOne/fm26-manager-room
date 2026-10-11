# Saved lineup research on the local Mac

Observed 2026-10-11. **A copy-only active-GK swap was applied and restored in FM.**
The web/Companion recommendation feature remains unavailable; this controlled
experiment is not a general supported save writer. Latest results are below.

## Evidence

- The running process points to the Steam `Football Manager 26/fm.app` bundle.
  Its `CFBundleShortVersionString` is **26.3.2.2329565**, unlike the earlier
  user-reported 26.2.0. The in-game build screen has not been verified; do not
  advertise this investigation as 26.2.0 compatibility.
- Local FM data is present under
  `~/Library/Application Support/Sports Interactive/Football Manager 26` and
  `~/Public/Sports Interactive/Football Manager 26`. The standard Documents
  location is absent. The Application Support folder contains a self-referencing
  `FM26 -> FM26` symlink; the probe records it without following it.
- `TacticTeamSelectionTableViewCollection*/…선발 정보.json` stores table column
  configuration (`m_tableConfig`, column IDs and widths), not the saved XI.
- The newest local save at capture time was `games/last save overwrite backup.fm`.
  Decompressing its indexed `tactics_man.dat` section read-only found both
  `ManagerRoom-Test` and `ManagerRoom-Test-2`. Three older saves inspected did
  not contain these names in that section. No conclusion about all other saves
  or unlisted frames follows from this limited search.
- The exact observed name prefix is byte `03`, a little-endian UTF-8 byte length,
  then the name. The two records suggest 26 following little-endian 32-bit words:
  20 populated references and six `ffffffff` values in each sample.
- Joining populated words to **player `pindex + 1`** yields exactly one player
  UID/name for each of the 20 entries in both samples, all in the managed squad.
  Joining directly to `pindex` produces unrelated players and is rejected as a
  working hypothesis. The first 11 / following 9 arrangement is plausible but
  has not been verified by loading each saved selection in the game.
- The two selections change multiple players. They are **not** a controlled
  one-player differential pair. Record size, empty sentinel, slot order,
  formation scope, record ownership and cross-build behavior remain unverified.
- FM's Accessibility tree exposes only the window and menu bar. A team-selection
  screenshot is available, but attempted menu clicks return
  `noWindowsAvailable`; a later attempt after screenshot recovery also failed.
  No selection was applied or game progression triggered.

### Follow-up after the user brought FM to the foreground

The window now has native close/full-screen/minimize controls and screenshot-
grounded menu clicks work. The earlier `noWindowsAvailable` error is no longer
the active blocker. The AX tree still does not expose in-game player controls.

On the pre-match team-selection screen, **Team Lineup Management → Manage
Selections** is greyed out and clicking it has no effect. **Save Team Selection**
opens a naming dialog. A preservation save named `ManagerRoom-Before-20261011`
was submitted, but its existence has not yet been confirmed by reloading or a
full-game save; do not count it as a verified rollback. Typing into the dialog
also navigated the background to the news page, so future text entry needs
explicit focus/readback verification. Returning via Back showed the original XI
and nine substitutes still selected.

The subsequent filesystem capture shows only the FM breadcrumb and preferences
plist changed; no `.fm` file changed and no standalone selection file appeared
within the scanned roots. This does not prove when named selections persist.
The next step is to open the normal tactics screen without progressing the match
and check whether saved-selection management is enabled there. No XI was changed.

Private captures stay under ignored `local-data/lineup-probe/`. Do not commit
user saves, names, complete inventories, or screenshots to public research notes.

## Reproduce the read-only investigation

Capture to a location outside every scanned root. Hashes are streamed, links are
not traversed, access errors are retained, and files changing during capture are
reported as errors rather than accepted as stable evidence.

```bash
mkdir -p local-data/lineup-probe
python3 tools/lineup_storage_probe.py capture \
  --app "$HOME/Library/Application Support/Steam/steamapps/common/Football Manager 26/fm.app" \
  > local-data/lineup-probe/before.json
# Save a named selection through FM, then capture after.json with the same command.
python3 tools/lineup_storage_probe.py diff \
  local-data/lineup-probe/before.json local-data/lineup-probe/after.json
```

Use repeated `--root` arguments for verified custom FM locations. Defaults are
FM-specific Application Support, Documents, Public and the FM preferences plist;
they do not search the entire home, Steam Cloud, or other applications' data.
A diff lists candidates, not proof that a changed file stores lineups. Missing
files can reflect access failure; inspect errors and `incomplete`.

The native research command reads an exact named candidate record and reports
UID/name joins, preserving ambiguity rather than matching by player name:

```bash
cargo run --manifest-path native/fm26-parser/Cargo.toml -- \
  lineup-research '/absolute/path/to/save.fm' 'ManagerRoom-Test'
```

Its output always declares `lineupFormatVerified: false`,
`slotMappingVerified: false` and `writeSupported: false`. The observed 26-word
extent is a research hypothesis. Offsets are diagnostics, never writable targets.
This command is not attached to the web UI or Companion application endpoint.

## Gate for continuing direct application

1. Restore functional FM UI control and confirm the intended game build.
2. Load both existing named selections through FM and compare the displayed
   XI/bench to the candidate UID sequence. Preserve the original live selection.
3. Save a controlled pair with exactly one player swap and separately observe
   named-selection save vs full-game save. Back up originals before each test.
4. Establish a game-owned import/UI route, or a fully validated versioned file
   format with reload, readback and rollback. Never write inferred offsets.
5. Bind the proposed XI/bench to career, snapshot, formation and verified UIDs,
   show the preview, apply, then read the actual game selection back. Report
   partial failure explicitly. Do not change attributes, CA/PA, hidden values,
   roles or match results, or invoke match progression.

## Explicitly authorized copy-only experiment

After the user authorized a save-copy experiment, `tools/experiment_lineup_copy.py`
was added. This is an isolated research exception to the no-inferred-offset-write
rule above, not a supported writer profile or permission to alter the original.
It swaps two references in one exact named selection with the observed
20-populated/6-empty layout. It rejects ambiguous names, invalid/duplicate player
joins, overlapping section extents, incomplete directory parsing, changed source
hashes and existing output paths. The source and the running process are never
opened for writing.

The root directory contains 222 entries plus a nested `rgman` directory with
1,153 entries: **1,375 total** in this sample. Recompression changes frame length,
so the experiment updates subsequent relative offsets throughout both levels,
the tactics compressed length and the header's trailer pointer. All other raw
directory bytes, header bytes and non-tactics body bytes are preserved, including
unlisted body data. The resulting container is independently read back.

Local result:

- Preserved source: `local-data/lineup-experiment/original.fm`.
- Candidate: `local-data/lineup-experiment/ManagerRoom-Experiment-GK-Swap.fm`.
- `ManagerRoom-Test` word 0 and word 11 were swapped: Donnarumma / Trafford.
  These are candidate starter-GK / first-bench slots, pending in-game verification.
- Exactly four bytes differ in the decompressed tactics section; no other
  decompressed tactics bytes differ. Every other compressed entry and all unlisted
  body bytes remain identical. The original local game's file hash is unchanged.
- Full native snapshot JSON before/after is byte-identical, and named-selection
  readback changes only the two intended UID references. This is stronger file
  evidence than checking only visible ability fields, but is not game-load proof.
- All 38 Python tests passed, including seven new reconstruction/guard tests.
- The candidate has **not been loaded in FM**, and the current live XI has not
  changed. The user was asked to save current live progress to a new
  `ManagerRoom-Before-Experiment.fm` before any reload, to prevent unsaved-progress
  loss. Original saves must remain available for rollback.

Requirements: existing native parser build and the installed `zstd` CLI. No new
dependencies were added. Example (substitute the reviewed source's actual hash):

```bash
python3 tools/experiment_lineup_copy.py \
  local-data/lineup-experiment/original.fm \
  local-data/lineup-experiment/new-candidate.fm \
  --source-sha256 '<reviewed-original-sha256>' \
  --saved-name ManagerRoom-Test --swap 0 11 \
  --reader native/fm26-parser/target/debug/fm26-manager-room-parser
```

The JSON report includes hashes and explicit `gameLoadVerified: false` /
`liveSelectionApplied: false`. Never equate successful reconstruction with direct
application. Loading this file will restore the source save's game date/state,
which may precede the currently running game's unsaved progress.

## Verification for this increment

- Python inventory/diff regression tests include same-size content changes,
  inaccessible paths, symlink loops, mismatched scopes and concurrent mutation.
- Native tests cover UTF-8 exact names, duplicate matches, truncation and invalid
  names. Local read-only runs resolve both existing named records.
- Validation: 241 web tests, 31 Python tests and 16 Rust tests passed; web syntax
  checks and `git diff --check` passed. Clippy completed with existing warnings
  elsewhere in the parser; the new research module has none.
- The before/after inventory has identical content hashes for all 390 captured
  files, including all nine local `.fm` saves. Game file contents were unchanged.
- These tests do not establish a writable format or successful game application.

## Subsequent in-game validation: active lineup and rollback

This supersedes the earlier UI-blocker and not-yet-loaded status above.

1. Repeated Back navigation reached the normal Portal. The settings gear exposes
   Save As and Load Game. Saved current progress to a new
   `ManagerRoom-Before-Experiment.fm`, then preserved a local copy.
2. Built `ManagerRoom-Current-GK-Swap.fm` from that baseline, changing only the
   named `ManagerRoom-Test` selection. FM loaded it successfully, but the active
   GK remained Donnarumma. Named-selection edits alone do not apply the live XI.
3. In that experimental session, selected Trafford through the GK player menu.
   The screen showed Trafford at GK and Donnarumma at S1. Saved a separate
   `ManagerRoom-UI-GK-Swap.fm` as a controlled observation.
4. The tactics sections differ at exactly four bytes in two 32-bit references,
   44 bytes apart (indices 0 and 11). Two copies of the same 26-reference list
   exist; only one changes in the controlled observation. Other sections also
   change during FM's own load/save cycle; none of those changes are replayed.
5. `tools/experiment_active_lineup_copy.py` requires both source hashes and the
   expected list. It accepts only a unique exact two-reference differential,
   rejecting extra tactics changes and existing output files. It reuses the
   complete container reconstruction and unchanged-body verification.
6. Loaded its `ManagerRoom-Active-GK-Swap.fm` output in FM. Without further player
   selection clicks, the tactics screen showed **Trafford GK / Donnarumma S1**;
   the other ten starters and remaining substitutes were unchanged.
7. Reloaded `ManagerRoom-Before-Experiment.fm`. The tactics screen showed
   **Donnarumma GK / Trafford S1**, the original XI and nine substitutes. The
   application was left on this restored normal tactics screen. No match was
   entered or progressed; the game date remained unchanged.

Verification and limits:

- Installed bundle is `26.3.2.2329565`; this does not establish 26.2.0 support.
- The active experiment inherits the earlier named-selection edit and adds only
  the observed active swap. It is not the untouched baseline.
- All 1,375 directory entries are checked. Generated copies preserve all other
  compressed sections and unlisted body bytes. Only the intended tactics bytes
  and necessary compression/directory metadata change.
- Native snapshot JSON from the untouched current baseline, named-swap candidate
  and active-swap candidate is byte-identical. Ability and result data were not
  modified by the writer.
- The original save and `ManagerRoom-Before-Experiment.fm` still match their
  preserved backup hashes. No existing user save was overwritten.
- All 42 Python tests passed; Python syntax and `git diff --check` passed.
- Private evidence remains in ignored `local-data/lineup-experiment/`. The three
  named experimental saves remain in the game saves folder alongside the backup.
- Remaining product work: structural build/owner identification on independent
  saves, all 11+bench UID/slot validation, recommendation preview integration,
  stale-snapshot rejection, and product readback/rollback reporting. Never
  hard-code the observed sample offsets as production addresses.


## 경기 준비 제품 연결 및 전체 명단 로드 검증 (2026-10-11)

경기 준비의 4-2-3-1 추천, 기존 선발 고정/휴식 조건, 벤치 9명을 미리보기와 새 파일 생성에 연결했다.
실제 브라우저 버튼 → 토큰/커리어 범위 검사 → 일회용 미리보기 → Python 복사본 생성 경로를 실행했다.
출력 SHA256은 `773e462df15d3152d19488280a12d738d261810d787a183cbd182b4172919999`.
선발 참조 30바이트가 바뀌었으며 나머지 1,374개 압축 항목과 미등재 본문은 동일했다.
전체 파서 스냅샷(선수 능력치, hidden, 출전/경기 이력 포함)도 원본과 동일했다.

생성 파일을 `ManagerRoom-Product-Lineup.fm`이라는 별도 사본으로 게임 폴더에 넣고 FM에서 불러왔다.
전술 화면의 XI: Donnarumma, Lewis, Dias, Stones, Gvardiol, Rodri, Wharton,
Bernardo Silva(RW), Foden(AM), Savinho, Haaland. 벤치 S1..S9: Marmoush, Trafford,
Guéhi, Cherki, Doku, Semenyo, Nico González, Khusanov, Rigg. 모두 미리보기와 일치했다.
경기 진행/결과 확정 없이 확인했다. FM은 선수별 기존 역할을 화면에 표시하므로 역할은 게임에서 확인한다.
이 증거는 해당 파일에 한정되며 모든 FM26 저장본이나 새 저장을 지원한다는 뜻이 아니다.
검증 후 `ManagerRoom-Before-Experiment.fm`을 다시 불러와 Cherki/Semenyo가 포함된 원래 XI와 Trafford S1을 확인했다.
원본과 최초 백업의 SHA256도 최초 값과 동일했다.
