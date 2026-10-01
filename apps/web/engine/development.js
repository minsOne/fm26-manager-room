import { coachConfidence } from "./confidence.js";

export function developmentRows(snapshot) {
  return snapshot.players
    .filter(p=>p.age<=23)
    .map(p=>developmentStatus(p))
    .sort((a,b)=>priority(b)-priority(a));
}

export function developmentStatus(player) {
  const snaps=player.snapshots ?? [];
  const growth=snaps.length>=2 ? snaps.at(-1).ca-snaps[0].ca : 0;
  const headroom=Math.max(0,player.pa-player.ca);
  const minutes=player.playingTime?.recentMinutes ?? 0;
  let status="TRACK";
  let statusLabel="관찰";
  let reason=`최근 성장 +${growth} CA`;
  if(player.age>=18 && minutes<60 && headroom>=20){ status="NEEDS_MINUTES"; statusLabel="출전 필요"; reason=`최근 14일 ${minutes}분 · 성장여유 +${headroom}`; }
  if(player.age>=19 && minutes<40 && headroom>=25){ status="LOAN"; statusLabel="임대 검토"; reason="1군 실전시간 부족"; }
  if(growth<=1 && headroom>=20){ status="STALLED"; statusLabel="성장 정체"; reason=`성장 +${growth} · PA 여유 +${headroom}`; }
  if(growth>=6){ status="FAST"; statusLabel="빠른 성장"; reason=`최근 스냅샷 +${growth} CA`; }
  if(player.ca>=150 && player.age<=21){ status="PROMOTE"; statusLabel="1군 확대"; reason="현재 능력이 로테이션 수준에 근접"; }
  const confidence=coachConfidence({dataCompleteness:.94,sampleSize:snaps.length>=3?.9:.55,modelAgreement:.87,futureUncertainty:.25});
  return {player,growth,headroom,minutes,status,statusLabel,reason,confidence};
}

export function loanOfferScore(player,offer){
  const promised={ "Important Player":100, "Regular Starter":88, "Squad Player":55, "Impact Sub":32 }[offer.promisedMinutes] ?? 40;
  const leagueFit=100-Math.abs(offer.leagueLevel-(Math.min(92,player.ca/2+5)));
  const score=promised*.36 + offer.facilities*5*.19 + offer.roleMatch*.25 + leagueFit*.15 + offer.wageShare*.05;
  return Math.round(score);
}

export function rankedLoanOffers(snapshot,playerId){
  const p=snapshot.players.find(x=>x.id===playerId);
  return snapshot.loanOffers.filter(x=>x.playerId===playerId)
    .map(o=>({...o,score:loanOfferScore(p,o)})).sort((a,b)=>b.score-a.score);
}

function priority(row){ return ({LOAN:90,NEEDS_MINUTES:80,STALLED:70,PROMOTE:65,FAST:30,TRACK:10})[row.status] ?? 0; }
