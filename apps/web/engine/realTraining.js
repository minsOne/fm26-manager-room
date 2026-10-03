import { roleDefinitions } from "./roles.js";
import { bestVerifiedRoles } from "./realRoleFit.js";

const FOCUS = {
  "Quickness": { label:"순발력·속도", attributes:["acceleration","pace"] },
  "Strength": { label:"근력", attributes:["strength"] },
  "Endurance": { label:"지구력", attributes:["stamina","workRate"] },
  "Shooting": { label:"슈팅", attributes:["finishing","composure"] },
  "Attacking Movement": { label:"공격 움직임", attributes:["offTheBall","anticipation","decisions"] },
  "Passing": { label:"패스", attributes:["passing","vision"] },
  "Ball Control": { label:"볼 컨트롤", attributes:["firstTouch","technique","dribbling"] },
  "Crossing": { label:"크로스", attributes:["crossing","technique"] },
  "Defensive Positioning": { label:"수비 위치선정", attributes:["positioning","marking","decisions","anticipation"] }
};

/**
 * Evidence-only individual-focus review.
 *
 * This is intentionally not an FM/SI training recommendation and never returns an
 * apply-ready action. It ranks role-relevant weaknesses using verified 1..20 attributes.
 * Current individual training, training workload and runtime medical state are not yet
 * available from the production snapshot, so an actual training change remains blocked.
 */
export function verifiedTrainingReview(player) {
  const position = player.primaryPosition ?? player.positions?.[0] ?? null;
  const missing = [];

  if (player.age === null || player.age === undefined) missing.push("나이");
  if (!position) missing.push("확인된 주 포지션");
  if (player.attributesKnown === false) missing.push("능력치");

  if (missing.length) {
    return unavailable(player, missing);
  }

  const best = bestVerifiedRoles(player, position, 1)[0] ?? null;
  if (!best || best.score === null) {
    return unavailable(player, ["비교 가능한 역할 적합도"]);
  }

  const definition = roleDefinitions[best.role] ?? {};
  const target = roleReadinessTarget(player.age);
  const candidates = [];

  for (const [focus, config] of Object.entries(FOCUS)) {
    const relevant = config.attributes.filter(attribute => definition[attribute] !== undefined);
    if (!relevant.length) continue;

    let totalWeight = 0;
    let knownWeight = 0;
    let weightedGap = 0;
    const evidence = [];
    const unknown = [];

    for (const attribute of relevant) {
      const weight = definition[attribute];
      totalWeight += weight;
      const value = player.attributes?.[attribute];
      if (Number.isInteger(value) && value >= 1 && value <= 20) {
        knownWeight += weight;
        const gap = Math.max(0, target - value);
        weightedGap += gap * weight;
        evidence.push({ attribute, value, weight, gap });
      } else {
        unknown.push(attribute);
      }
    }

    const coverage = totalWeight ? knownWeight / totalWeight : 0;
    if (coverage < 0.8 || knownWeight === 0) continue;

    const gap = weightedGap / knownWeight;
    candidates.push({
      focus,
      label:config.label,
      gap:Math.round(gap * 10) / 10,
      coverage,
      evidence:evidence.sort((a,b)=>(b.gap*b.weight)-(a.gap*a.weight)),
      missingAttributes:unknown
    });
  }

  candidates.sort((a,b)=>b.gap-a.gap || b.coverage-a.coverage || a.label.localeCompare(b.label,"ko"));
  const primary = candidates.find(row=>row.gap > 0) ?? null;
  const bottlenecks = [...(best.evidence ?? [])]
    .map(row=>({
      attribute:row.attribute,
      value:row.value,
      weight:row.weight,
      gap:Math.max(0,target-row.value),
      weightedGap:Math.max(0,target-row.value)*row.weight
    }))
    .sort((a,b)=>b.weightedGap-a.weightedGap || a.value-b.value || a.attribute.localeCompare(b.attribute))
    .slice(0,3);

  const paHeadroom = player.pa === null || player.ca === null ? null : Math.max(0,player.pa-player.ca);
  const uncertainty = [
    "현재 집중훈련 미확인",
    "훈련 부하 미확인",
    "실시간 피로·부상 위험 미확인"
  ];
  if (player.pa === null) uncertainty.push("확정 PA 미확인");

  return {
    player,
    position,
    role:best.role,
    roleFit:best.score,
    roleCoverage:best.coverage,
    target,
    primary,
    alternatives:candidates.filter(row=>row!==primary).slice(0,2),
    bottlenecks,
    paHeadroom,
    action:primary ? "훈련 초점 후보 검토" : "추가 초점 우선순위 낮음",
    applyReady:false,
    uncertainty,
    official:false,
    methodology:"manager-room-training-review-v1",
    note:"확인된 역할 능력치의 상대적 약점을 찾는 검토용 휴리스틱입니다. 현재 훈련·부하가 확인되기 전에는 변경 권고나 자동 적용을 하지 않습니다."
  };
}

export function verifiedTrainingReviews(snapshot) {
  return (snapshot.players ?? [])
    .map(verifiedTrainingReview)
    .sort((a,b)=>{
      const ag=a.primary?.gap ?? -1;
      const bg=b.primary?.gap ?? -1;
      return bg-ag || (b.roleFit ?? -1)-(a.roleFit ?? -1) || a.player.name.localeCompare(b.player.name,"ko");
    });
}

export function focusLabel(value) {
  return FOCUS[value]?.label ?? value;
}

function unavailable(player, missing) {
  return {
    player,
    position:player.primaryPosition ?? player.positions?.[0] ?? null,
    role:null,
    roleFit:null,
    roleCoverage:0,
    target:null,
    primary:null,
    alternatives:[],
    bottlenecks:[],
    paHeadroom:player.pa === null || player.ca === null ? null : Math.max(0,player.pa-player.ca),
    action:"판단 보류",
    applyReady:false,
    uncertainty:[...missing,"현재 집중훈련 미확인","훈련 부하 미확인"],
    official:false,
    methodology:"manager-room-training-review-v1",
    note:"검증된 입력이 부족해 훈련 초점 후보를 만들지 않습니다."
  };
}

function roleReadinessTarget(age) {
  if (age <= 17) return 13;
  if (age <= 21) return 14;
  if (age <= 28) return 15;
  return 14;
}
