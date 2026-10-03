/**
 * Observational economy review over finance-covered nation groups.
 * These are Manager Room comparison proxies, never official FM/SI ratings.
 */

export function economyReview(snapshot) {
  const groups=[...(snapshot.economyGroups??[])];
  const maxCapacity=Math.max(0,...groups.map(group=>group.budgetCapacityProxy??0));

  return groups.map(group=>{
    const financialCapacityIndex=maxCapacity>0
      ? Math.round(group.budgetCapacityProxy/maxCapacity*100)
      : null;
    const sportingPower=group.sportingPowerProxy;
    const comparableGap=financialCapacityIndex!==null && sportingPower!==null
      ? financialCapacityIndex-sportingPower
      : null;
    const reputationCoverage=group.clubsWithFinance>0
      ? group.reputationCoverageClubs/group.clubsWithFinance
      : 0;

    return {
      ...group,
      label:group.nationName??`Nation ${group.nationId}`,
      financialCapacityIndex,
      sportingPower,
      comparableGap,
      reputationCoverage,
      methodology:"manager-room-nation-finance-v1",
      official:false
    };
  }).sort((a,b)=>
    (b.financialCapacityIndex??-1)-(a.financialCapacityIndex??-1)
    || a.nationId-b.nationId
  );
}

export function saudiEconomyReview(snapshot) {
  const groups=economyReview(snapshot);
  const group=groups.find(row=>row.nationName==="Saudi Arabia");
  if(!group) {
    return {
      available:false,
      status:"자료 미확인",
      action:"Saudi Arabia 재정 그룹 확인 필요",
      missing:["클럽 database Unique ID 앵커로 확인된 Saudi Arabia nation group"],
      official:false
    };
  }

  const missing=[];
  if(group.sportingPower===null) missing.push("클럽 reputation");
  if(group.reputationCoverage<0.8) missing.push("reputation 커버리지 80% 이상");
  missing.push("12개월 재정 시계열");
  missing.push("실제 이적 지출");
  missing.push("리그 경기력/성적 시계열");

  let signal="비교 관찰";
  if(group.comparableGap!==null && group.comparableGap>=20 && group.top4CapacityShare>=65) {
    signal="재정력 대비 스포츠력 격차 관찰";
  }

  return {
    available:true,
    status:signal,
    action:"관찰만 수행 · World Balance 적용 비활성",
    group,
    missing,
    official:false,
    methodology:"manager-room-saudi-economy-review-v1",
    note:"Financial Capacity Index는 세이브에서 읽힌 국가별 양(+) 이적예산 + 연환산 주급예산의 상대값입니다. Sporting Power는 클럽 reputation 평균의 0~100 proxy입니다. 두 수치는 FM/SI 공식 비교 지표가 아니며 과열 판정이나 게임 수정 근거로 단독 사용하지 않습니다."
  };
}
