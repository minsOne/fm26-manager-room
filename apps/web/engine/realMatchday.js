import { bestVerifiedRoles } from "./realRoleFit.js";
import { maximumWeightAssignment } from "./realAssignment.js";

export const reviewFormations = {
  "4-3-3":[
    slot("gk","GK"),slot("rb","RB"),slot("rcb","CB"),slot("lcb","CB"),slot("lb","LB"),
    slot("dm","DM"),slot("rcm","CM"),slot("lcm","CM"),slot("rw","RW"),slot("lw","LW"),slot("st","ST")
  ],
  "4-2-3-1":[
    slot("gk","GK"),slot("rb","RB"),slot("rcb","CB"),slot("lcb","CB"),slot("lb","LB"),
    slot("rdm","DM"),slot("ldm","DM"),slot("am","AM"),slot("rw","RW"),slot("lw","LW"),slot("st","ST")
  ],
  "3-4-2-1":[
    slot("gk","GK"),slot("rcb","CB"),slot("cb","CB"),slot("lcb","CB"),
    slot("rwb","RB"),slot("rcm","CM"),slot("lcm","CM"),slot("lwb","LB"),
    slot("ram","AM"),slot("lam","AM"),slot("st","ST")
  ]
};

export const benchCoveragePositions=["GK","CB","RB","LB","DM","CM","AM","RW","LW","ST"];

/**
 * Produces a globally optimized review lineup only from verified role-fit inputs.
 * It never claims final availability or a best XI when runtime-only medical/eligibility data is unknown.
 */
export function matchdayReview(snapshot, formation="4-3-3", options={}) {
  const slots=(reviewFormations[formation]??reviewFormations["4-3-3"]).map(value=>({...value}));
  const unavailable=[];
  const bySlot=new Map();

  for(const current of slots){
    const rows=[];
    for(const player of snapshot.players??[]){
      if(player.availability?.injuryFree===false || player.availability?.eligible===false){
        if(!unavailable.some(row=>row.player.id===player.id)){
          unavailable.push({
            player,
            reason:player.availability?.injuryFree===false
              ?"현재 부상 상태가 확인됨"
              :"출전 자격·징계·등록 불가가 확인됨"
          });
        }
        continue;
      }

      const best=bestVerifiedRoles(player,current.position,1)[0];
      if(!best || best.score===null) continue;

      const missing=criticalMissing(player);
      const adjustment=options.adjustments?.get(player.id);
      rows.push({
        player,
        slot:current,
        role:best.role,
        score:best.score,
        selectionScore:Math.max(1,Math.min(100,best.score+(adjustment?.delta??0))),
        selectionEvidence:adjustment?.evidence??[],
        roleFit:best,
        missing,
        availabilityKnown:missing.length===0,
        official:false
      });
    }
    rows.sort((a,b)=>b.score-a.score || (b.player.ca??-1)-(a.player.ca??-1)
      || String(a.player.id).localeCompare(String(b.player.id),undefined,{numeric:true}));
    bySlot.set(current.id,rows);
  }

  const optimized=maximumWeightAssignment(bySlot);
  const assigned=new Map(optimized.map(({slotId,row})=>[slotId,row]).filter(([,row])=>row));

  const lineup=slots.map(current=>assigned.get(current.id)??{
    slot:current,player:null,role:null,score:null,roleFit:null,
    missing:["비교 가능한 역할 적합도 후보"],selectionScore:null,selectionEvidence:[],availabilityKnown:false,official:false
  });
  const missingSlots=lineup.filter(row=>!row.player).map(row=>row.slot);
  const selectedWithUnknowns=lineup.filter(row=>row.player && row.missing.length);
  const observedCritical=lineup.reduce((sum,row)=>
    sum+(row.player ? 5-row.missing.length : 0),0);
  const criticalDenominator=lineup.filter(row=>row.player).length*5;
  const totalRoleFit=lineup.reduce((sum,row)=>sum+(row.score??0),0);
  const bench=benchReview(snapshot,lineup,9);
  const decisionMissing=[
    snapshot.buildVerified===true?null:"빌드 지원 확인",
    options.stale?"최신 스냅샷":null,
    ...(options.decisionMissing??[])
  ].filter(Boolean);
  bench.readyForFinalDecision=bench.readyForFinalDecision && decisionMissing.length===0;

  return {
    formation:reviewFormations[formation]?formation:"4-3-3",
    lineup,
    bench,
    unavailable,
    missingSlots,
    selectedWithUnknowns,
    selectedCount:lineup.filter(row=>row.player).length,
    uniquePlayers:new Set(lineup.filter(row=>row.player).map(row=>row.player.id)).size,
    totalRoleFit,
    totalSelectionScore:lineup.reduce((sum,row)=>sum+(row.selectionScore??0),0),
    observedCritical,
    criticalDenominator,
    decisionMissing,
    readyForFinalDecision:missingSlots.length===0 && selectedWithUnknowns.length===0 && decisionMissing.length===0,
    assignmentMethod:"global-maximum-weight-v1",
    methodology:"manager-room-matchday-review-v3",
    official:false,
    note:options.adjustments
      ?"Role Fit 원점수를 유지하고, 선택한 모드의 검토 점수 합을 최대화한 배치입니다. 부상·징계·등록·컨디션·피로 확인 전에는 최종 선발이 아닙니다."
      :"확인된 Role Fit의 전체 합을 최대화한 검토용 배치입니다. 부상·징계·등록·컨디션·피로 확인 전에는 최종 선발이 아닙니다."
  };
}

