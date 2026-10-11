# 로컬 Codex 인수인계 — FM26 Manager Room

작성: 2026-10-11 (Asia/Seoul). 이 문서는 해당 시점의 인수인계 기록이다.
작업 시작 시 현재 코드와 Git 상태를 다시 확인한다.

후속 로컬 조사: [선발 저장 위치 연구](lineup-storage-research.md).
설치 번들은 26.3.2.2329565였으며, 최신 백업 세이브의 `tactics_man` 섹션에서
두 테스트 명단과 선수 참조 후보를 찾았다. 읽기 전용 조사 명령이 추가되었지만
이후 복사본 실험에서 현재 선발 GK/S1의 게임 기반 대조를 확보했다.
수정본을 FM에서 불러와 트래퍼드 GK / 도나룸마 S1을 확인하고,
`ManagerRoom-Before-Experiment.fm`을 재로드해 원래 선발·후보로 복원했다.
경기 준비 탭에 추천 XI+벤치 미리보기/새 세이브 생성이 연결되었다.
검증한 원본 SHA256 하나와 4-2-3-1만 지원하며 샘플 오프셋을 일반화하지 않는다.
생성된 파일은 FM에서 직접 불러와야 하며 실행 중인 게임에는 자동 적용하지 않는다.

## 바로 이어갈 작업

사용자의 최우선 미완료 요청은 **경기 준비의 추천 선발을 FM26에 직접 적용**하는 기능이다.
사용자 Mac에서 저장 명단의 실제 저장 위치/형식과 UI 접근성을 조사한다.
제한된 원본에 대한 복사본 생성은 구현되었다. 새로운 저장본·포메이션 지원은 추가 구조 검증이 필요하다.
JSON 내보내기나 파일 생성 성공을 게임 적용 성공으로 보고하지 않는다.

1. `git status --short`와 최신 main을 확인하고 사용자 로컬 변경을 보존한다.
2. 이 문서와 [잔여 작업](remaining-work.md), [Mac 검증](macos-validation.md),
   [데이터 연구](fm26-data-research.md), [writer 현황](../companion/writer/README.md)을 읽는다.
3. 실행 중인 FM의 실제 앱 경로, 버전/빌드, 저장 경로를 읽기 전용으로 확인한다.
4. 아래 조사 기록을 바탕으로 저장 명단 파일 또는 macOS 접근성 요소를 확인한다.
5. 검증 가능한 경로가 확보되면 선발 적용을 구현하고 실제 화면에서 결과를 읽어 검증한다.

## 기준 코드와 완료 사항

