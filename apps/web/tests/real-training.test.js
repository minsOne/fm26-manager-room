import test from "node:test";
import assert from "node:assert/strict";
import { verifiedTrainingReview, verifiedTrainingReviews } from "../engine/realTraining.js";

function striker(overrides={}) {
  return {
    id:"9",
    name:"Test Striker",
    age:19,
    ca:125,
    pa:180,
    primaryPosition:"ST",
    positions:["ST"],
    positionsKnown:true,
    attributesKnown:true,
    positionRatings:{STC:20},
    attributes:{
      finishing:16,
      offTheBall:8,
      pace:16,
      acceleration:16,
      composure:16,
      anticipation:9,
      firstTouch:15,
      technique:15,
      workRate:12,
      stamina:13,
      teamwork:12,
      strength:12
    },
    hidden:{injuryProneness:6},
    ...overrides
  };
}

test("verified training review ranks a role-relevant weakness",()=>{
  const review=verifiedTrainingReview(striker());
  assert.equal(review.role,"Advanced Forward");
  assert.equal(review.primary?.focus,"Attacking Movement");
  assert.equal(review.primary?.label,"공격 움직임");
  assert.ok(review.primary.gap>0);
  assert.equal(review.applyReady,false);
  assert.ok(review.bottlenecks.some(x=>x.attribute==="offTheBall"));
});

test("training review never becomes an apply instruction without live training context",()=>{
  const review=verifiedTrainingReview(striker());
  assert.equal(review.action,"훈련 초점 후보 검토");
  assert.equal(review.applyReady,false);
  assert.ok(review.uncertainty.includes("현재 집중훈련 미확인"));
  assert.ok(review.uncertainty.includes("훈련 부하 미확인"));
  assert.ok(review.uncertainty.includes("실시간 피로·부상 위험 미확인"));
});

test("unknown age blocks a focus candidate instead of inventing an age band",()=>{
  const review=verifiedTrainingReview(striker({age:null}));
  assert.equal(review.action,"판단 보류");
  assert.equal(review.primary,null);
  assert.ok(review.uncertainty.includes("나이"));
});

test("insufficient verified role attributes block training focus ranking",()=>{
  const review=verifiedTrainingReview(striker({
    attributes:{finishing:16},
    positionRatings:{STC:20}
  }));
  assert.equal(review.action,"판단 보류");
  assert.equal(review.primary,null);
  assert.ok(review.uncertainty.includes("비교 가능한 역할 적합도"));
});

test("unknown PA is context uncertainty, not a fabricated headroom number",()=>{
  const review=verifiedTrainingReview(striker({pa:null}));
  assert.equal(review.primary?.focus,"Attacking Movement");
  assert.equal(review.paHeadroom,null);
  assert.ok(review.uncertainty.includes("확정 PA 미확인"));
});

test("reviews sort the largest role-relevant gap first",()=>{
  const first=striker({id:"1",name:"Large gap"});
  const second=striker({
    id:"2",name:"Small gap",
    attributes:{...striker().attributes,offTheBall:13,anticipation:13}
  });
  const rows=verifiedTrainingReviews({players:[second,first]});
  assert.equal(rows[0].player.id,"1");
  assert.ok(rows[0].primary.gap>rows[1].primary.gap);
});
