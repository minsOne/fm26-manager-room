import { bestVerifiedRoles } from "./realRoleFit.js";
import { maximumWeightAssignment } from "./realAssignment.js";
import { reviewFormations } from "./realMatchday.js";

/**
 * Multi-fixture rotation scenario.
 *
 * It is deliberately not a final lineup recommendation:
 * - fixture importance is not invented when the save does not expose it;
 * - unknown fatigue/injury/eligibility is never treated as zero/healthy;
 * - observed recent minutes may be an incomplete lower bound.
 *
 * The optimizer balances verified Role Fit against already-planned starts and
 * high *observed* recent workload. This produces a review scenario, not an FM/SI rule.
 */
export function rotationWindowReview(snapshot, formation="4-3-3", horizon=4) {
  const safeHorizon=Math.max(2,Math.min(5,Number.isInteger(horizon)?horizon:4));
  const fixtures=(snapshot.fixtures??[])
    .filter(fixture=>fixture.date>=snapshot.gameDate)
    .sort((a,b)=>a.date.localeCompare(b.date))
    .slice(0,safeHorizon);

  if(fixtures.length<2){
    return {
      available:false,
      reason:"향후 일정이 2경기 이상 확인되어야 로테이션 창을 만들 수 있습니다.",
      fixtures,
      matches:[],
      exposure:[],
      official:false,
      methodology:"manager-room-rotation-window-v1"
    };
  }

  const slots=(reviewFormations[formation]??reviewFormations["4-3-3"]).map(slot=>({...slot}));
  const plannedStarts=new Map();
  const matches=[];
  let previousIds=new Set();

  for(const fixture of fixtures){
    const bySlot=new Map();

    for(const current of slots){
      const rows=[];
      for(const player of snapshot.players??[]){
        if(player.availability?.injuryFree===false || player.availability?.eligible===false) continue;

        const best=bestVerifiedRoles(player,current.position,1)[0];
        if(!best || best.score===null) continue;

        const starts=plannedStarts.get(player.id)??0;
        const exposurePenalty=starts*6;
        const observedMinutesPenalty=observedWorkloadPenalty(player);
        const conditionPenalty=conditionWorkloadPenalty(player);
        const assignmentScore=Math.max(
          0,
          best.score-exposurePenalty-observedMinutesPenalty-conditionPenalty
        );

        rows.push({
          player,
          slot:current,
          role:best.role,
          score:best.score,
          assignmentScore,
          roleFit:best,
          startsBefore:starts,
          penalties:{
            plannedStarts:exposurePenalty,
            observedMinutes:observedMinutesPenalty,
            condition:conditionPenalty
          },
          missing:rotationMissing(player),
          official:false
        });
      }
      bySlot.set(current.id,rows);
    }

    const assigned=maximumWeightAssignment(bySlot);
    const byId=new Map(
      assigned
        .filter(row=>row.row)
        .map(row=>[row.slotId,row.row])
    );
    const lineup=slots.map(slot=>byId.get(slot.id)??{
      slot,player:null,role:null,score:null,assignmentScore:null,
      startsBefore:null,penalties:null,
      missing:["비교 가능한 역할 적합도 후보"],official:false
    });

    const selectedIds=new Set(lineup.filter(row=>row.player).map(row=>row.player.id));
    for(const id of selectedIds) plannedStarts.set(id,(plannedStarts.get(id)??0)+1);

    const changes=matches.length===0
      ? 0
      : symmetricDifferenceSize(previousIds,selectedIds)/2;
    previousIds=selectedIds;

    matches.push({
      fixture,
      lineup,
      selectedCount:selectedIds.size,
      totalRoleFit:lineup.reduce((sum,row)=>sum+(row.score??0),0),
      changesFromPrevious:changes,
      missingSlots:lineup.filter(row=>!row.player).map(row=>row.slot.position),
      criticalUnknownPlayers:lineup.filter(row=>row.player&&row.missing.length).length
    });
  }

  const exposure=(snapshot.players??[])
    .map(player=>({
      player,
      plannedStarts:plannedStarts.get(player.id)??0,
      recentMinutes:player.minutes,
      recentMinutesComplete:player.historyComplete===true,
      condition:player.condition,
      missing:rotationMissing(player)
    }))
    .filter(row=>row.plannedStarts>0)
    .sort((a,b)=>b.plannedStarts-a.plannedStarts
      || (b.recentMinutes??-1)-(a.recentMinutes??-1)
      || String(a.player.id).localeCompare(String(b.player.id),undefined,{numeric:true}));

  const repeatedHighLoad=exposure.filter(row=>
    row.plannedStarts>=Math.ceil(fixtures.length*0.75)
    && row.recentMinutes!==null
    && row.recentMinutes>=270
  );

  const missingEvidence=new Set();
  for(const row of exposure){
    for(const item of row.missing) missingEvidence.add(item);
  }
  if(fixtures.some(fixture=>fixture.importance===null||fixture.importance===undefined)){
    missingEvidence.add("경기 중요도");
  }

  return {
    available:true,
    formation:reviewFormations[formation]?formation:"4-3-3",
    fixtures,
    matches,
    exposure,
    repeatedHighLoad,
    missingEvidence:[...missingEvidence],
    readyForFinalDecision:matches.every(match=>
      match.missingSlots.length===0&&match.criticalUnknownPlayers===0
    ) && missingEvidence.size===0,
    official:false,
    methodology:"manager-room-rotation-window-v1",
    note:"확인된 Role Fit을 유지하면서 계획된 선발 횟수와 확인된 최근 출전량을 분산한 검토 시나리오입니다. 경기 중요도·피로·부상·징계·등록이 미확인이면 최종 로테이션으로 확정하지 않습니다."
  };
}

function observedWorkloadPenalty(player){
  if(player.minutes===null||player.minutes===undefined) return 0;
  // Only penalize a workload that is already observed. If history is incomplete,
  // it remains a lower bound, but a high lower bound is still meaningful evidence.
  if(player.minutes<180) return 0;
  return Math.min(9,Math.round((player.minutes-180)/45)*2);
}

function conditionWorkloadPenalty(player){
  if(player.condition===null||player.condition===undefined||player.condition>=90) return 0;
  return Math.min(8,Math.ceil((90-player.condition)/2));
}

function rotationMissing(player){
  return [
    player.availability?.injuryFree===null?"현재 부상 여부":null,
    player.availability?.eligible===null?"출전 자격·징계·등록":null,
    player.fatigue===null?"피로":null,
    player.minutes===null?"최근 출전 기록":null,
    player.minutes!==null&&!player.historyComplete?"출전 기록 완전성":null
  ].filter(Boolean);
}

function symmetricDifferenceSize(left,right){
  let count=0;
  for(const value of left) if(!right.has(value)) count++;
  for(const value of right) if(!left.has(value)) count++;
  return count;
}