기준 main: `a5862abb255bc8fc93f9a7a11e0d481c76c192cf` (PR #72 병합).
이 문서 자체의 후속 커밋은 위 기준에 포함되지 않는다.

- [PR #70](https://github.com/minsOne/fm26-manager-room/pull/70):
  Companion의 ChatGPT 로그인, Keychain 계정, 모델 선택, 명시적 미리보기/전송.
  실제 사용자 계정 로그인·토큰 갱신·응답 수신은 별도 실기 검증 필요.
- [PR #71](https://github.com/minsOne/fm26-manager-room/pull/71):
  게임 화면에서 옮겨 적은 근거 JSON, 훈련/이적/결과/재정 검토.
  자동 추출이나 게임 쓰기 기능으로 오해하지 말 것.
- [PR #72](https://github.com/minsOne/fm26-manager-room/pull/72):
  부하 검토는 1군 기본, 2군·유스 및 소속 미확인은 선택 표시.
  훈련/선수단 CA·PA 오름차순/내림차순, 선수 목록 나이, 능력치·역할 한국어 표시.
  선수단 1군/2군/유스/미확인 분류, 포지션 필터, 추천 역할 최대 3순위.
- Rust 읽기 → Swift Companion → 로컬 HTTP → 웹 UI, 새 게임/관측 분기,
  설치/start/stop/doctor, 관측 보관·복원 기능은 구현되어 있다.

주의할 동작:
- teamSlot 0은 1군. 그 외 슬롯만으로 2군/유스를 확정하지 않는다.
  UI에서 비1군 teamId를 한 번 분류하며 커리어/관측 분기별로 보관한다.
- 역할 점수는 현재 관측 능력치 기반 자체 평가다. FM 공식 역할 점수가 아니다.
  지원 역할이 2개인 포지션에는 3순위를 만들어 넣지 않는다.
- 현재 역할 평가는 단일 역할 모델이다. FM26 화면의 공 소유/미소유 역할을
  각각 모델링한 완성된 전술 평가로 간주하면 안 된다.
- 실제 선발 적용, 의료/피로의 검증된 자동 추출, 공식 참가 자격 매핑,
  게임에 대한 World Balance 쓰기는 미완료다.

## FM26 선발 명단 조사 — 확인된 사실

사용자가 보고한 버전은 **26.2.0**. 정확한 추가 빌드 번호는 미확인.
Mac에서 게임을 실행하며 팀 선발 화면을 제공했다.

화면 관측:
- 전술: 4-2-3-1 DM AM 넓게. 선발 11명, 후보 S1–S9가 보인다.
- 선수별 드롭다운과 공 소유 시 역할/공 미소유 시 역할이 별도로 존재한다.
- 빠른 선발 메뉴: 제한 없이 선발, 로테이션 선수단 선발,
  유소년 유망주 선발, 팀 라인업 관리, 역할 선택, 초기화.
- 팀 라인업 관리 하위 메뉴: **팀 선발 명단 저장**, **선발 명단 관리**.
  최초 캡처에서 후자는 비활성화였다.
- 사용자는 `ManagerRoom-Test`를 저장했다.
  같은 이름으로 재시도한 화면에서 “파일 덮어쓰기 / 파일은 이미 있습니다”가 표시됐다.
- 이어 `ManagerRoom-Test-2`로 저장하도록 안내했다.
  해당 작업 뒤 사용자가 제공한 변경 파일 검색 결과에는 FM 관련 파일로
  `~/Library/Application Support/Sports Interactive/Football Manager 26/backtrace/bt-breadcrumbs-0`
  하나만 보였다. 이 파일을 명단 데이터라고 볼 근거는 없다.
- 홈 디렉터리의 `*ManagerRoom-Test*` 파일명 검색은 결과가 없었다.
- 변경 파일 검색 범위는 Documents, Library/Application Support,
  Library/Preferences, Library/Containers였다.
  에러 출력을 숨겼으므로 접근 거부가 있었는지는 확인하지 못했다.
- 이후 게임 전체 저장 후 재검색을 안내했지만 그 결과는 아직 받지 못했다.
- 실제 명단 파일은 전달받지 못했다. 이미지 자료는 대화 첨부였으며 저장소에 없다.

**확정하지 않은 내용**:
저장 명단이 메모리/세이브 내부인지, 별도 파일인지, 다른 위치에 있는지,
종료/전체 저장 시 기록되는지는 모른다. “파일”이라는 UI 표현과 검색 실패만으로
어느 방식을 확정하지 않는다. 외부 명단 가져오기 기능도 아직 확인하지 못했다.

## 로컬 조사 방법과 완료 조건

우선 반복 스크린샷 요청보다 로컬 읽기 전용 진단으로 진행한다.

- 실제 사용자 데이터 경로와 권한 오류를 확인한다. 전역 검색 결과를 통째로 공유하거나
  브라우저 쿠키·다른 앱 DB를 수집하지 않는다.
- 명단 저장 전후 FM 관련 파일의 시간/크기/해시를 비교한다.
  필요하면 사용자가 게임 전체 저장을 수행한 전후도 구분하여 조사한다.
- 파일 발견 시 원본을 보존하고 복사본의 형식/선수 ID/슬롯을 분석한다.
  최소 두 명단(선수 한 명만 변경)의 차이와 게임 자체 재불러오기로 의미를 검증한다.
- 파일 경로가 성립하지 않으면 macOS Accessibility의 읽기 전용 트리 조사부터 한다.
  로컬 Codex라는 이유만으로 화면 제어/접근성 권한이 있다고 가정하지 않는다.
  권한은 정상적인 시스템 절차로 부여하며 우회하지 않는다.
- 선수 이름만으로 동명이인을 매칭하지 않는다. 가능하면 검증된 ID와 슬롯을 사용한다.
- 적용 대상 선발/벤치를 미리 보여주고 현재 커리어/관측과 결합한다.
  역할 변경은 공 소유/미소유 구분을 확인한 뒤 별도로 다룬다.
- 실제 적용 후 FM 화면/검증된 읽기 경로로 선발을 재확인해야 성공 처리한다.
  부분 실패 시 상태를 설명하고 검증된 되돌리기 수단을 제공한다.
- 화면 좌표만으로 무조건 클릭하거나 추측한 세이브 오프셋을 쓰지 않는다.
  “경기로 이동”, “즉석 결과”를 자동 실행하지 않는다.

사용자는 push → PR → CI → main 병합과 추천 선발 직접 적용 개발을 이미 승인했다.
일반적인 진행 승인을 다시 요청할 필요는 없다. 단, 선수 CA/PA, 능력치,
히든 능력치와 경기 결과는 수정하지 않는다. 별도의 World Balance 게임 쓰기는
검증된 프로필/미리보기/읽기 재검증/롤백 및 해당 쓰기 승인이 필요한 별도 범위다.

## 코드 위치

| 영역 | 시작 파일/폴더 |
| --- | --- |
| 실제 데이터 UI/이벤트 | `apps/web/previewView.js`, `apps/web/preview.js` |
| 소속 분류·정렬·포지션 | `apps/web/engine/rosterDisplay.js` |
| 한국어 표시 | `apps/web/engine/koreanLabels.js` |
| 역할 평가 | `apps/web/engine/realRoleFit.js` |
| 경기 준비/로테이션 | `apps/web/engine/realMatchday.js`, `apps/web/engine/realRotation.js` |
| 커리어/관측 | `apps/web/engine/snapshotSession.js`, `apps/web/engine/realSnapshot.js` |
| 수동 근거 검토 | `apps/web/engine/decisionEvidence.js`, `apps/web/engine/evidenceReviews.js` |
| macOS 앱/인증 | `companion/macos/Sources/ManagerRoomCompanion/` |
| 네이티브 파서 | `native/fm26-parser/` |
| 통합 검증 | `tools/test_integrated_manager_room.py`, `tools/test_real_preview.py` |

## 기존 검증 결과와 실기 한계

PR #72 최종 head `04ecfadc4e982ce4f3b46e3d357e8d4155eaad98`에서:
- Node 테스트 241개, Python 필드 감사 테스트 25개 통과.
- Web App CI, Real Data Preview CI, Rust Parser CI, macOS Release Package,
  macOS Install CI, Snapshot Field Parity, Integrated Manager Room 모두 성공.
- 통합 검증은 공개 FM 세이브, 고정 reference와 필드 대조, Swift 빌드/HTTP,
  Chromium/WebKit을 포함한다.
- 병합 후 Pages 배포 run `38110515257` 성공.
- 이것은 사용자 Mac의 FM26 26.2.0 UI 조작이나 실제 계정 인증 성공 증거가 아니다.

검증 명령은 변경 범위에 맞춰 실행한다:

```bash
npm --prefix apps/web run check
npm --prefix apps/web test
python3 -m unittest discover -s tools/tests -p 'test_snapshot_field_audit.py' -v
cargo test --manifest-path native/fm26-parser/Cargo.toml
swift build --package-path companion/macos
```

## 사용자 Mac 설치 참고

기존 저장소 폴더에서 최신 코드를 받고 설치:

```bash
git pull --ff-only
./install.sh
"$HOME/.local/bin/manager-room" start
```

필요 시 `manager-room select-save`, `manager-room doctor --deep --online` 사용.
새 게임을 같은 경로에 저장했다면 stop 후 select-save의 `--new-career` 옵션을 사용한다.
자세한 명령은 [README](../README.md)와 현재 CLI 도움말을 확인한다.

이전 설치 중 bash/zsh에서 Cargo의 `env.tcsh`를 읽어 구문 오류가 발생했다.
bash/zsh에서는 `source "$HOME/.cargo/env"`를 사용한다.
사용자 셸 설정을 검사할 때 기존 내용을 먼저 읽고 필요한 부분만 수정한다.

## 로컬 Codex에 전달할 시작 요청

> docs/codex-handoff.md와 docs/remaining-work.md를 읽고 현재 Git 상태를 확인해 주세요.
> 우선 FM26 26.2.0의 저장 선발 명단 위치와 접근성 요소를 읽기 전용으로 조사하고,
> 추천 선발 직접 적용을 검증 가능한 방식으로 구현해 주세요.
> 사용자 변경은 보존하고 선수 능력치와 경기 결과는 수정하지 마세요.
> 구현 후 관련 테스트, PR, CI 확인과 main 병합까지 진행해 주세요.
