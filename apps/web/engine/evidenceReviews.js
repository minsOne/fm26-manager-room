import { evidenceScope, sameEvidenceScope } from './decisionEvidence.js';
import { trainingReview } from './realReviews.js';

export function activeEvidence(s){return sameEvidenceScope(s.decisionEvidence?.scope,evidenceScope(s))?s.decisionEvidence:null;}
export function eligibilityReview(s,fixture){
  const packet=activeEvidence(s);
  return s.players.map(player=>{
    const row=packet?.eligibility.find(r=>r.playerId===player.id&&r.fixtureId===fixture?.id&&r.competitionId===fixture.competitionId);
    const medical=packet?.medical.find(r=>r.playerId===player.id);
    const blocked=[],missing=[];
    if(row){
      if(row.registered===false&&row.exempt===false)blocked.push('등록 없음·면제 아님');
      else if(row.registered!==true&&row.exempt!==true)missing.push('등록 또는 면제');
      if(row.suspended===true)blocked.push('징계');else if(row.suspended===null)missing.push('징계');
      for(const [key,label] of [['workPermit','취업 허가'],['otherRulesClear','기타 대회 규정']]){
        if(row[key]===false)blocked.push(label);else if(row[key]===null)missing.push(label);
      }
    }else missing.push('해당 경기·대회 자격 근거');
    if(medical?.injured===true)blocked.push('현재 부상');
    if(medical?.injured==null)missing.push('현재 부상 여부');
    return {player,blocked,missing,row,medical,status:blocked.length?'blocked':missing.length?'unknown':'transcribed-clear'};
  });
}

/** Negative evidence may exclude a player. Positive transcription never certifies native availability. */
export function fixtureEvidenceSnapshot(s,fixture){
  const reviews=eligibilityReview(s,fixture),byId=new Map(reviews.map(r=>[r.player.id,r]));
  return {...s,players:s.players.map(p=>{
    const r=byId.get(p.id);if(!r.blocked.length)return p;
    return {...p,availability:{...p.availability,eligible:false},evidenceExclusion:r.blocked.join(' · ')};
  })};
}

export function assignedTrainingReview(s){
  const packet=activeEvidence(s);if(!packet)return [];
  return s.players.map(player=>{
    const role=trainingReview(player),assignment=packet.assignments.find(a=>a.playerId===player.id);
    const current=packet.catalogue.find(c=>c.id===assignment?.focusId)??null;
    const priorities=new Set(role.attributes.map(a=>a.attribute));
    const candidates=packet.catalogue.map(focus=>({focus,matched:focus.attributes.filter(a=>priorities.has(a))}))
      .filter(r=>r.matched.length).sort((a,b)=>b.matched.length-a.matched.length||a.focus.id.localeCompare(b.focus.id));
    const from=assignment?player.observations?.find(o=>o.lineage===s.observationLineage&&o.date===assignment.since):null;
    const through=player.observations?.find(o=>o.lineage===s.observationLineage&&o.date===s.gameDate);
    const changes=current&&from&&through&&from.date<through.date?current.attributes.flatMap(key=>
      Number.isFinite(from.attributes[key])&&Number.isFinite(through.attributes[key])?[{key,from:from.attributes[key],to:through.attributes[key],delta:through.attributes[key]-from.attributes[key]}]:[]):[];
    return {player,current,assignment,candidates,changes,from:from?.date??null,through:changes.length?through.date:null,
      action:!assignment?'현재 배정 확인':!candidates.length?'역할·훈련 대응 근거 부족':candidates[0].focus.id===current.id?'현재 배정이 검토 능력치와 대응':'대응 항목 변경 검토',
      note:'감독이 옮긴 게임 훈련 항목의 대응 비교입니다. 강도·성장량·훈련의 인과 효과를 예측하지 않습니다.'};
  });
}

