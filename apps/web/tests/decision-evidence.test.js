import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionEvidence, evidenceTemplate, readEvidence, EVIDENCE_BYTES } from '../engine/decisionEvidence.js';
import { eligibilityReview, fixtureEvidenceSnapshot, assignedTrainingReview, offerReviews, outcomeReview, economyReview, balanceProposal, simulateBalanceProposal } from '../engine/evidenceReviews.js';
import { SnapshotSession } from '../engine/snapshotSession.js';
import { CareerArchive } from '../engine/careerArchive.js';
import { normalizeRealSnapshot } from '../engine/realSnapshot.js';
import { rotationReview } from '../engine/realRotation.js';
import { renderRoom } from '../previewView.js';
import { roleDefinitions } from '../engine/roles.js';
const attrs=Object.fromEntries([...new Set(Object.values(roleDefinitions).flatMap(Object.keys))].map(k=>[k,15]));
const raw=()=>({schemaVersion:2,source:'rust-native',saveId:'career',saveName:'Save',gameDate:'2037-07-03',dbVersion:'26',manager:{clubUid:1,name:'M',club:'FC'},
  clubFinance:{balance:100000,wageBudgetWeekly:10000},
  players:[{id:'7',name:'P',ca:120,positions:['CM'],positionRatings:{MC:20},attributes:{...attrs,passing:8},fitness:{},playingTime:{},contract:{}}],
  fixtures:[{id:'f1',date:'2037-07-04',competitionId:3,competitionKnown:true,competition:'League',opponent:'A'},{id:'f2',date:'2037-07-05',competitionId:4,opponent:'B'}]});
function snapshot(){const s=normalizeRealSnapshot(raw());s.observationLineage='lineage';return s;}
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
function attach(s,p){s.decisionEvidence=readEvidence(JSON.stringify(p),s);return s;}
const elig=()=>({playerId:'7',fixtureId:'f1',competitionId:'3',registered:false,exempt:false,suspended:false,workPermit:true,otherRulesClear:true,reference:'FM registration'});
const med=()=>({playerId:'7',injured:false,fatigueLabel:'Fresh',riskLabel:'Low',reference:'FM medical centre'});
const offer=()=>({id:'o',playerId:'7',kind:'loan-out',club:'Other',expires:'2037-07-05',interest:true,registration:true,contractClear:true,currency:'GBP',fee:100,weeklyWage:50,feeThreshold:90,maxWeeklyWage:60,facility:16,minFacility:15,promisedMinutes:60,minMinutes:45,reference:'FM offer'});
const ledger=(clubId,leagueId,from,through,wageSpend=20)=>({clubId,leagueId,from,through,wageSpend,currency:'GBP',income:200,expenditure:100,transferSpend:40,transferIncome:10,reference:'FM finance'});

test('strict packet rejects scope crossing, unsupported keys, coercion, duplicates and bad dates atomically',()=>{
  const s=snapshot(),base=evidenceTemplate(s);base.eligibility=[elig()];base.medical=[med()];base.offers=[offer()];
  assert.deepEqual(readEvidence(JSON.stringify(base),s),base);
  for(const change of [p=>p.scope.date='2037-07-02',p=>p.scope.lineage='old',p=>p.scope.career='new',p=>p.scope.build='other',p=>p.scope.dbVersion='other',
    p=>p.eligibility[0].competitionId='4',p=>p.eligibility[0].fixtureId='missing',p=>p.eligibility[0].registered=0,p=>p.eligibility.push(elig()),
    p=>p.medical[0].fatigueLabel=0,p=>p.offers[0].fee=true,p=>p.offers[0].expires='2037-02-30',p=>p.offers[0].currency='raw',p=>p.offers[0].extra=true,
    p=>p.medical[0].playerId='unknown',p=>p.results=null,p=>p.version=2,p=>p.catalogue=[{id:'x',name:'x',attributes:['constructor'],reference:'x'}]]){
    const p=structuredClone(base);change(p);assert.throws(()=>readEvidence(JSON.stringify(p),s));
  }
  assert.throws(()=>readEvidence(' '.repeat(EVIDENCE_BYTES+1),s));
  assert.throws(()=>evidenceTemplate({...s,observationLineage:null}));
});

