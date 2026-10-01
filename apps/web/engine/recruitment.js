import { positionHealth } from "./analysis.js";
import { roleFit, roleDefinitions } from "./roles.js";
import { coachConfidence } from "./confidence.js";

export function recruitmentPriorities(snapshot){
  return ["GK","RB","CB","LB","DM","CM","AM","RW","LW","ST"]
    .map(position=>{
      const health=positionHealth(snapshot,position);
      const severity=Math.max(0,100-health.score);
      const confidence=coachConfidence({dataCompleteness:.95,sampleSize:.9,modelAgreement:health.fits.length>=2?.92:.75,futureUncertainty:health.future?.player?.age<=20?.18:.08});
      return {position,health,severity,confidence,level:severity>=30?"NOW":severity>=20?"THIS YEAR":severity>=12?"SUCCESSION":"NO NEED"};
    }).sort((a,b)=>b.severity-a.severity);
}

export function candidatesForPosition(snapshot,position){
  const slot=snapshot.formation.slots.find(s=>s.position===position) ?? syntheticSlot(position);
  const internalBest=positionHealth(snapshot,position).starter?.fit ?? 0;
  return snapshot.externalCandidates.map(player=>{
    const fit=roleFit(player,slot);
    const valueScore=Math.max(0,100-player.value/700000);
    const wageScore=Math.max(0,100-player.wage/2500);
    const future=Math.min(100,(player.pa-player.ca)*2.2 + fit*.45);
    const overall=Math.round(fit*.48+valueScore*.18+wageScore*.09+future*.18+(player.age<=23?7:2));
    const upgrade=fit-internalBest;
    const confidence=coachConfidence({dataCompleteness:.88,sampleSize:.65,modelAgreement:fit>=82?.88:.7,futureUncertainty:player.age<=21?.3:.15});
    return {player,fit,overall,upgrade,confidence,valueScore,wageScore,future};
  }).filter(x=>x.fit>=58).sort((a,b)=>b.overall-a.overall);
}

export function replacementSimilarity(player,candidate,role){
  const def=roleDefinitions[role]??{};
  let diff=0,total=0;
  for(const [attr,w] of Object.entries(def)){
    diff+=Math.abs((player.attributes[attr]??1)-(candidate.attributes[attr]??1))*w;
    total+=19*w;
  }
  return Math.max(0,Math.round((1-diff/Math.max(1,total))*100));
}

export function upgradeCandidates(snapshot,position,minimumUpgrade=4){
  return candidatesForPosition(snapshot,position).filter(x=>x.upgrade>=minimumUpgrade);
}

export function buyVsDevelop(snapshot,position){
  const health=positionHealth(snapshot,position);
  const market=candidatesForPosition(snapshot,position)[0];
  const prospect=health.future;
  if(!market) return {decision:"DEVELOP",reason:"의미 있는 외부 후보가 없음",market:null,prospect};
  if(prospect && prospect.player.pa>=180 && prospect.fit>=market.fit-10){
    return {decision:"DEVELOP",reason:"내부 유망주가 1~2년 내 격차를 줄일 가능성이 큼",market,prospect};
  }
  return {decision:"BUY",reason:"현재 뎁스 문제를 내부 자원만으로 해결하기 어려움",market,prospect};
}

export function shadowSquadImpact(snapshot,position,candidate){
  const before=positionHealth(snapshot,position);
  const clone={...snapshot,players:[...snapshot.players,{...candidate,id:`shadow-${candidate.id}`,playingTime:{agreed:"Squad Player",recentMinutes:0,minutesLast5:0},fitness:{condition:100,fatigue:0,injuryRisk:candidate.hidden?.injuryProneness??5},snapshots:[]}]};
  const after=positionHealth(clone,position);
  return {before:before.score,after:after.score,delta:after.score-before.score,backupBefore:before.backup?.fit??0,backupAfter:after.backup?.fit??0};
}

function syntheticSlot(position){
  const role=({GK:"Goalkeeper",CB:"Central Defender",LB:"Full Back",RB:"Full Back",DM:"Holding Midfielder",CM:"Central Midfielder",AM:"Advanced Playmaker",LW:"Winger",RW:"Winger",ST:"Advanced Forward"})[position];
  return {position,ipRole:role,oopRole:role};
}
