import { roleGaps, roleDefinitions } from "./roles.js";
import { coachConfidence, recommendation } from "./confidence.js";

const focusCatalog = {
  "Quickness":["acceleration","pace"],
  "Strength":["strength"],
  "Endurance":["stamina","workRate"],
  "Shooting":["finishing","composure"],
  "Attacking Movement":["offTheBall","anticipation","decisions"],
  "Passing":["passing","vision"],
  "Ball Control":["firstTouch","technique","dribbling"],
  "Crossing":["crossing","technique"],
  "Defensive Positioning":["positioning","marking","decisions","anticipation"]
};

export function trainingRecommendations(snapshot) {
  const currentById = Object.fromEntries((snapshot.training ?? []).map(x=>[x.playerId,x.focus]));
  return snapshot.players.map(player => recommendTraining(player, bestRole(snapshot,player), currentById[player.id] ?? null));
}

export function recommendTraining(player, role, currentFocus=null) {
  const target = player.age <= 17 ? 13 : player.age <= 21 ? 14 : 15;
  const gaps = roleGaps(player,role,target);
  const roleWeights = roleDefinitions[role] ?? {};
  const headroom=Math.max(0,player.pa-player.ca);
  const ageMultiplier=player.age<=17?1.22:player.age<=21?1.12:player.age<=25?1:.75;
  const focusScores=[];

  for(const [focus,attrs] of Object.entries(focusCatalog)){
    let relevant=0, gapScore=0, currentAvg=0;
    for(const attr of attrs){
      const weight=roleWeights[attr] ?? .35;
      const value=player.attributes[attr] ?? 1;
      relevant+=weight;
      currentAvg+=value;
      gapScore+=Math.max(0,target-value)*weight;
    }
    currentAvg/=attrs.length;
    const headroomFactor=1+Math.min(.35,headroom/120);
    const alreadyHighPenalty=currentAvg>=16?.35:currentAvg>=14?.72:1;
    const injuryPenalty=(player.hidden?.injuryProneness ?? 5)>=15?.72:1;
    const score=(gapScore*10 + relevant*8)*ageMultiplier*headroomFactor*alreadyHighPenalty*injuryPenalty;
    const confidence=coachConfidence({
      dataCompleteness:.96,
      sampleSize:player.snapshots?.length>=3?.85:.5,
      modelAgreement:relevant>=2?.9:.7,
      volatility:(player.hidden?.injuryProneness ?? 5)/40,
      futureUncertainty:Math.max(0,.3-headroom/200)
    });
    focusScores.push({focus,score:Math.round(score),confidence,currentAvg:Math.round(currentAvg*10)/10,attrs});
  }

  focusScores.sort((a,b)=>b.score-a.score);
  const primary=focusScores[0];
  const noFocus = headroom <= 4 || (primary?.score ?? 0)<16 || player.age>=29;
  const action=noFocus?"No additional focus":primary.focus;
  const evidence=[
    `${role} 기준`,
    `CA/PA ${player.ca}/${player.pa}`,
    headroom>20?`성장 여유 +${headroom}`:"성장 여유 제한",
    ...gaps.slice(0,2).map(x=>`${x.attribute} ${x.value} (gap ${x.gap})`)
  ];
  const rec=recommendation({
    action,
    confidence:noFocus?Math.min(96,primary?.confidence??80):primary.confidence,
    evidence,
    uncertainty:player.snapshots?.length<3?["성장 스냅샷 표본 부족"]:[],
    risk:(player.hidden?.injuryProneness??0)>=15?"Medium":"Low",
    payload:{role,primary,alternatives:focusScores.slice(1,3),gaps}
  });
  return {
    player, role, currentFocus, primary:rec,
    changeNeeded: currentFocus !== action,
    alternatives:focusScores.slice(1,3)
  };
}

export function bestRole(snapshot,player){
  let best=null;
  for(const slot of snapshot.formation.slots){
    const def=roleDefinitions[slot.ipRole];
    if(!def) continue;
    let sum=0,total=0;
    for(const [a,w] of Object.entries(def)){sum+=(player.attributes[a]??1)*w;total+=20*w;}
    const score=total?sum/total*100:0;
    if(!best||score>best.score) best={role:slot.ipRole,score};
  }
  return best?.role ?? "Central Midfielder";
}