export function offerReviews(s){
  return (activeEvidence(s)?.offers??[]).map(offer=>{
    const blocked=[],missing=[];
    if(offer.expires<s.gameDate)blocked.push('오퍼 만료');
    for(const [key,label] of [['interest','관심·수락 의사'],['registration','등록 조건'],['contractClear','계약 조건']]){
      if(offer[key]===false)blocked.push(label);else if(offer[key]===null)missing.push(label);
    }
    // fee: acquisition/termination cost for buy/release; guaranteed proceeds for sell/loan-out.
    // feeThreshold is a spending cap for buy/release and a minimum acceptable fee for sell/loan-out.
    const outgoing=['sell','loan-out'].includes(offer.kind);
    for(const [value,limit,label,min] of [['fee','feeThreshold',outgoing?'수입 하한':'비용 상한',outgoing],['weeklyWage','maxWeeklyWage','잔여 부담 주급 상한',false]]){
      if(offer[value]===null||offer[limit]===null)missing.push(label);
      else if(min?offer[value]<offer[limit]:offer[value]>offer[limit])blocked.push(label);
    }
    if(offer.kind==='loan-out')for(const [value,limit,label] of [['facility','minFacility','시설 하한'],['promisedMinutes','minMinutes','경기당 출전 약속 하한']]){
      if(offer[value]===null||offer[limit]===null)missing.push(label);
      else if(offer[value]<offer[limit])blocked.push(label);
    }
    return {offer,player:[...s.players,...(s.candidates??[])].find(p=>p.id===offer.playerId),blocked,missing,
      status:blocked.length?'조건 불일치':missing.length?'판단 보류':'입력 조건 충족 · 감독 검토',
      official:false};
  });
}

