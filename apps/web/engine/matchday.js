import { fixtureImportance, medicalAdvice, playingTimeRisk } from "./analysis.js";
import { roleFit } from "./roles.js";
import { coachConfidence } from "./confidence.js";

export function selectMatchday(snapshot, fixture=snapshot.fixtures[0], mode="balanced") {
  const importance = fixtureImportance(fixture);
  const philosophy = snapshot.manager.philosophy;
  const candidates = [];
  for (const slot of snapshot.formation.slots) {
    for (const player of snapshot.players) {
      const fit = roleFit(player, slot);
      const medical = medicalAdvice(player, importance);
      const minutes = playingTimeRisk(player);
      const growth = player.age <= 21 ? Math.min(1, Math.max(0, (player.pa-player.ca)/50)) : 0;
      const startValue = scoreForMode({player, fit, medical, minutes, growth, importance, mode, philosophy});
      candidates.push({slot,player,fit,medical,minutes,growth,startValue});
    }
  }

  const lineup = assignUnique(snapshot.formation.slots, candidates);
  const selectedIds = new Set(lineup.map(x=>x.player.id));
  const bench = optimizeBench(snapshot, selectedIds, importance);
  const conflicts = lineup
    .filter(x => x.medical.action === "REST" || x.medical.action === "MANAGE MINUTES")
    .map(x => ({
      player:x.player,
      type:"workload",
      title:`${x.player.name} workload conflict`,
      detail:`${x.medical.action} recommended, but tactical fit is ${x.fit}`,
      confidence:x.medical.confidence
    }));
  const minutePlan = lineup.map(x => ({
    player:x.player,
    targetMinutes: x.medical.action === "MANAGE MINUTES" ? 60 : x.medical.action === "REST" ? 0 : x.player.age >= 33 ? 70 : 90,
    reason: x.medical.action === "MANAGE MINUTES" ? "피로 관리" : x.player.age >= 33 ? "노장 부하 관리" : "기본"
  }));

  const teamFit = Math.round(lineup.reduce((sum,x)=>sum+x.fit,0)/lineup.length);
  const confidence = coachConfidence({
    dataCompleteness:.95,
    sampleSize:.9,
    modelAgreement:mode==="best"? .94 : .88,
    volatility:Math.min(.5,lineup.filter(x=>x.medical.action!=="START").length/11),
    futureUncertainty: fixture.id===snapshot.fixtures[0].id ? .08 : .18
  });

  return {fixture,importance,mode,lineup,bench,conflicts,minutePlan,teamFit,confidence};
}

export function optimizeBench(snapshot, selectedIds, importance, max=9) {
  const coverTargets = ["GK","CB","RB","LB","DM","CM","RW","LW","ST"];
  const available = snapshot.players.filter(p=>!selectedIds.has(p.id));
  const bench=[];
  const used=new Set();
  for (const target of coverTargets) {
    const slot = snapshot.formation.slots.find(s=>s.position===target) ?? {position:target,ipRole:fallbackRole(target),oopRole:fallbackRole(target)};
    const ranked = available
      .filter(p=>!used.has(p.id))
      .map(p=>({player:p,fit:roleFit(p,slot),medical:medicalAdvice(p,importance)}))
      .filter(x=>x.medical.action!=="REST")
      .sort((a,b)=>b.fit-a.fit);
    if (ranked[0]) { bench.push({...ranked[0],covers:[target]}); used.add(ranked[0].player.id); }
    if (bench.length>=max) break;
  }
  if (bench.length<max) {
    const extra=available.filter(p=>!used.has(p.id))
      .map(p=>({player:p,fit:Math.max(...snapshot.formation.slots.map(s=>roleFit(p,s))),medical:medicalAdvice(p,importance),covers:p.positions}))
      .sort((a,b)=>b.fit-a.fit);
    for (const x of extra) { if(bench.length>=max) break; bench.push(x); }
  }
  return bench;
}

function assignUnique(slots, candidates) {
  const bySlot = new Map(slots.map(s=>[s.id,candidates.filter(c=>c.slot.id===s.id).sort((a,b)=>b.startValue-a.startValue)]));
  const selected=[];
  const used=new Set();

  // Harder-to-fill positions first, then improve globally with swaps.
  const slotOrder=[...slots].sort((a,b)=>{
    const ar=bySlot.get(a.id).filter(x=>x.fit>=72).length;
    const br=bySlot.get(b.id).filter(x=>x.fit>=72).length;
    return ar-br;
  });
  for (const slot of slotOrder) {
    const pick=bySlot.get(slot.id).find(x=>!used.has(x.player.id)) ?? bySlot.get(slot.id)[0];
    if (pick) { selected.push(pick); used.add(pick.player.id); }
  }

  // Two-pass conflict improvement.
  for(let pass=0;pass<2;pass++){
    for(const current of [...selected]){
      const alternatives=bySlot.get(current.slot.id).filter(x=>!used.has(x.player.id));
      const best=alternatives[0];
      if(best && best.startValue>current.startValue+7){
        used.delete(current.player.id); used.add(best.player.id);
        selected[selected.indexOf(current)]=best;
      }
    }
  }
  return slots.map(slot=>selected.find(x=>x.slot.id===slot.id)).filter(Boolean);
}

function scoreForMode({player,fit,medical,minutes,growth,importance,mode,philosophy}) {
  const loadPenalty = medical.payload?.load ?? 0;
  const minuteNeed = minutes.risk;
  const youthBias = player.age<=21 ? philosophy.youthDevelopment/100 : 0;
  let score=fit*1.1 - loadPenalty*.42;
  if(mode==="best") score += fit*.32 + importance*.08 - loadPenalty*.18;
  if(mode==="balanced") score += minuteNeed*.12 + growth*8*youthBias - loadPenalty*.2;
  if(mode==="development") score += minuteNeed*.25 + growth*25*youthBias - fit*.03;
  if(mode==="protect") score += minuteNeed*.1 + growth*8 - loadPenalty*.55;
  if(medical.action==="REST") score-= mode==="best" && importance>=92 ? 12 : 35;
  return score;
}

function fallbackRole(position){
  return ({GK:"Goalkeeper",CB:"Central Defender",LB:"Full Back",RB:"Full Back",DM:"Holding Midfielder",CM:"Central Midfielder",AM:"Advanced Playmaker",LW:"Winger",RW:"Winger",ST:"Advanced Forward"})[position];
}
