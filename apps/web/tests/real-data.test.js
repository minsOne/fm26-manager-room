import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRealSnapshot, validDate, medicalReview, playingTimeReview, growthReview } from "../engine/realSnapshot.js";
import { SnapshotSession, validateBridge } from "../engine/snapshotSession.js";
import { applyDevelopmentHistory, historySummary } from "../engine/developmentHistory.js";
import { rooms, renderRoom, statusHTML, playerDetail } from "../previewView.js";
import { verifiedRoleFit, bestVerifiedRoles } from "../engine/realRoleFit.js";

const raw = () => ({schemaVersion:2,source:"rust-native",saveName:"Career.fm",gameDate:"2037-07-01",dbVersion:"26.0.0",
  manager:{club:"Test Club",clubUid:45,name:"Manager"},players:[{id:"7",name:"Young Player",age:18,ca:125,pa:125,paKnown:false,
    positions:["CM"],attributes:{passing:14,strength:9},hidden:{professionalism:17},
    playingTime:{agreed:"Squad Player",recentMinutes:0,recentMinutesKnown:false,minutesLast5:0},
    fitness:{condition:100,fatigue:0,fatigueKnown:false,injuryRisk:0,injuryRiskKnown:false},
    contract:{monthsRemaining:99,weeklyWage:0,end:null},snapshots:[{date:"2037-07-01",ca:125}]}],fixtures:[]});
const json = (v,status=200) => new Response(JSON.stringify(v),{status,headers:{"Content-Type":"application/json"}});
const session = (get,options={}) => new SnapshotSession({fetcher:async url=>{
  if(url.endsWith("/api/parser")) return json({parsing:false,lastError:null});
  if(url.endsWith("/api/history")) return new Response("",{status:404});
  return get();
},...options});

for(const [name,mutate,field] of [
  ["unknown fatigue zero",x=>{},"fatigue"], ["unknown injury zero",x=>{},"injuryRisk"],
  ["unknown PA equal to CA",x=>{},"pa"], ["missing history zero",x=>{},"minutes"],
  ["placeholder contract months",x=>{},"monthsRemaining"], ["placeholder wage zero",x=>{},"wage"],
  ["missing market interest",x=>{},"interest"], ["explicitly unknown condition",x=>{x.players[0].fitness.conditionKnown=false;},"condition"]
])test(name,()=>{const x=raw();mutate(x);assert.equal(normalizeRealSnapshot(x).players[0][field],null);});
test("known zero remains zero",()=>{const x=raw();x.players[0].fitness.fatigueKnown=true;assert.equal(normalizeRealSnapshot(x).players[0].fatigue,0);});
test("received time does not become capture time or game build",()=>{const s=normalizeRealSnapshot(raw());assert.equal(s.capturedAt,null);assert.equal(s.build,null);assert.equal(s.dbVersion,"26.0.0");assert.equal(s.buildVerified,false);});
test("missing arrays are empty but malformed arrays rejected",()=>{const x=raw();assert.deepEqual(normalizeRealSnapshot(x).candidates,[]);x.fixtures={};assert.throws(()=>normalizeRealSnapshot(x));});
for(const [name,change] of [
  ["duplicate UID",x=>x.players.push({...x.players[0]})], ["boolean CA",x=>x.players[0].ca=true],
  ["invalid CA",x=>x.players[0].ca=201], ["known PA out of range",x=>{x.players[0].paKnown=true;x.players[0].pa=201;}],
  ["demo source",x=>x.source="demo"], ["unrecognized schema",x=>x.schemaVersion=55],
  ["invalid game date",x=>x.gameDate="2037-02-29"], ["missing managed club",x=>x.manager=null],
  ["missing save identity",x=>delete x.saveName]
])test(`reject ${name}`,()=>{const x=raw();change(x);assert.throws(()=>normalizeRealSnapshot(x));});
test("valid leap dates and wrong days",()=>{assert.ok(validDate("2036-02-29"));assert.equal(validDate("2037-02-29"),false);assert.equal(validDate("2037-02-31"),false);assert.equal(validDate("2037-07-01junk"),false);});
test("legacy nested real schema preserves unknown flags",()=>{const x=raw();const nested={...x,source:undefined,meta:{source:"fmsave",saveName:x.saveName,gameDate:x.gameDate}};assert.equal(normalizeRealSnapshot(nested).players[0].fatigue,null);});
test("no fabricated medical green light or probability",()=>{const s=normalizeRealSnapshot(raw());const r=medicalReview(s.players[0],s);assert.equal(r.action,"판단 보류");assert.equal(r.probability,null);assert.equal(r.observedFields,1);assert.ok(r.missing.includes("피로"));});
test("stale fully populated data cannot permit a start",()=>{const x=raw();x.knownBuild=true;Object.assign(x.players[0].fitness,{fatigueKnown:true,injuryRiskKnown:true,injuryFreeKnown:true,injuryFree:true});Object.assign(x.players[0],{eligibilityKnown:true,eligible:true});Object.assign(x.players[0].playingTime,{recentMinutesKnown:true,historyComplete:true});const s=normalizeRealSnapshot(x);assert.equal(medicalReview(s.players[0],s,true).action,"판단 보류");});
test("five appearances are not five team games",()=>{const x=raw();Object.assign(x.players[0].playingTime,{recentMinutesKnown:true,minutesLast5:450});const p=normalizeRealSnapshot(x).players[0];assert.equal(p.appearances,450);assert.equal(playingTimeReview(p).risk,null);assert.match(playingTimeReview(p).reason,/팀의 최근 5경기/);});
test("single snapshot is not stagnation",()=>{const s=normalizeRealSnapshot(raw());assert.equal(growthReview(s.players[0],s).delta,null);});
test("growth requires comparable save lineage and dates",()=>{const x=raw();x.saveId="career-1";x.players[0].snapshots=[{date:"2037-06-01",ca:120,lineage:"other"},{date:"2037-07-01",ca:125,lineage:"career-1"}];let s=normalizeRealSnapshot(x);assert.equal(growthReview(s.players[0],s).delta,null);x.players[0].snapshots[0].lineage="career-1";s=normalizeRealSnapshot(x);assert.equal(growthReview(s.players[0],s).delta,5);});