/** Only the last plan from a prior calendar date is evaluated; same-day ordering is unknowable. */
export function outcomeReview(s){
  const results=activeEvidence(s)?.results??[],journal=s.decisionJournal??[];
  const rows=results.map(result=>{
    const plans=journal.filter(d=>d.fixtureId===result.fixtureId&&d.fixtureDate===result.date&&d.date<result.date);
    const decision=plans.at(-1);
    const outcome=result.goalsFor>result.goalsAgainst?'승':result.goalsFor===result.goalsAgainst?'무':'패';
    if(!decision)return {result,outcome,status:'경기 전날까지 보관한 계획 없음',decision:null,overlap:null,minutesMAE:null};
    const predicted=new Map(decision.lineup.map(p=>[p.playerId,90]));
    for(const change of decision.changes){predicted.set(change.outgoingId,change.minute);predicted.set(change.incomingId,90-change.minute);}
    const actual=new Map(result.minutes.map(p=>[p.playerId,p.minutes]));
    // A missing player is unknown, never inferred DNP/zero. Explicit zero is required.
    const matched=[...predicted].filter(([id])=>actual.has(id));
    const errors=matched.map(([id,n])=>Math.abs(n-actual.get(id)));
    return {result,decision,outcome,status:'연결됨',
      overlap:decision.lineup.filter(p=>result.starters.includes(p.playerId)).length,denominator:decision.lineup.length,
      minutePairs:matched.length,plannedPlayers:predicted.size,minutesMAE:errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null};
  });
  return {rows,linked:rows.filter(r=>r.decision).length,total:results.length,
    note:'선발 일치·출전분 오차는 계획 실행도를 뜻합니다. 승패는 관측 결과이며 추천 효과·승리 예측 정확도로 해석하지 않습니다. 같은 날 저장한 계획은 사전 예측에서 제외합니다.'};
}
const day=d=>Date.parse(`${d}T00:00:00Z`)/86400000;
export function economyReview(s){
  const records=activeEvidence(s)?.economy??[];
  const groups=new Map();
  for(const r of records){const key=JSON.stringify([r.currency,r.from,r.through]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const periods=[...groups.values()].flatMap(rows=>{
    const totalSpend=rows.reduce((n,r)=>n+r.transferSpend,0);
    return [...new Set(rows.map(r=>r.leagueId))].map(leagueId=>{
      const league=rows.filter(r=>r.leagueId===leagueId),sum=key=>league.reduce((n,r)=>n+r[key],0);
      return {leagueId,currency:rows[0].currency,from:rows[0].from,through:rows[0].through,clubs:league.length,
        income:sum('income'),expenditure:sum('expenditure'),net:sum('income')-sum('expenditure'),
        transferSpend:sum('transferSpend'),netTransferSpend:sum('transferSpend')-sum('transferIncome'),wageSpend:sum('wageSpend'),
        sampleShare:totalSpend>0?sum('transferSpend')/totalSpend:null};
    });
  }).sort((a,b)=>a.from.localeCompare(b.from)||a.leagueId.localeCompare(b.leagueId));
  const changes=records.flatMap(current=>{
    const previous=records.find(r=>r.clubId===current.clubId&&r.leagueId===current.leagueId&&r.currency===current.currency
      &&day(r.through)+1===day(current.from)&&day(r.through)-day(r.from)===day(current.through)-day(current.from));
    return previous?[{clubId:current.clubId,currency:current.currency,from:previous.from,through:current.through,
      wageChange:current.wageSpend-previous.wageSpend,wageGrowth:previous.wageSpend>0?current.wageSpend/previous.wageSpend-1:null}]:[];
  });
  return {periods,changes,note:'동일 기간·통화의 수록 구단 표본입니다. 세계 전체 점유율·물가 상승률이 아닙니다. 주급 지출 변화는 같은 구단·리그·통화의 연속된 동일 일수 기간만 비교합니다.'};
}

const balanceFields=['balance','transferBudgetAllocated','transferBudgetRemaining','wageBudgetWeekly'];
export function balanceProposal(s,field,percent){
  if(!s.observationLineage||(!s.selectionId&&!s.saveId)||!balanceFields.includes(field)||!Number.isFinite(percent)||Math.abs(percent)>10||percent===0)throw Error('재정 항목과 ±10% 이내 조정률을 확인하세요.');
  const before=s.clubFinance?.[field];
  if(!Number.isSafeInteger(before)||before<=0)throw Error('양수 정수 재정 관측값이 필요합니다.');
  const after=Math.round(before*(1+percent/100));if(after===before)throw Error('반올림 후 변화가 없습니다.');
  return {kind:'fm26-balance-review',version:1,scope:evidenceScope(s),clubId:s.manager.clubUid,
    field,before,after,rollback:{before:after,after:before},writeEnabled:false,
    unit:'parser-raw-unverified',note:'검토용 수치 시뮬레이션. 게임 파일 수정·복구에 사용할 수 있는 쓰기 프로필이 아닙니다.'};
}
export function simulateBalanceProposal(s,proposal,{rollback=false}={}){
  if(proposal?.kind!=='fm26-balance-review'||proposal.version!==1||proposal.writeEnabled!==false||!sameEvidenceScope(proposal.scope,evidenceScope(s))
    ||proposal.clubId!==s.manager.clubUid||!balanceFields.includes(proposal.field)
    ||!Number.isSafeInteger(proposal.before)||proposal.before<=0||!Number.isSafeInteger(proposal.after)||proposal.after<0
    ||Math.abs(proposal.after-proposal.before)>Math.ceil(proposal.before*.1)
    ||proposal.rollback?.before!==proposal.after||proposal.rollback?.after!==proposal.before)throw Error('변경안 범위 또는 형식이 일치하지 않습니다.');
  const expected=rollback?proposal.after:proposal.before,value=rollback?proposal.before:proposal.after;
  if(s.clubFinance?.[proposal.field]!==expected)throw Error('재정 관측값이 바뀌었습니다. 변경안을 다시 만드세요.');
  return {...s,clubFinance:{...s.clubFinance,[proposal.field]:value}};
}
