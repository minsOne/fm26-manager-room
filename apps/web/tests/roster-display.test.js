import test from 'node:test';
import assert from 'node:assert/strict';
import { workloadGroup, filterWorkloadRows, sortTrainingPlayers } from '../engine/rosterDisplay.js';
import { normalizeRealSnapshot } from '../engine/realSnapshot.js';
import { renderRoom } from '../previewView.js';
const raw=()=>({schemaVersion:2,source:'rust-native',saveName:'career',gameDate:'2037-07-01',manager:{clubUid:1,name:'M'},fixtures:[],players:[
  {id:'a',name:'First',teamId:10,teamSlot:0,ca:100,pa:180,paKnown:true,age:16,fitness:{condition:80},attributes:{},positions:[]},
  {id:'b',name:'Reserves',teamId:11,teamSlot:1,ca:150,pa:160,paKnown:true,age:30,fitness:{condition:80},attributes:{},positions:[]},
  {id:'c',name:'Youth',teamId:12,teamSlot:2,ca:100,pa:0,paKnown:false,fitness:{condition:80},attributes:{},positions:[]},
  {id:'d',name:'Unknown',ca:50,pa:0,paKnown:false,fitness:{condition:80},attributes:{},positions:[]}]});
const ids=rows=>rows.map(p=>p.id);
test('native team metadata is normalized without inferring squad from age, CA or playing-time promise',()=>{
  const s=normalizeRealSnapshot(raw());assert.deepEqual(s.players.map(workloadGroup),['first','development','development','unknown']);
  for(const invalid of [undefined,null,-1,true,'0',1.5]){const r=raw();r.players[0].teamSlot=invalid;assert.equal(workloadGroup(normalizeRealSnapshot(r).players[0]),'unknown');}
  const r=raw();delete r.players[0].teamId;assert.equal(workloadGroup(normalizeRealSnapshot(r).players[0]),'unknown');
});
test('workload defaults to first team and each inclusion option is independent and nonmutating',()=>{
  const rows=normalizeRealSnapshot(raw()).players.map(player=>({player})),before=structuredClone(rows);
  assert.deepEqual(filterWorkloadRows(rows).map(r=>r.player.id),['a']);
  assert.deepEqual(filterWorkloadRows(rows,{includeDevelopment:true}).map(r=>r.player.id),['a','b','c']);
  assert.deepEqual(filterWorkloadRows(rows,{includeUnknown:true}).map(r=>r.player.id),['a','d']);
  assert.equal(filterWorkloadRows(rows,{includeUnknown:true,includeDevelopment:true}).length,4);assert.deepEqual(rows,before);
});
test('CA/PA sort in both directions, keeping unknowns last and equal values stable',()=>{
  const players=normalizeRealSnapshot(raw()).players,before=structuredClone(players);
  assert.deepEqual(ids(sortTrainingPlayers(players,{key:'ca',direction:'asc'})),['d','a','c','b']);
  assert.deepEqual(ids(sortTrainingPlayers(players,{key:'ca',direction:'desc'})),['b','a','c','d']);
  assert.deepEqual(ids(sortTrainingPlayers(players,{key:'pa',direction:'asc'})),['b','a','c','d']);
  assert.deepEqual(ids(sortTrainingPlayers(players,{key:'pa',direction:'desc'})),['a','b','c','d']);
  assert.deepEqual(players,before);assert.deepEqual(ids(sortTrainingPlayers(players,{key:'constructor',direction:'desc'})),ids(players));
});
test('training sort headers are keyboard buttons with truthful aria-sort and sorted rows',()=>{
  const s=normalizeRealSnapshot(raw()),html=renderRoom('training',{snapshot:s,status:'current'},{query:'',trainingSort:{key:'pa',direction:'desc'}});
  assert.match(html,/aria-sort="descending"><button data-training-sort="pa"/);
  assert.match(html,/PA 오름차순 정렬/);assert.ok(html.indexOf('data-player="a"')<html.indexOf('data-player="b"'));
});
