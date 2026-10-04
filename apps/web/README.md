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
Fixture-specific hard starter locks, rest directives, minute caps and scheduled
substitutions constrain XI/bench selection. Short caps trigger verified replacement
review; insufficient replacement coverage defers subsequent plans.
Conflicts require explicit resolution and defer subsequent rotation plans.

Player details show retained dated match records with unknown minutes preserved.
Matchday recomputes an exact 14-calendar-date window ending on each fixture, keeps
planned minutes separate, and defers ambiguous/invalid history arithmetic. Complete
coverage and game-screen minute interpretation remain unverified.

Role Fit and workload-adjusted selection utility are separate. Planned starter
and substitute reservations split a hypothetical 90-minute scenario, not observed minutes,
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

### 경기별 규정 입력

경기 준비 화면에서 FM 규칙 화면의 벤치 등록·교체 선수 한도를 수동 입력할 수 있습니다.
빈칸은 미확인, 0은 허용 없음입니다. 입력 한도 초과 시 해당 경기와 이후 경기의
출전분 예약을 보류합니다. 입력은 선택한 경기의 브라우저 세션에만 적용됩니다.
검토 벤치는 최대 9명이며, 선수별 등록 자격·교체 횟수·연장 등은 별도 확인이 필요합니다.
세이브에서 자동 확인된 규정으로 표시하지 않습니다.
