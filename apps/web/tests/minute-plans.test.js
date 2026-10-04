import test from "node:test";
import assert from "node:assert/strict";
import { matchdayReview } from "../engine/realMatchday.js";
import { rotationReview } from "../engine/realRotation.js";
import { editFixtureSelection } from "../engine/realSelection.js";
import { roleDefinitions } from "../engine/roles.js";
import { renderRoom } from "../previewView.js";
const keys=[...new Set(Object.values(roleDefinitions).flatMap(Object.keys))];
function snapshot(){
  return {gameDate:"2037-08-01",buildVerified:true,players:["GK","DR","DC","DC","DL","DM","MC","MC","AMR","AML","STC"].flatMap((code,i)=>[17,15].map((rating,n)=>({
    id:String(i+1+n*20),name:`P${i+1+n*20}`,ca:140,age:25,pa:null,
    attributes:Object.fromEntries(keys.map(k=>[k,rating])),positions:[],positionRatings:{[code]:20},
    condition:null,fatigue:null,injuryRisk:null,minutes:null,historyComplete:false,availability:{injuryFree:null,eligible:null}
  }))),fixtures:[1,2,3].map((id,i)=>({id:String(id),date:`2037-08-0${1+i*3}`,opponent:`Team ${id}`,importance:null}))};
}
const review=(s,c)=>matchdayReview(s,"4-3-3",{constraints:c});

test("a 60-minute cap allocates a unique verified replacement and preserves observed unknowns",()=>{
  const s=snapshot(),original=structuredClone(s);
  const directives=new Map([["1",{lockedStarters:{st:"11"},minuteCaps:{"11":60}}]]);
  const r=rotationReview(s,{constraintsByFixture:directives,mode:"best-xi"});
  const p=r.plans[0].review.minutePlan;
  assert.equal(p.status,"review");assert.equal(p.changes.length,1);
  assert.equal(p.changes[0].minute,60);assert.equal(p.changes[0].incoming.id,"31");
  assert.equal(p.changes[0].automatic,true);
  assert.equal(p.appearances.reduce((sum,a)=>sum+a.minutes,0),990);
  const starter=r.players.find(p=>p.player.id==="11"),sub=r.players.find(p=>p.player.id==="31");
  assert.equal(starter.reservations[0].minutes,60);assert.equal(sub.reservations[0].minutes,30);
  assert.equal(sub.plannedStarts,0);assert.equal(sub.plannedSubAppearances,1);
  assert.equal(sub.observedMinutes,null);assert.equal(sub.medicalMinuteCap,null);
  assert.ok(r.plans[0].review.bench.players.some(b=>b.player.id==="31" && b.plannedSubstitute));
  assert.equal(r.plans[0].review.readyForFinalDecision,false);assert.deepEqual(s,original);
});

test("explicit incoming player is reserved outside the globally optimized XI",()=>{
  const r=review(snapshot(),{substitutions:{st:{minute:70,playerId:"11"}}});
  assert.equal(r.lineup.find(r=>r.slot.id==="st").player.id,"31");
  assert.equal(r.minutePlan.changes[0].incoming.id,"11");
  assert.equal(r.minutePlan.changes[0].automatic,false);
  assert.equal(r.minutePlan.appearances.find(a=>a.playerId==="11").minutes,20);
  assert.ok(r.bench.players.some(b=>b.player.id==="11"));
});

test("zero cap excludes both XI and bench without changing observed minutes",()=>{
  const s=snapshot();s.players.find(p=>p.id==="11").minutes=345;
  const r=review(s,{minuteCaps:{"11":0}});
  assert.ok(r.lineup.every(r=>r.player?.id!=="11"));assert.ok(r.bench.players.every(r=>r.player.id!=="11"));
  assert.equal(s.players.find(p=>p.id==="11").minutes,345);
});