test('eligibility handles exemption, missing rules and positive transcription without certifying native fields',()=>{
  const s=snapshot(),p=evidenceTemplate(s);p.eligibility=[elig()];p.medical=[med()];attach(s,p);
  assert.equal(eligibilityReview(s,s.fixtures[0])[0].status,'blocked');
  const source=structuredClone(s);const first=fixtureEvidenceSnapshot(s,s.fixtures[0]);assert.equal(first.players[0].availability.eligible,false);assert.deepEqual(s,source);
  assert.equal(fixtureEvidenceSnapshot(s,s.fixtures[1]).players[0].availability.eligible,null);
  p.eligibility[0].exempt=true;attach(s,p);assert.equal(eligibilityReview(s,s.fixtures[0])[0].status,'transcribed-clear');
  assert.equal(fixtureEvidenceSnapshot(s,s.fixtures[0]).players[0].availability.eligible,null);
  p.eligibility[0].otherRulesClear=null;attach(s,p);assert.equal(eligibilityReview(s,s.fixtures[0])[0].status,'unknown');
  p.medical[0].injured=true;attach(s,p);assert.equal(eligibilityReview(s,s.fixtures[1])[0].status,'blocked');
  s.gameDate='2037-07-04';assert.equal(fixtureEvidenceSnapshot(s,s.fixtures[0]).players[0].availability.eligible,null);
});

test('rotation excludes a transcribed suspended player and locked selections become conflicts only for that fixture',()=>{
  const s=snapshot(),p=evidenceTemplate(s);p.eligibility=[elig()];attach(s,p);
  const reviews=rotationReview(s,{constraintsByFixture:new Map([['f1',{lockedStarters:{rcm:'7'}}]])});
  assert.equal(reviews.status,'conflict');assert.equal(reviews.plans[0].review.selectedCount,0);
  const regular=rotationReview(s);
  assert.equal(regular.plans[0].review.unavailable[0].player.id,'7');
  assert.equal(regular.plans[0].review.bench.players.some(p=>p.player.id==='7'),false);
  assert.equal(regular.plans[1].review.lineup.some(p=>p.player?.id==='7'),true);
});

test('training compares only entered catalogue, exact assignment-start baseline and same lineage',()=>{
  const s=snapshot(),p=evidenceTemplate(s);p.catalogue=[{id:'passing',name:'Passing',attributes:['passing'],reference:'FM focus'}];p.assignments=[{playerId:'7',focusId:'passing',since:'2037-07-01',reference:'FM assignment'}];
  s.players[0].observations=[{date:'2037-07-01',lineage:'lineage',attributes:{passing:8}},{date:s.gameDate,lineage:'lineage',attributes:{passing:9}}];attach(s,p);
  let r=assignedTrainingReview(s)[0];assert.equal(r.current.id,'passing');assert.equal(r.candidates[0].focus.id,'passing');assert.equal(r.changes[0].delta,1);
  s.players[0].observations[0].lineage='old';assert.deepEqual(assignedTrainingReview(s)[0].changes,[]);
  s.players[0].observations[0].lineage='lineage';s.players[0].observations[0].date='2037-06-30';assert.deepEqual(assignedTrainingReview(s)[0].changes,[]);
});