test("real role fit uses only verified attributes and position ratings",()=>{
  const x=raw();
  Object.assign(x.players[0],{
    primaryPosition:"CM",
    positions:["CM","DM"],
    positionRatings:{MC:20,DM:16},
    attributes:{
      passing:16,vision:17,firstTouch:16,technique:16,decisions:15,
      composure:15,dribbling:14,offTheBall:14,stamina:15,workRate:15,
      positioning:14,anticipation:14,tackling:12,marking:11,strength:12
    }
  });
  const p=normalizeRealSnapshot(x).players[0];
  const fit=verifiedRoleFit(p,"CM","Advanced Playmaker");
  assert.equal(fit.official,false);
  assert.equal(fit.coverage,1);
  assert.equal(fit.position.raw,20);
  assert.equal(fit.position.source,"positionRatings");
  assert.ok(fit.score>=60&&fit.score<=100,fit);
  assert.ok(fit.strongest.length>0);
});

test("real role fit refuses incomplete core attributes",()=>{
  const x=raw();
  Object.assign(x.players[0],{
    primaryPosition:"CM",positions:["CM"],positionRatings:{MC:20},
    attributes:{passing:16,vision:17}
  });
  const p=normalizeRealSnapshot(x).players[0];
  const fit=verifiedRoleFit(p,"CM","Advanced Playmaker");
  assert.equal(fit.score,null);
  assert.ok(fit.coverage<0.8);
  assert.match(fit.reason,/충분히 확인/);
});

test("real role fit refuses unknown position familiarity",()=>{
  const x=raw();
  Object.assign(x.players[0],{
    primaryPosition:"CM",positionsKnown:false,positions:["CM"],positionRatings:{MC:20},
    attributes:{
      passing:16,vision:17,firstTouch:16,technique:16,decisions:15,
      composure:15,dribbling:14,offTheBall:14
    }
  });
  const p=normalizeRealSnapshot(x).players[0];
  const fit=verifiedRoleFit(p,"CM","Advanced Playmaker");
  assert.equal(fit.score,null);
  assert.match(fit.reason,/포지션 숙련도/);
});

test("best verified roles stay within the requested position family",()=>{
  const x=raw();
  Object.assign(x.players[0],{
    primaryPosition:"ST",positions:["ST"],positionRatings:{STC:20},
    attributes:{
      finishing:16,offTheBall:16,pace:16,acceleration:16,composure:15,
      anticipation:15,firstTouch:15,technique:15,workRate:14,stamina:14,
      teamwork:14,strength:14
    }
  });
  const p=normalizeRealSnapshot(x).players[0];
  const roles=bestVerifiedRoles(p,"ST",10);
  assert.deepEqual(roles.map(r=>r.role).sort(),["Advanced Forward","Pressing Forward"].sort());
  assert.ok(roles.every(r=>r.score!==null));
});


