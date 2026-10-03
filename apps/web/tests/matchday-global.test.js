import test from "node:test";
import assert from "node:assert/strict";
import { maximumWeightAssignment } from "../engine/realAssignment.js";
import { benchReview, matchdayReview } from "../engine/realMatchday.js";

test("global assignment avoids the greedy collision trap",()=>{
  const p1={id:"1",name:"Flexible Star",ca:150};
  const p2={id:"2",name:"Specialist",ca:120};
  const rows=new Map([
    ["a",[
      {player:p1,score:90},
      {player:p2,score:89}
    ]],
    ["b",[
      {player:p1,score:88},
      {player:p2,score:10}
    ]]
  ]);
  const result=maximumWeightAssignment(rows);
  assert.equal(result.find(row=>row.slotId==="a").row.player.id,"2");
  assert.equal(result.find(row=>row.slotId==="b").row.player.id,"1");
  assert.equal(result.reduce((sum,row)=>sum+(row.row?.score??0),0),177);
});

test("global assignment leaves an impossible slot empty instead of inventing a player",()=>{
  const rows=new Map([
    ["a",[{player:{id:"1",name:"Only",ca:100},score:70}]],
    ["b",[]]
  ]);
  const result=maximumWeightAssignment(rows);
  assert.equal(result.find(row=>row.slotId==="a").row.player.id,"1");
  assert.equal(result.find(row=>row.slotId==="b").row,null);
});

test("bench review excludes the XI and known unavailable players while prioritizing coverage",()=>{
  const attributes=allAttributes(15);
  const selected=player("1","XI Player",{MC:20},attributes);
  const gk=player("2","Bench Keeper",{GK:20},attributes);
  const utility=player("3","Utility Defender",{DC:20,DR:18,DL:17,DM:16},attributes);
  const attack=player("4","Attack Cover",{AMC:19,AMR:18,AML:18,STC:17},attributes);
  const injured=player("5","Injured Keeper",{GK:20},allAttributes(20),{
    injuryFree:false,eligible:true
  });

  const snapshot={players:[selected,gk,utility,attack,injured]};
  const lineup=[{player:selected,slot:{id:"cm",position:"CM"},score:80,missing:[]}];
  const review=benchReview(snapshot,lineup,3,65);

  assert.equal(review.selectedCount,3);
  assert.ok(review.players.every(row=>row.player.id!=="1"));
  assert.ok(review.players.every(row=>row.player.id!=="5"));
  assert.equal(review.players[0].player.id,"2");
  assert.ok(review.coveredPositions.includes("GK"));
  assert.ok(review.coveredPositions.includes("CB"));
  assert.ok(review.coveredPositions.some(position=>["AM","RW","LW","ST"].includes(position)));
  assert.equal(review.official,false);
});

test("matchday review reports global assignment and never duplicates a selected player",()=>{
  const attributes=allAttributes(15);
  const specs=[
    ["1","GK",{GK:20}],["2","RB",{DR:20}],["3","CB",{DC:20}],["4","CB",{DC:18}],
    ["5","LB",{DL:20}],["6","DM",{DM:20}],["7","CM",{MC:20}],["8","CM",{MC:18}],
    ["9","RW",{AMR:20}],["10","LW",{AML:20}],["11","ST",{STC:20}],
    ["12","Utility",{MC:16,DM:16,DC:15}]
  ];
  const snapshot={players:specs.map(([id,name,ratings])=>player(id,name,ratings,attributes))};
  const review=matchdayReview(snapshot,"4-3-3");

  assert.equal(review.assignmentMethod,"global-maximum-weight-v1");
  assert.equal(review.selectedCount,11);
  assert.equal(review.uniquePlayers,11);
  assert.ok(review.totalRoleFit>0);
  assert.ok(review.bench.players.every(row=>!review.lineup.some(x=>x.player?.id===row.player.id)));
});

function player(id,name,positionRatings,attributes,availability={injuryFree:null,eligible:null}){
  return {
    id,name,ca:130,
    positionRatings,
    positions:Object.keys(positionRatings).map(webPosition),
    positionsKnown:true,
    attributes:{...attributes},
    availability,
    condition:95,
    fatigue:null,
    injuryRisk:null
  };
}

function webPosition(code){
  return ({GK:"GK",DC:"CB",DR:"RB",DL:"LB",WBR:"RB",WBL:"LB",DM:"DM",MC:"CM",AMC:"AM",AMR:"RW",AML:"LW",STC:"ST"})[code]??"CM";
}

function allAttributes(value){
  const names=[
    "crossing","dribbling","finishing","heading","longShots","marking","offTheBall","passing",
    "penaltyTaking","tackling","vision","handling","aerialReach","commandOfArea","communication",
    "kicking","throwing","anticipation","decisions","oneOnOnes","positioning","reflexes",
    "firstTouch","technique","flair","corners","teamwork","workRate","longThrows","eccentricity",
    "rushingOut","punching","acceleration","freeKickTaking","strength","stamina","pace",
    "jumpingReach","leadership","dirtiness","balance","bravery","consistency","aggression",
    "agility","importantMatches","injuryProneness","versatility","naturalFitness","determination",
    "composure","concentration"
  ];
  return Object.fromEntries(names.map(name=>[name,value]));
}
