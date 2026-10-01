import { positionHealth } from "./analysis.js";
import { coachConfidence } from "./confidence.js";

export function transferDecisions(snapshot){
  const ranking=new Map();
  for(const position of ["GK","RB","CB","LB","DM","CM","AM","RW","LW","ST"]){
    const health=positionHealth(snapshot,position);
    health.fits.forEach((x,index)=>{
      const prev=ranking.get(x.player.id);
      if(!prev || index<prev.rank) ranking.set(x.player.id,{rank:index+1,position,fit:x.fit});
    });
  }
  return snapshot.players.map(player=>{
    const rank=ranking.get(player.id) ?? {rank:99,position:player.primaryPosition,fit:0};
    const headroom=Math.max(0,player.pa-player.ca);
    const minutes=player.playingTime?.recentMinutes??0;
    let decision="KEEP", score=20, reason="현재 스쿼드 역할 유지";
    if(player.age<=21 && headroom>=20 && minutes<80){decision="LOAN";score=75;reason="성장여유가 크지만 1군 출전시간 부족";}
    if(player.age>=24 && rank.rank>=4 && headroom<=8 && player.market?.interest>=50){decision="SELL";score=84;reason="포지션 경쟁 순위 낮고 시장 관심 존재";}
    if(player.contract?.monthsRemaining<=12 && rank.rank>=3){decision="SELL";score=88;reason="계약 만료 위험과 낮은 스쿼드 우선순위";}
    if(player.influence==="Team Leader" && decision==="SELL"){score-=20;reason+=" · 라커룸 영향력 주의";}
    const confidence=coachConfidence({dataCompleteness:.92,sampleSize:.84,modelAgreement:score>=75?.9:.75,futureUncertainty:player.age<=21?.28:.1});
    return {player,decision,score,reason,rank,confidence};
  }).sort((a,b)=>b.score-a.score);
}

export function contractRisks(snapshot){
  return snapshot.players.map(player=>{
    const months=player.contract?.monthsRemaining??99;
    const roleImportance=({ "Star Player":100,"Important Player":85,"Regular Starter":72,"Squad Player":55,"Impact Sub":38,"Future Prospect":30 })[player.playingTime?.agreed]??50;
    const expiryRisk=Math.max(0,(18-months)*5);
    const replaceability=player.age<=22 && player.pa>=180?80:roleImportance;
    const risk=Math.min(100,Math.round(expiryRisk*.62+replaceability*.38));
    return {player,months,risk,priority:risk>=70?"RENEW":risk>=45?"REVIEW":"OK"};
  }).filter(x=>x.months<=18 || x.risk>=45).sort((a,b)=>b.risk-a.risk);
}
