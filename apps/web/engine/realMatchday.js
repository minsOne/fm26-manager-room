import { bestVerifiedRoles } from "./realRoleFit.js";

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

/**
 * Produces a review lineup only from verified role-fit inputs.
 * It never claims final availability or a best XI when runtime-only medical/eligibility data is unknown.
 */
export function matchdayReview(snapshot, formation="4-3-3") {
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
      rows.push({
        player,
        slot:current,
        role:best.role,
        score:best.score,
        roleFit:best,
        missing,
        availabilityKnown:missing.length===0,
        official:false
      });
    }
    rows.sort((a,b)=>b.score-a.score || (b.player.ca??-1)-(a.player.ca??-1) || a.player.name.localeCompare(b.player.name));
    bySlot.set(current.id,rows);
  }

  // Fill the positions with fewer viable candidates first to reduce greedy assignment collisions.
  const order=[...slots].sort((a,b)=>
    (bySlot.get(a.id)?.length??0)-(bySlot.get(b.id)?.length??0)
    || a.id.localeCompare(b.id)
  );
  const used=new Set();
  const assigned=new Map();

  for(const current of order){
    const candidate=(bySlot.get(current.id)??[]).find(row=>!used.has(row.player.id));
    if(candidate){
      used.add(candidate.player.id);
      assigned.set(current.id,candidate);
    }
  }

  const lineup=slots.map(current=>assigned.get(current.id)??{
    slot:current,player:null,role:null,score:null,roleFit:null,
    missing:["비교 가능한 역할 적합도 후보"],availabilityKnown:false,official:false
  });
  const missingSlots=lineup.filter(row=>!row.player).map(row=>row.slot);
  const selectedWithUnknowns=lineup.filter(row=>row.player && row.missing.length);
  const observedCritical=lineup.reduce((sum,row)=>
    sum+(row.player ? 4-row.missing.length : 0),0);
  const criticalDenominator=lineup.filter(row=>row.player).length*4;

  return {
    formation:reviewFormations[formation]?formation:"4-3-3",
    lineup,
    unavailable,
    missingSlots,
    selectedWithUnknowns,
    selectedCount:lineup.filter(row=>row.player).length,
    uniquePlayers:new Set(lineup.filter(row=>row.player).map(row=>row.player.id)).size,
    observedCritical,
    criticalDenominator,
    readyForFinalDecision:missingSlots.length===0 && selectedWithUnknowns.length===0,
    methodology:"manager-room-matchday-review-v1",
    official:false,
    note:"역할 적합도 기준 검토용 배치입니다. 부상·징계·등록·컨디션·피로 확인 전에는 최종 선발이 아닙니다."
  };
}

export function workloadReview(snapshot) {
  const rows=[];
  for(const player of snapshot.players??[]){
    const evidence=[];
    if(player.minutes!==null){
      evidence.push(`최근 14일 수록 출전 ${player.minutes}분${player.historyComplete?"":" 이상"}`);
    }
    if(player.condition!==null) evidence.push(`컨디션 ${player.condition}`);

    const flags=[];
    if(player.minutes!==null && player.minutes>=300) flags.push("출전량 높음");
    if(player.condition!==null && player.condition<=85) flags.push("컨디션 확인 필요");
    if(!flags.length) continue;

    rows.push({
      player,
      flags,
      evidence,
      action:"감독 확인",
      missing:[
        player.fatigue===null?"피로":null,
        player.injuryRisk===null?"부상 위험":null,
        player.availability?.injuryFree===null?"현재 부상 여부":null,
        player.availability?.eligible===null?"출전 자격·징계·등록":null
      ].filter(Boolean),
      official:false
    });
  }
  return rows.sort((a,b)=>(b.player.minutes??-1)-(a.player.minutes??-1));
}

function criticalMissing(player){
  return [
    player.availability?.injuryFree===null ? "현재 부상 여부" : null,
    player.availability?.eligible===null ? "출전 자격·징계·등록" : null,
    player.condition===null ? "컨디션" : null,
    player.fatigue===null ? "피로" : null
  ].filter(Boolean);
}

function slot(id,position){ return {id,position}; }
