import test from "node:test";
import assert from "node:assert/strict";
import { mockSnapshot } from "../data/mockSnapshot.js";
import { selectMatchday } from "../engine/matchday.js";
import { trainingRecommendations } from "../engine/training.js";
import { recruitmentPriorities } from "../engine/recruitment.js";
import { marketHealth } from "../engine/economy.js";

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
