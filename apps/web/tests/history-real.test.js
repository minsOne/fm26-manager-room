import test from "node:test";
import assert from "node:assert/strict";
import {normalizeMatchHistory,historyWindow} from "../engine/realHistory.js";
import {normalizeRealSnapshot} from "../engine/realSnapshot.js";
import {rotationReview} from "../engine/realRotation.js";
import {roleDefinitions} from "../engine/roles.js";
import {playerDetail,renderRoom} from "../previewView.js";
const match=(date,minutes,id=1)=>({date,minutes,minutesKnown:minutes!==null,opponentTeamId:id,competitionId:12});
const pWith=(rows,flags={},clock="2037-08-01")=>({matchHistory:normalizeMatchHistory({matchesKnown:true,matches:rows,...flags},clock)});

test("explicit dated records preserve zero and header-only unknown minutes without mutation",()=>{
  const input={matchesKnown:true,matches:[match("2037-08-01",0),{...match("2037-07-31",77),minutesKnown:false}],historyComplete:false};
  const copy=structuredClone(input),h=normalizeMatchHistory(input,"2037-08-01");
  assert.equal(h.status,"review");assert.equal(h.records[0].minutes,0);assert.equal(h.records[1].minutes,null);
  assert.equal(h.complete,false);assert.equal(h.minutesVerified,false);assert.deepEqual(input,copy);
});

test("missing history and an empty unproven list do not establish zero minutes",()=>{
  for(const pt of [{},{matches:[]},{matchesKnown:false,matches:[match("2037-07-31",90)]}]){
    const player={matchHistory:normalizeMatchHistory(pt,"2037-08-01")};
    assert.equal(historyWindow(player,"2037-08-01","2037-08-01").minutes,null);
    assert.equal(player.matchHistory.status,"unavailable");
  }
  const empty=pWith([]);
  assert.equal(historyWindow(empty,"2037-08-01","2037-08-01").minutes,null);
  const confirmed=pWith([],{historyComplete:true});
  assert.equal(historyWindow(confirmed,"2037-08-01","2037-08-01").minutes,0);
  assert.equal(historyWindow(confirmed,"2037-08-01","2037-08-02").minutes,null);
});

test("fourteen-date window handles exact cutoff, known zero, missing stats and same-day ambiguity",()=>{
  const p=pWith([match("2037-07-18",90),match("2037-07-19",60),match("2037-07-31",null),match("2037-08-01",0)]);
  const w=historyWindow(p,"2037-08-01","2037-08-01");
  assert.equal(w.from,"2037-07-19");assert.equal(w.minutes,60);assert.equal(w.knownRecords,2);
  assert.equal(w.missingRecords,1);assert.equal(w.sameDayRecords,1);assert.equal(w.complete,false);
  const later=historyWindow(p,"2037-08-01","2037-08-02");
  assert.equal(later.minutes,0);assert.equal(later.knownRecords,1);assert.equal(later.observedThrough,"2037-08-01");
  assert.equal(historyWindow(p,"2037-08-01","2037-08-15").minutes,null);
});

test("UTC windows cross leap days and years without projecting new observations",()=>{
  const leap=pWith([match("2036-02-29",90),match("2036-02-17",40),match("2036-02-16",70)],{},"2036-03-01");
  const w=historyWindow(leap,"2036-03-01","2036-03-01");
  assert.equal(w.from,"2036-02-17");assert.equal(w.minutes,130);
  const year=pWith([match("2036-12-31",90)],{historyComplete:true},"2037-01-01");
  assert.equal(historyWindow(year,"2037-01-01","2037-01-02").from,"2036-12-20");
  assert.equal(historyWindow(year,"2037-01-01","2037-01-02").complete,false);
});

for(const [name,rows] of [
  ["non-array",{}], ["future date",[match("2037-08-02",90)]],
  ["invalid date",[match("2037-02-29",90)]], ["fractional minutes",[match("2037-07-31",1.5)]],
  ["out of sanity range",[match("2037-07-31",200)]], ["numeric string",[match("2037-07-31","90")]],
  ["missing opponent",[{...match("2037-07-31",90),opponentTeamId:null}]],
  ["duplicate match identity",[match("2037-07-31",90),match("2037-07-31",60)]],
]) test(`invalid or ambiguous dated history defers arithmetic: ${name}`,()=>{
  const p=pWith(rows,{historyComplete:true});
  assert.equal(p.matchHistory.status,"invalid");assert.ok(p.matchHistory.issues.length);
  assert.equal(historyWindow(p,"2037-08-01","2037-08-01").minutes,null);
  assert.equal(p.matchHistory.complete,false);
});

