import { activeEvidence, eligibilityReview, assignedTrainingReview, offerReviews, outcomeReview, economyReview } from './engine/evidenceReviews.js';
const esc=v=>String(v??'미확인').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const note=s=>`<p class="notice">${esc(s)}</p>`;
const card=(title,body)=>`<section class="panel"><h2>${esc(title)}</h2>${body}</section>`;
const table=(heads,rows)=>`<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}">가져온 근거가 없습니다.</td></tr>`}</tbody></table></div>`;
const pct=v=>v===null?'미확인':`${(v*100).toFixed(1)}%`;

export function evidenceRoom(state,ui){
  const s=state.snapshot,p=activeEvidence(s),disabled=state.status!=='current'||state.parser?.parsing||!state.parser||state.metadataWarning;
  return card('게임 화면 근거 가져오기',note('파서가 아직 읽지 못하는 자료를 FM 화면에서 확인하고 옮겨 입력합니다. 입력자: 감독. 형식 검증은 원본의 정확성을 보증하지 않습니다. 각 행의 reference에 화면·대회·항목을 남기세요.')
    +note('커리어·관측 구간·게임 날짜·버전이 달라지면 판단에서 제외합니다. 기존 자료를 수정한 후 가져오면 보관한 근거 파일 전체를 교체합니다. 최대 1MB, 각 목록 1,000행. 게임이나 외부 AI로 전송하지 않습니다.')
    +note(s.evidenceWarning??(p?'현재 범위 근거 연결됨':'연결된 근거 없음'))
    +'<p><a href="https://github.com/minsOne/fm26-manager-room/blob/main/docs/decision-evidence.md" target="_blank" rel="noopener noreferrer">항목별 입력 예시와 단위 안내</a></p>'
    +`<button data-evidence-template ${disabled?'disabled':''}>현재 커리어 입력 틀 열기</button> <button data-evidence-export>보관 근거 내보내기</button>
      <label for="evidenceImportFile">근거 JSON 파일</label><input id="evidenceImportFile" type="file" accept="application/json,.json" ${disabled?'disabled':''}>
      <form id="evidenceForm"><label for="evidenceDraft">검토·수정할 JSON (가져오기 전에 내용 확인)</label><textarea id="evidenceDraft" rows="16" spellcheck="false">${esc(ui.evidenceDraft??'')}</textarea><button ${disabled?'disabled':''}>이 내용으로 근거 전체 교체</button></form><p id="evidenceStatus" role="status">${esc(ui.evidenceMessage??'')}</p>`)
    +card('입력에 사용할 ID',table(['선수 UID','선수'],[...s.players,...s.candidates].map(p=>[p.id,p.name]))
      +table(['경기 ID','날짜','상대','대회 ID'],s.fixtures.map(f=>[f.id,f.date,f.opponent,f.competitionId])))
    +card('연결된 근거 수',table(['분야','행'],p?Object.entries(p).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]):[]));
}
export function evidencePanel(view,state){
  const s=state.snapshot,p=activeEvidence(s);if(!s)return '';
  const intro=note('아래 자료는 감독이 게임 화면에서 옮긴 근거입니다. 자동 추출·공식 판정과 구분합니다.')+'<button data-view="evidence">근거 입력·파일 관리</button>';
  if(['medical','matchday'].includes(view)){
    const rows=s.fixtures.flatMap(f=>eligibilityReview(s,f).filter(r=>r.row||r.medical).map(r=>[
      `${f.date} ${f.opponent}`,r.player.name,r.status==='blocked'?'제외':r.status==='unknown'?'미확인':'입력 조건 통과 · 재확인',
      r.blocked.join(' · ')||r.missing.join(' · ')||'자동 자격 인증 아님',r.medical?.fatigueLabel,r.medical?.riskLabel,r.row?.reference??r.medical?.reference]));
    return card('경기별 등록·출전 근거',intro+table(['경기','선수','판단','사유','피로 화면값','위험 화면값','출처'],rows));
  }
  if(['training','development'].includes(view))return card('실제 훈련 배정·항목 대응',intro
    +note('입력한 목록 안에서 역할 핵심 능력치와 대응하는 훈련을 비교합니다. 배정 시작일과 오늘의 같은 관측 구간 기록이 모두 있을 때만 변화를 표시합니다. 중간 배정이 바뀌었다면 since도 갱신하세요. 변화는 훈련 효과의 증명이 아닙니다.')
    +table(['선수','현재 배정','배정 시작','대응 후보','검토','배정 기간 관측 변화'],assignedTrainingReview(s).map(r=>[r.player.name,r.current?.name,r.assignment?.since,
      r.candidates.map(c=>`${c.focus.name} (${c.matched.join(', ')})`).join(' · '),r.action,r.changes.map(c=>`${c.key} ${c.from} → ${c.to}`).join(' · ')||'비교 근거 부족'])));
  if(['recruitment','transfers','contracts'].includes(view))return card('오퍼 조건 검토',intro
    +note('감독이 정한 비용 상한 또는 매각·임대 수입 하한, 잔여 주급 부담, 관심·계약·등록 조건을 비교합니다. 임대는 시설·출전 약속 하한도 확인합니다. 모든 입력 조건이 맞아도 감독 검토가 필요합니다.')
    +table(['선수','유형·구단','금액·통화','판단','불일치','미확인','출처'],offerReviews(s).map(r=>[r.player?.name??r.offer.playerId,`${r.offer.kind} · ${r.offer.club}`,`${r.offer.fee??'?'} ${r.offer.currency}`,r.status,r.blocked.join(' · '),r.missing.join(' · '),r.offer.reference])));
  if(view==='reports'){
    const report=outcomeReview(s);
    return card('실제 결과 연결 · 계획 실행도',intro+note(report.note)+note(`경기 결과 ${report.total}건 중 경기 전 계획 ${report.linked}건 연결`)
      +table(['경기 ID·날짜','스코어','연결','선발 일치','출전분 평균 절대 오차','비교 인원'],report.rows.map(r=>[
        `${r.result.fixtureId} · ${r.result.date}`,`${r.result.goalsFor}–${r.result.goalsAgainst} (${r.outcome})`,r.status,
        r.decision?`${r.overlap}/${r.denominator}`:null,r.minutesMAE===null?null:`${r.minutesMAE.toFixed(1)}분`,r.decision?`${r.minutePairs}/${r.plannedPlayers}`:null])));
  }
  if(view==='economy'){
    const report=economyReview(s),disabled=state.status!=='current'||state.parser?.parsing;
    return card('실제 경제 흐름 · 수록 표본',intro+note(report.note)
      +table(['리그','기간','통화·구단 수','수입','지출','순현금 흐름','이적 지출','표본 지출 비중'],report.periods.map(r=>[r.leagueId,`${r.from}~${r.through}`,`${r.currency} · ${r.clubs}`,r.income,r.expenditure,r.net,r.transferSpend,pct(r.sampleShare)]))
      +table(['구단','비교 기간','통화','주급 지출 변화','증감률'],report.changes.map(r=>[r.clubId,`${r.from}~${r.through}`,r.currency,r.wageChange,pct(r.wageGrowth)])))
      +card('World Balance 변경안 · 수치 시뮬레이션',note('현재 관리팀의 양수 재정 관측값에 ±10% 이내 변경안을 만듭니다. 원시 단위로 전후값·되돌림을 검증합니다. 게임 파일 쓰기·복구는 지원하지 않으며 선수 능력치·경기 결과는 변경 대상이 아닙니다.')
        +`<form id="balanceForm"><label for="balanceField">재정 항목</label><select id="balanceField" name="field">${['balance','transferBudgetAllocated','transferBudgetRemaining','wageBudgetWeekly'].map(k=>`<option value="${k}">${k}</option>`).join('')}</select><label for="balancePercent">조정률 (%)</label><input id="balancePercent" name="percent" type="number" min="-10" max="10" step="0.1" value="-5" required><button ${disabled?'disabled':''}>전후값·되돌림 검증 후 변경안 내보내기</button></form><p id="balanceStatus" role="status"></p>`);
  }
  return p?'':note('추가 근거는 “게임 근거” 화면에서 입력할 수 있습니다.');
}
