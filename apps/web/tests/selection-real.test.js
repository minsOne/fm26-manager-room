import test from "node:test";
import assert from "node:assert/strict";
import { matchdayReview } from "../engine/realMatchday.js";
import { rotationReview } from "../engine/realRotation.js";
import { editFixtureSelection } from "../engine/realSelection.js";
import { roleDefinitions } from "../engine/roles.js";
import { renderRoom } from "../previewView.js";

const attributes=[...new Set(Object.values(roleDefinitions).flatMap(Object.keys))];
function snapshot(){
  const codes=["GK","DR","DC","DC","DL","DM","MC","MC","AMR","AML","STC"];
  return {gameDate:"2037-08-01",buildVerified:true,players:codes.flatMap((code,i)=>[17,15].map((rating,n)=>({
    id:String(i+1+n*20),name:`P${i+1+n*20}`,ca:140,age:25,pa:170,
    attributes:Object.fromEntries(attributes.map(k=>[k,rating])),positions:[],positionRatings:{[code]:20},
    condition:99,fatigue:10,injuryRisk:2,minutes:0,historyComplete:true,availability:{injuryFree:true,eligible:true}
  }))),fixtures:[1,2,3].map((id,i)=>({id:String(id),date:`2037-08-0${1+i*3}`,opponent:`Team ${id}`,importance:50}))};
}
const review=(s,constraints,options={})=>matchdayReview(s,"4-3-3",{constraints,...options});
const selected=r=>r.lineup.filter(row=>row.player).map(row=>row.player.id);

test("a hard lock can choose a weaker player; remaining global assignment stays unique and source unchanged",()=>{
  const s=snapshot();const original=structuredClone(s);
  const baseline=review(s,{});
  const r=review(s,{lockedStarters:{st:"31"}});
  assert.equal(r.lineup.find(row=>row.slot.id==="st").player.id,"31");
  assert.equal(r.lineup.find(row=>row.slot.id==="st").locked,true);
  assert.equal(r.selectedCount,11);assert.equal(r.uniquePlayers,11);
  assert.ok(r.totalRoleFit<baseline.totalRoleFit);
  assert.ok(r.bench.players.every(row=>!selected(r).includes(row.player.id)));
  assert.deepEqual(s,original);
});

test("rest excludes starter and backup from both XI and bench",()=>{
  const s=snapshot();const r=review(s,{restIds:["11","31"]});
  assert.equal(r.lineup.find(row=>row.slot.id==="st").player,null);
  assert.ok(r.bench.players.every(row=>!["11","31"].includes(row.player.id)));
  assert.deepEqual(r.resting.map(p=>p.id),["11","31"]);
  assert.equal(r.readyForFinalDecision,false);
});

for(const [name,constraints,code] of [
  ["duplicate player locks",{lockedStarters:{rcb:"3",lcb:"3"}},"duplicate-lock"],
  ["simultaneous lock and rest",{lockedStarters:{st:"11"},restIds:["11"]},"lock-rest-conflict"],
  ["missing locked UID",{lockedStarters:{st:"gone"}},"missing-locked-player"],
  ["missing rested UID",{restIds:["gone"]},"missing-rest-player"],
  ["obsolete formation slot",{lockedStarters:{am:"11"}},"missing-slot"],
  ["unverified role",{lockedStarters:{gk:"11"}},"unverified-locked-role"],
  ["malformed root",[],"invalid-constraints"],
  ["malformed locks",{lockedStarters:["11"]},"invalid-locks"],
  ["malformed rest",{restIds:"11"},"invalid-rests"],
  ["invalid lock UID",{lockedStarters:{st:11}},"invalid-lock-id"],
  ["invalid rest UID",{restIds:[null]},"invalid-rest-id"]
]) test(`selection conflict blocks the entire recommendation: ${name}`,()=>{
  const r=review(snapshot(),constraints);
  assert.ok(r.selectionConflicts.some(c=>c.code===code));
  assert.equal(r.status,"conflict");assert.equal(r.selectedCount,0);
  assert.equal(r.bench.selectedCount,0);assert.equal(r.readyForFinalDecision,false);
  assert.ok(r.decisionMissing.includes("감독 지정 충돌"));
});

test("a known injury or ineligibility rejects a lock while unknown medicine remains unknown",()=>{
  for(const key of ["injuryFree","eligible"]){
    const s=snapshot();s.players.find(p=>p.id==="11").availability[key]=false;
    assert.ok(review(s,{lockedStarters:{st:"11"}}).selectionConflicts.some(c=>c.code==="unavailable-locked-player"));
  }
  const s=snapshot();const p=s.players.find(p=>p.id==="11");
  p.availability={injuryFree:null,eligible:null};p.fatigue=null;p.injuryRisk=null;
  const r=review(s,{lockedStarters:{st:"11"}},{stale:true});
  assert.equal(r.status,"review");assert.equal(r.lineup.find(row=>row.slot.id==="st").player.id,"11");
  assert.equal(r.readyForFinalDecision,false);
  assert.ok(r.lineup.find(row=>row.slot.id==="st").missing.includes("피로"));
  assert.ok(r.decisionMissing.includes("최신 스냅샷"));
});

