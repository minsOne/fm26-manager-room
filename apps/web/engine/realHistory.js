const obj=v=>v!==null && typeof v==="object" && !Array.isArray(v);
const integer=(v,min,max)=>Number.isInteger(v) && v>=min && v<=max;
const dayMs=86400000;
export function validDate(v){
  if(typeof v!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d=new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v;
}

/** Retained source observations; unknown minutes and missing matches stay separate. */
export function normalizeMatchHistory(playingTime,gameDate){
  const base={status:"unavailable",records:[],issues:[],complete:false,minutesVerified:false};
  if(playingTime.matchesKnown!==true) return base;
  if(!Array.isArray(playingTime.matches) || playingTime.matches.length>10000)
    return {...base,status:"invalid",issues:["경기 기록 목록 형식·범위 확인"]};
  const records=[],issues=[],seen=new Set();
  for(const row of playingTime.matches){
    if(!obj(row) || !validDate(row.date) || row.date>gameDate
      || !integer(row.opponentTeamId,1,2999999) || !integer(row.competitionId,1,65535)){
      issues.push("경기 날짜·참조 ID 확인");continue;
    }
    // 130 is the pinned reference's sanity bound, never a medical/competition cap.
    const minutes=row.minutesKnown===true && integer(row.minutes,0,130)?row.minutes:null;
    if(row.minutesKnown===true && minutes===null) issues.push("출전분 원시값 범위 확인");
    const key=JSON.stringify([row.date,row.opponentTeamId,row.competitionId]);
    if(seen.has(key)) issues.push("같은 날짜·상대·대회 기록 중복: 경기 식별 확인");
    seen.add(key);
    records.push({date:row.date,opponentTeamId:row.opponentTeamId,competitionId:row.competitionId,minutes});
  }
  records.sort((a,b)=>b.date.localeCompare(a.date)||a.opponentTeamId-b.opponentTeamId||a.competitionId-b.competitionId||(a.minutes??-1)-(b.minutes??-1));
  return {status:issues.length?"invalid":"review",records,issues:[...new Set(issues)],
    complete:playingTime.historyComplete===true && !issues.length,
    minutesVerified:playingTime.minutesInterpretationVerified===true};
}

/** Exactly N UTC calendar dates ending on the anchor; future observed minutes never inferred. */
export function historyWindow(player,gameDate,anchorDate,days=14){
  const history=player.matchHistory;
  const base={source:"dated",status:history?.status??"unavailable",from:null,through:anchorDate,
    observedThrough:gameDate,minutes:null,knownRecords:0,missingRecords:0,sameDayRecords:0,
    complete:false,minutesVerified:history?.minutesVerified===true,issues:history?.issues??[]};
  if(!validDate(gameDate) || !validDate(anchorDate) || !integer(days,1,365))
    return {...base,status:"invalid",issues:["부하 검토 날짜·기간 확인"]};
  const from=new Date(Date.parse(`${anchorDate}T00:00:00Z`)-(days-1)*dayMs).toISOString().slice(0,10);
  if(!validDate(from)) return {...base,status:"invalid",issues:["부하 검토 날짜 범위 확인"]};
  if(history?.status!=="review") return {...base,from};
  const rows=history.records.filter(row=>row.date>=from && row.date<=anchorDate && row.date<=gameDate);
  const known=rows.filter(row=>row.minutes!==null),missingRecords=rows.length-known.length;
  const complete=history.complete===true && !missingRecords && anchorDate<=gameDate;
  return {...base,from,observedThrough:gameDate<anchorDate?gameDate:anchorDate,
    minutes:known.length || complete?known.reduce((n,row)=>n+row.minutes,0):null,
    knownRecords:known.length,missingRecords,sameDayRecords:rows.filter(row=>row.date===anchorDate).length,complete};
}
