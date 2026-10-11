import test from 'node:test';
import assert from 'node:assert/strict';
import { lineupCopyRequest } from '../engine/lineupCopy.js';
const review=()=>({status:'review',selectedCount:11,
  lineup:['gk','rb','rcb','lcb','lb','rdm','ldm','am','rw','lw','st'].map((id,i)=>({slot:{id},player:{id:String(i+1)}})),
  bench:{players:Array.from({length:9},(_,i)=>({player:{id:String(i+12)}}))}});
test('lineup export retains slot identities including AM/RW and rejects incomplete/duplicate selections',()=>{
  const r=review(), request=lineupCopyRequest(r,'4-2-3-1');
  assert.equal(request.lineup.am,'8');assert.equal(request.lineup.rw,'9');
  assert.equal(lineupCopyRequest(r,'4-3-3'),null);
  r.bench.players[0].player.id='1';assert.equal(lineupCopyRequest(r,'4-2-3-1'),null);
  const missing=review();missing.selectedCount=10;assert.equal(lineupCopyRequest(missing,'4-2-3-1'),null);
});
