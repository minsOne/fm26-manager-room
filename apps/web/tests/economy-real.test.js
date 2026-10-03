import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRealSnapshot } from "../engine/realSnapshot.js";
import { economyReview, saudiEconomyReview } from "../engine/realEconomy.js";

const raw=()=>({
  schemaVersion:2,source:"rust-native",saveName:"Economy.fm",gameDate:"2037-07-01",dbVersion:"26.0.0",
  manager:{club:"Test Club",clubUid:45,name:"Manager"},
  players:[],fixtures:[],
  economyGroups:[
    {
      nationId:133,nationName:"Saudi Arabia",clubsWithFinance:8,financeRows:96,
      totalBalance:1_000_000_000,transferBudgetAllocated:400_000_000,
      transferBudgetRemaining:300_000_000,wageBudgetWeekly:10_000_000,
      wagePayrollWeekly:8_000_000,budgetCapacityProxy:820_000_000,
      top4CapacityShare:72,reputationCoverageClubs:8,averageReputation:6500,
      sportingPowerProxy:65,
      topClubs:[
        {clubUid:1,clubName:"A",balance:200_000_000,transferBudgetRemaining:90_000_000,
         wageBudgetWeekly:2_000_000,wagePayrollWeekly:1_500_000,reputation:7500,budgetCapacityProxy:194_000_000}
      ]
    },
    {
      nationId:44,nationName:null,clubsWithFinance:10,financeRows:120,
      totalBalance:2_000_000_000,transferBudgetAllocated:700_000_000,
      transferBudgetRemaining:600_000_000,wageBudgetWeekly:20_000_000,
      wagePayrollWeekly:18_000_000,budgetCapacityProxy:1_640_000_000,
      top4CapacityShare:50,reputationCoverageClubs:10,averageReputation:8000,
      sportingPowerProxy:80,topClubs:[]
    }
  ]
});

test("real snapshot validates nation economy groups",()=>{
  const s=normalizeRealSnapshot(raw());
  assert.equal(s.economyGroups.length,2);
  assert.equal(s.economyGroups[0].nationId,133);
  assert.equal(s.economyGroups[0].nationName,"Saudi Arabia");
  assert.equal(s.economyGroups[0].topClubs[0].clubName,"A");
});

test("malformed nation economy data rejects the whole refresh",()=>{
  const x=raw();
  x.economyGroups[0].top4CapacityShare=101;
  assert.throws(()=>normalizeRealSnapshot(x),/경제 그룹/);
});

test("economy review uses relative capacity without calling it official",()=>{
  const s=normalizeRealSnapshot(raw());
  const rows=economyReview(s);
  const saudi=rows.find(row=>row.nationId===133);
  const other=rows.find(row=>row.nationId===44);
  assert.equal(other.financialCapacityIndex,100);
  assert.equal(saudi.financialCapacityIndex,50);
  assert.equal(saudi.sportingPower,65);
  assert.equal(saudi.comparableGap,-15);
  assert.equal(saudi.official,false);
});

test("Saudi review never turns one snapshot into an overheating verdict",()=>{
  const x=raw();
  x.economyGroups[0].budgetCapacityProxy=2_000_000_000;
  const s=normalizeRealSnapshot(x);
  const review=saudiEconomyReview(s);
  assert.equal(review.available,true);
  assert.equal(review.official,false);
  assert.doesNotMatch(review.status,/과열|overheated/i);
  assert.match(review.action,/관찰/);
  assert.ok(review.missing.includes("12개월 재정 시계열"));
  assert.ok(review.missing.includes("실제 이적 지출"));
});

test("missing verified Saudi mapping is reported as unknown, not healthy",()=>{
  const x=raw();
  x.economyGroups=x.economyGroups.filter(group=>group.nationId!==133);
  const review=saudiEconomyReview(normalizeRealSnapshot(x));
  assert.equal(review.available,false);
  assert.match(review.status,/미확인/);
});
