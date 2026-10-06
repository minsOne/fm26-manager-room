import { trainingReview, candidateComparison, observationReport, evidenceBriefing } from "./engine/realReviews.js";
import { historyWindow } from "./engine/realHistory.js";
import { medicalReview, playingTimeReview, growthReview, number } from "./engine/realSnapshot.js";
import { bestVerifiedRoles } from "./engine/realRoleFit.js";
import { verifiedSquadDepth } from "./engine/realDepth.js";
import { recruitmentReview } from "./engine/realRecruitment.js";
import { matchdayReview, workloadReview } from "./engine/realMatchday.js";
import { rotationReview, rotationModes } from "./engine/realRotation.js";
export const rooms = {
  manager:"Manager Room", squad:"선수단", matchday:"경기 준비", tactics:"전술 검토", training:"훈련 검토",
  development:"성장 기록", medical:"체력·출전", recruitment:"선수 보강", transfers:"임대·방출",
  contracts:"계약", economy:"구단 재정", reports:"추천 검증", coach:"AI Coach", settings:"연결 설정"
};
export const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const show = v => v === null || v === undefined || v === "Unknown" ? '<span class="unknown">미확인</span>' : esc(v);
const numeric = v => number(v) === null ? show(null) : esc(v.toLocaleString("ko-KR"));
const note = s => `<p class="notice">${esc(s)}</p>`;
const table = (headers, rows, empty="수록된 데이터가 없습니다.") => `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const playerLink = p => `<button class="text-button" data-player="${esc(p.id)}">${esc(p.name)}</button>`;
const card = (title, body) => `<section class="panel"><h2>${esc(title)}</h2>${body}</section>`;
const fitHeaders = ["선수", "포지션", "CA", "PA", "컨디션"];
const playerRow = p => [playerLink(p),show(p.positions.length?p.positions.join(" / "):null),numeric(p.ca),numeric(p.pa),numeric(p.condition)];
export function statusHTML(state) {
  const s = state.snapshot;
  const label = {empty:"연결 전",error:"데이터 연결 실패",current:"실제 세이브",stale:"이전 정상 데이터 유지", "career-changed":"다른 세이브 전환 보류"}[state.status];
  return `<strong>${esc(label ?? state.status)}</strong>${state.refreshing?" · 조회 중":""}${state.parser?.parsing?" · 파서 분석 중 (현재 표시는 이전 결과)":""}
    ${s ? `<div>게임 ${esc(s.gameDate)} · ${esc(s.saveName)} · ${esc(s.manager.club)} · ${esc(s.source)}</div>
    <div>캡처 시각 ${show(s.capturedAt)} · 최근 수신 ${show(state.receivedAt)} · 빌드 ${show(s.build)} · DB ${show(s.dbVersion)}</div>`:""}
    ${state.parser?`<div>${state.status === "current" ? "Connected" : "Connection needs review"} · Pinned Save: ${show(state.parser.selectionMode === "pinned" ? state.parser.selectedSavePath?.split("/").pop() : null)} · Last Sync: ${show(state.parser.lastSuccessAt)}</div>`:""}
    ${state.error?`<div class="error">${esc(state.error)}</div>`:""}
    ${state.metadataWarning?`<div>${esc(state.metadataWarning)}</div>`:""}
    ${s?.observationArchive?.warning?`<div>${esc(s.observationArchive.warning)}</div>`:""}
    ${s && !state.parser?"<div>파서 상태 API 미제공: 가장 최근 게임 저장이 반영되었는지는 확인되지 않았습니다.</div>":""}
    ${state.pending?`<div>${esc(state.pending.saveName)} / ${esc(state.pending.manager.club)} <button data-accept-career>${state.pendingRestart?"별도 기록으로 시작":"이 세이브로 전환"}</button></div>`:""}`;
}
export function renderRoom(view, state, ui) {
  const s = state.snapshot;
  if (view === "settings") return card("로컬 연결", `<form id="bridgeForm"><label for="bridgeInput">Bridge 주소</label><input id="bridgeInput" name="bridge" value="${esc(ui.bridge)}" required><button>연결</button></form>`
    + note("같은 컴퓨터의 로컬 API만 사용합니다. 주소 변경은 이 세션의 기존 스냅샷을 버립니다. 실제 세이브를 외부 AI에 보내지 않습니다."))
    +card("새 게임·커리어 분리",note("새 게임을 저장한 뒤 Mac에서 manager-room stop → manager-room select-save 경로.fm --new-career → manager-room start 순서로 실행하세요. 같은 파일명을 재사용해도 새 커리어 ID를 부여합니다. 새 경기 일정은 수집된 이후 표시합니다.")
      +note("같은 파일·감독·날짜로 덮어쓴 새 게임은 자동 식별할 수 없습니다. --new-career를 사용하세요. 이전 저장으로 돌아간 경우에도 기존 성장 기록과 합치지 않습니다.")
      +note("아래 버튼은 현재 커리어의 브라우저 관측 구간과 선발·교체·규정 지정을 새로 시작합니다. 이전 관측 구간은 보관 한도 내에서 유지하며 게임 파일은 바꾸지 않습니다.")
      +`<button data-new-observations ${state.status!=="current"||!s?.observationArchive||(!s.selectionId&&!s.saveId)?"disabled":""}>새 관측 구간 시작 · 경기 지정 초기화</button>`)
    +card("날짜별 기록 보관",note(`이 브라우저·Bridge별 보관입니다. 커리어/분기 최대 8개, 각 최대 60일, 전체 약 3MB까지이며 오래된 기록부터 줄입니다. 브라우저 데이터 삭제·다른 기기에는 이어지지 않습니다. 현재 구간 ${s?.observationArchive?.dates??0}일 수록.`)
      +note("기록 파일은 선수 UID·능력치·검토 이력을 포함합니다. 가져오기는 기존 보관 기록 전체를 교체합니다. 커리어 ID가 다른 자료는 자동으로 합치지 않습니다.")
      +`<button data-export-archive>기록 내보내기</button><label for="archiveImportFile">기록 파일 선택</label><input id="archiveImportFile" type="file" accept="application/json,.json"><p id="archiveImportStatus" role="status"></p><button data-confirm-archive disabled>선택한 기록으로 교체</button>`);
  if (!s) return card("실제 데이터 연결 필요", note("Mac Companion을 실행한 뒤 다시 조회하세요. 연결 실패를 데모 데이터로 숨기지 않습니다.")
    + '<button data-refresh>다시 조회</button> <button data-view="settings">연결 설정</button> <a href="./demo.html">예시 데이터로 기존 UI 보기</a>');
  const stale = state.status !== "current" || state.parser?.parsing === true;
  const players = s.players.filter(p=>!ui.query || `${p.name} ${p.id}`.toLocaleLowerCase().includes(ui.query.toLocaleLowerCase()));
  const upcoming = s.fixtures.filter(f=>f.date>=s.gameDate);
  const fixtureTable = table(["날짜","상대","홈/원정","대회"], upcoming.map(f=>[
    show(f.date),show(f.opponent),show(f.home===null?null:f.home?"홈":"원정"),show(f.competition)
  ]),"향후 일정이 수록되지 않았습니다. 일정 없음과 파서 미지원은 구분해 확인해야 합니다.");
  let body;
  switch(view) {
    case "manager": {
      const next=upcoming[0];
      const missingFatigue=s.players.filter(p=>p.fatigue===null).length;
      const missingHistory=s.players.filter(p=>!p.historyComplete).length;
      body = `<div class="summary-grid">${card("다음 일정",next?`<h3>${esc(next.date)} · ${esc(next.opponent)}</h3><p>${show(next.competition)}</p>`:note("향후 일정 미확인"))}
      ${card("수록 선수",`<h3>${s.players.length}명</h3><p>이 스냅샷의 인원입니다. 1군 등록 인원과 같다는 뜻은 아닙니다.</p>`)}</div>`;
      body += card("반드시 확인", `<p>피로 미확인 ${missingFatigue}명 · 출전 기록 완전성 미확인 ${missingHistory}명</p>`
        + note("피로 0, 부상 위험 0, 선발 가능으로 해석하지 않습니다. Coach Confidence는 확률 대신 확인된 근거와 누락 항목으로 표시합니다.")
        + (!s.buildVerified?note("이 스냅샷에 정확한 FM 빌드 지원 확인이 없습니다. 관측값을 게임 화면과 대조해야 합니다."):""));
      body += card("향후 일정",fixtureTable); break;
    }
    case "squad": {
      const depth = verifiedSquadDepth(s);
      body = card("포지션 뎁스 · Manager Room 휴리스틱",
        note("FM/SI 공식 스쿼드 등급이 아닙니다. 확인된 역할 능력치와 포지션 숙련도만 사용하며, 비교 가능한 선수가 부족하면 결론을 내리지 않습니다.")
        + table(["포지션","최상위 후보","Role Fit","2순위 후보","Role Fit","비교 가능 인원","상태"], depth.map(row=>[
          esc(row.position),
          row.starter?playerLink(row.starter.player):show(null),
          row.starter?numeric(row.starter.score):show(null),
          row.backup?playerLink(row.backup.player):show(null),
          row.backup?numeric(row.backup.score):show(null),
          numeric(row.knownPlayers),
          esc(row.state)
        ])));
      body += card("선수단 관측값",table(fitHeaders,players.map(playerRow)));
      break;
    }
    case "matchday": {
      const rotation=rotationReview(s,{fixtureId:ui.fixtureId,formation:ui.formation,mode:ui.rotationMode,stale,constraintsByFixture:ui.constraintsByFixture});
      const review=rotation.plans[0]?.review??matchdayReview(s,ui.formation,{stale,decisionMissing:[rotation.reason]});
      const workload=workloadReview(s);
      const selectedFixture=rotation.plans[0]?.fixture.id;
      body=card("경기 선택",upcoming.length?`<label for="fixtureSelect">검토할 경기</label><select id="fixtureSelect">${rotation.status==="deferred"?'<option value="" selected disabled>선택한 경기 미수록 · 다시 선택하세요</option>':""}${upcoming.map(f=>`<option value="${esc(f.id)}" ${selectedFixture===f.id?"selected":""}>${esc(f.date)} · ${esc(f.opponent)}</option>`).join("")}</select>`:"향후 일정 미확인");
      body+=card("로테이션 검토 모드",`<label for="rotationModeSelect">감독의 검토 방향</label><select id="rotationModeSelect">${Object.entries(rotationModes).map(([key,label])=>`<option value="${key}" ${rotation.mode===key?"selected":""}>${label}</option>`).join("")}</select>`
        +note("검토 점수는 Role Fit과 별개입니다. 모드별 출전량·계획상 부하·유소년 우선순위를 반영한 휴리스틱이며 성공 확률이나 실제 피로가 아닙니다."));
      if(rotation.status==="deferred") {
        body+=card("로테이션 판단 보류",note(rotation.reason));
        body+=card("일정",fixtureTable);
        break;
      }
      body+=selectionControls(s,rotation.plans[0],ui.restPanelOpen,ui.minutePanelOpen);
      body+=card("검토 계획 기록",note("현재 선발·교체 초안을 로컬 보고서에 보관합니다. 게임에 적용한 명단이나 경기 결과가 아니며 의료·자격 미확인은 그대로 기록합니다.")
        +`<button data-save-review ${stale||!s.observationLineage||review.status!=="review"||!review.selectedCount?"disabled":""}>현재 검토 계획 보관</button>`
        +note(`현재 관측 구간 검토 기록 ${s.decisionJournal?.length??0}건 · 최근 30건까지 보관`));
      const workloadIds=new Set([...review.lineup.filter(r=>r.player).map(r=>r.player.id),...review.minutePlan.changes.map(c=>c.incoming.id)]);
      body+=card("경기일 기준 수록 출전량 · 최근 14일",note("경기일을 포함한 14개 달력 날짜의 기록입니다. 스냅샷 이후 실제 출전은 미확인이고, 감독 계획은 별도로 계산합니다. 친선·대표팀·유소년 및 오래된 경기 누락 가능성이 있습니다.")
        +table(["선수","자료 기준","기간 내 수록 출전분","출전분 있는 기록","출전분 미확인 기록","완전성·추가 확인"],rotation.plans[0].observedWorkloads.filter(r=>workloadIds.has(r.player.id)).map(({player,window:w})=>[
          playerLink(player),w.source==="dated"?esc(`${w.from}~${w.through} · 관측 ${w.observedThrough}까지`):"날짜별 기록 미제공 · 스냅샷 합계",numeric(w.minutes),w.status==="review"?numeric(w.knownRecords):show(null),w.status==="review"?numeric(w.missingRecords):show(null),
          esc([w.complete?"수록 범위 완전성 확인":"전체 출전량 미확인",w.source==="dated" && !w.minutesVerified?"출전분 해석 대조 필요":null,w.sameDayRecords?"당일 기록 시간 순서 미확인":null,...w.issues].filter(Boolean).join(" · "))
        ])));
      if(rotation.conflicts.length) body+=card("선택 충돌 · 배치 보류",
        note("지정을 자동으로 풀거나 다른 선수로 바꾸지 않습니다. 충돌 경기 이후의 로테이션도 보류합니다.")
        +table(["경기","슬롯","원인·해결 방법"],rotation.conflicts.map(c=>[
          esc(`${c.fixture.date} · ${c.fixture.opponent}`),show(c.slotId),esc(c.message)
        ])));
      if(review.minutePlan.pending.length) body+=card("교체 계획 보류",note("교체 후보를 확보하기 전에는 이 경기와 이후 경기의 출전분을 예약하지 않습니다.")+table(["슬롯","원인"],review.minutePlan.pending.map(p=>[esc(p.slotId),esc(p.message)])));
      body+=card("출전시간·교체 계획 · 90분 시나리오",note("감독이 정한 상한과 교체 시점입니다. 의료상 허용 시간은 미확인입니다. 슬롯당 1회 교체만 검토하며 연장·추가시간·대회별 교체 횟수와 창은 반영하지 않습니다.")
        +table(["슬롯","나갈 선수","교체 시점","들어갈 선수","투입 출전분","후보 근거"],review.minutePlan.changes.map(c=>[esc(c.slot.id),playerLink(c.outgoing),numeric(c.minute),playerLink(c.incoming),numeric(90-c.minute),c.automatic?"역할 근거 기반 자동 검토":"감독 지정"]),review.status==="conflict"?"감독 지정 충돌 해결 후 계획을 다시 계산합니다.":review.minutePlan.pending.length?"교체 후보를 확보해야 합니다.":"상한·교체 지정 없음: 배치된 선발은 계획상 90분입니다."));
      body+=card("선발 후보 배치 · 전역 최적화 검토용",
        note(review.note)
        +table(["슬롯","선수","역할","Role Fit","검토 점수","배치 근거","최종 확정 전 미확인"],review.lineup.map(row=>[
          esc(row.slot.position),
          row.player?playerLink(row.player):show(null),
          show(row.role)+(row.locked?" · 감독 고정":""),
          numeric(row.score),
          numeric(row.selectionScore),
          esc(row.selectionEvidence.join(" · ")),
          esc(row.missing.join(" · ")||"핵심 항목 확인됨")
        ]))
        +note(`배치 ${review.selectedCount}/11명 · Role Fit 합 ${review.totalRoleFit} · 핵심 확인 ${review.observedCritical}/${review.criticalDenominator}. ${review.readyForFinalDecision?"감독 최종 확인 필요":"자동 선발 확정은 보류"}`)
        +note(`경기 단위 미확인: ${review.decisionMissing.join(" · ")||"없음"}`));
      body+=card("벤치 커버리지 · 검토용",
        note(review.bench.note)
        +table(["선수","커버 가능 포지션","최고 Role Fit","최종 확정 전 미확인"],review.bench.players.map(row=>[
          playerLink(row.player)+(row.plannedSubstitute?" · 교체 계획":""),
          esc(row.coverage.map(item=>item.position).join(" / ")),
          numeric(row.bestScore),
          esc(row.missing.join(" · ")||"핵심 항목 확인됨")
        ]),"검증 가능한 벤치 후보가 없습니다.")
        +note(`후보 ${review.bench.selectedCount}명 · 커버 ${review.bench.coveredPositions.join(" / ")||"없음"} · 미커버 ${review.bench.missingCoverage.join(" / ")||"없음"}. 실제 벤치 인원·교체·대회별 등록 규정 확인 전에는 확정 보류`));
      if(rotation.plans.length){
        body+=card("향후 최대 5경기 로테이션 · 계획 시나리오",
          note(rotation.note)
          +table(["날짜","상대","이전 경기와 간격 (일)","다음 경기까지 휴식일","일정 밀집","직전 계획 대비 새 선발","교체 계획","선발 후보"],rotation.plans.map(plan=>[
            esc(plan.fixture.date),esc(plan.fixture.opponent),numeric(plan.gapBefore),numeric(plan.restDaysAfter),
            esc(plan.congested?"4일 이내 간격":"수록 일정에서 밀집 신호 없음"),numeric(plan.changedStarters),
            plan.review.minutePlan.changes.map(c=>`${esc(c.slot.id)} ${numeric(c.minute)}분: ${playerLink(c.outgoing)} → ${playerLink(c.incoming)}`).join(" · ")||"지정 없음",
            plan.review.selectionConflicts.length?"감독 지정 충돌 · 이후 계획 보류":plan.review.minutePlan.pending.length?"교체 후보 부족 · 이후 계획 보류":plan.review.lineup.filter(row=>row.player).map(row=>`${esc(row.slot.id)} ${playerLink(row.player)}${row.locked?" (고정)":""}`).join(" · ")
          ])));
        body+=card("출전분 관측과 계획",table(["선수","스냅샷 기준 최근 14일 수록 출전분","기록 범위","계획 선발","계획 교체 투입","계획상 예약 출전분","의학적 출전 상한"],rotation.players.filter(row=>row.plannedMinutes>0).map(row=>[
          playerLink(row.player),numeric(row.observedMinutes),esc(row.observedMinutes===null?"미확인":row.historyComplete?"완전성 확인":"수록 하한"),
          numeric(row.plannedStarts),numeric(row.plannedSubAppearances),numeric(row.plannedMinutes),show(row.medicalMinuteCap)
        ])));
      }
      body+=card("부하 검토",workload.length
        ? table(["선수","신호","확인된 근거","미확인","행동"],workload.map(row=>[
            playerLink(row.player),esc(row.flags.join(" · ")),esc(row.evidence.join(" · ")),
            esc(row.missing.join(" · ")),esc(row.action)
          ]))
        : note("현재 수록된 출전량/컨디션에서 별도 검토 신호가 없습니다. 피로·부상 위험 미확인은 정상으로 해석하지 않습니다."));
      body+=card("일정",fixtureTable);
      break;
    }
    case "tactics": {
      const rows = players.map(p=>{
        const position = p.primaryPosition ?? p.positions[0] ?? null;
        const best = position ? bestVerifiedRoles(p, position, 1)[0] : null;
        return [
          playerLink(p),
          show(position),
          best ? esc(best.role) : show(null),
          best ? numeric(best.score) : show(null),
          best ? `${Math.round(best.coverage*100)}%` : show(null),
          best ? esc(best.label) : "판단 보류"
        ];
      });
      body=card("분석용 포메이션",`<label for="formationSelect">검토 포메이션</label><select id="formationSelect">${["4-3-3","4-2-3-1","3-4-2-1"].map(f=>`<option ${ui.formation===f?"selected":""}>${f}</option>`).join("")}</select>`
        +note("이 선택은 브라우저의 검토 설정이며 실제 게임 전술을 읽거나 수정한 결과가 아닙니다. 동일 세이브가 갱신돼도 선택을 유지합니다."))
        +card("Role Fit · Manager Room 휴리스틱",
          note("FM/SI 공식 역할 점수가 아닙니다. 확인된 1~20 능력치와 포지션 숙련도만 사용하며, 역할 핵심 능력치 커버리지가 80% 미만이면 점수를 만들지 않습니다.")
          +table(["선수","포지션","최적 역할","Role Fit","능력치 커버리지","해석"],rows));
      break;
    }
    case "training": body=card("역할별 훈련 검토 근거",note("현재 집중훈련과 FM26 훈련 목록은 미확인입니다. 역할 핵심 능력치 중 낮은 관측값을 보여주며 훈련 항목·강도·성장량을 처방하지 않습니다.")
      +table(["선수","역할","검토할 관측 능력치","CA","PA"],players.map(p=>{
        const r=trainingReview(p);return [playerLink(p),show(r.role),r.attributes.map(a=>`${esc(a.attribute)} ${numeric(a.value)}`).join(" · ")||esc(r.reason),numeric(p.ca),numeric(p.pa)];
      })));break;
    case "development": body=card("성장 관측",note(`현재 관측 구간 ${s.observationArchive?.dates??0}일 수록. 같은 날짜 재저장은 최신 관측으로 교체하며 성장 비교를 만들지 않습니다. 새 커리어·과거 날짜·버전 변경은 별도 구간입니다.`)
      +note(s.observationArchive?.warning??"브라우저에 수집된 서로 다른 날짜만 비교합니다. 0 변화는 정체 판정이 아닙니다.")
      +table(["선수","나이","CA 변화","능력치 변화","근거"],players.map(p=>{
        const g=growthReview(p,s);return [playerLink(p),numeric(p.age),numeric(g.delta),g.attributes.map(a=>`${esc(a.key)} ${a.from} → ${a.to}`).join(" · ")||"비교 가능한 변화 없음",esc(g.message)];
      })));break;
    case "medical": body=card("Coach Confidence · 근거 확인",note("관측 항목 수는 추천 성공 확률이 아닙니다. 최신성·기록 완전성·출전 자격은 별도로 확인합니다.")
      +table(["선수","컨디션","피로","부상 위험","관측 근거","기용 판단","미확인"],players.map(p=>{
        const r=medicalReview(p,s,stale); return [playerLink(p),numeric(p.condition),numeric(p.fatigue),numeric(p.injuryRisk),`${r.observedFields} / ${r.denominator}`,esc(r.action),esc(r.missing.join(" · "))];
      }))) +card("출전시간",table(["선수","최근 5개 통계 기록의 출전분","약속","불만 위험"],players.map(p=>[playerLink(p),numeric(p.appearances),show(p.agreed),esc(playingTimeReview(p).action)]))) ;break;
    case "recruitment": {
      const reviews=recruitmentReview(s);
      body=candidateSearchForm(state,ui)
        +card("후보 파일 가져오기",note('CLI에서 만든 후보 파일도 사용할 수 있습니다: manager-room candidates --query "검색어" --offset 0 > candidates.json')
        +note("후보 파일은 현재 커리어·날짜·버전이 같을 때만 표시합니다. 새 스냅샷을 수집하면 후보 파일을 다시 생성하세요. 파서가 디코딩한 범위이며 완전한 세계 DB·영입 가능성을 보증하지 않습니다.")
        +`<label for="candidateImportFile">후보 페이지 가져오기</label><input id="candidateImportFile" type="file" accept="application/json,.json"><p id="candidateImportStatus" role="status"></p>`)
        +card("포지션별 보강 검토",note("영입 필요성을 확정하는 기능이 아닙니다. 확인된 Role Fit 기반으로 현재 스쿼드의 주전·백업 적합도만 검토합니다.")
        +table(["포지션","상태","주전 후보","2순위 후보","검토 행동","근거"],reviews.map(r=>[
          esc(r.position),esc(r.status),
          r.starter?playerLink(r.starter.player):show(null),
          r.backup?playerLink(r.backup.player):show(null),
          esc(r.action),esc(r.reason)
        ])));
      body+=card("수록 영입 후보",note(`검색 범위: ${s.candidateCoverage}. 이 목록을 전 세계 전체 선수로 간주하지 않습니다.`)
        +table(fitHeaders,s.candidates.filter(p=>!ui.query||p.name.toLocaleLowerCase().includes(ui.query.toLocaleLowerCase())).map(playerRow),"영입 후보 인덱스가 수록되지 않았습니다. 후보가 없다는 뜻은 아닙니다."));
      body+=card("수록 외부 후보 비교",note("현재 백업과 Role Fit만 비교합니다. 가격·관심·계약·등록 자격 미확인 시 영입 가능성이나 비용 효율을 판정하지 않습니다.")
        +table(["포지션","외부 후보","역할","Role Fit","내부 백업 대비"],candidateComparison(s).map(r=>[esc(r.position),playerLink(r.player),esc(r.role),numeric(r.score),numeric(r.backupDifference)]),"비교 가능한 외부 후보 데이터가 없습니다."));
      break;
    }
    case "transfers": body=card("임대·방출 검토",note(`임대 오퍼 ${s.loanOffers.length}건 수록. 오퍼 수만으로 조건 적합성을 판단하지 않습니다. 시장 관심·시설·출전 약속 미확인 상태에서는 처분 권고를 보류합니다.`)
      +table(["선수","시장 관심","출전 약속","계약 종료"],players.map(p=>[playerLink(p),numeric(p.interest),show(p.agreed),show(p.contractEnd)])));break;
    case "contracts": body=card("계약 관측값",note("주급의 0 값은 파서 기본값일 수 있습니다. 통화·금액 유효성 확인 전에는 유로 표시나 비용 비교를 하지 않습니다.")
      +table(["선수","계약 종료","잔여 개월","확인된 주급","파서 원시 주급 (미검증)"],players.map(p=>[playerLink(p),show(p.contractEnd),numeric(p.monthsRemaining),numeric(p.wage),numeric(p.rawWage)])));break;
    case "economy": body=card("관리팀 재정",s.clubFinance?table(["항목","파서 관측값"],Object.entries(s.clubFinance).map(([k,v])=>[esc(k),numeric(v)])):note("관리팀 재정 데이터 미수록"));
      body+=card("세계 경제",note(`리그 자료 ${s.leagues.length}개 수록. 국가·리그 연결과 시계열 지출이 검증되기 전에는 사우디 과열 지수를 계산하지 않습니다. 현재 예산은 실제 지출이나 인플레이션과 다릅니다.`))
      +note("금액 단위 확인 필요 · World Balance 게임 수정 비활성");break;
    case "reports": {
      const report=observationReport(s);
      body=card("관측 변화 보고서",note(`비교 가능 ${report.comparable}/${report.total}명 · CA 증가 ${report.increased}명 · 감소 ${report.decreased}명 · 동일 ${report.unchanged}명`)+note(report.note)
        +table(["선수","비교 시작","비교 종료","CA 변화"],report.rows.map(r=>[playerLink(r.player),esc(r.from),esc(r.through),numeric(r.delta)])))
        +card("보관한 검토 계획",note("자체 평가는 감독의 주관적 검토입니다. 경기 결과·모델 정확도·추천 성공률로 계산하지 않습니다.")
          +table(["기록 날짜","경기 날짜","포메이션","선발 UID","교체","미확인 근거","자체 평가"],(s.decisionJournal??[]).slice().reverse().map(r=>[
            esc(r.date),esc(r.fixtureDate),esc(r.formation),r.lineup.map(p=>`${esc(p.slot)}: ${esc(p.playerId)}`).join(" · "),
            r.changes.map(c=>`${esc(c.slot)} ${c.minute}분 ${esc(c.outgoingId)} → ${esc(c.incomingId)}`).join(" · ")||"없음",
            esc(r.decisionMissing.join(" · ")),`<select aria-label="검토 자체 평가" data-review-assessment="${esc(r.id)}" ${stale?"disabled":""}>${[["pending","미평가"],["helpful","검토에 도움됨"],["needs-review","보완 필요"]].map(([value,label])=>`<option value="${value}" ${r.assessment===value?"selected":""}>${label}</option>`).join("")}</select>`
          ])))
        +card("추천 사후 검증",`<h3>수록 기록 ${s.outcomes.length}건</h3>`+note("결과의 정의와 표본이 검증되기 전에는 정확도나 성공 확률을 표시하지 않습니다."));break;}
    case "coach": body=coachForm(state,ui)
      +card("로컬 근거 브리핑",table(["주제","확인된 범위","다음 확인"],evidenceBriefing(s).map(r=>[esc(r.topic),esc(r.evidence),esc(r.action)])));break;
    default: body=card("자료",table(fitHeaders,players.map(playerRow)));
  }
  return (stale?note("이전 스냅샷으로 표시 중입니다. 현재 경기의 기용 결정을 확정하지 마세요."):"")+body;
}
function candidateSearchForm(state,ui){
  const a=ui.actions??{},disabled=a.busy||state.status!=='current'||state.parser?.parsing||!state.snapshot?.selectionId;
  const page=a.page;
  return card('외부 선수 검색',note('현재 고정 세이브에서 이름·UID로 검색합니다. 빈 검색어는 CA 순으로 최대 100명씩 표시합니다. 완전한 세계 DB나 영입 가능성을 뜻하지 않습니다.')
    +`<form id="candidateSearchForm"><label for="candidateQuery">이름 또는 UID</label><input id="candidateQuery" maxlength="200" value="${esc(a.query??'')}" ${disabled?'disabled':''}><button ${disabled?'disabled':''}>후보 검색</button></form>`
    +`<p id="candidateSearchStatus" role="status">${esc(a.message??'')}</p>`
    +(page?`<div><button data-candidate-offset="${Math.max(0,page.offset-100)}" ${disabled||page.offset===0?'disabled':''}>이전 100명</button> <button data-candidate-offset="${page.offset+100}" ${disabled||!page.hasMore?'disabled':''}>다음 100명</button></div>`:''));
}
function coachForm(state,ui){
  const a=ui.actions??{},s=state.snapshot,disabled=a.busy||state.status!=='current'||state.parser?.parsing||!s?.selectionId;
  const preview=a.preview;
  return card('AI Coach 요청',note('선수 한 명의 관측값과 질문을 OpenAI에 보냅니다. 먼저 전송 내용을 미리 보고 확인하세요. API 키는 Mac에만 설정하며 질문·응답은 브라우저에 저장하지 않습니다.')
    +`<form id="coachForm"><label for="coachPlayer">검토할 선수</label><select id="coachPlayer" required ${disabled?'disabled':''}><option value="">선수 선택</option>${s.players.map(p=>`<option value="${esc(p.id)}" ${a.playerId===p.id?'selected':''}>${esc(p.name)} · ${esc(p.id)}</option>`).join('')}</select>
      <label for="coachQuestion">질문</label><textarea id="coachQuestion" rows="4" maxlength="4000" required ${disabled?'disabled':''}>${esc(a.question??'')}</textarea><button ${disabled?'disabled':''}>전송 내용 미리보기</button></form>`
    +`<p id="coachStatus" role="status">${esc(a.message??'')}</p>`
    +(preview?`<section id="coachPreview"><h3>전송할 요청 · 아직 전송하지 않음</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(preview.request,null,2))}</pre>
      <p>위 질문과 선수 관측값이 OpenAI로 전송되며 API 비용이 발생할 수 있습니다. 개인정보를 질문에 넣지 않았는지 확인하세요.</p>
      <button data-coach-send ${disabled||!preview.sendEnabled||preview.expiresAt<=Date.now()?'disabled':''}>내용 확인 · OpenAI에 전송</button>${!preview.sendEnabled?note('전송을 활성화하려면 Mac에서 API 키·모델을 설정하고 --enable-web-coach로 다시 시작하세요.'):''}</section>`:'')
    +(a.answer?`<section id="coachAnswer"><h3>AI 해석 · 게임 화면 확인 필요</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(a.answer)}</pre></section>`:'')
    +note('Mac 설정: manager-room stop → OPENAI_MODEL을 설정한 뒤 manager-room start --enable-web-coach. OPENAI_API_KEY는 로컬 비밀 관리 방식으로 설정하세요. 모델만 설정하면 무료 로컬 미리보기를 사용할 수 있습니다.'));
}
export function playerDetail(player, s) {
  if (!player) return "";
  return `<section class="panel" id="selectedPlayer"><div class="panel-title"><h2>${esc(player.name)}</h2><button data-close-player>닫기</button></div><p>UID ${esc(player.id)} · 게임 ${esc(s.gameDate)} · PA ${show(player.pa)}</p>`
    + note("파서가 제공한 관측값입니다. 미확인 값은 0으로 채우지 않았습니다. 세이브 빌드별 게임 화면 대조는 별도 검증입니다.")
    + `<div class="summary-grid">${card("일반 능력치",table(["항목","관측값"],Object.entries(player.attributes).map(([k,v])=>[esc(k),numeric(v)])))}
      ${card("히든·성격",table(["항목","관측값"],Object.entries(player.hidden).map(([k,v])=>[esc(k),numeric(v)])))}</div>`
    + datedHistoryDetail(player,s.gameDate)
    + roleFitDetail(player)
    + `</section>`;
}


function datedHistoryDetail(player,gameDate){
  const h=player.matchHistory;
  if(!h || h.status==="unavailable") return card("날짜별 경기 기록",note("날짜별 기록 미제공: 경기 누락과 실제 미출전을 구분할 수 없습니다."));
  const w=historyWindow(player,gameDate,gameDate);
  return card("날짜별 경기 기록",note("세이브에 남은 파서 관측값입니다. 친선·대표팀·유소년 및 오래된 경기 누락 가능성이 있어 전체 출전량은 미확인입니다. 출전분 해석은 게임 화면 대조가 필요합니다.")
    +note(`최근 14일 ${w.from}~${w.through}: ${w.minutes===null?"미확인":`${w.minutes}분 수록`} · 출전분 미확인 기록 ${w.missingRecords}건`)
    +(h.issues.length?note(h.issues.join(" · ")):"")
    +table(["날짜","상대 팀 ID","대회 단계 ID","수록 출전분"],h.records.map(r=>[esc(r.date),numeric(r.opponentTeamId),numeric(r.competitionId),numeric(r.minutes)]),"수록 경기 없음 · 실제 미출전 여부 미확인"));
}

function roleFitDetail(player) {
  const position = player.primaryPosition ?? player.positions?.[0] ?? null;
  if (!position) return card("Role Fit", note("확인된 주 포지션이 없어 역할 적합도를 계산하지 않습니다."));
  const roles = bestVerifiedRoles(player, position, 4);
  if (!roles.length) return card("Role Fit", note("역할 핵심 능력치 또는 포지션 숙련도 자료가 부족합니다."));
  return card("Role Fit · Manager Room 휴리스틱",
    note("FM/SI 공식 수치가 아닙니다. 확인된 능력치와 포지션 숙련도만 사용하는 비교용 휴리스틱입니다.")
    + table(["역할","점수","능력치 점수","포지션","커버리지","해석"], roles.map(r=>[
      esc(r.role), numeric(r.score), numeric(r.attributeScore), numeric(r.positionScore),
      `${Math.round(r.coverage*100)}%`, esc(r.label)
    ])));
}

function selectionControls(snapshot,plan,restPanelOpen,minutePanelOpen){
  const review=plan.review;
  const fixtureId=esc(plan.fixture.id);
  const locks=review.constraints.lockedStarters;
  const restIds=new Set(review.constraints.restIds);
  const players=snapshot.players;
  const playerIds=new Set(players.map(p=>p.id));
  const slots=review.lineup.map(row=>row.slot);
  const obsolete=Object.entries(locks).filter(([id])=>!slots.some(s=>s.id===id));
  const lockFields=slots.map(slot=>{
    const selected=Object.hasOwn(locks,slot.id)?locks[slot.id]:"";
    return `<label class="selection-field" for="lock-${esc(slot.id)}">${esc(slot.id)} (${esc(slot.position)}) 선발 고정
      <select id="lock-${esc(slot.id)}" data-lock-slot="${esc(slot.id)}" data-fixture-id="${fixtureId}">
        <option value="" ${selected?"":"selected"}>자동 검토 배치</option>
        ${selected && !playerIds.has(selected)?`<option selected value="${esc(selected)}">UID ${esc(selected)} · 현재 미수록</option>`:""}
        ${players.map(p=>`<option value="${esc(p.id)}" ${selected===p.id?"selected":""}>${esc(p.name)} · UID ${esc(p.id)}</option>`).join("")}
      </select></label>`;
  }).join("");
  const restFields=[...players,...[...restIds].filter(id=>!playerIds.has(id)).map(id=>({id,name:`UID ${id} · 현재 미수록`}))]
    .map(p=>`<label class="rest-field"><input type="checkbox" data-rest-player="${esc(p.id)}" data-fixture-id="${fixtureId}" ${restIds.has(p.id)?"checked":""}> ${esc(p.name)} · UID ${esc(p.id)}</label>`).join("");
  const caps=review.constraints.minuteCaps;
  const capFields=[...players,...Object.keys(caps).filter(id=>!playerIds.has(id)).map(id=>({id,name:`UID ${id} · 현재 미수록`}))].map(p=>
    `<label class="selection-field">${esc(p.name)} · UID ${esc(p.id)} 감독 상한 (분)<input type="number" min="0" max="90" step="1" placeholder="지정 없음" data-minute-cap-player="${esc(p.id)}" data-fixture-id="${fixtureId}" value="${Number.isInteger(caps[p.id])?caps[p.id]:""}"></label>`).join("");
  const subFields=slots.map(slot=>{
    const d=review.constraints.substitutions[slot.id]??{};
    return `<label class="selection-field">${esc(slot.id)} 교체 시점 (분)<input id="sub-minute-${esc(slot.id)}" type="number" min="1" max="89" step="1" placeholder="선발 상한 사용" data-sub-slot="${esc(slot.id)}" data-sub-field="minute" data-fixture-id="${fixtureId}" value="${Number.isInteger(d.minute)?d.minute:""}"></label>
      <label class="selection-field">${esc(slot.id)} 교체 투입 선수<select id="sub-player-${esc(slot.id)}" data-sub-slot="${esc(slot.id)}" data-sub-field="playerId" data-fixture-id="${fixtureId}"><option value="">자동 검토 후보</option>
      ${d.playerId && !playerIds.has(d.playerId)?`<option selected value="${esc(d.playerId)}">UID ${esc(d.playerId)} · 현재 미수록</option>`:""}
      ${players.map(p=>`<option value="${esc(p.id)}" ${d.playerId===p.id?"selected":""}>${esc(p.name)} · UID ${esc(p.id)}</option>`).join("")}</select></label>`;
  }).join("");
  const ruleFields=[["benchLimit","벤치 등록 한도",23],["substitutionLimit","교체 선수 한도",11]].map(([key,label,max])=>`<label class="selection-field">${label} (명)<input type="number" min="0" max="${max}" step="1" placeholder="미확인" data-match-rule="${key}" data-fixture-id="${fixtureId}" value="${review.matchRules.values[key]??""}"></label>`).join("");
  return card("감독 지정 · 선택한 경기만 적용",
    note(`${plan.fixture.date} · ${plan.fixture.opponent}. 선발 고정은 남은 슬롯의 전역 배치에 우선합니다. 휴식 지정은 선발·벤치에서 모두 제외합니다. 브라우저 세션의 계획이며 실제 게임 설정을 바꾸지 않습니다.`)
    +note("같은 커리어의 재수집·모드·포메이션 변경 시 지정을 유지합니다. 새 커리어·Bridge 변경·페이지 재로드 시 초기화됩니다. 고정은 미확인 의료·출전 자격을 확인된 것으로 만들지 않습니다.")
    +note("경기 규정 · 감독 수동 입력: FM 규칙 화면에서 확인한 정규시간 한도를 입력하세요. 빈칸=미확인, 0=허용 없음. 이 경기만 적용하며 자동 추출·검증된 규정이 아닙니다. 선수별 등록 자격, 교체 횟수·하프타임·연장·특별 교체는 별도 확인하세요.")
    +`<div class="selection-grid">${ruleFields}</div>`
    +note(`검토 벤치는 최대 ${review.matchRules.reviewBenchLimit}명입니다. 입력 한도가 9명을 넘어도 현재 검토 범위는 9명입니다. 한도 초과 시 이 경기와 이후 출전분 예약을 보류합니다.`)
    +`<div class="selection-grid">${lockFields}</div>`
    +obsolete.map(([id,playerId])=>`<p>현재 포메이션에 없는 고정: ${esc(id)} · UID ${esc(playerId)} <button data-unlock-slot="${esc(id)}" data-fixture-id="${fixtureId}">이 슬롯 고정 해제</button></p>`).join("")
    +`<details data-rest-controls ${restPanelOpen?"open":""}><summary>이 경기 휴식 지정 (${restIds.size}명)</summary><div class="selection-grid">${restFields}</div></details>`
    +note("감독 상한은 빈칸=미지정, 0=출전 제외, 1~90분=계획 상한입니다. 짧은 상한에는 교체 후보가 필요합니다. 교체 선수만 지정할 때는 시점 또는 선발의 짧은 상한을 입력하세요.")
    +`<div class="selection-grid">${subFields}</div>`
    +`<details data-minute-controls ${minutePanelOpen?"open":""}><summary>감독 출전시간 상한 (${Object.keys(caps).length}명)</summary><div class="selection-grid">${capFields}</div></details>`
    +`<button data-clear-selection data-fixture-id="${fixtureId}">이 경기 지정 초기화</button>`);
}