test("selected career history produces comparable growth across save dates",()=>{
  const s=normalizeRealSnapshot(raw());
  const history={
    schemaVersion:1,selectionId:"pin-123",points:[
      {gameDate:"2037-06-01",players:[{id:"7",ca:120,pa:180,value:900000,attributes:{passing:13,strength:9}}]},
      {gameDate:"2037-07-01",players:[{id:"7",ca:125,pa:180,value:1000000,attributes:{passing:14,strength:10}}]}
    ]
  };
  applyDevelopmentHistory(s,history,"pin-123");
  const review=growthReview(s.players[0],s);
  const summary=historySummary(s.players[0],s);
  assert.equal(s.lineageId,"pin-123");
  assert.equal(review.delta,5);
  assert.equal(summary.points,2);
  assert.equal(summary.caDelta,5);
  assert.deepEqual(summary.attributeChanges.map(x=>[x.name,x.delta]).sort(),[["passing",1],["strength",1]]);
});

test("development history never crosses selected career identity",()=>{
  const s=normalizeRealSnapshot(raw());
  const before=structuredClone(s.players[0].history);
  applyDevelopmentHistory(s,{
    schemaVersion:1,selectionId:"other-career",
    points:[{gameDate:"2037-06-01",players:[{id:"7",ca:80,attributes:{passing:1}}]}]
  },"pin-123");
  assert.deepEqual(s.players[0].history,before);
  assert.equal(s.lineageId,undefined);
});

test("future and unknown player history rows are ignored",()=>{
  const s=normalizeRealSnapshot(raw());
  applyDevelopmentHistory(s,{
    schemaVersion:1,selectionId:"pin-123",points:[
      {gameDate:"2037-08-01",players:[{id:"7",ca:130,attributes:{passing:15}}]},
      {gameDate:"2037-06-01",players:[{id:"999",ca:199,attributes:{passing:20}}]},
      {gameDate:"2037-06-01",players:[{id:"7",ca:120,attributes:{passing:13}}]}
    ]
  },"pin-123");
  assert.equal(s.players[0].history.length,1);
  assert.equal(s.players[0].history[0].date,"2037-06-01");
  assert.equal(s.players[0].history[0].ca,120);
});

test("snapshot session merges optional backend history only for pinned selection",async()=>{
  let x=raw();
  const fetcher=async url=>{
    if(url.endsWith("/api/parser")) return json({parsing:false,lastError:null,selectionId:"pin-123",selectionMode:"pinned"});
    if(url.endsWith("/api/history")) return json({
      schemaVersion:1,selectionId:"pin-123",points:[
        {gameDate:"2037-06-01",players:[{id:"7",ca:120,attributes:{passing:13}}]},
        {gameDate:"2037-07-01",players:[{id:"7",ca:125,attributes:{passing:14}}]}
      ]
    });
    return json(x);
  };
  const s=new SnapshotSession({fetcher});
  await s.refresh();
  assert.equal(s.state.status,"current");
  assert.equal(s.state.snapshot.lineageId,"pin-123");
  assert.equal(growthReview(s.state.snapshot.players[0],s.state.snapshot).delta,5);
});

for(const url of ["https://evil.example","http://127.0.0.1.evil.example:8765","http://u:p@localhost:8765","http://localhost:8765/path","file:///tmp/x","http://localhost:8765/?x=1","http://localhost:8765/#x"])
  test(`reject external/ambiguous endpoint ${url}`,()=>assert.throws(()=>validateBridge(url)));