test('offer gates distinguish costs, proceeds, conditions, unknowns, expiry and loan facilities',()=>{
  const s=snapshot(),p=evidenceTemplate(s);p.offers=[offer()];attach(s,p);assert.match(offerReviews(s)[0].status,/충족/);
  for(const [key,value,label] of [['fee',80,'수입 하한'],['weeklyWage',70,'잔여 부담'],['facility',14,'시설'],['promisedMinutes',30,'출전'],['registration',false,'등록'],['expires','2037-07-01','만료']]){
    p.offers=[{...offer(),[key]:value}];attach(s,p);assert.ok(offerReviews(s)[0].blocked.some(x=>x.includes(label)));
  }
  p.offers=[{...offer(),contractClear:null}];attach(s,p);assert.equal(offerReviews(s)[0].status,'판단 보류');
  p.offers=[{...offer(),kind:'release',fee:100,feeThreshold:90}];attach(s,p);assert.ok(offerReviews(s)[0].blocked.includes('비용 상한'));
  s.candidates=[{...s.players[0],id:'8'}];p.offers=[{...offer(),kind:'buy',playerId:'8',fee:80,feeThreshold:90}];attach(s,p);assert.match(offerReviews(s)[0].status,/충족/);
});

test('actual match linkage excludes same-day hindsight, measures execution and preserves missing DNP',()=>{
  const s=snapshot();s.decisionJournal=[{id:'d1',date:'2037-07-01',fixtureDate:'2037-07-02',fixtureId:'past',lineup:[{playerId:'1'},{playerId:'2'}],changes:[{outgoingId:'1',incomingId:'12',minute:60}]},
    {id:'late',date:'2037-07-02',fixtureDate:'2037-07-02',fixtureId:'past',lineup:[{playerId:'9'}],changes:[]}];
  const p=evidenceTemplate(s);p.results=[{fixtureId:'past',date:'2037-07-02',goalsFor:2,goalsAgainst:1,starters:Array.from({length:11},(_,i)=>String(i+1)),minutes:Array.from({length:11},(_,i)=>({playerId:String(i+1),minutes:90})),reference:'FM result'}];attach(s,p);
  let report=outcomeReview(s);assert.equal(report.linked,1);assert.equal(report.rows[0].decision.id,'d1');assert.equal(report.rows[0].overlap,2);assert.equal(report.rows[0].minutesMAE,15);assert.equal(report.rows[0].minutePairs,2);assert.equal(report.rows[0].plannedPlayers,3);
  p.results[0].minutes.push({playerId:'12',minutes:0});attach(s,p);assert.equal(outcomeReview(s).rows[0].minutesMAE,20);
  s.decisionJournal=s.decisionJournal.slice(1);assert.equal(outcomeReview(s).linked,0);
  p.results[0].starters[1]='1';assert.throws(()=>attach(s,p));
});

test('economic flows partition currency and periods, matched cohorts and zero denominators',()=>{
  const s=snapshot(),p=evidenceTemplate(s);p.economy=[ledger('1','Saudi','2037-06-01','2037-06-15'),ledger('1','Saudi','2037-06-16','2037-06-30',30),
    ledger('2','Europe','2037-06-16','2037-06-30',20),{...ledger('3','Other','2037-06-16','2037-06-30'),currency:'EUR',transferSpend:0}];attach(s,p);
  const report=economyReview(s);assert.equal(report.periods.find(r=>r.leagueId==='Saudi'&&r.from==='2037-06-16').sampleShare,.5);
  assert.equal(report.periods.find(r=>r.currency==='EUR').sampleShare,null);assert.equal(report.changes.length,1);assert.equal(report.changes[0].wageGrowth,.5);
  p.economy[1].leagueId='Other';attach(s,p);assert.equal(economyReview(s).changes.length,0);
  p.economy.push({...p.economy[0],from:'2037-06-10',through:'2037-06-20'});assert.throws(()=>attach(s,p),/겹칩니다/);
});

