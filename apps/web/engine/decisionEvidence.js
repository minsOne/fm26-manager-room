import { validDate } from './realHistory.js';

export const EVIDENCE_BYTES=1024*1024;
const groups=['eligibility','medical','catalogue','assignments','offers','results','economy'];
const bytes=s=>new TextEncoder().encode(s).byteLength;
const fail=message=>{throw Error(`근거 자료: ${message}`);};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=300;
const num=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const integer=(x,min,max)=>Number.isInteger(x)&&num(x,min,max);
const tri=x=>x===null||typeof x==='boolean';
const optional=(x,check)=>x===null||check(x);
function shape(x,keys){if(!obj(x)||Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))fail('필드 누락 또는 지원하지 않는 필드입니다.');}
function rows(x,key,limit=1000){if(!Array.isArray(x)||x.length>limit)fail(`${key} 목록 제한 초과`);}
function unique(list,key,label){const seen=new Set();for(const row of list){const k=key(row);if(seen.has(k))fail(`${label} 중복`);seen.add(k);}}
function requireThat(condition,label){if(!condition)fail(`${label} 값 또는 연결을 확인하세요.`);}
const amount=x=>optional(x,v=>num(v,0,1e12));
const currency=x=>typeof x==='string'&&/^[A-Z]{3}$/.test(x);
const attribute=x=>typeof x==='string'&&/^[a-zA-Z][a-zA-Z0-9]{0,49}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);

export function evidenceScope(s){
  return {career:s.careerKey,lineage:s.observationLineage??null,date:s.gameDate,source:s.source,dbVersion:s.dbVersion??null,build:s.build??null};
}
export function sameEvidenceScope(a,b){return obj(a)&&obj(b)&&Object.keys(b).every(k=>a[k]===b[k])&&Object.keys(a).length===Object.keys(b).length;}
export function evidenceTemplate(s){
  if(!s?.observationLineage||(!s.selectionId&&!s.saveId))fail('고정 세이브와 관측 구간 연결 후 사용하세요.');
  return {kind:'fm26-manager-room-evidence',version:1,scope:evidenceScope(s),source:'manager-transcription',
    ...Object.fromEntries(groups.map(k=>[k,[]]))};
}

