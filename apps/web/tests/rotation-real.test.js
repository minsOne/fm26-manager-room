import test from "node:test";
import assert from "node:assert/strict";
import { rotationReview } from "../engine/realRotation.js";
import { matchdayReview, workloadReview } from "../engine/realMatchday.js";
import { roleDefinitions } from "../engine/roles.js";
import { renderRoom } from "../previewView.js";

const attributeNames=[...new Set(Object.values(roleDefinitions).flatMap(Object.keys))];
function player(id,code,value=16){
  return {id,name:`Player ${id}`,ca:140,pa:160,age:25,attributes:Object.fromEntries(attributeNames.map(key=>[key,value])),
    positionRatings:{[code]:20},positions:[],condition:98,fatigue:10,injuryRisk:2,
    availability:{injuryFree:true,eligible:true},minutes:0,historyComplete:true};
}
function snapshot(){
  const codes=["GK","DR","DC","DC","DL","DM","MC","MC","AMR","AML","STC"];
  return {gameDate:"2037-08-01",buildVerified:true,players:codes.flatMap((code,i)=>[
    player(String(i+1),code,17),player(String(i+21),code,16)
  ]),fixtures:[
    {id:"1",date:"2037-08-01",opponent:"A",importance:50},
    {id:"2",date:"2037-08-04",opponent:"B",importance:50},
    {id:"3",date:"2037-08-07",opponent:"C",importance:50},
    {id:"4",date:"2037-08-10",opponent:"D",importance:null},
    {id:"5",date:"2037-08-24",opponent:"E",importance:null},
    {id:"6",date:"2037-09-03",opponent:"F",importance:null}
  ]};
}
const striker=review=>review.lineup.find(row=>row.slot.position==="ST");

test("schedule plans fill unique XIs and reserve minutes without mutating source or inventing medical caps",()=>{
  const s=snapshot();const original=structuredClone(s);
  const result=rotationReview(s);
  assert.equal(result.plans.length,5);
  for(const plan of result.plans){
    assert.equal(plan.review.selectedCount,11);
    assert.equal(plan.review.uniquePlayers,11);
    assert.ok(plan.review.bench.players.every(row=>!plan.review.lineup.some(x=>x.player?.id===row.player.id)));
    assert.equal(plan.medicalMinuteCap,null);
  }
  assert.equal(result.plans[0].gapBefore,null);
  assert.equal(result.plans[0].gapAfter,3);
  assert.equal(result.plans[0].restDaysAfter,2);
  assert.ok(result.plans[1].changedStarters>0);
  assert.equal(result.players.reduce((sum,row)=>sum+row.plannedMinutes,0),5*11*90);
  assert.ok(result.players.every(row=>row.medicalMinuteCap===null));
  assert.deepEqual(s,original);
  assert.equal(result.official,false);
  assert.equal(result.readyForFinalDecision,false);
});

test("selected fixture anchors the plan and still uses actual previous/next calendar gaps",()=>{
  const result=rotationReview(snapshot(),{fixtureId:"3",horizon:3});
  assert.equal(result.plans[0].fixture.id,"3");
  assert.equal(result.plans[0].gapBefore,3);
  assert.equal(result.plans.length,3);
  assert.equal(result.plans[0].changedStarters,null);
  assert.ok(result.players.flatMap(row=>row.reservations).every(row=>!["1","2"].includes(row.fixtureId)));
  for(const id of ["absent","past"]){
    const s=snapshot();s.fixtures.push({id:"past",date:"2037-07-30",opponent:"Old"});
    const result=rotationReview(s,{fixtureId:id});
    assert.equal(result.status,"deferred");assert.deepEqual(result.plans,[]);
  }
});

test("calendar handles UTC dates, year boundaries, same-day ambiguity and no terminal zero rest",()=>{
  const s=snapshot();s.gameDate="2036-12-31";
  s.fixtures=[{id:"z",date:"2037-01-03"},{id:"a",date:"2036-12-31"},{id:"b",date:"2036-12-31"}];
  const result=rotationReview(s);
  assert.equal(result.plans[0].fixture.id,"a");
  assert.equal(result.plans[0].gapAfter,0);
  assert.ok(result.plans[0].review.decisionMissing.some(s=>s.includes("동일 날짜")));
  assert.equal(result.plans[2].gapAfter,null);
  assert.equal(result.plans[2].restDaysAfter,null);
  assert.equal(result.plans[2].gapBefore,3);
});

test("Balanced rotates a loaded starter while Best XI preserves raw global Role Fit",()=>{
  const s=snapshot();s.players.find(p=>p.id==="11").minutes=360;
  const balanced=rotationReview(s);
  const best=rotationReview(s,{mode:"best-xi"});
  assert.equal(striker(balanced.plans[0].review).player.id,"31");
  assert.equal(striker(best.plans[0].review).player.id,"11");
  assert.deepEqual(best.plans[0].review.lineup.map(row=>row.player.id),matchdayReview(s).lineup.map(row=>row.player.id));
  assert.equal(best.plans[1].changedStarters,0);
  assert.ok(best.plans[0].review.lineup.every(row=>row.selectionScore===row.score));
});

