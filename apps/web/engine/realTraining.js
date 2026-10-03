import { bestVerifiedRoles } from "./realRoleFit.js";

/**
 * Review-only training analysis for real save data.
 * This intentionally does not map gaps to FM26 individual-focus names until
 * current focus and training-load data are independently verified.
 */
export function trainingReview(snapshot) {
  return (snapshot.players ?? [])
    .map(player=>trainingReviewForPlayer(player))
    .sort((a,b)=>{
      if (a.priority===null && b.priority!==null) return 1;
      if (b.priority===null && a.priority!==null) return -1;
      return (b.priority??-1)-(a.priority??-1)
        || (b.player.pa??-1)-(a.player.pa??-1)
        || a.player.name.localeCompare(b.player.name);
    });
}

export function trainingReviewForPlayer(player) {
  const position=player.primaryPosition ?? player.positions?.[0] ?? null;
  if (!position) {
    return unavailable(player,"자료 부족","확인된 주 포지션이 없습니다.");
  }

  const role=bestVerifiedRoles(player,position,1)[0] ?? null;
  if (!role || role.score===null) {
    return unavailable(player,"자료 부족","역할 핵심 능력치 또는 포지션 숙련도가 충분히 확인되지 않았습니다.");
  }

  const ca=player.ca;
  const pa=player.pa;
  const age=player.age;
  if (ca===null || pa===null || age===null) {
    return {
      player,position,role,headroom:null,gaps:observedGaps(role),
      stage:null,status:"성장 여유 미확인",action:"추가 데이터 확인",priority:null,
      missing:[
        ca===null?"CA":null,pa===null?"PA":null,age===null?"나이":null,
        "현재 개인훈련 focus","훈련 부하·피로"
      ].filter(Boolean),
      canRecommendFocus:false,official:false,
      methodology:"manager-room-training-review-v1"
    };
  }

  const headroom=Math.max(0,pa-ca);
  const gaps=observedGaps(role);
  const stage=developmentStage(age);

  if (headroom<=5 || age>=29) {
    return {
      player,position,role,headroom,gaps,stage,
      status:headroom<=5?"성장 여유 제한":"유지 단계",
      action:"집중훈련 변경 보류",
      priority:0,
      missing:["현재 개인훈련 focus","훈련 부하·피로"],
      canRecommendFocus:false,official:false,
      methodology:"manager-room-training-review-v1",
      reason:headroom<=5
        ? `CA/PA 차이가 ${headroom}로 작아 공격적인 개발 결론을 내리지 않습니다.`
        : "나이만으로 훈련 변경을 권하지 않고 현재 역할과 부하 확인을 우선합니다."
    };
  }

  if (!gaps.length) {
    return {
      player,position,role,headroom,gaps,stage,
      status:"역할 핵심치 균형 양호",action:"유지·관찰",priority:20,
      missing:["현재 개인훈련 focus","훈련 부하·피로"],
      canRecommendFocus:false,official:false,
      methodology:"manager-room-training-review-v1",
      reason:"확인된 역할 핵심 능력치에서 14 미만의 뚜렷한 gap을 찾지 못했습니다."
    };
  }

  const gapPressure=gaps
    .slice(0,3)
    .reduce((sum,gap)=>sum+Math.max(0,14-gap.value)*gap.weight,0);
  const ageBonus=age<=21?18:age<=25?8:0;
  const priority=Math.min(100,Math.round(headroom*1.2+gapPressure*2.2+ageBonus));

  return {
    player,position,role,headroom,gaps,stage,
    status:"개발 항목 검토",action:"핵심 능력치 개발 검토",priority,
    missing:["현재 개인훈련 focus","훈련 부하·피로"],
    canRecommendFocus:false,official:false,
    methodology:"manager-room-training-review-v1",
    reason:`Role Fit ${role.score}, 성장 여유 +${headroom}; 확인된 낮은 핵심 능력치를 코치와 검토할 수 있습니다.`
  };
}

function observedGaps(role) {
  return [...(role.evidence ?? [])]
    .filter(row=>Number.isInteger(row.value) && row.value<14)
    .map(row=>({
      attribute:row.attribute,
      value:row.value,
      weight:row.weight,
      severity:(14-row.value)*row.weight
    }))
    .sort((a,b)=>b.severity-a.severity || a.attribute.localeCompare(b.attribute));
}

function developmentStage(age) {
  if (age<=17) return "기초 성장";
  if (age<=21) return "집중 성장";
  if (age<=25) return "역할 전문화";
  return "유지·보완";
}

function unavailable(player,status,reason) {
  return {
    player,position:null,role:null,headroom:null,gaps:[],stage:null,
    status,action:"추가 데이터 확인",priority:null,
    missing:["Role Fit 입력","현재 개인훈련 focus","훈련 부하·피로"],
    canRecommendFocus:false,official:false,
    methodology:"manager-room-training-review-v1",reason
  };
}
