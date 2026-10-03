const record=value=>value!==null && typeof value==="object" && !Array.isArray(value)
  && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const uid=value=>typeof value==="string" && value.trim().length>0;

/** Validate hard manager directives without weakening evidence/availability gates. */
export function selectionConstraints(snapshot, slots, candidates, input={}){
  const conflicts=[];
  const add=(code,message,slotId=null,playerId=null)=>conflicts.push({code,message,slotId,playerId});
  const restIds=new Set();
  const lockedStarters=new Map();
  const players=new Map((snapshot.players??[]).map(p=>[p.id,p]));
  if(!record(input)){
    add("invalid-constraints","감독 지정 형식이 잘못되었습니다. 이 경기 지정을 초기화하세요.");
    return {conflicts,restIds,lockedStarters,lockedRows:new Map()};
  }
  const rests=input.restIds??[];
  const locks=input.lockedStarters??{};
  if(!Array.isArray(rests)) add("invalid-rests","휴식 지정 목록 형식이 잘못되었습니다.");
  else for(const id of rests){
    if(!uid(id)) add("invalid-rest-id","휴식 지정 선수 UID 형식이 잘못되었습니다.");
    else {
      restIds.add(id);
      if(!players.has(id)) add("missing-rest-player",`휴식 지정 선수 UID ${id}가 최신 스냅샷에 없습니다. 지정을 확인하세요.`,null,id);
    }
  }
  if(!record(locks)) add("invalid-locks","선발 고정 목록 형식이 잘못되었습니다.");
  else for(const [slotId,id] of Object.entries(locks)){
    if(!uid(id)) add("invalid-lock-id",`${slotId}: 선발 고정 선수 UID 형식이 잘못되었습니다.`,slotId);
    else lockedStarters.set(slotId,id);
  }
  const slotIds=new Set(slots.map(s=>s.id));
  const used=new Set();
  const lockedRows=new Map();
  for(const [slotId,id] of lockedStarters){
    if(!slotIds.has(slotId)) add("missing-slot",`${slotId}: 현재 포메이션에 없는 슬롯입니다. 고정을 해제하거나 포메이션을 확인하세요.`,slotId,id);
    if(used.has(id)) add("duplicate-lock",`선수 UID ${id}를 여러 슬롯에 고정했습니다. 한 슬롯만 남기세요.`,slotId,id);
    used.add(id);
    if(restIds.has(id)) add("lock-rest-conflict",`선수 UID ${id}의 선발 고정과 휴식 지정이 충돌합니다. 하나를 해제하세요.`,slotId,id);
    const player=players.get(id);
    if(!player){
      add("missing-locked-player",`${slotId}: 고정 선수 UID ${id}가 최신 스냅샷에 없습니다. 고정을 확인하세요.`,slotId,id);
      continue;
    }
    if(player.availability?.injuryFree===false || player.availability?.eligible===false){
      add("unavailable-locked-player",`${slotId}: ${player.name}의 부상 또는 출전 불가가 확인됐습니다. 고정을 해제하세요.`,slotId,id);
      continue;
    }
    if(slotIds.has(slotId) && !restIds.has(id)){
      const row=candidates.get(slotId)?.find(r=>r.player.id===id);
      if(!row) add("unverified-locked-role",`${slotId}: ${player.name}의 역할 적합도 근거가 부족합니다. 다른 슬롯·선수를 선택하세요.`,slotId,id);
      else lockedRows.set(slotId,{...row,locked:true,selectionEvidence:["감독이 지정한 경기별 선발 고정",...row.selectionEvidence]});
    }
  }
  return {conflicts,restIds,lockedStarters,lockedRows};
}

/** Isolated per-fixture browser preferences; never attached to native snapshots. */
export function editFixtureSelection(byFixture,fixtureId,edit){
  const previous=byFixture.get(fixtureId)??{lockedStarters:{},restIds:[]};
  const next={...previous,lockedStarters:{...previous.lockedStarters},restIds:[...previous.restIds]};
  if(edit.type==="clear") {byFixture.delete(fixtureId);return;}
  if(edit.type==="lock"){
    if(edit.playerId) Object.defineProperty(next.lockedStarters,edit.slotId,{value:edit.playerId,enumerable:true,configurable:true,writable:true});
    else delete next.lockedStarters[edit.slotId];
  }
  if(edit.type==="rest"){
    const ids=new Set(next.restIds);
    if(edit.rest) ids.add(edit.playerId);else ids.delete(edit.playerId);
    next.restIds=[...ids];
  }
  if(edit.type==="cap"){
    next.minuteCaps={...previous.minuteCaps};
    if(edit.minutes===null) delete next.minuteCaps[edit.playerId];
    else Object.defineProperty(next.minuteCaps,edit.playerId,{value:edit.minutes,enumerable:true,configurable:true,writable:true});
  }
  if(edit.type==="sub"){
    next.substitutions={...previous.substitutions};
    const directive={...previous.substitutions?.[edit.slotId],[edit.field]:edit.value};
    if(directive.minute==null && !directive.playerId) delete next.substitutions[edit.slotId];
    else Object.defineProperty(next.substitutions,edit.slotId,{value:directive,enumerable:true,configurable:true,writable:true});
  }
  byFixture.set(fixtureId,next);
}