test('balance proposals simulate readback and rollback without mutation; drift, cross-career and forbidden fields fail',()=>{
  const s=snapshot(),original=structuredClone(s),p=balanceProposal(s,'balance',-5),sim=simulateBalanceProposal(s,p);
  assert.equal(p.writeEnabled,false);assert.equal(sim.clubFinance.balance,95000);assert.equal(simulateBalanceProposal(sim,p,{rollback:true}).clubFinance.balance,100000);assert.deepEqual(s,original);
  assert.throws(()=>simulateBalanceProposal({...s,clubFinance:{balance:2}},p),/바뀌었습니다/);
  assert.throws(()=>simulateBalanceProposal({...s,observationLineage:'new'},p));
  for(const field of ['ca','pa','reputation','__proto__'])assert.throws(()=>balanceProposal(s,field,-5));
  for(const percent of [11,-11,NaN,Infinity,0])assert.throws(()=>balanceProposal(s,'balance',percent));
  assert.throws(()=>simulateBalanceProposal(s,{...p,after:80000}));
});

test('store retains old file under failed imports; stale data is inert and exportable; bridge isolation',()=>{
  const storage=memory(),store=new DecisionEvidence({storage,namespace:'A'}),s=snapshot(),p=evidenceTemplate(s);p.medical=[med()];store.importText(JSON.stringify(p),s);
  assert.equal(new DecisionEvidence({storage,namespace:'A'}).view(s).decisionEvidence.medical.length,1);
  assert.equal(new DecisionEvidence({storage,namespace:'B'}).view(s).decisionEvidence,null);
  const old=store.exportText();assert.throws(()=>store.importText('{}',s));assert.equal(store.exportText(),old);
  store.storage={setItem:()=>{throw Error('quota');}};p.medical=[];assert.throws(()=>store.importText(JSON.stringify(p),s),/저장 실패/);assert.equal(store.exportText(),old);
  assert.equal(store.view({...s,gameDate:'2037-07-04'}).decisionEvidence,null);assert.equal(store.exportText(),old);
});

test('session keeps evidence on unchanged polls but expires it on day, restart and new-career boundaries',async()=>{
  const storage=memory(),evidence=new DecisionEvidence({storage}),archive=new CareerArchive({storage});let data=raw(),parser={selectionId:'pin',parsing:false,lastError:null};
  const session=new SnapshotSession({archive,evidence,fetcher:async url=>new Response(JSON.stringify(url.endsWith('/api/parser')?parser:data))});await session.refresh();
  const p=evidenceTemplate(session.state.snapshot);p.medical=[med()];session.importEvidence(JSON.stringify(p));await session.refresh();assert.equal(session.state.snapshot.decisionEvidence.medical.length,1);
  parser.parsing=true;await session.refresh();assert.throws(()=>session.importEvidence(JSON.stringify(p)));parser.parsing=false;
  data={...data,gameDate:'2037-07-04'};await session.refresh();assert.equal(session.state.snapshot.decisionEvidence,null);
  session.importEvidence(JSON.stringify(evidenceTemplate(session.state.snapshot)));session.startNewObservations();assert.equal(session.state.snapshot.decisionEvidence,null);
  parser.selectionId='new-career';await session.refresh();assert.equal(session.state.status,'career-changed');session.acceptPending();assert.equal(session.state.snapshot.decisionEvidence,null);
});

test('evidence UI escapes imported source/labels and exposes all five review areas',()=>{
  const s=snapshot(),p=evidenceTemplate(s);p.medical=[{...med(),injured:true,reference:'<img src=x>',riskLabel:'<script>bad</script>'}];attach(s,p);
  const state={snapshot:s,status:'current',parser:{parsing:false}},ui={query:'',actions:{},evidenceDraft:'</textarea><script>bad</script>'};
  for(const view of ['evidence','medical','training','transfers','reports','economy']){
    const html=renderRoom(view,state,ui);assert.equal(html.includes('<script>bad</script>'),false);assert.equal(html.includes('<img src=x>'),false);
  }
  assert.match(renderRoom('medical',state,ui),/&lt;script&gt;/);
  assert.match(renderRoom('matchday',state,ui),/감독 입력 근거: 현재 부상/);
  assert.match(renderRoom('economy',state,ui),/게임 파일 쓰기·복구는 지원하지/);
});