test("a header-only window stays unknown and different opponents on one date remain distinct",()=>{
  const unknown=pWith([match("2037-07-31",null)],{historyComplete:true});
  const w=historyWindow(unknown,"2037-08-01","2037-08-01");
  assert.equal(w.minutes,null);assert.equal(w.missingRecords,1);assert.equal(w.complete,false);
  const two=pWith([match("2037-08-01",30,1),match("2037-08-01",20,2)]);
  assert.equal(two.matchHistory.status,"review");assert.equal(historyWindow(two,"2037-08-01","2037-08-01").minutes,50);
});

function rotationSnapshot(){
  const keys=[...new Set(Object.values(roleDefinitions).flatMap(Object.keys))];
  const rows=[match("2037-07-25",90),match("2037-07-26",90),match("2037-07-27",90),match("2037-07-28",90)];
  return {gameDate:"2037-08-01",buildVerified:true,players:[{
    id:"7",name:"Striker",positions:[],attributes:Object.fromEntries(keys.map(k=>[k,17])),positionRatings:{STC:20},
    ca:150,age:25,pa:null,condition:99,fatigue:null,injuryRisk:null,availability:{injuryFree:null,eligible:null},
    minutes:999,historyComplete:false,...pWith(rows)
  }],fixtures:[{id:"1",date:"2037-08-05",opponent:"A"},{id:"2",date:"2037-08-08",opponent:"B"},{id:"3",date:"2037-08-20",opponent:"C"}]};
}

test("future rotation uses dated observed windows and keeps planned reservations separate",()=>{
  const s=rotationSnapshot(),copy=structuredClone(s),r=rotationReview(s);
  const first=r.plans[0],next=r.plans[1],late=r.plans[2];
  assert.equal(first.observedWorkloads[0].window.minutes,360);
  assert.equal(next.observedWorkloads[0].window.minutes,270);
  assert.equal(late.observedWorkloads[0].window.minutes,null);
  const a=first.review.lineup.find(r=>r.player),b=next.review.lineup.find(r=>r.player);
  assert.equal(a.score-a.selectionScore,10); // >3 days from capture, but dated evidence is valid.
  assert.equal(b.score-b.selectionScore,12); // prior 90 planned minutes; no stale 360-minute penalty.
  assert.equal(r.players[0].observedMinutes,999);assert.equal(r.players[0].plannedMinutes,270);
  assert.ok(first.review.decisionMissing.includes("출전분 해석의 게임 화면 대조"));
  assert.deepEqual(s,copy);
});

test("invalid timeline never falls back to a legacy aggregate and same-day history requires ordering",()=>{
  const s=rotationSnapshot();s.fixtures[0].date=s.gameDate;
  s.players[0].matchHistory=normalizeMatchHistory({matchesKnown:true,matches:[match("2037-08-01",90),match("2037-08-01",90)]},s.gameDate);
  const invalid=rotationReview(s).plans[0];
  assert.equal(invalid.observedWorkloads[0].window.minutes,null);
  assert.ok(invalid.review.decisionMissing.includes("날짜별 출전 기록 오류·중복"));
  s.players[0].matchHistory=pWith([match("2037-08-01",90)]).matchHistory;
  assert.ok(rotationReview(s).plans[0].review.decisionMissing.includes("경기 당일 수록 기록의 시간 순서"));
});

test("normalized native timeline and UI preserve source limitations and escape text",()=>{
  const raw={schemaVersion:2,source:"rust-native",saveName:"Test.fm",gameDate:"2037-08-01",manager:{clubUid:1},players:[{
    id:"7",name:"<img src=x>",positions:[],playingTime:{matchesKnown:true,matches:[match("2037-07-31",90),match("2037-07-30",null)],historyComplete:false}
  }],fixtures:[]};
  const s=normalizeRealSnapshot(raw),p=s.players[0];
  assert.equal(p.matchHistory.records[1].minutes,null);assert.equal(p.minutes,null);
  const html=playerDetail(p,s);
  assert.match(html,/날짜별 경기 기록/);assert.match(html,/2037-07-31/);assert.match(html,/대회 단계 ID/);assert.match(html,/전체 출전량은 미확인/);
  assert.doesNotMatch(html,/<img|NaN|undefined|Infinity/);
  const rs=rotationSnapshot();const room=renderRoom("matchday",{snapshot:rs,status:"current"},{fixtureId:"1"});
  assert.match(room,/경기일 기준 수록 출전량/);assert.match(room,/2037-07-23/);
});