test("Development uses verified age and PA only; unknown PA is not substituted with CA",()=>{
  const s=snapshot();const youth=s.players.find(p=>p.id==="31");youth.age=19;youth.pa=180;
  const review=rotationReview(s,{mode:"development"});
  const row=striker(review.plans[0].review);
  assert.equal(row.player.id,"31");assert.ok(row.selectionScore>row.score);
  youth.pa=null;
  s.players=s.players.filter(p=>p.id!=="11");
  const unknown=striker(rotationReview(s,{mode:"development"}).plans[0].review);
  assert.ok(unknown.selectionEvidence.some(s=>s.includes("PA 여유 미확인")));
  assert.equal(unknown.selectionScore-unknown.score,4);
  youth.age=null;
  const noAge=striker(rotationReview(s,{mode:"development"}).plans[0].review);
  assert.equal(noAge.selectionScore,noAge.score);
});

test("Protect applies a stronger workload preference but retains the same Role Fit",()=>{
  const s=snapshot();s.players.find(p=>p.id==="11").minutes=360;
  s.players=s.players.filter(p=>p.id!=="31");
  const balanced=striker(rotationReview(s).plans[0].review);
  const protect=striker(rotationReview(s,{mode:"protect"}).plans[0].review);
  assert.equal(protect.score,balanced.score);assert.ok(protect.selectionScore<balanced.selectionScore);
});

test("only verified importance softens rotation preferences; unknown importance is never an easy match",()=>{
  const s=snapshot();s.players=s.players.filter(p=>p.id!=="31");
  s.players.find(p=>p.id==="11").minutes=360;
  s.fixtures[0].importance=null;
  const unknown=striker(rotationReview(s).plans[0].review);
  assert.equal(unknown.score-unknown.selectionScore,10);
  s.fixtures[0].importance=90;
  const important=striker(rotationReview(s).plans[0].review);
  assert.equal(important.score-important.selectionScore,5);
});

test("earlier planned reservations expire only from the hypothetical four-day scenario window",()=>{
  const s=snapshot();s.players=s.players.filter(p=>Number(p.id)<20);
  const result=rotationReview(s);
  assert.ok(striker(result.plans[1].review).selectionEvidence.some(s=>s.includes("90분 예약")));
  const afterGap=striker(result.plans[4].review);
  assert.equal(afterGap.selectionScore,afterGap.score);
  assert.ok(result.players.every(row=>row.observedMinutes===0 && row.plannedMinutes===450));
});

test("unknown inputs never become zero/healthy and block final decisions",()=>{
  const s=snapshot();s.buildVerified=false;
  for(const p of s.players){delete p.availability;delete p.fatigue;delete p.injuryRisk;delete p.condition;delete p.minutes;p.historyComplete=false;}
  for(const f of s.fixtures)f.importance=null;
  const result=rotationReview(s,{stale:true});
  assert.ok(result.plans.every(plan=>!plan.readyForFinalDecision));
  const first=result.plans[0].review;
  assert.equal(first.observedCritical,0);
  assert.ok(first.lineup.every(row=>row.missing.length===5));
  assert.ok(first.decisionMissing.includes("최신 스냅샷"));
  assert.ok(first.decisionMissing.includes("빌드 지원 확인"));
  assert.ok(result.players.every(row=>row.observedMinutes===null));
  assert.ok(first.lineup.every(row=>row.selectionEvidence.some(s=>s.includes("0분으로 간주하지 않음"))));
  assert.equal(workloadReview({players:[{id:"missing"}]}).length,0);
});

test("future availability is not inferred from current true flags and old workload is not extrapolated",()=>{
  const s=snapshot();s.players.find(p=>p.id==="11").minutes=360;
  const result=rotationReview(s,{fixtureId:"5"});
  assert.equal(striker(result.plans[0].review).player.id,"11");
  assert.ok(result.plans[0].review.decisionMissing.includes("경기 당일 체력·부상·출전 자격 재확인"));
  assert.equal(result.plans[0].readyForFinalDecision,false);
});

test("known unavailable players stay outside every draft and sparse roles leave gaps",()=>{
  const s=snapshot();s.players.find(p=>p.id==="11").availability.injuryFree=false;
  s.players.find(p=>p.id==="31").availability.eligible=false;
  const result=rotationReview(s);
  assert.ok(result.plans.every(plan=>striker(plan.review).player===null));
  assert.ok(result.plans.every(plan=>plan.review.missingSlots.length>0));
});

test("empty calendar defers and horizon is bounded",()=>{
  const s=snapshot();assert.equal(rotationReview(s,{horizon:99}).plans.length,5);
  assert.equal(rotationReview(s,{horizon:0}).plans.length,1);
  s.fixtures=[];assert.equal(rotationReview(s).status,"deferred");
});

test("UI shows the selected schedule, mode, missing medical cap and escaped values",()=>{
  const s=snapshot();s.fixtures[1].opponent='<img src=x onerror="alert(1)">';
  const html=renderRoom("matchday",{snapshot:s,status:"current"},{query:"",formation:"4-3-3",fixtureId:"2",rotationMode:"protect"});
  assert.match(html,/value="2" selected/);assert.match(html,/value="protect" selected/);
  assert.match(html,/계획상 예약 출전분/);assert.match(html,/의학적 출전 상한/);
  assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/NaN|undefined|\bInfinity\b/);
});

test("an absent fixture does not display an unanchored lineup as a match recommendation",()=>{
  const html=renderRoom("matchday",{snapshot:snapshot(),status:"current"},{query:"",formation:"4-3-3",fixtureId:"missing"});
  assert.match(html,/로테이션 판단 보류/);
  assert.doesNotMatch(html,/선발 후보 배치|향후 최대 5경기 로테이션/);
});