/**
 * Builds a review bench from players outside the XI.
 * Positional coverage is based only on verified role-fit scores >= minimumFit.
 */
export function benchReview(snapshot, lineup, max=9, minimumFit=65) {
  const selectedIds=new Set((lineup??[]).filter(row=>row.player).map(row=>row.player.id));
  const candidates=[];

  for(const player of snapshot.players??[]){
    if(selectedIds.has(player.id)) continue;
    if(player.availability?.injuryFree===false || player.availability?.eligible===false) continue;

    const coverage=[];
    for(const position of benchCoveragePositions){
      const best=bestVerifiedRoles(player,position,1)[0];
      if(best?.score!==null && best?.score>=minimumFit){
        coverage.push({position,score:best.score,role:best.role});
      }
    }
    if(!coverage.length) continue;
    coverage.sort((a,b)=>b.score-a.score || a.position.localeCompare(b.position));

    candidates.push({
      player,
      coverage,
      bestScore:coverage[0].score,
      missing:criticalMissing(player),
      official:false
    });
  }

  const chosen=[];
  const used=new Set();
  const uncovered=new Set(benchCoveragePositions);

  while(chosen.length<max){
    let best=null;
    for(const candidate of candidates){
      if(used.has(candidate.player.id)) continue;
      const newlyCovered=candidate.coverage.filter(row=>uncovered.has(row.position));
      const hasGK=newlyCovered.some(row=>row.position==="GK");
      const utility=newlyCovered.length*10_000
        +(uncovered.has("GK")&&hasGK?50_000:0)
        +candidate.bestScore*100
        +Math.min(candidate.coverage.length,9)*10
        +(candidate.player.ca??0);
      if(!best || utility>best.utility
        || (utility===best.utility
          && String(candidate.player.id).localeCompare(String(best.candidate.player.id),undefined,{numeric:true})<0)){
        best={candidate,newlyCovered,utility};
      }
    }
    if(!best) break;

    used.add(best.candidate.player.id);
    chosen.push(best.candidate);
    for(const row of best.candidate.coverage) uncovered.delete(row.position);
  }

  const coveredPositions=benchCoveragePositions.filter(position=>!uncovered.has(position));
  const missingCoverage=benchCoveragePositions.filter(position=>uncovered.has(position));
  const selectedWithUnknowns=chosen.filter(row=>row.missing.length);

  return {
    players:chosen,
    coveredPositions,
    missingCoverage,
    selectedCount:chosen.length,
    allCoverageKnown:missingCoverage.length===0,
    selectedWithUnknowns,
    readyForFinalDecision:missingCoverage.length===0 && selectedWithUnknowns.length===0 && snapshot.buildVerified===true,
    minimumFit,
    methodology:"manager-room-bench-coverage-v1",
    official:false,
    note:"선발과 중복되지 않는 후보 중 검증된 Role Fit으로 포지션 커버리지를 최대화합니다. 실제 벤치 등록 규정·부상·징계·피로 확인 전에는 확정 명단이 아닙니다."
  };
}

export function workloadReview(snapshot) {
  const rows=[];
  for(const player of snapshot.players??[]){
    const evidence=[];
    if(Number.isFinite(player.minutes)){
      evidence.push(`최근 14일 수록 출전 ${player.minutes}분${player.historyComplete?"":" 이상"}`);
    }
    if(Number.isFinite(player.condition)) evidence.push(`컨디션 ${player.condition}`);

    const flags=[];
    if(Number.isFinite(player.minutes) && player.minutes>=300) flags.push("출전량 높음");
    if(Number.isFinite(player.condition) && player.condition<=85) flags.push("컨디션 확인 필요");
    if(!flags.length) continue;

    rows.push({
      player,
      flags,
      evidence,
      action:"감독 확인",
      missing:[
        !Number.isFinite(player.fatigue)?"피로":null,
        !Number.isFinite(player.injuryRisk)?"부상 위험":null,
        typeof player.availability?.injuryFree!=="boolean"?"현재 부상 여부":null,
        typeof player.availability?.eligible!=="boolean"?"출전 자격·징계·등록":null
      ].filter(Boolean),
      official:false
    });
  }
  return rows.sort((a,b)=>(b.player.minutes??-1)-(a.player.minutes??-1));
}

function criticalMissing(player){
  return [
    typeof player.availability?.injuryFree!=="boolean" ? "현재 부상 여부" : null,
    typeof player.availability?.eligible!=="boolean" ? "출전 자격·징계·등록" : null,
    !Number.isFinite(player.condition) ? "컨디션" : null,
    !Number.isFinite(player.fatigue) ? "피로" : null,
    !Number.isFinite(player.injuryRisk) ? "부상 위험" : null
  ].filter(Boolean);
}

function slot(id,position){ return {id,position}; }
