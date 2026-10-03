import { matchdayReview } from "./realMatchday.js";
import { validDate } from "./realSnapshot.js";

export const rotationModes = {
  "best-xi":"Best XI",
  balanced:"Balanced",
  development:"Development",
  protect:"Protect Key Players"
};
const daysBetween = (a,b) => (Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000;
const known = (value,min,max) => Number.isFinite(value) && value>=min && value<=max;

/**
 * Sequential, review-only scenario. Manager caps and substitutions split a 90-minute scenario;
 * these reservations are neither observed minutes nor medical minute caps.
 * We do not project recovery, injuries, eligibility, fatigue or match results.
 */
export function rotationReview(snapshot, options={}) {
  const mode=Object.hasOwn(rotationModes,options.mode)?options.mode:"balanced";
  const horizon=Number.isInteger(options.horizon)?Math.max(1,Math.min(5,options.horizon)):5;
  const upcoming=(snapshot.fixtures??[]).filter(f=>validDate(f.date) && f.date>=snapshot.gameDate)
    .slice().sort((a,b)=>a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
  const start=options.fixtureId==null?0:upcoming.findIndex(f=>f.id===options.fixtureId);
  if(!validDate(snapshot.gameDate) || !upcoming.length || start<0){
    return {mode,plans:[],players:[],status:"deferred",official:false,readyForFinalDecision:false,
      reason:start<0?"선택한 경기가 최신 스냅샷의 향후 일정에 없습니다. 경기를 다시 선택하세요.":"향후 일정 또는 게임 날짜가 미확인입니다. 로테이션 판단을 보류합니다."};
  }

  const fixtures=upcoming.slice(start,start+horizon);
  const reservations=new Map((snapshot.players??[]).map(p=>[p.id,[]]));
  const plans=[];
  for(const fixture of fixtures){
    const index=upcoming.findIndex(f=>f.id===fixture.id);
    const previous=upcoming[index-1]??null;
    const next=upcoming[index+1]??null;
    const gapBefore=previous?daysBetween(previous.date,fixture.date):null;
    const gapAfter=next?daysBetween(fixture.date,next.date):null;
    const congested=(gapBefore!==null && gapBefore<=4) || (gapAfter!==null && gapAfter<=4);
    const currentEvidence=daysBetween(snapshot.gameDate,fixture.date)<=3;
    const adjustments=new Map();
    for(const player of snapshot.players??[]){
      const recentPlans=reservations.get(player.id).filter(row=>daysBetween(row.date,fixture.date)<=4);
      adjustments.set(player.id,selectionAdjustment(player,mode,{congested,currentEvidence,
        plannedMinutes:recentPlans.reduce((sum,row)=>sum+row.minutes,0),importance:fixture.importance}));
    }
    const missing=[
      "대회별 등록·벤치·교체 규정",
      fixture.date>snapshot.gameDate?"경기 당일 체력·부상·출전 자격 재확인":null,
      fixture.importance==null?"경기 중요도":null,
      upcoming.some(f=>f.id!==fixture.id && f.date===fixture.date)?"동일 날짜 일정의 시간·대상팀 확인":null,
      mode!=="best-xi" && (snapshot.players??[]).some(p=>!known(p.minutes,0,20160) || p.historyComplete!==true)
        ?"최근 출전 기록·완전성":null
    ].filter(Boolean);
    const constraints=options.constraintsByFixture?.get(fixture.id);
    const review=matchdayReview(snapshot,options.formation,{adjustments,stale:options.stale,decisionMissing:missing,constraints});
    const previousPlan=plans.at(-1);
    const previousIds=new Set(previousPlan?.review.lineup.filter(row=>row.player).map(row=>row.player.id)??[]);
    const changedStarters=previousPlan?review.lineup.filter(row=>row.player && !previousIds.has(row.player.id)).length:null;
    const plan={fixture,gapBefore,gapAfter,restDaysBefore:gapBefore===null?null:Math.max(0,gapBefore-1),
      restDaysAfter:gapAfter===null?null:Math.max(0,gapAfter-1),congested,changedStarters,review,
      scenarioMinutes:90,medicalMinuteCap:null,readyForFinalDecision:review.readyForFinalDecision};
    plans.push(plan);
    // No reservations or downstream optimization may assume an unresolved lineup.
    if(review.selectionConflicts.length || review.minutePlan.pending.length) break;
    for(const row of review.minutePlan.appearances){
      reservations.get(row.playerId).push({fixtureId:fixture.id,date:fixture.date,minutes:row.minutes,kind:row.kind,slotId:row.slotId});
    }
  }
  return {
    mode,plans,status:plans.some(p=>p.review.selectionConflicts.length)?"conflict":plans.some(p=>p.review.minutePlan.pending.length)?"planning-required":"review",official:false,readyForFinalDecision:false,
    conflicts:plans.flatMap(p=>p.review.selectionConflicts.map(c=>({...c,fixture:p.fixture}))),
    players:(snapshot.players??[]).map(player=>({player,observedMinutes:player.minutes??null,
      historyComplete:player.historyComplete===true,plannedStarts:reservations.get(player.id).filter(r=>r.kind==="starter").length,
      plannedSubAppearances:reservations.get(player.id).filter(r=>r.kind==="substitute").length,
      plannedMinutes:reservations.get(player.id).reduce((sum,row)=>sum+row.minutes,0),
      reservations:reservations.get(player.id),medicalMinuteCap:null})),
    methodology:"manager-room-sequential-rotation-v2",
    note:"각 경기의 검토 점수를 전역 배치한 순차 시나리오입니다. 전체 경기의 공동 최적해나 체력 예측이 아닙니다. 90분 시나리오에서 감독 상한·교체 시점을 반영한 출전분을 예약하며 실제 출전분·의학적 상한과 구분합니다. 경기마다 다시 저장·확인하세요."
  };
}

function selectionAdjustment(player,mode,context){
  if(mode==="best-xi") return {delta:0,evidence:["확인된 Role Fit 우선; 부하 점수 조정 없음"]};
  let delta=0;
  const evidence=[];
  const weight=mode==="protect"?1.5:1;
  // Only verified importance can reduce rotation preference; missing is never 'easy match'.
  const importanceWeight=known(context.importance,0,100) && context.importance>=75?0.5:1;
  const subtract=(amount,label)=>{
    const penalty=Math.round(amount*weight*importanceWeight);
    delta-=penalty;evidence.push(`${label}: 검토 점수 −${penalty}`);
  };
  if(context.currentEvidence){
    if(known(player.minutes,0,20160) && player.minutes>=300)
      subtract(context.congested?10:4,`스냅샷 기준 최근 14일 수록 ${player.minutes}분${player.historyComplete?"":" 이상"}`);
    if(known(player.condition,0,100) && player.condition<=85)
      subtract(8,`스냅샷 컨디션 ${player.condition}; 미래 회복 미예측`);
  }
  if(context.plannedMinutes>0)
    subtract(Math.min(24,context.plannedMinutes/90*12),`앞선 4일 내 계획상 ${context.plannedMinutes}분 예약`);
  if(mode==="development" && known(player.age,14,21)){
    const headroom=known(player.ca,0,200) && known(player.pa,0,200)?Math.max(0,player.pa-player.ca):null;
    const bonus=headroom===null?4:4+Math.min(6,Math.floor(headroom/5));
    delta+=bonus;evidence.push(`만 ${player.age}세 개발 검토: +${bonus}; ${headroom===null?"PA 여유 미확인":`PA − CA ${headroom}`}`);
  }
  if(!known(player.minutes,0,20160)) evidence.push("최근 출전량 미확인; 0분으로 간주하지 않음");
  else if(player.historyComplete!==true) evidence.push("출전 기록은 수록 하한; 누락된 경기를 추정하지 않음");
  if(context.importance==null) evidence.push("경기 중요도 미확인; 쉬운 경기로 간주하지 않음");
  if(!evidence.length) evidence.push("확인된 입력에서 추가 부하 조정 없음; 정상 체력 판정 아님");
  return {delta,evidence};
}
