import test from 'node:test';
import assert from 'node:assert/strict';
import { CareerArchive } from '../engine/careerArchive.js';
import { SnapshotSession } from '../engine/snapshotSession.js';
import { normalizeRealSnapshot, growthReview } from '../engine/realSnapshot.js';
import { trainingReview, candidateComparison, observationReport, evidenceBriefing } from '../engine/realReviews.js';
import { renderRoom, statusHTML } from '../previewView.js';
const raw=(date='2037-07-01',ca=120)=>({schemaVersion:2,source:'rust-native',saveId:'career',saveName:'Career',dbVersion:'26.2',gameDate:date,manager:{clubUid:1,club:'FC',name:'Manager'},players:[{id:'7',name:'P',ca,pa:140,paKnown:true,positions:['CM'],positionRatings:{MC:20},attributes:{passing:14,strength:9},fitness:{},playingTime:{},contract:{}}],fixtures:[]});
const snap=(date,ca)=>normalizeRealSnapshot(raw(date,ca));
function memory(){const m=new Map();return {m,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}
const response=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});

test('same-day replace, cross-day growth and reload persistence preserve source',()=>{
  const storage=memory(),a=new CareerArchive({storage});const s=snap();const original=structuredClone(s);
  assert.equal(growthReview(a.capture(s).players[0],a.capture(s)).delta,null);
  a.capture(snap('2037-07-01',121));const b=a.capture(snap('2037-07-02',123));
  assert.equal(growthReview(b.players[0],b).delta,2);assert.equal(b.observationArchive.dates,2);assert.deepEqual(s,original);
  const c=new CareerArchive({storage}).capture(snap('2037-07-03',124));
  assert.equal(growthReview(c.players[0],c).delta,3);assert.equal(c.observationArchive.dates,3);
});
test('unknown identifier never archives or creates a false lineage',()=>{
  const s=snap();s.saveId=null;const a=new CareerArchive({storage:memory()});
  assert.equal(a.capture(s).observationArchive.dates,0);assert.equal(a.data.segments.length,0);
});
test('rollback and parser-version changes require a new segment',()=>{
  const a=new CareerArchive({storage:memory()});const first=a.capture(snap('2037-07-03',125));
  const back=snap('2037-07-01',120);assert.match(a.boundary(back),/과거/);
  assert.equal(a.capture(back).observationArchive.dates,0);assert.equal(a.data.segments.length,1);
  const fresh=a.capture(back,{restart:true});assert.notEqual(fresh.observationLineage,first.observationLineage);
  assert.equal(fresh.observationArchive.dates,1);assert.equal(a.data.segments.length,2);
  const version=snap('2037-07-02',123);version.dbVersion='27';assert.match(a.boundary(version),/버전/);
});
test('new save IDs, club/manager changes and bridge namespaces do not mix',()=>{
  const storage=memory();const a=new CareerArchive({storage,namespace:'A'});a.capture(snap());
  for(const mutate of [s=>s.saveId='other',s=>s.manager.clubUid='2',s=>s.manager.name='Other']){
    const s=snap('2037-07-02',130);mutate(s);const b=a.capture(s);assert.equal(b.observationArchive.dates,1);
  }
  assert.equal(new CareerArchive({storage,namespace:'B'}).data.segments.length,0);
});
test('missing player observations never become zero and attributes compare only known pairs',()=>{
  const a=new CareerArchive({storage:memory()});a.capture(snap());
  const absent=snap('2037-07-02');absent.players=[];a.capture(absent);
  const s=snap('2037-07-03',120);s.players[0].attributes={passing:15,newField:10};const b=a.capture(s);const g=growthReview(b.players[0],b);
  assert.equal(g.delta,0);assert.equal(g.observations,2);assert.deepEqual(g.attributes,[{key:'passing',from:14,to:15,delta:1}]);
  assert.equal(observationReport(b).unchanged,1);
});
test('retention prunes oldest dates and preserves the active segment under byte pressure',()=>{
  const a=new CareerArchive({storage:memory(),maxDates:2,maxSegments:2,maxBytes:1500});
  a.capture(snap());a.capture(snap('2037-07-02'));const c=a.capture(snap('2037-07-03'));
  assert.equal(c.observationArchive.from,'2037-07-02');
  const other=snap();other.saveId='other';a.capture(other);a.capture(snap('2037-07-04'));
  assert.equal(a.data.segments.at(-1).records.at(-1).date,'2037-07-04');
});
test('oversized observations are deferred without destroying earlier data',()=>{
  const a=new CareerArchive({storage:memory(),maxBytes:500});a.capture(snap());const before=structuredClone(a.data);
  const s=snap('2037-07-02');s.players=Array.from({length:50},(_,i)=>({...s.players[0],id:String(i)}));
  assert.match(a.capture(s).observationArchive.warning,/용량/);assert.deepEqual(a.data,before);
});
test('corrupt persisted archive is preserved and quota errors remain visible',()=>{
  const storage=memory(),a=new CareerArchive({storage});storage.setItem(a.key,'broken');
  const b=new CareerArchive({storage});assert.match(b.capture(snap()).observationArchive.warning,/읽지 못/);assert.equal(storage.getItem(a.key),'broken');
  const q=new CareerArchive({storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});
  assert.match(q.capture(snap()).observationArchive.warning,/저장 공간/);assert.equal(q.data.segments.length,1);
});
test('duplicate dates and boolean CA in persisted records are rejected',()=>{
  for(const mutate of [s=>s.records.push(s.records[0]),s=>s.records[0].players[0].ca=true]){
    const storage=memory(),a=new CareerArchive({storage});a.capture(snap());const data=structuredClone(a.data);mutate(data.segments[0]);storage.setItem(a.key,JSON.stringify(data));
    const b=new CareerArchive({storage});assert.equal(b.data.segments.length,0);assert.match(b.warning,/읽지 못/);
  }
});
test('session rollback requires acceptance and never merges into earlier observations',async()=>{
  let input=raw('2037-07-03',125);const storage=memory(),archive=new CareerArchive({storage});
  const session=new SnapshotSession({archive,fetcher:async url=>response(url.endsWith('/api/parser')?{selectionId:'pin',parsing:false,lastError:null}:input)});
  await session.refresh();input=raw('2037-07-04',126);await session.refresh();const old=session.state.snapshot;
  input=raw('2037-07-01',120);await session.refresh();assert.equal(session.state.snapshot,old);assert.equal(session.state.status,'career-changed');assert.equal(session.state.pendingRestart,true);
  session.acceptPending();assert.equal(session.state.snapshot.observationArchive.dates,1);assert.notEqual(session.state.snapshot.observationLineage,old.observationLineage);
  await session.refresh();assert.equal(session.state.status,'current');assert.equal(session.state.snapshot.observationArchive.dates,1);
  assert.match(statusHTML({...session.state,pending:old,pendingRestart:true}),/별도 기록으로 시작/);
});
test('reload detects archive rollback even without a previous session snapshot',async()=>{
  const archive=new CareerArchive({storage:memory()});archive.capture(snap('2037-07-03'));
  const session=new SnapshotSession({archive,fetcher:async url=>response(url.endsWith('/api/parser')?{parsing:false,lastError:null}:raw())});
  await session.refresh();assert.equal(session.state.status,'career-changed');assert.equal(session.state.snapshot,null);
  assert.equal(session.acceptPending(),true);assert.equal(session.state.snapshot.observationArchive.dates,1);
});
test('failed parsing and in-progress imports do not add observations',async()=>{
  const archive=new CareerArchive({storage:memory()});let parser={selectionId:'pin',parsing:true,lastError:null};
  const session=new SnapshotSession({archive,fetcher:async url=>response(url.endsWith('/api/parser')?parser:raw())});
  await session.refresh();assert.equal(archive.data.segments.length,0);
  parser={...parser,parsing:false,lastError:'failed'};await session.refresh();assert.equal(archive.data.segments.length,0);
  parser={...parser,lastError:null};await session.refresh();assert.equal(archive.data.segments.length,1);
  const rev=session.state.revision;await session.refresh();assert.equal(session.state.revision,rev);
});
test('new observation action creates a separate baseline without deleting previous records',async()=>{
  const archive=new CareerArchive({storage:memory()});const session=new SnapshotSession({archive,fetcher:async url=>response(url.endsWith('/api/parser')?{selectionId:'pin',parsing:false}:raw())});
  await session.refresh();const old=session.state.snapshot.observationLineage;assert.equal(session.startNewObservations(),true);
  assert.notEqual(session.state.snapshot.observationLineage,old);assert.equal(archive.data.segments.length,2);
});
test('briefing and views remain factual with empty external candidate and medical inputs',()=>{
  const s=snap();assert.deepEqual(candidateComparison(s),[]);assert.equal(trainingReview(s.players[0]).role,null);
  assert.ok(evidenceBriefing(s).some(r=>r.evidence.includes('미확인 1명')));
  for(const view of ['training','development','recruitment','reports','coach','settings']){
    const html=renderRoom(view,{snapshot:s,status:'current'},{bridge:'http://localhost:8765'});
    assert.doesNotMatch(html,/NaN|undefined|Infinity/);
  }
});

