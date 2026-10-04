import { validDate } from './realHistory.js';
const KEY='managerRoom.careerArchive.v1';
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const str=v=>typeof v==='string'&&v.length>0&&v.length<=512;
const stats=v=>Object.fromEntries(Object.entries(v??{}).filter(([k,n])=>/^[a-zA-Z][a-zA-Z0-9]*$/.test(k)&&integer(n,1,20)));
const identity=s=>JSON.stringify([s.selectionId??s.saveId,s.manager.clubUid,s.manager.name]);
const format=s=>JSON.stringify([s.source,s.dbVersion,s.build]);
const bytes=s=>new TextEncoder().encode(s).byteLength;

/** Bounded, browser-local observations; never inferred match or training outcomes. */
export class CareerArchive {
  constructor({storage=null,namespace='',maxBytes=3*1024*1024,maxDates=60,maxSegments=8}={}){
    this.storage=storage;this.restoreStorage=storage;this.key=KEY+':'+namespace;this.maxBytes=maxBytes;this.maxDates=maxDates;this.maxSegments=maxSegments;
    this.data={version:1,segments:[]};this.warning=storage?null:'브라우저 저장소 사용 불가: 기록은 현재 세션에만 유지됩니다.';
    try{
      const text=storage?.getItem(this.key);
      if(text){
        if(bytes(text)>maxBytes)throw Error('archive too large');
        const data=JSON.parse(text);
        if(!validArchive(data,maxDates,maxSegments))throw Error('invalid archive');
        this.data=data;
      }
    }catch{
      // Preserve unreadable persisted data; do not silently overwrite it with an empty archive.
      this.storage=null;this.warning='보관 기록을 읽지 못했습니다. 기존 저장 내용은 유지하고 현재 세션에서만 기록합니다.';
    }
  }
  segment(s){return this.data.segments.findLast(x=>x.key===identity(s));}
  boundary(s){
    if(!s.selectionId&&!s.saveId)return null;
    const segment=this.segment(s);if(!segment)return null;
    if(s.gameDate<segment.records.at(-1).date)return '게임 날짜가 이전 기록보다 과거입니다. 새 게임·이전 저장 분기를 별도 기록으로 시작하세요.';
    if(format(s)!==segment.format)return '데이터 출처 또는 버전이 바뀌었습니다. 이전 기록과 비교하지 않고 새 기록으로 시작하세요.';
    return null;
  }
  capture(snapshot,{restart=false}={}){
    if(!snapshot.selectionId&&!snapshot.saveId)return this.decorate(snapshot,null,'고정 세이브 식별자가 없어 누적 기록을 보류합니다.');
    if(!restart&&this.boundary(snapshot))return this.decorate(snapshot,null,this.boundary(snapshot));
    const data=structuredClone(this.data);let segment=data.segments.findLast(x=>x.key===identity(snapshot));
    if(!segment||restart){
      segment={id:globalThis.crypto.randomUUID(),key:identity(snapshot),format:format(snapshot),records:[],decisions:[]};
      data.segments.push(segment);
    }
    const record={date:snapshot.gameDate,players:snapshot.players.map(p=>({id:p.id,ca:p.ca,attributes:stats(p.attributes)}))};
    // Last accepted observation per calendar date. Repeated polling never creates growth.
    segment.records=segment.records.filter(r=>r.date!==record.date);segment.records.push(record);
    segment.records=segment.records.slice(-this.maxDates);
    data.segments=data.segments.filter(s=>s!==segment);data.segments.push(segment);
    data.segments=data.segments.slice(-this.maxSegments);
    let serialized=JSON.stringify(data);
    while(bytes(serialized)>this.maxBytes){
      if(data.segments.length>1)data.segments.shift();
      else if(segment.records.length>1)segment.records.shift();
      else return this.decorate(snapshot,null,'현재 스냅샷이 보관 용량을 초과하여 누적 기록을 보류합니다.');
      serialized=JSON.stringify(data);
    }
    if(!validArchive(data,this.maxDates,this.maxSegments))return this.decorate(snapshot,null,'관측 기록 형식이 보관 조건을 충족하지 않아 저장하지 않았습니다.');
    this.data=data;
    if(this.storage)try{this.storage.setItem(this.key,serialized);this.warning=null;}
    catch{this.warning='브라우저 저장 공간 부족 또는 접근 실패: 이번 기록은 현재 세션에만 유지됩니다.';}
    return this.decorate(snapshot,segment);
  }
  exportText(){return JSON.stringify({kind:"fm26-manager-room-observations",version:1,archive:this.data});}
  inspectImport(text){
    if(typeof text!=="string"||bytes(text)>this.maxBytes+65536)throw Error("기록 파일 크기 제한을 초과했습니다.");
    let packet;try{packet=JSON.parse(text);}catch{throw Error("기록 파일 JSON이 올바르지 않습니다.");}
    if(packet?.kind!=="fm26-manager-room-observations"||packet.version!==1
      ||!validArchive(packet.archive,this.maxDates,this.maxSegments)
      ||bytes(JSON.stringify(packet.archive))>this.maxBytes)throw Error("지원하지 않거나 손상된 기록 파일입니다. 기존 기록은 유지합니다.");
    return {data:packet.archive,segments:packet.archive.segments.length,
      dates:packet.archive.segments.reduce((n,s)=>n+s.records.length,0)};
  }
  importText(text){
    const inspected=this.inspectImport(text),serialized=JSON.stringify(inspected.data);
    // Persist before swapping memory: a failed restore must not destroy the current archive.
    const target=this.restoreStorage;
    if(!target)throw Error("영구 저장소를 사용할 수 없어 가져오기를 중단했습니다. 기존 기록은 유지합니다.");
    try{target.setItem(this.key,serialized);}catch{throw Error("가져온 기록을 저장하지 못했습니다. 기존 기록은 유지합니다.");}
    this.storage=target;this.data=structuredClone(inspected.data);this.warning=null;return inspected;
  }
  view(snapshot){
    const reason=this.boundary(snapshot);
    return this.decorate(snapshot,reason?null:this.segment(snapshot),reason);
  }
  saveDecision(snapshot,plan){
    if(!plan || plan.review.status!=="review" || !plan.review.selectedCount)return this.view(snapshot);
    const segment=this.segment(snapshot);
    if(!segment || segment.id!==snapshot.observationLineage || this.boundary(snapshot))return this.view(snapshot);
    const record={id:globalThis.crypto.randomUUID(),date:snapshot.gameDate,fixtureId:String(plan.fixture.id),fixtureDate:plan.fixture.date,
      formation:plan.review.formation,assessment:"pending",
      lineup:plan.review.lineup.filter(r=>r.player).map(r=>({slot:r.slot.id,playerId:r.player.id})),
      changes:plan.review.minutePlan.changes.map(c=>({slot:c.slot.id,outgoingId:c.outgoing.id,incomingId:c.incoming.id,minute:c.minute})),
      decisionMissing:plan.review.decisionMissing.slice(0,30)};
    const data=structuredClone(this.data),copy=data.segments.find(s=>s.id===segment.id);
    copy.decisions=[...(copy.decisions??[]),record].slice(-30);
    return this.commitJournal(snapshot,data);
  }
  assessDecision(snapshot,id,assessment){
    if(!["pending","helpful","needs-review"].includes(assessment))return this.view(snapshot);
    const data=structuredClone(this.data),segment=data.segments.find(s=>s.id===snapshot.observationLineage);
    const row=segment?.decisions?.find(r=>r.id===id);if(!row)return this.view(snapshot);
    row.assessment=assessment;return this.commitJournal(snapshot,data);
  }
  commitJournal(snapshot,data){
    const serialized=JSON.stringify(data);
    if(bytes(serialized)>this.maxBytes)return this.decorate(snapshot,this.segment(snapshot),'검토 기록 보관 용량을 초과했습니다. 이번 변경은 저장하지 않았습니다.');
    if(!validArchive(data,this.maxDates,this.maxSegments))return this.decorate(snapshot,null,'관측 기록 형식이 보관 조건을 충족하지 않아 저장하지 않았습니다.');
    this.data=data;
    if(this.storage)try{this.storage.setItem(this.key,serialized);this.warning=null;}
    catch{this.warning='브라우저 저장 실패: 검토 기록은 현재 세션에만 유지됩니다.';}
    return this.view(snapshot);
  }
  decorate(snapshot,segment,warning=null){
    // Always keep the source snapshot immutable and keep native history separate.
    const rows=new Map();
    for(const r of segment?.records??[])for(const p of r.players){
      if(!rows.has(p.id))rows.set(p.id,[]);
      rows.get(p.id).push({date:r.date,ca:p.ca,attributes:p.attributes,lineage:segment.id});
    }
    return {...snapshot,decisionJournal:structuredClone(segment?.decisions??[]),observationLineage:segment?.id??null,
      observationArchive:{dates:segment?.records.length??0,from:segment?.records[0]?.date??null,through:segment?.records.at(-1)?.date??null,
        segments:this.data.segments.length,maxDates:this.maxDates,maxSegments:this.maxSegments,warning:warning??this.warning},
      players:snapshot.players.map(p=>({...p,observations:rows.get(p.id)??[]}))};
  }
}
function validArchive(data,maxDates,maxSegments){
  if(!object(data)||data.version!==1||!Array.isArray(data.segments)||data.segments.length>maxSegments)return false;
  const ids=new Set();
  return data.segments.every(s=>{
    if(!object(s)||!str(s.id)||ids.has(s.id)||!str(s.key)||!str(s.format)||!Array.isArray(s.records)||!s.records.length||s.records.length>maxDates)return false;
    if(s.decisions!==undefined && (!Array.isArray(s.decisions)||s.decisions.length>30||!validDecisions(s.decisions)))return false;
    ids.add(s.id);let previous='';
    return s.records.every(r=>{
      if(!object(r)||!validDate(r.date)||r.date<=previous||!Array.isArray(r.players)||r.players.length>250000)return false;
      previous=r.date;const players=new Set();
      return r.players.every(p=>{
        if(!object(p)||!str(p.id)||players.has(p.id)||(p.ca!==null&&!integer(p.ca,0,200))||!object(p.attributes))return false;
        players.add(p.id);return Object.entries(p.attributes).every(([k,v])=>/^[a-zA-Z][a-zA-Z0-9]*$/.test(k)&&integer(v,1,20));
      });
    });
  });
}

function validDecisions(rows){
  const ids=new Set();
  return rows.every(r=>{
    if(!object(r)||!str(r.id)||ids.has(r.id)||!validDate(r.date)||!validDate(r.fixtureDate)||!str(r.fixtureId)||!str(r.formation)
      ||!["pending","helpful","needs-review"].includes(r.assessment)
      ||!Array.isArray(r.lineup)||r.lineup.length>11||!Array.isArray(r.changes)||r.changes.length>9
      ||!Array.isArray(r.decisionMissing)||r.decisionMissing.length>30||!r.decisionMissing.every(str))return false;
    ids.add(r.id);
    return r.lineup.every(p=>object(p)&&str(p.slot)&&str(p.playerId))
      &&r.changes.every(c=>object(c)&&str(c.slot)&&str(c.outgoingId)&&str(c.incomingId)&&integer(c.minute,1,89));
  });
}