test("accept loopback endpoint only",()=>assert.equal(validateBridge("http://127.0.0.1:8765/"),"http://127.0.0.1:8765"));
test("first load failure never returns demo",async()=>{const s=session(()=>{throw new Error("offline");});await s.refresh();assert.equal(s.state.snapshot,null);assert.equal(s.state.status,"error");});
test("refresh failure retains identical last-good snapshot",async()=>{let fail=false;const s=session(()=>{if(fail)throw new Error("offline");return json(raw());});await s.refresh();const previous=s.state.snapshot;fail=true;await s.refresh();assert.equal(s.state.snapshot,previous);assert.equal(s.state.status,"stale");assert.equal(s.state.revision,1);});
test("invalid refresh does not replace published data",async()=>{let input=raw();const s=session(()=>json(input));await s.refresh();const previous=s.state.snapshot;input={};await s.refresh();assert.equal(s.state.snapshot,previous);assert.equal(s.state.status,"stale");});
test("no overlapping fetch and no revision increment on same data",async()=>{let calls=0;const s=session(()=>{calls++;return json(raw());});await Promise.all([s.refresh(),s.refresh(),s.refresh()]);assert.equal(calls,1);await s.refresh();assert.equal(s.state.revision,1);});
test("changed same-career snapshot increments revision",async()=>{const x=raw();const s=session(()=>json(x));await s.refresh();x.players[0].ca=127;await s.refresh();assert.equal(s.state.revision,2);assert.equal(s.state.snapshot.players[0].ca,127);});
test("backend selection id keeps renamed pinned save in the same career",async()=>{
  let x=raw();
  const fetcher=async url=>url.endsWith("/api/parser")
    ? json({parsing:false,lastError:null,selectionId:"pin-123",selectionMode:"pinned"})
    : json(x);
  const s=new SnapshotSession({fetcher});
  await s.refresh();
  assert.equal(s.state.revision,1);
  x={...raw(),saveName:"Career renamed.fm"};x.players[0].ca=129;
  await s.refresh();
  assert.equal(s.state.status,"current");
  assert.equal(s.state.pending,null);
  assert.equal(s.state.snapshot.saveName,"Career renamed.fm");
  assert.equal(s.state.snapshot.players[0].ca,129);
  assert.equal(s.state.revision,2);
});
test("career switch is explicit and never silently replaces",async()=>{let x=raw();const s=session(()=>json(x));await s.refresh();const old=s.state.snapshot;x={...raw(),saveName:"Other.fm"};await s.refresh();assert.equal(s.state.snapshot,old);assert.equal(s.state.status,"career-changed");assert.equal(s.state.pending.saveName,"Other.fm");assert.ok(s.acceptPending());assert.equal(s.state.snapshot.saveName,"Other.fm");});
test("parser failure marks stale even when snapshot endpoint succeeds",async()=>{const s=new SnapshotSession({fetcher:async url=>json(url.endsWith("/api/parser")?{lastError:"parse failed"}:raw())});await s.refresh();assert.equal(s.state.status,"stale");assert.equal(s.state.snapshot.players.length,1);});
test("missing parser API is explicit and not a demo",async()=>{const s=new SnapshotSession({fetcher:async url=>url.endsWith("/api/parser")?new Response("",{status:404}):json(raw())});await s.refresh();assert.equal(s.state.status,"current");assert.equal(s.state.parser,null);assert.match(statusHTML(s.state),/가장 최근 게임 저장/);});
test("oversized response rejected",async()=>{const s=session(()=>json(raw()),{maxBytes:10});await s.refresh();assert.equal(s.state.snapshot,null);assert.match(s.state.error,/크기 제한/);});
test("timeout also covers response body",async()=>{const s=new SnapshotSession({timeoutMs:15,fetcher:async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener("abort",()=>controller.error(new DOMException("aborted","AbortError")),{once:true});}}))});await s.refresh();assert.match(s.state.error,/시간이 초과/);});
test("dispose aborts old requests without publishing",async()=>{const s=session(()=>json(raw()));const p=s.refresh();s.dispose();await p;assert.equal(s.state.snapshot,null);});
for(const room of Object.keys(rooms))test(`empty/partial real snapshot renders ${room}`,()=>{
  const s=normalizeRealSnapshot({...raw(),players:[]});const state={snapshot:s,status:"current",revision:1};
  assert.equal(typeof renderRoom(room,state,{bridge:"http://127.0.0.1:8765",formation:"4-3-3",query:""}),"string");
  assert.doesNotMatch(renderRoom(room,state,{bridge:"http://127.0.0.1:8765",formation:"4-3-3",query:""}),/NaN|undefined|\bInfinity\b/);
});
test("XSS text and attribute injection escaped in all new views",()=>{const x=raw();x.players[0].name='<img src=x onerror="evil()">';x.players[0].id='\" onfocus=evil()';const s=normalizeRealSnapshot(x);for(const room of Object.keys(rooms)){assert.doesNotMatch(renderRoom(room,{snapshot:s,status:"stale"},{bridge:"http://127.0.0.1:8765",query:""}),/<img|data-player="" onfocus/);}assert.doesNotMatch(playerDetail(s.players[0],s),/<img/);});