/** Strict, bounded user transcriptions. This validates shape and scope, not FM extraction. */
export function readEvidence(text,s){
  if(typeof text!=='string'||bytes(text)>EVIDENCE_BYTES)fail('파일은 1MB 이하여야 합니다.');
  let p;try{p=JSON.parse(text);}catch{fail('JSON 형식 오류');}
  shape(p,['kind','version','scope','source',...groups]);
  const scope=evidenceScope(s);
  requireThat(s.observationLineage&&(s.selectionId||s.saveId)&&sameEvidenceScope(p.scope,scope),'커리어·관측 구간·날짜·버전');
  requireThat(p.kind==='fm26-manager-room-evidence'&&p.version===1&&p.source==='manager-transcription','자료 종류');
  groups.forEach(k=>rows(p[k],k));
  const players=new Set(s.players.map(v=>v.id)),allPlayers=new Set([...players,...(s.candidates??[]).map(v=>v.id)]);
  for(const r of p.eligibility){
    shape(r,['playerId','fixtureId','competitionId','registered','exempt','suspended','workPermit','otherRulesClear','reference']);
    const f=s.fixtures.find(f=>f.id===r.fixtureId);
    requireThat(players.has(r.playerId)&&f&&f.date>=s.gameDate&&f.competitionId!=null&&r.competitionId===f.competitionId,'선수·경기·대회 ID');
    requireThat(['registered','exempt','suspended','workPermit','otherRulesClear'].every(k=>tri(r[k]))&&str(r.reference),'출전 자격');
  }
  unique(p.eligibility,r=>JSON.stringify([r.fixtureId,r.playerId]),'경기별 선수');
  for(const r of p.medical){
    shape(r,['playerId','injured','fatigueLabel','riskLabel','reference']);
    requireThat(players.has(r.playerId)&&tri(r.injured)&&optional(r.fatigueLabel,str)&&optional(r.riskLabel,str)&&str(r.reference),'의료 관측');
  }
  unique(p.medical,r=>r.playerId,'의료 선수');
  for(const r of p.catalogue){
    shape(r,['id','name','attributes','reference']);rows(r.attributes,'훈련 능력치',20);
    requireThat(str(r.id)&&str(r.name)&&str(r.reference)&&r.attributes.length>0&&r.attributes.every(attribute),'훈련 항목');
    unique(r.attributes,x=>x,'훈련 능력치');
  }
  unique(p.catalogue,r=>r.id,'훈련 항목');
  for(const r of p.assignments){
    shape(r,['playerId','focusId','since','reference']);
    requireThat(players.has(r.playerId)&&p.catalogue.some(c=>c.id===r.focusId)&&validDate(r.since)&&r.since<=s.gameDate&&str(r.reference),'훈련 배정');
  }
  unique(p.assignments,r=>r.playerId,'훈련 배정 선수');
  for(const r of p.offers){
    shape(r,['id','playerId','kind','club','expires','interest','registration','contractClear','currency','fee','weeklyWage','feeThreshold','maxWeeklyWage','facility','minFacility','promisedMinutes','minMinutes','reference']);
    requireThat(str(r.id)&&allPlayers.has(r.playerId)&&['buy','loan-out','sell','release'].includes(r.kind)&&str(r.club)&&validDate(r.expires)&&str(r.reference),'오퍼');
    requireThat(r.kind==='buy'?!players.has(r.playerId):players.has(r.playerId),'오퍼 대상 선수');
    requireThat(['interest','registration','contractClear'].every(k=>tri(r[k]))&&currency(r.currency),'관심·등록·계약·통화');
    requireThat(['fee','weeklyWage','feeThreshold','maxWeeklyWage'].every(k=>amount(r[k])),'오퍼 금액');
    requireThat(['facility','minFacility'].every(k=>optional(r[k],v=>integer(v,1,20)))&&['promisedMinutes','minMinutes'].every(k=>optional(r[k],v=>integer(v,0,90))),'시설·경기당 약속 출전분');
  }
  unique(p.offers,r=>r.id,'오퍼');
  for(const r of p.results){
    shape(r,['fixtureId','date','goalsFor','goalsAgainst','starters','minutes','reference']);
    rows(r.starters,'실제 선발',11);rows(r.minutes,'실제 출전분',23);
    requireThat(str(r.fixtureId)&&validDate(r.date)&&r.date<=s.gameDate&&integer(r.goalsFor,0,99)&&integer(r.goalsAgainst,0,99)&&r.starters.length===11&&r.starters.every(str)&&str(r.reference),'경기 결과');
    requireThat((s.decisionJournal??[]).some(d=>d.fixtureId===r.fixtureId&&d.fixtureDate===r.date),'보관한 경기 계획');
    unique(r.starters,x=>x,'실제 선발');
    for(const m of r.minutes){shape(m,['playerId','minutes']);requireThat(str(m.playerId)&&integer(m.minutes,0,130),'실제 출전분');}
    unique(r.minutes,m=>m.playerId,'출전분 선수');
    requireThat(r.starters.every(id=>r.minutes.some(m=>m.playerId===id)),'선발 출전분 (0분도 명시)');
  }
  unique(p.results,r=>r.fixtureId,'경기 결과');
  for(const r of p.economy){
    shape(r,['clubId','leagueId','currency','from','through','income','expenditure','transferSpend','transferIncome','wageSpend','reference']);
    requireThat(str(r.clubId)&&str(r.leagueId)&&currency(r.currency)&&validDate(r.from)&&validDate(r.through)&&r.from<=r.through&&r.through<=s.gameDate&&str(r.reference),'재정 기간·구단·리그');
    requireThat(['income','expenditure','transferSpend','transferIncome','wageSpend'].every(k=>num(r[k],0,1e12)),'기간 실제 지출');
    requireThat(r.transferSpend+r.wageSpend<=r.expenditure&&r.transferIncome<=r.income,'총액과 세부 지출');
  }
  unique(p.economy,r=>JSON.stringify([r.clubId,r.currency,r.from,r.through]),'구단 재정 기간');
  for(let i=0;i<p.economy.length;i++)for(let j=0;j<i;j++){
    const a=p.economy[i],b=p.economy[j];
    if(a.clubId===b.clubId&&a.from<=b.through&&b.from<=a.through)fail('구단 재정 기간이 겹칩니다.');
  }
  return p;
}

/** One review packet per bridge. Stale packets remain exportable but never influence decisions. */
export class DecisionEvidence {
  constructor({storage=null,namespace=''}={}){this.storage=storage;this.key=`managerRoom.decisionEvidence.v1:${namespace}`;this.text=null;this.warning=null;
    try{this.text=storage?.getItem(this.key)??null;if(this.text!==null&&(typeof this.text!=='string'||bytes(this.text)>EVIDENCE_BYTES))throw Error();}
    catch{this.text=null;this.warning='저장된 근거를 읽지 못했습니다. 기존 저장 내용은 유지합니다.';}
  }
  importText(text,s){const packet=readEvidence(text,s),serialized=JSON.stringify(packet);
    if(!this.storage)fail('브라우저 저장소 사용 불가. 기존 자료를 유지합니다.');
    try{this.storage.setItem(this.key,serialized);}catch{fail('저장 실패. 기존 자료를 유지합니다.');}
    this.text=serialized;this.warning=null;return this.view(s);
  }
  view(s){
    if(!this.text)return {...s,decisionEvidence:null,evidenceWarning:this.warning};
    try{return {...s,decisionEvidence:readEvidence(this.text,s),evidenceWarning:null};}
    catch(error){return {...s,decisionEvidence:null,evidenceWarning:error.message+' 기존 파일은 내보낼 수 있습니다.'};}
  }
  exportText(){if(!this.text)fail('보관한 근거가 없습니다.');return this.text;}
}