test('verified training attributes and external candidates use observed inputs without invented costs',()=>{
  const s=snap(),p=s.players[0];p.primaryPosition='CM';
  p.attributes=Object.fromEntries(['passing','vision','firstTouch','technique','decisions','composure','positioning','anticipation','stamina','workRate','offTheBall'].map(k=>[k,k==='passing'?9:14]));
  const training=trainingReview(p);assert.ok(training.role);assert.equal(training.attributes[0].attribute,'passing');assert.equal(training.attributes[0].value,9);
  s.candidates=[{...structuredClone(p),id:'outside',name:'<script>bad</script>'}];
  const candidates=candidateComparison(s);assert.ok(candidates.some(c=>c.player.id==='outside'));assert.ok(candidates.every(c=>c.backupDifference===null));
  const html=renderRoom('recruitment',{snapshot:s,status:'current'},{});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
  s.candidates[0].availability.eligible=false;assert.deepEqual(candidateComparison(s),[]);
});

test('review journal preserves draft evidence, feedback and career isolation after reload',()=>{
  const storage=memory(),a=new CareerArchive({storage});let s=a.capture(snap());
  const plan={fixture:{id:'f',date:'2037-07-03'},review:{status:'review',selectedCount:1,formation:'4-3-3',lineup:[{slot:{id:'rcm'},player:s.players[0]}],minutePlan:{changes:[]},decisionMissing:['출전 자격']}};
  s=a.saveDecision(s,plan);assert.equal(s.decisionJournal.length,1);assert.deepEqual(s.decisionJournal[0].decisionMissing,['출전 자격']);
  s=a.assessDecision(s,s.decisionJournal[0].id,'helpful');
  const reloaded=new CareerArchive({storage}).capture(snap());assert.equal(reloaded.decisionJournal[0].assessment,'helpful');
  assert.equal(a.assessDecision(s,s.decisionJournal[0].id,'success-100-percent').decisionJournal[0].assessment,'helpful');
  const next=a.capture(snap(),{restart:true});assert.equal(next.decisionJournal.length,0);
  assert.equal(a.saveDecision(next,{...plan,review:{...plan.review,status:'conflict'}}).decisionJournal.length,0);
  assert.doesNotMatch(renderRoom('reports',{snapshot:reloaded,status:'current'},{}),/NaN|undefined/);
});

test('portable archive round trip replaces only after validation and a durable write',()=>{
  const a=new CareerArchive({storage:memory()});a.capture(snap());a.capture(snap('2037-07-02',125));
  const exported=a.exportText();const storage=memory(),b=new CareerArchive({storage});b.capture(snap());
  assert.equal(b.inspectImport(exported).dates,2);b.importText(exported);
  assert.equal(b.view(snap('2037-07-02')).observationArchive.dates,2);
  const before=b.exportText();assert.throws(()=>b.importText('{}'));assert.equal(b.exportText(),before);
  storage.setItem=()=>{throw Error('quota');};assert.throws(()=>b.importText(exported));assert.equal(b.exportText(),before);
});
test('archive import preserves foreign IDs and can explicitly recover corrupted storage',()=>{
  const storage=memory(),a=new CareerArchive({storage});a.capture(snap());const exported=a.exportText();storage.setItem(a.key,'corrupt');
  const b=new CareerArchive({storage});b.importText(exported);assert.equal(b.view(snap()).observationArchive.dates,1);
  const foreign=snap();foreign.saveId='new-career';assert.equal(b.view(foreign).observationArchive.dates,0);
  assert.throws(()=>b.importText(exported.replace('"version":1','"version":99')));
});
