import { medicalReview, playingTimeReview, growthReview, number } from "./engine/realSnapshot.js";
import { bestVerifiedRoles } from "./engine/realRoleFit.js";
import { verifiedSquadDepth } from "./engine/realDepth.js";
import { recruitmentReview } from "./engine/realRecruitment.js";
import { matchdayReview, workloadReview } from "./engine/realMatchday.js";
import { economyReview, saudiEconomyReview } from "./engine/realEconomy.js";
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
    ${s && !state.parser?"<div>파서 상태 API 미제공: 가장 최근 게임 저장이 반영되었는지는 확인되지 않았습니다.</div>":""}
    ${state.pending?`<div>${esc(state.pending.saveName)} / ${esc(state.pending.manager.club)} <button data-accept-career>이 세이브로 전환</button></div>`:""}`;
}
export function renderRoom(view, state, ui) {
  const s = state.snapshot;
  if (view === "settings") return card("로컬 연결", `<form id="bridgeForm"><label for="bridgeInput">Bridge 주소</label><input id="bridgeInput" name="bridge" value="${esc(ui.bridge)}" required><button>연결</button></form>`
    + note("같은 컴퓨터의 로컬 API만 사용합니다. 주소 변경은 이 세션의 기존 스냅샷을 버립니다. 실제 세이브를 외부 AI에 보내지 않습니다."));
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
      const review=matchdayReview(s,ui.formation);
      const workload=workloadReview(s);
      body=card("경기 선택",upcoming.length?`<label for="fixtureSelect">검토할 경기</label><select id="fixtureSelect">${upcoming.map(f=>`<option value="${esc(f.id)}" ${ui.fixtureId===f.id?"selected":""}>${esc(f.date)} · ${esc(f.opponent)}</option>`).join("")}</select>`:"향후 일정 미확인");
      body+=card("선발 후보 배치 · 전역 최적화 검토용",
        note(review.note)
        +table(["슬롯","선수","역할","Role Fit","최종 확정 전 미확인"],review.lineup.map(row=>[
          esc(row.slot.position),
          row.player?playerLink(row.player):show(null),
          show(row.role),
          numeric(row.score),
          esc(row.missing.join(" · ")||"핵심 항목 확인됨")
        ]))
        +note(`배치 ${review.selectedCount}/11명 · Role Fit 합 ${review.totalRoleFit} · 핵심 확인 ${review.observedCritical}/${review.criticalDenominator}. ${review.readyForFinalDecision?"최종 확인 가능":"자동 선발 확정은 보류"}`));
      body+=card("벤치 커버리지 · 검토용",
        note(review.bench.note)
        +table(["선수","커버 가능 포지션","최고 Role Fit","최종 확정 전 미확인"],review.bench.players.map(row=>[
          playerLink(row.player),
          esc(row.coverage.map(item=>item.position).join(" / ")),
          numeric(row.bestScore),
          esc(row.missing.join(" · ")||"핵심 항목 확인됨")
        ]),"검증 가능한 벤치 후보가 없습니다.")
        +note(`후보 ${review.bench.selectedCount}명 · 커버 ${review.bench.coveredPositions.join(" / ")||"없음"} · 미커버 ${review.bench.missingCoverage.join(" / ")||"없음"}. ${review.bench.readyForFinalDecision?"최종 확인 가능":"벤치 확정은 보류"}`));
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
    case "training": body=card("집중훈련 검토",note("현재 집중훈련과 FM26 역할별 훈련 목록의 확인이 필요합니다. 여기서는 PA와 CA를 대조할 뿐 성장량·적합한 집중훈련을 단정하지 않습니다.")
      +table(["선수","CA","PA","PA − CA","현재 집중훈련"],players.map(p=>[playerLink(p),numeric(p.ca),numeric(p.pa),numeric(p.ca===null||p.pa===null?null:p.pa-p.ca),show(null)]))); break;
    case "development": body=card("성장 관측",table(["선수","나이","CA 변화","근거"],players.map(p=>{
      const g=growthReview(p,s); return [playerLink(p),numeric(p.age),numeric(g.delta),esc(g.message)];
    }))); break;
    case "medical": body=card("Coach Confidence · 근거 확인",note("관측 항목 수는 추천 성공 확률이 아닙니다. 최신성·기록 완전성·출전 자격은 별도로 확인합니다.")
      +table(["선수","컨디션","피로","부상 위험","관측 근거","기용 판단","미확인"],players.map(p=>{
        const r=medicalReview(p,s,stale); return [playerLink(p),numeric(p.condition),numeric(p.fatigue),numeric(p.injuryRisk),`${r.observedFields} / ${r.denominator}`,esc(r.action),esc(r.missing.join(" · "))];
      }))) +card("출전시간",table(["선수","최근 5개 통계 기록의 출전분","약속","불만 위험"],players.map(p=>[playerLink(p),numeric(p.appearances),show(p.agreed),esc(playingTimeReview(p).action)]))) ;break;
    case "recruitment": {
      const reviews=recruitmentReview(s);
      body=card("포지션별 보강 검토",note("영입 필요성을 확정하는 기능이 아닙니다. 확인된 Role Fit 기반으로 현재 스쿼드의 주전·백업 적합도만 검토합니다.")
        +table(["포지션","상태","주전 후보","2순위 후보","검토 행동","근거"],reviews.map(r=>[
          esc(r.position),esc(r.status),
          r.starter?playerLink(r.starter.player):show(null),
          r.backup?playerLink(r.backup.player):show(null),
          esc(r.action),esc(r.reason)
        ])));
      body+=card("수록 영입 후보",note(`검색 범위: ${s.candidateCoverage}. 이 목록을 전 세계 전체 선수로 간주하지 않습니다.`)
        +table(fitHeaders,s.candidates.filter(p=>!ui.query||p.name.toLocaleLowerCase().includes(ui.query.toLocaleLowerCase())).map(playerRow),"영입 후보 인덱스가 수록되지 않았습니다. 후보가 없다는 뜻은 아닙니다."));
      break;
    }
    case "transfers": body=card("임대·방출 검토",note(`임대 오퍼 ${s.loanOffers.length}건 수록. 오퍼 수만으로 조건 적합성을 판단하지 않습니다. 시장 관심·시설·출전 약속 미확인 상태에서는 처분 권고를 보류합니다.`)
      +table(["선수","시장 관심","출전 약속","계약 종료"],players.map(p=>[playerLink(p),numeric(p.interest),show(p.agreed),show(p.contractEnd)])));break;
    case "contracts": body=card("계약 관측값",note("주급의 0 값은 파서 기본값일 수 있습니다. 통화·금액 유효성 확인 전에는 유로 표시나 비용 비교를 하지 않습니다.")
      +table(["선수","계약 종료","잔여 개월","확인된 주급","파서 원시 주급 (미검증)"],players.map(p=>[playerLink(p),show(p.contractEnd),numeric(p.monthsRemaining),numeric(p.wage),numeric(p.rawWage)])));break;
    case "economy": {
      const groups=economyReview(s);
      const saudi=saudiEconomyReview(s);
      body=card("관리팀 재정",s.clubFinance
        ? table(["항목","파서 관측값"],Object.entries(s.clubFinance).map(([k,v])=>[esc(k),numeric(v)]))
        : note("관리팀 재정 데이터 미수록"));
      body+=card("국가별 재정 관측 · Manager Room proxy",
        note("통화 단위 확인 전 원시 숫자로 표시합니다. Financial Capacity는 양(+) 이적예산 + 연환산 주급예산의 국가 간 상대 proxy이며 실제 지출이 아닙니다.")
        +table(["국가","재정 클럽","재정력 상대지수","Sporting proxy","격차","상위4 집중도"],groups.slice(0,15).map(row=>[
          esc(row.label),
          numeric(row.clubsWithFinance),
          numeric(row.financialCapacityIndex),
          numeric(row.sportingPower),
          numeric(row.comparableGap),
          row.top4CapacityShare===null?show(null):esc(`${row.top4CapacityShare}%`)
        ]),"국가별 재정 집계가 수록되지 않았습니다."));
      if(saudi.available){
        body+=card("Saudi Arabia · 실제 세이브 관측",
          `<p><strong>${esc(saudi.status)}</strong></p>`
          +note(saudi.note)
          +table(["항목","관측값"],[
            ["Financial Capacity Index",numeric(saudi.group.financialCapacityIndex)],
            ["Sporting Power proxy",numeric(saudi.group.sportingPower)],
            ["비교 격차",numeric(saudi.group.comparableGap)],
            ["재정 클럽 수",numeric(saudi.group.clubsWithFinance)],
            ["Reputation 커버",`${numeric(saudi.group.reputationCoverageClubs)} / ${numeric(saudi.group.clubsWithFinance)}`],
            ["상위 4개 집중도",esc(`${saudi.group.top4CapacityShare}%`)]
          ])
          +table(["상위 클럽","잔여 이적예산","주급 예산","Reputation"],saudi.group.topClubs.map(club=>[
            esc(club.clubName),numeric(club.transferBudgetRemaining),numeric(club.wageBudgetWeekly),numeric(club.reputation)
          ]),"상위 클럽 상세 미수록")
          +note(`추가 검증 필요: ${saudi.missing.join(" · ")}. ${saudi.action}`));
      }else{
        body+=card("Saudi Arabia",note("검증된 nation 133 재정 그룹이 이 스냅샷에 없습니다. 이를 사우디 재정이 없다는 뜻으로 해석하지 않습니다."));
      }
      body+=note("World Balance 게임 수정 비활성 · 현재 화면은 read-only 관측입니다.");
      break;
    }
    case "reports": body=card("추천 사후 검증",`<h3>수록 기록 ${s.outcomes.length}건</h3>`+note("결과의 정의와 표본이 검증되기 전에는 정확도나 성공 확률을 표시하지 않습니다."));break;
    case "coach": body=card("AI 연결 상태",note("외부 AI 모델은 아직 연결되지 않았습니다. 기존 데모의 규칙 기반 답변을 실제 ChatGPT 분석으로 표시하지 않습니다. 선수 버튼을 누르면 확인된 근거를 직접 볼 수 있습니다."));break;
    default: body=card("자료",table(fitHeaders,players.map(playerRow)));
  }
  return (stale?note("이전 스냅샷으로 표시 중입니다. 현재 경기의 기용 결정을 확정하지 마세요."):"")+body;
}
export function playerDetail(player, s) {
  if (!player) return "";
  return `<section class="panel" id="selectedPlayer"><div class="panel-title"><h2>${esc(player.name)}</h2><button data-close-player>닫기</button></div><p>UID ${esc(player.id)} · 게임 ${esc(s.gameDate)} · PA ${show(player.pa)}</p>`
    + note("파서가 제공한 관측값입니다. 미확인 값은 0으로 채우지 않았습니다. 세이브 빌드별 게임 화면 대조는 별도 검증입니다.")
    + `<div class="summary-grid">${card("일반 능력치",table(["항목","관측값"],Object.entries(player.attributes).map(([k,v])=>[esc(k),numeric(v)])))}
      ${card("히든·성격",table(["항목","관측값"],Object.entries(player.hidden).map(([k,v])=>[esc(k),numeric(v)])))}</div>`
    + roleFitDetail(player)
    + `</section>`;
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
