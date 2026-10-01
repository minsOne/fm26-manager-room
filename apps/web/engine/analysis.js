import { roleFit } from "./roles.js";
import { coachConfidence, recommendation } from "./confidence.js";

export function fixtureImportance(fixture) {
  let score = fixture.opponentStrength * 0.44 + fixture.tableImpact * 0.36;
  if (fixture.competition === "Champions League") score += 10;
  if (fixture.knockout) score += 9;
  if (fixture.rivalry) score += 8;
  if (!fixture.home) score += 3;
  return clamp(Math.round(score), 20, 100);
}

export function workloadScore(player) {
  const minutes = Math.min(1, (player.playingTime?.recentMinutes ?? 0) / 360);
  const fatigue = (player.fitness?.fatigue ?? 0) / 100;
  const conditionPenalty = 1 - ((player.fitness?.condition ?? 100) / 100);
  const injury = (player.fitness?.injuryRisk ?? 0) / 20;
  return clamp(Math.round((minutes*0.38 + fatigue*0.32 + conditionPenalty*0.18 + injury*0.12)*100),0,100);
}

export function medicalAdvice(player, nextImportance=50) {
  const load = workloadScore(player);
  let action = "START";
  if (load >= 72) action = "REST";
  else if (load >= 52) action = nextImportance >= 85 ? "MANAGE MINUTES" : "ROTATE";
  const confidence = coachConfidence({
    dataCompleteness:.95,
    sampleSize:Math.min(1,(player.playingTime?.recentMinutes ?? 0)/180),
    modelAgreement: load >= 72 ? .95 : .82,
    volatility:(player.fitness?.fatigue ?? 0)/160
  });
  return recommendation({
    action, confidence,
    evidence:[`최근 14일 ${player.playingTime?.recentMinutes ?? 0}분`, `Condition ${player.fitness?.condition ?? "?"}%`, `Fatigue ${player.fitness?.fatigue ?? "?"}`],
    uncertainty:[],
    risk: load >= 72 ? "High" : load >= 52 ? "Medium" : "Low",
    payload:{ load }
  });
}

export function playingTimeRisk(player) {
  const agreed = player.playingTime?.agreed ?? "Squad Player";
  const minutes = player.playingTime?.minutesLast5 ?? 0;
  const expected = {
    "Star Player":350, "Important Player":300, "Regular Starter":240,
    "Squad Player":120, "Impact Sub":60, "Future Prospect":20
  }[agreed] ?? 100;
  const ratio = expected ? minutes/expected : 1;
  const risk = clamp(Math.round((1-ratio)*100),0,100);
  const confidence = coachConfidence({ dataCompleteness:.95, sampleSize:.85, modelAgreement:.9, volatility:.15 });
  return { risk, expected, minutes, confidence, status:risk>=60?"HIGH":risk>=30?"WATCH":"OK" };
}

export function positionHealth(snapshot, position) {
  const slot = snapshot.formation.slots.find(s=>s.position===position) ??
    { position, ipRole:defaultRole(position), oopRole:defaultRole(position) };
  const fits = snapshot.players
    .map(p=>({player:p,fit:roleFit(p,slot)}))
    .filter(x=>x.fit>=55)
    .sort((a,b)=>b.fit-a.fit);
  const starter = fits[0]?.fit ?? 0;
  const backup = fits[1]?.fit ?? 0;
  const future = fits.filter(x=>x.player.age<=21 && x.player.pa-x.player.ca>=15)[0];
  const aging = fits.filter(x=>x.fit>=75 && x.player.age>=31).length;
  const score = Math.round(starter*0.52 + backup*0.35 + Math.min(future?.fit ?? 0,85)*0.13 - aging*3);
  let status="GOOD";
  if (starter < 78 || backup < 68) status="CRITICAL";
  else if (backup < 78 || aging>=2) status="ATTENTION";
  return { position, score:clamp(score,0,100), status, starter:fits[0], backup:fits[1], future, aging, fits };
}

export function squadHealth(snapshot) {
  return ["GK","RB","CB","LB","DM","CM","AM","RW","LW","ST"].map(pos=>positionHealth(snapshot,pos));
}

export function buildActionCenter(snapshot, trainingRecommendations, developmentRows, recruitmentPriorities, economyAlerts) {
  const nextImportance = fixtureImportance(snapshot.fixtures[0]);
  const actions = [];
  for (const p of snapshot.players) {
    const med=medicalAdvice(p,nextImportance);
    if (med.action==="REST" || med.action==="MANAGE MINUTES") {
      actions.push({type:"medical",priority:med.action==="REST"?98:78,title:`${p.name} · ${med.action}`,detail:med.evidence.join(" · "),confidence:med.confidence});
    }
    const pt=playingTimeRisk(p);
    if (pt.risk>=45) actions.push({type:"minutes",priority:85,title:`${p.name} · 출전시간 부족`,detail:`${p.playingTime.agreed} · 최근 5경기 ${pt.minutes}분`,confidence:pt.confidence});
  }
  for (const t of trainingRecommendations.filter(x=>x.changeNeeded).slice(0,4)) {
    actions.push({type:"training",priority:65,title:`${t.player.name} · 훈련 변경`,detail:`${t.currentFocus ?? "None"} → ${t.primary.focus}`,confidence:t.primary.confidence});
  }
  for (const d of developmentRows.filter(x=>["STALLED","NEEDS_MINUTES","LOAN"].includes(x.status)).slice(0,3)) {
    actions.push({type:"development",priority:62,title:`${d.player.name} · ${d.statusLabel}`,detail:d.reason,confidence:d.confidence});
  }
  if (recruitmentPriorities[0]?.severity >= 70) {
    const r=recruitmentPriorities[0];
    actions.push({type:"recruitment",priority:72,title:`${r.position} 보강 필요`,detail:`Starter ${r.health.starter?.fit ?? 0} / Backup ${r.health.backup?.fit ?? 0}`,confidence:r.confidence});
  }
  for (const alert of economyAlerts) actions.push({type:"economy",priority:55,title:`${alert.name} 시장 과열`,detail:`Financial/Sporting gap +${alert.gap}`,confidence:alert.confidence});
  return actions.sort((a,b)=>b.priority-a.priority);
}

function defaultRole(position) {
  return ({GK:"Goalkeeper",CB:"Central Defender",LB:"Full Back",RB:"Full Back",DM:"Holding Midfielder",CM:"Central Midfielder",AM:"Advanced Playmaker",LW:"Winger",RW:"Winger",ST:"Advanced Forward"})[position];
}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
