import { maximumWeightAssignment } from "./realAssignment.js";

const record=v=>v!==null && typeof v==="object" && !Array.isArray(v)
  && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const validMinutes=(v,min,max)=>Number.isInteger(v) && v>=min && v<=max;

/** Manager inputs only. No inference of medical limits or competition rules. */
export function minuteDirectives(snapshot,slots,candidates,input){
  const caps=new Map(),substitutions=new Map(),incomingIds=new Set(),excludedIds=new Set(),conflicts=[];
  const add=(code,message,slotId=null,playerId=null)=>conflicts.push({code,message,slotId,playerId});
  const players=new Map((snapshot.players??[]).map(p=>[p.id,p]));
  if(!record(input)) return {caps,substitutions,incomingIds,excludedIds,conflicts};
  if(input.minuteCaps!=null && !record(input.minuteCaps)) add("invalid-caps","출전시간 상한 형식을 확인하세요.");
  else for(const [id,minutes] of Object.entries(input.minuteCaps??{})){
    caps.set(id,minutes);
    if(!players.has(id)) add("missing-cap-player",`상한 지정 선수 UID ${id}가 최신 스냅샷에 없습니다.`,null,id);
    if(!validMinutes(minutes,0,90)) add("invalid-cap",`UID ${id}: 감독 상한은 0~90의 정수여야 합니다.`,null,id);
    if(minutes===0){
      excludedIds.add(id);
      if(Object.values(input.lockedStarters??{}).includes(id)) add("lock-zero-cap",`UID ${id}: 선발 고정과 0분 상한이 충돌합니다.`,null,id);
    }
  }
  if(input.substitutions!=null && !record(input.substitutions)) add("invalid-subs","교체 지정 형식을 확인하세요.");
  else for(const [slotId,directive] of Object.entries(input.substitutions??{})){
    if(!record(directive)){add("invalid-sub","교체 지정 형식을 확인하세요.",slotId);continue;}
    substitutions.set(slotId,directive);
    if(!slots.some(s=>s.id===slotId)) add("missing-sub-slot",`${slotId}: 현재 포메이션에 없는 교체 지정입니다. 이 경기 지정을 초기화하세요.`,slotId);
    if(directive.minute!=null && !validMinutes(directive.minute,1,89)) add("invalid-sub-minute",`${slotId}: 교체 시점은 1~89의 정수여야 합니다.`,slotId);
    const id=directive.playerId;
    if(id!=null && id!=="" && (typeof id!=="string" || !id.trim())) add("invalid-sub-player",`${slotId}: 교체 선수 UID 형식을 확인하세요.`,slotId);
    if(!id) continue;
    if(incomingIds.has(id)) add("duplicate-sub",`UID ${id}: 여러 슬롯의 교체 선수로 지정했습니다.`,slotId,id);
    incomingIds.add(id);
    if(Object.values(input.lockedStarters??{}).includes(id)) add("starter-sub-conflict",`UID ${id}: 선발 고정과 교체 투입 지정이 충돌합니다.`,slotId,id);
    if((Array.isArray(input.restIds)?input.restIds:[]).includes(id) || excludedIds.has(id)) add("rest-sub-conflict",`UID ${id}: 휴식·0분 상한과 교체 투입이 충돌합니다.`,slotId,id);
    const p=players.get(id);
    if(!p) add("missing-sub-player",`${slotId}: 교체 선수 UID ${id}가 최신 스냅샷에 없습니다.`,slotId,id);
    else if(p.availability?.injuryFree===false || p.availability?.eligible===false) add("unavailable-sub",`${slotId}: ${p.name}의 출전 불가가 확인되었습니다.`,slotId,id);
    else if(!candidates.get(slotId)?.some(r=>r.player.id===id)) add("unverified-sub-role",`${slotId}: ${p.name}의 역할 근거가 부족합니다.`,slotId,id);
  }
  if(incomingIds.size>9) add("review-bench-capacity","교체 선수 지정이 검토용 벤치 9명 범위를 넘습니다. 실제 대회 규정은 별도 확인해야 합니다.");
  return {caps,substitutions,incomingIds,excludedIds,conflicts};
}

/** One change per slot in a 90-minute scenario; explicit incoming players reserved first. */
export function minutePlan(lineup,candidates,directives,restIds){
  const conflicts=[],pending=[],changes=[],appearances=[],reservedRows=[];
  const add=(code,message,slotId)=>conflicts.push({code,message,slotId,playerId:null});
  const starters=new Set(lineup.filter(r=>r.player).map(r=>r.player.id));
  const requests=[],automatic=new Map();
  for(const row of lineup){
    const directive=directives.substitutions.get(row.slot.id);
    if(!row.player){
      if(directive) add("sub-without-starter",`${row.slot.id}: 선발 후보가 없어 교체 계획을 만들 수 없습니다.`,row.slot.id);
      continue;
    }
    const cap=directives.caps.get(row.player.id)??90;
    const minute=directive?.minute??(cap<90?cap:null);
    if(minute===null){
      if(directive?.playerId) add("sub-time-required",`${row.slot.id}: 교체 시점 또는 선발의 90분 미만 상한을 입력하세요.`,row.slot.id);
      appearances.push({playerId:row.player.id,slotId:row.slot.id,kind:"starter",minutes:90});
      continue;
    }
    if(minute>cap) add("starter-cap-exceeded",`${row.slot.id}: 교체 시점이 선발의 감독 상한을 넘습니다.`,row.slot.id);
    const request={slot:row.slot,outgoing:row.player,minute,incoming:null};
    requests.push(request);
    const eligible=(candidates.get(row.slot.id)??[]).filter(r=>!starters.has(r.player.id)
      && !restIds.has(r.player.id) && !directives.excludedIds.has(r.player.id)
      && (directives.caps.get(r.player.id)??90)>=90-minute);
    if(directive?.playerId){
      request.incoming=eligible.find(r=>r.player.id===directive.playerId);
      if(!request.incoming) add("sub-cap-exceeded",`${row.slot.id}: 지정 교체 선수의 출전 상한·투입 조건을 확인하세요.`,row.slot.id);
    }else automatic.set(row.slot.id,eligible.filter(r=>!directives.incomingIds.has(r.player.id)));
  }
  const assigned=new Map(maximumWeightAssignment(automatic).map(r=>[r.slotId,r.row]));
  for(const request of requests){
    const incoming=request.incoming??assigned.get(request.slot.id);
    if(!incoming){pending.push({slotId:request.slot.id,message:`${request.slot.id}: 상한을 지키며 남은 시간을 맡을 교체 후보 근거가 부족합니다.`});continue;}
    reservedRows.push(incoming);
    changes.push({...request,incoming:incoming.player,automatic:!directives.substitutions.get(request.slot.id)?.playerId});
    appearances.push({playerId:request.outgoing.id,slotId:request.slot.id,kind:"starter",minutes:request.minute},
      {playerId:incoming.player.id,slotId:request.slot.id,kind:"substitute",minutes:90-request.minute});
  }
  if(reservedRows.length>9) add("review-bench-capacity","교체 계획이 검토용 벤치 9명 범위를 넘습니다. 대회 규정 확인이 필요합니다.",null);
  return {conflicts,pending,changes,appearances,reservedRows,medicalMinuteCap:null,
    status:conflicts.length?"conflict":pending.length?"planning-required":"review"};
}
