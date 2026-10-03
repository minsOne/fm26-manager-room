import { roleDefinitions } from "./roles.js";

const POSITION_CODES = {
  GK:["GK"], CB:["DC","SW"], LB:["DL","WBL"], RB:["DR","WBR"],
  DM:["DM"], CM:["MC"], AM:["AMC"], LW:["ML","AML"], RW:["MR","AMR"], ST:["STC"]
};

const ROLE_OPTIONS = {
  GK:["Goalkeeper","Sweeper Keeper"],
  CB:["Central Defender","Ball Playing Defender"],
  LB:["Full Back","Wing Back"],
  RB:["Full Back","Wing Back"],
  DM:["Holding Midfielder","Deep Lying Playmaker","Central Midfielder"],
  CM:["Central Midfielder","Deep Lying Playmaker","Advanced Playmaker"],
  AM:["Advanced Playmaker","Central Midfielder","Inside Forward"],
  LW:["Winger","Inside Forward","Advanced Playmaker"],
  RW:["Winger","Inside Forward","Advanced Playmaker"],
  ST:["Advanced Forward","Pressing Forward"]
};

export function verifiedRoleFit(player, position, role) {
  const definition = roleDefinitions[role];
  if (!definition) return unavailable("지원하지 않는 역할입니다.");

  const entries = Object.entries(definition);
  const totalWeight = entries.reduce((sum,[,weight])=>sum+weight,0);
  let knownWeight = 0;
  let weighted = 0;
  const missing = [];
  const evidence = [];

  for (const [attribute,weight] of entries) {
    const value = player.attributes?.[attribute];
    if (Number.isInteger(value) && value >= 1 && value <= 20) {
      knownWeight += weight;
      weighted += value * weight;
      evidence.push({attribute,value,weight});
    } else {
      missing.push(attribute);
    }
  }

  const coverage = totalWeight ? knownWeight / totalWeight : 0;
  if (coverage < 0.8) {
    return {
      ...unavailable("역할 핵심 능력치가 충분히 확인되지 않았습니다."),
      coverage,
      missing,
      evidence
    };
  }

  const attributeScore = Math.round(weighted / (20 * knownWeight) * 100);
  const position = verifiedPositionFamiliarity(player, position);
  if (position.score === null) {
    return {
      ...unavailable("포지션 숙련도를 확인할 수 없습니다."),
      coverage,
      missing,
      evidence,
      attributeScore,
      position
    };
  }

  // Manager Room heuristic, not an FM/SI role rating:
  // most weight is the observed role attributes, with a smaller verified position-familiarity term.
  const score = Math.round(attributeScore * 0.82 + position.score * 0.18);
  const strongest = [...evidence].sort((a,b)=>(b.value*b.weight)-(a.value*a.weight)).slice(0,3);
  const gaps = [...evidence].sort((a,b)=>(a.value*a.weight)-(b.value*b.weight)).slice(0,3);

  return {
    score,
    attributeScore,
    positionScore: position.score,
    position,
    coverage,
    missing,
    evidence,
    strongest,
    gaps,
    label: band(score),
    methodology:"manager-room-role-fit-v1",
    official:false
  };
}

export function bestVerifiedRoles(player, position, limit=4) {
  const roles = ROLE_OPTIONS[position] ?? [];
  return roles
    .map(role=>({role,...verifiedRoleFit(player,position,role)}))
    .filter(row=>row.score !== null)
    .sort((a,b)=>b.score-a.score)
    .slice(0,limit);
}

export function verifiedPositionFamiliarity(player, position) {
  const keys = POSITION_CODES[position] ?? [];
  const ratings = player.positionRatings ?? {};
  const values = keys
    .map(key=>ratings[key])
    .filter(value=>Number.isInteger(value) && value >= 1 && value <= 20);

  if (values.length) {
    const raw = Math.max(...values);
    return {score:raw*5, raw, source:"positionRatings", known:true};
  }

  if (player.positionsKnown !== false && player.positions?.includes(position)) {
    return {score:85, raw:null, source:"derivedPosition", known:false};
  }

  return {score:null, raw:null, source:"unknown", known:false};
}

function unavailable(reason) {
  return {
    score:null, attributeScore:null, positionScore:null, position:null,
    coverage:0, missing:[], evidence:[], strongest:[], gaps:[],
    label:"미확인", methodology:"manager-room-role-fit-v1", official:false, reason
  };
}

function band(score) {
  if (score >= 85) return "매우 적합";
  if (score >= 75) return "적합";
  if (score >= 65) return "검토";
  return "낮음";
}
