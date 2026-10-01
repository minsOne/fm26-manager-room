import test from "node:test";
import assert from "node:assert/strict";
import { mockSnapshot } from "../data/mockSnapshot.js";
import { selectMatchday } from "../engine/matchday.js";
import { trainingRecommendations } from "../engine/training.js";
import { recruitmentPriorities } from "../engine/recruitment.js";
import { marketHealth } from "../engine/economy.js";
import { normalizeSnapshot } from "../engine/snapshotAdapter.js";

test("matchday lineup uses 11 unique players",()=>{
  const plan=selectMatchday(structuredClone(mockSnapshot),mockSnapshot.fixtures[0],"balanced");
  assert.equal(plan.lineup.length,11);
  assert.equal(new Set(plan.lineup.map(x=>x.player.id)).size,11);
});

test("training advisor produces recommendation for every player",()=>{
  const rows=trainingRecommendations(structuredClone(mockSnapshot));
  assert.equal(rows.length,mockSnapshot.players.length);
  assert.ok(rows.every(x=>x.primary?.action));
  assert.ok(rows.every(x=>x.primary.confidence>=35&&x.primary.confidence<=99));
});

test("recruitment priorities identify a weakest position",()=>{
  const rows=recruitmentPriorities(structuredClone(mockSnapshot));
  assert.ok(rows.length>=10);
  assert.ok(rows[0].severity>=rows.at(-1).severity);
});

test("Saudi market is detected as overheated in demo snapshot",()=>{
  const rows=marketHealth(structuredClone(mockSnapshot));
  const saudi=rows.find(x=>x.id==="saudi");
  assert.equal(saudi.status,"OVERHEATED");
  assert.ok(saudi.gap>20);
});


test("native Rust snapshot normalizes to canonical Manager Room schema",()=>{
  const native={
    schemaVersion:2,
    source:"rust-native",
    saveName:"Career",
    dbVersion:"26.0.0+0",
    gameDate:"2037-07-01",
    manager:{name:"Manager",club:"FC St. Helens",clubUid:2000180964},
    clubFinance:{
      balance:1000000,
      transferBudgetAllocated:500000,
      transferBudgetRemaining:400000,
      wageBudgetWeekly:100000,
      wagePayrollWeekly:90000,
      financeRows:12
    },
    fixtures:[{
      id:"f1",date:"2037-07-05",opponent:"Club B",home:true,
      competition:"Stage 10",competitionKnown:false,restDaysAfter:4,
      homeTeamId:1,awayTeamId:2
    }],
    players:[{
      id:"1",name:"Test Player",age:20,nationality:"1",
      primaryPosition:"CM",positions:["CM"],ca:130,pa:170,paKnown:true,
      value:10000000,wage:50000,attributes:{passing:14},hidden:{professionalism:15},
      playingTime:{agreed:"Squad Player",recentMinutes:180,minutesLast5:220,recentMinutesKnown:true},
      fitness:{condition:94,matchSharpness:88,fatigueKnown:false,injuryRiskKnown:false},
      contract:{weeklyWage:50000,monthsRemaining:24,squadStatus:"Squad Player"}
    }],
    coverage:{recentMinutes:"native-match-history"}
  };
  const snapshot=normalizeSnapshot(native);
  assert.equal(snapshot.meta.gameDate,"2037-07-01");
  assert.equal(snapshot.manager.club,"FC St. Helens");
  assert.equal(snapshot.formation.slots.length,11);
  assert.equal(snapshot.players[0].playingTime.recentMinutes,180);
  assert.equal(snapshot.players[0].fitness.fatigue,0);
  assert.equal(snapshot.fixtures[0].opponent,"Club B");
  assert.equal(snapshot.leagues.length,0);
  assert.equal(snapshot.clubFinance.transferBudgetRemaining,400000);
});

test("real snapshot without world league mapping yields no fake market health",()=>{
  const snapshot=normalizeSnapshot({
    schemaVersion:2,
    source:"rust-native",
    saveName:"Career",
    gameDate:"2037-07-01",
    manager:{club:"FC St. Helens"},
    fixtures:[],
    players:[]
  });
  assert.deepEqual(marketHealth(snapshot),[]);
});
