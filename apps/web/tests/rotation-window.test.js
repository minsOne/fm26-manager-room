import test from "node:test";
import assert from "node:assert/strict";
import { rotationWindowReview } from "../engine/realRotation.js";

const allAttributes=(value=15)=>Object.fromEntries([
  "crossing","dribbling","finishing","heading","longShots","marking","offTheBall","passing",
  "penaltyTaking","tackling","vision","handling","aerialReach","commandOfArea","communication",
  "kicking","throwing","anticipation","decisions","oneOnOnes","positioning","reflexes",
  "firstTouch","technique","flair","corners","teamwork","workRate","longThrows","eccentricity",
  "rushingOut","punching","acceleration","freeKickTaking","strength","stamina","pace",
  "jumpingReach","leadership","dirtiness","balance","bravery","consistency","aggression",
  "agility","importantMatches","injuryProneness","versatility","naturalFitness","determination",
  "composure","concentration"
].map(name=>[name,value]));

function player(id,position,ratings,overrides={}){
  return {
    id:String(id),name:`P${id}`,ca:130,
    primaryPosition:position,positions:[position],positionsKnown:true,
    positionRatings:ratings,attributes:allAttributes(15),
    minutes:0,historyComplete:true,condition:95,fatigue:null,injuryRisk:null,
    availability:{injuryFree:null,eligible:null},
    ...overrides
  };
}

function snapshot(players,fixtures=4){
  return {
    gameDate:"2037-07-01",
    players,
    fixtures:Array.from({length:fixtures},(_,index)=>({
      id:`f${index+1}`,
      date:`2037-07-${String(2+index*3).padStart(2,"0")}`,
      opponent:`Opponent ${index+1}`,
      home:index%2===0,
      competition:null,
      importance:null
    }))
  };
}

function fullSquad(){
  const starters=[
    player(1,"GK",{GK:20}),
    player(2,"RB",{DR:20}),player(3,"CB",{DC:20}),player(4,"CB",{DC:19}),player(5,"LB",{DL:20}),
    player(6,"DM",{DM:20}),player(7,"CM",{MC:20}),player(8,"CM",{MC:19}),
    player(9,"RW",{AMR:20}),player(10,"LW",{AML:20}),player(11,"ST",{STC:20})
  ];
  const backups=[
    player(12,"GK",{GK:17}),
    player(13,"RB",{DR:17}),player(14,"CB",{DC:17}),player(15,"LB",{DL:17}),
    player(16,"DM",{DM:17}),player(17,"CM",{MC:17}),player(18,"CM",{MC:16}),
    player(19,"RW",{AMR:17}),player(20,"LW",{AML:17}),player(21,"ST",{STC:17})
  ];
  return [...starters,...backups];
}

test("rotation window needs at least two known future fixtures",()=>{
  const review=rotationWindowReview(snapshot(fullSquad(),1),"4-3-3",4);
  assert.equal(review.available,false);
  assert.match(review.reason,/2경기/);
});

test("rotation window keeps unique players in every match",()=>{
  const review=rotationWindowReview(snapshot(fullSquad()),"4-3-3",4);
  assert.equal(review.available,true);
  assert.equal(review.matches.length,4);
  for(const match of review.matches){
    const ids=match.lineup.filter(row=>row.player).map(row=>row.player.id);
    assert.equal(new Set(ids).size,ids.length);
    assert.equal(match.selectedCount,11);
  }
  assert.equal(review.official,false);
});

test("planned-start penalty rotates comparable backups into later matches",()=>{
  const review=rotationWindowReview(snapshot(fullSquad()),"4-3-3",4);
  const distinct=new Set(
    review.matches.flatMap(match=>match.lineup.filter(row=>row.player).map(row=>row.player.id))
  );
  assert.ok(distinct.size>11,`expected rotation beyond one XI, got ${distinct.size}`);
  assert.ok(review.matches.slice(1).some(match=>match.changesFromPrevious>0));
});

test("high observed recent minutes reduce scenario assignment without treating unknown fatigue as zero",()=>{
  const players=fullSquad();
  const overloaded=players.find(p=>p.id==="7");
  overloaded.minutes=360;
  overloaded.historyComplete=false;
  const review=rotationWindowReview(snapshot(players),"4-3-3",4);
  const exposure=review.exposure.find(row=>row.player.id==="7");
  assert.ok(exposure);
  assert.ok(exposure.missing.includes("피로"));
  assert.ok(exposure.missing.includes("출전 기록 완전성"));
  assert.ok(review.missingEvidence.includes("경기 중요도"));
  assert.equal(review.readyForFinalDecision,false);
});

test("known unavailable player is never scheduled",()=>{
  const players=fullSquad();
  players.find(p=>p.id==="11").availability={injuryFree:false,eligible:true};
  const review=rotationWindowReview(snapshot(players),"4-3-3",4);
  assert.ok(review.matches.every(match=>
    match.lineup.every(row=>row.player?.id!=="11")
  ));
});

test("horizon is clamped to two through five matches",()=>{
  const players=fullSquad();
  const s=snapshot(players,6);
  assert.equal(rotationWindowReview(s,"4-3-3",99).matches.length,5);
  assert.equal(rotationWindowReview(s,"4-3-3",1).matches.length,2);
});
