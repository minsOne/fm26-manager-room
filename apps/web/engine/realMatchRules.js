const fields={benchLimit:{label:"벤치 등록 한도",max:23},substitutionLimit:{label:"교체 선수 한도",max:11}};

/** Session-only, fixture-specific user transcription. Never save-derived eligibility. */
export function matchRuleLimits(input){
  const values={benchLimit:null,substitutionLimit:null},conflicts=[];
  const add=message=>conflicts.push({code:"invalid-match-rule",message,slotId:null,playerId:null});
  if(input!=null){
    if(typeof input!=="object" || Array.isArray(input)
      || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) add("경기 규정 입력 형식이 잘못되었습니다. 이 경기 지정을 초기화하세요.");
    else for(const [key,{label,max}] of Object.entries(fields)){
      const value=input[key];
      if(value==null) continue;
      if(!Number.isInteger(value) || value<0 || value>max) add(`${label}: 0~${max}의 정수를 입력하세요. 빈칸은 미확인입니다.`);
      else values[key]=value;
    }
  }
  return {values,conflicts,source:"manager-entry",verified:false,
    reviewBenchLimit:Math.min(9,values.benchLimit??9),
    missing:[values.benchLimit===null?"벤치 등록 한도":null,
      values.substitutionLimit===null?"교체 선수 한도":null,
      "선수별 대회 등록·출전 자격","교체 횟수·하프타임·연장·특별 교체 규정"].filter(Boolean)};
}

export function checkMatchRulePlan(rules,minutes){
  const conflicts=[];
  for(const [key,code,label] of [["benchLimit","match-bench-limit","벤치 등록"],["substitutionLimit","match-substitution-limit","교체 선수"]]){
    const limit=rules.values[key];
    if(limit!==null && minutes.changes.length>limit) conflicts.push({code,
      message:`계획 교체 선수 ${minutes.changes.length}명이 감독 입력 ${label} 한도 ${limit}명을 넘습니다. 계획 또는 입력 규정을 확인하세요.`,slotId:null,playerId:null});
  }
  return conflicts;
}