for(const [name,c,code] of [
  ["cap negative",{minuteCaps:{"11":-1}},"invalid-cap"],
  ["cap fraction",{minuteCaps:{"11":60.5}},"invalid-cap"],
  ["cap above 90",{minuteCaps:{"11":91}},"invalid-cap"],
  ["cap string",{minuteCaps:{"11":"60"}},"invalid-cap"],
  ["cap missing player",{minuteCaps:{gone:60}},"missing-cap-player"],
  ["cap malformed",{minuteCaps:[]},"invalid-caps"],
  ["lock zero cap",{lockedStarters:{st:"11"},minuteCaps:{"11":0}},"lock-zero-cap"],
  ["sub malformed",{substitutions:[]},"invalid-subs"],
  ["sub malformed row",{substitutions:{st:[]}},"invalid-sub"],
  ["sub obsolete slot",{substitutions:{old:{minute:60,playerId:"31"}}},"missing-sub-slot"],
  ["sub late",{substitutions:{st:{minute:90}}},"invalid-sub-minute"],
  ["sub fractional",{substitutions:{st:{minute:60.5}}},"invalid-sub-minute"],
  ["sub missing time",{substitutions:{st:{playerId:"31"}}},"sub-time-required"],
  ["sub missing player",{substitutions:{st:{minute:60,playerId:"gone"}}},"missing-sub-player"],
  ["sub wrong role",{substitutions:{gk:{minute:60,playerId:"31"}}},"unverified-sub-role"],
  ["sub rested",{restIds:["31"],substitutions:{st:{minute:60,playerId:"31"}}},"rest-sub-conflict"],
  ["sub locked",{lockedStarters:{st:"31"},substitutions:{st:{minute:60,playerId:"31"}}},"starter-sub-conflict"],
  ["sub duplicate",{substitutions:{rcb:{minute:60,playerId:"23"},lcb:{minute:65,playerId:"23"}}},"duplicate-sub"],
  ["outgoing cap exceeded",{lockedStarters:{st:"11"},minuteCaps:{"11":60},substitutions:{st:{minute:70,playerId:"31"}}},"starter-cap-exceeded"],
  ["incoming cap exceeded",{minuteCaps:{"31":20},substitutions:{st:{minute:60,playerId:"31"}}},"sub-cap-exceeded"]
]) test(`invalid minute plan blocks lineup and reservations: ${name}`,()=>{
  const r=rotationReview(snapshot(),{constraintsByFixture:new Map([["1",c]])});
  assert.equal(r.status,"conflict");assert.ok(r.conflicts.some(p=>p.code===code));
  assert.equal(r.plans.length,1);assert.equal(r.plans[0].review.selectedCount,0);
  assert.equal(r.plans[0].review.bench.selectedCount,0);
  assert.ok(r.players.every(p=>p.plannedMinutes===0));
});

test("known unavailable incoming is rejected and blank XI cannot receive a sub",()=>{
  const s=snapshot();s.players.find(p=>p.id==="31").availability.injuryFree=false;
  assert.ok(review(s,{substitutions:{st:{minute:60,playerId:"31"}}}).selectionConflicts.some(c=>c.code==="unavailable-sub"));
  assert.ok(review(snapshot(),{restIds:["11","31"],substitutions:{st:{minute:60}}}).selectionConflicts.some(c=>c.code==="sub-without-starter"));
});

test("missing replacement defers this and downstream plans but retains earlier reservations",()=>{
  const c={lockedStarters:{st:"11"},minuteCaps:{"11":60,"31":20}};
  const r=rotationReview(snapshot(),{mode:"best-xi",constraintsByFixture:new Map([["2",c]])});
  assert.equal(r.status,"planning-required");assert.equal(r.plans.length,2);
  assert.equal(r.plans[1].review.minutePlan.pending[0].slotId,"st");
  assert.ok(r.players.flatMap(p=>p.reservations).every(a=>a.fixtureId==="1"));
  assert.equal(r.players.reduce((n,p)=>n+p.plannedMinutes,0),990);
});

test("simultaneous automatic substitutions have globally unique incoming IDs and conserve slot minutes",()=>{
  const r=review(snapshot(),{lockedStarters:{rcb:"3",lcb:"4"},minuteCaps:{"3":60,"4":65}});
  assert.equal(r.minutePlan.changes.length,2);
  assert.equal(new Set(r.minutePlan.changes.map(c=>c.incoming.id)).size,2);
  assert.equal(new Set(r.minutePlan.appearances.map(a=>a.playerId)).size,13);
  assert.equal(r.minutePlan.appearances.reduce((n,a)=>n+a.minutes,0),990);
});

