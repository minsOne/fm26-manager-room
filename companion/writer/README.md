# writer

No game writer is enabled. The local saved-selection investigation found named
records inside a save's `tactics_man` section and added a read-only native
`lineup-research` command. It does not establish a writable format or apply a XI.

The user-authorized `tools/experiment_lineup_copy.py` creates an **experimental
new copy only**, swapping two populated references within an existing named
selection. It requires the exact source SHA-256, resolves player UIDs with the
reader, walks the complete container directory, and verifies unchanged data
outside those two references. Existing output paths are rejected.

`tools/experiment_active_lineup_copy.py` additionally replays an exact,
game-observed two-slot differential into a new copy. On the local installed
26.3.2.2329565 bundle, loading its output showed the intended GK/S1 swap, and
reloading the preserved baseline restored the original lineup. This remains an
experimental CLI, not a general writer or Companion feature.

See [local evidence and remaining gates](../../docs/lineup-storage-research.md).
Keep ability/CA/PA/hidden values and match results outside lineup application.


## 경기 준비의 제한된 세이브 복사본 생성

경기 준비에서 4-2-3-1을 선택하고 선발·벤치 변경을 미리 본 다음 새 세이브를 생성할 수 있다.
기존 감독 지정(선발 고정/휴식)을 그대로 사용하며 별도의 추천 엔진은 만들지 않는다.
`WebActions`의 커리어 범위와 2분짜리 일회용 미리보기로 요청을 묶는다.
`LineupCopy.swift`는 동봉한 `matchday_lineup_copy.py`를 실행한다. 로컬 Python 3과 zstd CLI가 필요하다.
설치/배포 스크립트는 기존 컨테이너 재구성 코드와 함께 `bin/LineupWriter`에 넣는다.

현재는 `ManagerRoom-Before-Experiment.fm`의 정확한 SHA256
`5694b8669bc31338ed8b9df49d2d4ec7cfb9ee9a2d2418c6c13a6870ab16bbef`만 허용한다.
파일 이름만 같은 다른 저장, 새로 저장한 파일, 다른 커리어/버전에는 쓰지 않는다.
이 제한은 일반적인 FM26 오프셋 탐지를 대신하지 않는다. 후속 지원은 추가 대조 검증이 필요하다.

선발 11명+벤치 9명의 UID를 파서의 구단 명단 및 유일한 pindex+1 참조와 교차 검증한다.
RW와 AM은 화면 배열 순서가 아닌 슬롯 ID로 배치한다. 모든 다른 압축 항목과 미등재 본문 바이트를
보존하고 원본/생성본의 전체 파서 스냅샷을 비교한다. 원본은 읽기 전용이며 새 파일은 독점 생성한다.
생성 성공 응답은 `fileCreated: true`, `liveSelectionApplied: false`이며 FM 불러오기가 별도로 필요하다.

선발 capability 조회는 AI 인증/Keychain과 분리되어 있다. HTTP 전송 테스트는 `serve --no-web-auth`로 사용자 Keychain을 읽지 않고 실행하며, OAuth 자체는 별도 Swift 회귀 테스트로 검사한다.
