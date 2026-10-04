import test from 'node:test';
import assert from 'node:assert/strict';
import { readCandidatePage } from '../engine/candidateImport.js';
import { normalizeRealSnapshot } from '../engine/realSnapshot.js';
const player=id=>({id,name:'Player',ca:130,pa:130,paKnown:false,positions:['CM'],attributes:{passing:15},fitness:{fatigue:0,fatigueKnown:false},playingTime:{},contract:{}});
const raw=()=>({schemaVersion:2,source:'rust-native',saveId:'pin',saveName:'Career',dbVersion:'26',gameDate:'2037-07-01',manager:{clubUid:1,name:'Manager'},players:[player('1')],externalCandidates:[player('2')],candidateSearch:{scanned:2,matched:1,offset:0,returned:1,hasMore:false}});
test('candidate import preserves unknowns and the selected career boundary',()=>{
  const source=raw(),snapshot=normalizeRealSnapshot(source),before=structuredClone(snapshot);
  const page=readCandidatePage(JSON.stringify(source),snapshot);assert.equal(page.players[0].pa,null);assert.equal(page.players[0].fatigue,null);assert.deepEqual(snapshot,before);
  for(const change of [x=>x.saveId='new-game',x=>x.gameDate='2037-07-02',x=>x.dbVersion='27',x=>x.externalCandidates=[player('1')],x=>x.candidateSearch.returned=2,x=>x.candidateSearch.hasMore=true]){
    const bad=raw();change(bad);assert.throws(()=>readCandidatePage(JSON.stringify(bad),snapshot));
  }
});
test('empty pages and malformed or oversized candidate files are distinguished',()=>{
  const source=raw(),snapshot=normalizeRealSnapshot(source);source.externalCandidates=[];source.candidateSearch={scanned:2,matched:1,offset:100,returned:0,hasMore:false};
  assert.equal(readCandidatePage(JSON.stringify(source),snapshot).players.length,0);
  assert.throws(()=>readCandidatePage('{',snapshot));assert.throws(()=>readCandidatePage('x'.repeat(4*1024*1024+1),snapshot));
});