test("caps and substitution edits are isolated, immutable and retained during lock/rest edits",()=>{
  const m=new Map();
  editFixtureSelection(m,"1",{type:"cap",playerId:"11",minutes:60});const before=structuredClone(m.get("1"));
  editFixtureSelection(m,"1",{type:"sub",slotId:"st",field:"playerId",value:"31"});
  editFixtureSelection(m,"1",{type:"sub",slotId:"st",field:"minute",value:55});
  editFixtureSelection(m,"1",{type:"rest",playerId:"21",rest:true});
  assert.deepEqual(before.minuteCaps,{"11":60});assert.equal(m.get("1").substitutions.st.minute,55);
  editFixtureSelection(m,"2",{type:"cap",playerId:"11",minutes:30});
  editFixtureSelection(m,"1",{type:"cap",playerId:"11",minutes:null});
  assert.deepEqual(m.get("1").minuteCaps,{});assert.equal(m.get("2").minuteCaps["11"],30);
  editFixtureSelection(m,"1",{type:"sub",slotId:"st",field:"minute",value:null});
  editFixtureSelection(m,"1",{type:"sub",slotId:"st",field:"playerId",value:""});
  assert.deepEqual(m.get("1").substitutions,{});
});

test("minute UI escapes player text, shows unknown medical cap and includes substitute reservations",()=>{
  const s=snapshot();s.players.find(p=>p.id==="31").name='<img src=x onerror="bad()">';
  const html=renderRoom("matchday",{snapshot:s,status:"current"},{formation:"4-3-3",fixtureId:"1",constraintsByFixture:new Map([["1",{minuteCaps:{"11":60}}]])});
  assert.match(html,/data-minute-cap-player/);assert.match(html,/sub-minute-st/);assert.match(html,/계획 교체 투입/);
  assert.match(html,/의료상 허용 시간은 미확인/);assert.doesNotMatch(html,/<img|NaN|undefined|\bInfinity\b/);
});

test("incoming medical unknowns block final decision even when the XI critical fields are complete",()=>{
  const s=snapshot();
  for(const p of s.players){p.condition=100;p.fatigue=0;p.injuryRisk=0;p.availability={injuryFree:true,eligible:true};}
  s.players.find(p=>p.id==="31").fatigue=null;
  const r=review(s,{minuteCaps:{"11":60},lockedStarters:{st:"11"}});
  assert.equal(r.selectedWithUnknowns.length,0);assert.equal(r.readyForFinalDecision,false);
  assert.ok(r.decisionMissing.includes("교체 선수 의료·출전 자격"));
});

test("review bench overflow conflicts without pretending nine is a competition rule",()=>{
  const s=snapshot();const base=review(s,{});
  const lockedStarters=Object.fromEntries(base.lineup.map(r=>[r.slot.id,r.player.id]));
  const minuteCaps=Object.fromEntries(base.lineup.map(r=>[r.player.id,60]));
  const r=review(s,{lockedStarters,minuteCaps});
  assert.equal(r.status,"conflict");assert.ok(r.selectionConflicts.some(c=>c.code==="review-bench-capacity"));
  assert.equal(r.minutePlan.appearances.length,0);
});

test("a verified substitute below coverage threshold remains on the reserved bench",()=>{
  const s=snapshot();s.players.find(p=>p.id==="31").attributes=Object.fromEntries(keys.map(k=>[k,9]));
  const r=review(s,{lockedStarters:{st:"11"},minuteCaps:{"11":60}});
  assert.equal(r.minutePlan.changes[0].incoming.id,"31");
  const b=r.bench.players.find(b=>b.player.id==="31");
  assert.equal(b.plannedSubstitute,true);assert.ok(b.bestScore<65);assert.deepEqual(b.coverage,[]);
});

