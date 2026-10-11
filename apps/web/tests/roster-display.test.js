import test from 'node:test';
import assert from 'node:assert/strict';
import { workloadGroup, filterWorkloadRows, sortTrainingPlayers, squadGroup, squadPreferenceKey, readSquadAssignments } from '../engine/rosterDisplay.js';
import { normalizeRealSnapshot } from '../engine/realSnapshot.js';
import { attributeLabels, attributeLabel, roleLabel, ageLabel } from '../engine/koreanLabels.js';
import { readFileSync } from 'node:fs';
import { roleDefinitions } from '../engine/roles.js';
import { playerDetail, renderRoom } from '../previewView.js';
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


test('all native named attributes, personality and role attributes have Korean display labels',()=>{
  const rust=readFileSync(new URL('../../../native/fm26-parser/src/snapshot.rs',import.meta.url),'utf8');
  const names=rust.match(/const ATTRIBUTE_NAMES[^=]+= \[([\s\S]*?)\];/)[1].match(/"([^"\n]+)"/g).map(s=>JSON.parse(s));
  for(const key of [...names,...Object.values(roleDefinitions).flatMap(Object.keys)])assert.ok(Object.hasOwn(attributeLabels,key),key);
  for(const key of Object.keys(roleDefinitions))assert.notEqual(roleLabel(key),key);
  assert.equal(ageLabel({age:null}),'나이 미확인');assert.equal(ageLabel({age:18}),'만 18세');
  assert.equal(attributeLabel('constructor'),'미번역 항목 (constructor)');
});
test('Korean display and ages are shared across details, training, tactics and player lists without changing data',()=>{
  const s=normalizeRealSnapshot(raw());s.players[0].attributes={passing:14,firstTouch:13};s.players[0].hidden={professionalism:17};
  const before=structuredClone(s),detail=playerDetail(s.players[0],s);
  assert.match(detail,/패스/);assert.match(detail,/퍼스트 터치/);assert.match(detail,/프로 의식/);assert.match(detail,/만 16세/);
  assert.ok(!detail.includes('>passing<'));
  for(const view of ['training','tactics','squad','medical','contracts','development']){
    const html=renderRoom(view,{snapshot:s,status:'current'},{query:''});assert.match(html,/만 16세/);if(view!=='squad')assert.match(html,/나이 미확인/);
  }
  assert.deepEqual(s,before);
});

test('squad grouping separates explicit reserve/youth mappings and isolates persistence by career and lineage',()=>{
  const s=normalizeRealSnapshot(raw()),mapping=readSquadAssignments('{"11":"reserve","12":"youth"}');
  assert.deepEqual(s.players.map(p=>squadGroup(p,mapping)),['first','reserve','youth','unknown']);
  assert.deepEqual(s.players.map(p=>squadGroup(p)),['first','unknown','unknown','unknown']);
  assert.throws(()=>readSquadAssignments('{"__proto__":"reserve"}'));
  assert.throws(()=>readSquadAssignments('{"11":"first"}'));
  s.observationLineage='one';const key=squadPreferenceKey(s,'bridge');
  assert.notEqual(squadPreferenceKey({...s,careerKey:'another'},'bridge'),key);
  assert.notEqual(squadPreferenceKey({...s,observationLineage:'two'},'bridge'),key);
  assert.notEqual(squadPreferenceKey(s,'other-bridge'),key);
  const state={snapshot:s,status:'current'},ui={query:'',squadAssignments:mapping};
  const first=renderRoom('squad',state,ui).split('<h2>선수단 관측값</h2>')[1];
  assert.match(first,/data-player="a"/);assert.ok(!first.includes('data-player="c"'));
  const youth=renderRoom('squad',state,{...ui,squadGroup:'youth',squadSort:{key:'pa',direction:'asc'}}).split('<h2>선수단 관측값</h2>')[1];
  assert.match(youth,/data-player="c"/);assert.ok(!youth.includes('data-player="a"'));
  assert.match(youth,/aria-sort="ascending"><button data-squad-sort="pa"/);
});
