import { bestVerifiedRoles } from './realRoleFit.js';
import { recruitmentReview } from './realRecruitment.js';
import { growthReview } from './realSnapshot.js';

/** Evidence reviews, not prescriptions or in-game training catalogue entries. */
export function trainingReview(player){
  const position=player.primaryPosition??player.positions?.[0];
  const best=position?bestVerifiedRoles(player,position,1)[0]:null;
  if(!best)return {role:null,attributes:[],reason:'역할·능력치 근거 부족'};
  const attributes=best.evidence.slice().sort((a,b)=>a.value-b.value||b.weight-a.weight||a.attribute.localeCompare(b.attribute)).slice(0,3);
  return {role:best.role,attributes,reason:'해당 역할 핵심 능력치 중 낮은 관측값입니다. 실제 집중훈련·훈련 강도 처방이 아닙니다.'};
}

/** Only compare explicitly supplied external candidates; do not fabricate a world index. */
export function candidateComparison(snapshot){
  const owned=new Set(snapshot.players.map(p=>p.id)),seen=new Set();
  return recruitmentReview(snapshot).flatMap(depth=>{
    const candidates=(snapshot.candidates??[]).filter(p=>!owned.has(p.id)).flatMap(player=>{
      if(player.availability?.eligible===false)return [];
      const role=bestVerifiedRoles(player,depth.position,1)[0];
      return role?[{player,position:depth.position,role:role.role,score:role.score,
        backupDifference:depth.backup?role.score-depth.backup.score:null}]:[];
    }).sort((a,b)=>b.score-a.score||a.player.id.localeCompare(b.player.id)).slice(0,3);
    return candidates.filter(c=>{const key=JSON.stringify([c.position,c.player.id]);if(seen.has(key))return false;seen.add(key);return true;});
  });
}

export function observationReport(snapshot){
  const rows=snapshot.players.map(player=>({player,...growthReview(player,snapshot)}));
  return {comparable:rows.filter(r=>r.delta!==null).length,total:rows.length,
    increased:rows.filter(r=>r.delta>0).length,decreased:rows.filter(r=>r.delta<0).length,
    unchanged:rows.filter(r=>r.delta===0).length,rows:rows.filter(r=>r.delta!==null),
    note:'비교 가능한 수록 선수만 집계합니다. 이적·누락 선수나 훈련·추천의 인과 효과를 추정하지 않습니다.'};
}

export function evidenceBriefing(snapshot){
  const missing=key=>snapshot.players.filter(p=>p.availability?.[key]==null).length;
  const report=observationReport(snapshot);
  return [
    {topic:'수록 범위',evidence:`관리팀 ${snapshot.players.length}명 / 외부 후보 ${snapshot.candidates?.length??0}명`,action:'전 세계 전체 선수 범위가 아닙니다.'},
    {topic:'의료·자격',evidence:`부상 여부 미확인 ${missing('injuryFree')}명 / 출전 자격 미확인 ${missing('eligible')}명`,action:'FM 경기 준비·의료 화면에서 확인'},
    {topic:'성장 관측',evidence:`서로 다른 날짜 비교 가능 ${report.comparable} / ${report.total}명`,action:'게임 날짜가 진행된 저장을 수집; CA 변화는 훈련 효과의 증명이 아님'},
    {topic:'계약',evidence:`종료일 확인 ${snapshot.players.filter(p=>p.contractEnd).length} / ${snapshot.players.length}명`,action:'임대·방출 판단 전 시장 관심·오퍼·출전 약속 확인'},
    {topic:'외부 AI',evidence:'CLI에서 명시적 요청 가능; 이 브리핑은 로컬 계산',action:'외부 전송·게임 수정 없음'}
  ];
}