for(const [label,rules,code] of [
  ['zero substitutions',{substitutionLimit:0},'match-substitution-limit'],
  ['zero bench',{benchLimit:0},'match-bench-limit'],
  ['negative',{benchLimit:-1},'invalid-match-rule'],
  ['fraction',{substitutionLimit:1.5},'invalid-match-rule'],
  ['string',{benchLimit:'5'},'invalid-match-rule'],
  ['over bound',{substitutionLimit:12},'invalid-match-rule'],
  ['malformed',[],'invalid-match-rule']
]) test(`manual rule conflict stops this and later reservations: ${label}`,()=>{
  const s=snapshot(),original=structuredClone(s);
  const r=rotationReview(s,{mode:'best-xi',constraintsByFixture:new Map([['2',{
    lockedStarters:{st:'11'},minuteCaps:{'11':60},matchRules:rules
  }]])});
  assert.equal(r.status,'conflict');assert.equal(r.plans.length,2);
  assert.ok(r.conflicts.some(c=>c.code===code));
  assert.equal(r.plans[1].review.selectedCount,0);assert.equal(r.plans[1].review.bench.selectedCount,0);
  assert.ok(r.players.flatMap(p=>p.reservations).every(a=>a.fixtureId==='1'));
  assert.equal(r.players.reduce((n,p)=>n+p.plannedMinutes,0),990);assert.deepEqual(s,original);
});

test('manual bench limit keeps planned incoming player and does not certify eligibility',()=>{
  const r=review(snapshot(),{lockedStarters:{st:'11'},minuteCaps:{'11':60},matchRules:{benchLimit:1,substitutionLimit:1}});
  assert.equal(r.status,'review');assert.equal(r.bench.selectedCount,1);
  assert.equal(r.bench.players[0].player.id,'31');assert.equal(r.minutePlan.changes.length,1);
  assert.equal(r.matchRules.verified,false);assert.equal(r.matchRules.source,'manager-entry');
  assert.ok(r.decisionMissing.includes('선수별 대회 등록·출전 자격'));
  assert.ok(r.decisionMissing.includes('교체 횟수·하프타임·연장·특별 교체 규정'));
  assert.equal(r.readyForFinalDecision,false);
});

test('manual zero, missing and limits beyond review capacity are distinct',()=>{
  const zero=review(snapshot(),{matchRules:{benchLimit:0,substitutionLimit:0}});
  assert.equal(zero.status,'review');assert.equal(zero.bench.selectedCount,0);
  assert.equal(zero.matchRules.values.benchLimit,0);
  const absent=review(snapshot(),{});
  assert.equal(absent.matchRules.values.benchLimit,null);assert.equal(absent.bench.selectedCount,9);
  assert.equal(review(snapshot(),{matchRules:{benchLimit:23}}).bench.selectedCount,9);
});

test('multiple simultaneous changes count as players, not one substitution window',()=>{
  const r=review(snapshot(),{lockedStarters:{rcb:'3',lcb:'4'},minuteCaps:{'3':60,'4':60},matchRules:{substitutionLimit:1}});
  assert.ok(r.selectionConflicts.some(c=>c.code==='match-substitution-limit'));
  assert.equal(r.minutePlan.appearances.length,0);
});

test('rule edits are immutable, fixture isolated, removable and reset with all directives',()=>{
  const m=new Map();editFixtureSelection(m,'1',{type:'rule',field:'benchLimit',value:0});
  const before=m.get('1');
  editFixtureSelection(m,'1',{type:'rule',field:'substitutionLimit',value:5});
  assert.deepEqual(before.matchRules,{benchLimit:0});
  editFixtureSelection(m,'2',{type:'rule',field:'benchLimit',value:7});
  editFixtureSelection(m,'1',{type:'rest',playerId:'11',rest:true});
  assert.equal(m.get('1').matchRules.substitutionLimit,5);
  editFixtureSelection(m,'1',{type:'rule',field:'benchLimit',value:null});
  assert.equal(m.get('1').matchRules.benchLimit,undefined);assert.equal(m.get('2').matchRules.benchLimit,7);
  editFixtureSelection(m,'1',{type:'clear'});assert.equal(m.has('1'),false);assert.equal(m.has('2'),true);
});

test('rule controls distinguish manual evidence and zero from unknown',()=>{
  const html=renderRoom('matchday',{snapshot:snapshot(),status:'current'},{fixtureId:'1',constraintsByFixture:new Map([['1',{matchRules:{benchLimit:0}}]])});
  assert.match(html,/감독 수동 입력/);assert.match(html,/data-match-rule="benchLimit"[^>]*value="0"/);
  assert.match(html,/data-match-rule="substitutionLimit"[^>]*value=""/);
  assert.match(html,/교체 횟수·하프타임·연장·특별 교체/);
  assert.doesNotMatch(html,/NaN|undefined/);
});