test("fixture-specific directives never spread to other fixtures",()=>{
  const s=snapshot();const input=structuredClone(s);
  const directives=new Map([["1",{lockedStarters:{st:"31"},restIds:["11"]}]]);
  const r=rotationReview(s,{constraintsByFixture:directives,mode:"best-xi"});
  assert.equal(r.plans[0].review.lineup.find(row=>row.slot.id==="st").player.id,"31");
  assert.equal(r.plans[1].review.lineup.find(row=>row.slot.id==="st").player.id,"11");
  assert.ok(r.players.find(row=>row.player.id==="11").reservations.every(row=>row.fixtureId!=="1"));
  assert.deepEqual(s,input);
});

test("a later fixture conflict stops downstream reservations and preserves only earlier drafts",()=>{
  const directives=new Map([["2",{lockedStarters:{st:"11"},restIds:["11"]}]]);
  const r=rotationReview(snapshot(),{constraintsByFixture:directives});
  assert.equal(r.status,"conflict");assert.equal(r.plans.length,2);
  assert.equal(r.conflicts[0].fixture.id,"2");
  assert.ok(r.players.flatMap(row=>row.reservations).every(row=>row.fixtureId==="1"));
  assert.equal(r.players.reduce((sum,p)=>sum+p.plannedMinutes,0),11*90);
  const first=rotationReview(snapshot(),{constraintsByFixture:new Map([["1",directives.get("2")]])});
  assert.equal(first.plans.length,1);assert.ok(first.players.every(p=>p.plannedMinutes===0));
});

test("all eleven locks are respected even when there are no remaining optimizer slots",()=>{
  const s=snapshot();const baseline=review(s,{});
  const locks=Object.fromEntries(baseline.lineup.map(row=>[row.slot.id,row.player.id]));
  const result=review(s,{lockedStarters:locks});
  assert.equal(result.selectedCount,11);assert.ok(result.lineup.every(row=>row.locked));
});

test("refresh can turn a valid retained lock into a visible conflict without replacing the user directive",()=>{
  const s=snapshot();const directives={lockedStarters:{st:"11"}};
  assert.equal(review(s,directives).status,"review");
  s.players=s.players.filter(p=>p.id!=="11");
  const r=review(s,directives);
  assert.equal(r.status,"conflict");assert.equal(r.constraints.lockedStarters.st,"11");
  assert.deepEqual(directives,{lockedStarters:{st:"11"}});
});

test("preference edits preserve other fixtures and contradictory user choices until explicit resolution",()=>{
  const byFixture=new Map();
  editFixtureSelection(byFixture,"1",{type:"lock",slotId:"st",playerId:"11"});
  const before=byFixture.get("1");
  editFixtureSelection(byFixture,"1",{type:"rest",playerId:"11",rest:true});
  assert.deepEqual(before.restIds,[]);
  assert.deepEqual(byFixture.get("1"),{lockedStarters:{st:"11"},restIds:["11"]});
  editFixtureSelection(byFixture,"2",{type:"rest",playerId:"31",rest:true});
  editFixtureSelection(byFixture,"1",{type:"lock",slotId:"st",playerId:""});
  assert.deepEqual(byFixture.get("2").restIds,["31"]);
  editFixtureSelection(byFixture,"1",{type:"clear"});
  assert.equal(byFixture.has("1"),false);assert.equal(byFixture.has("2"),true);
});

test("constraint IDs, names and obsolete slots are escaped; prototype-like IDs do not alter state prototypes",()=>{
  const s=snapshot();s.players.find(p=>p.id==="11").name='<img src=x onerror="alert(1)">';
  const constraintsByFixture=new Map();
  editFixtureSelection(constraintsByFixture,"1",{type:"lock",slotId:"__proto__",playerId:"11"});
  editFixtureSelection(constraintsByFixture,"1",{type:"lock",slotId:'<img src=x>',playerId:"11"});
  assert.equal(Object.getPrototypeOf(constraintsByFixture.get("1").lockedStarters),Object.prototype);
  const html=renderRoom("matchday",{snapshot:s,status:"current"},{formation:"4-3-3",fixtureId:"1",query:"",constraintsByFixture});
  assert.match(html,/선택 충돌/);assert.match(html,/고정 해제/);
  assert.doesNotMatch(html,/<img|NaN|undefined|\bInfinity\b/);
});
