import test from 'node:test';
import assert from 'node:assert/strict';
import { WebActionSession, actionScope } from '../engine/webActions.js';
import { renderRoom } from '../previewView.js';
import { normalizeRealSnapshot } from '../engine/realSnapshot.js';
const token='a'.repeat(64);
const raw=()=>({schemaVersion:2,source:'rust-native',saveName:'Career',dbVersion:'26',gameDate:'2037-07-01',
  manager:{clubUid:1,name:'Manager'},players:[{id:'1',name:'Player',ca:120,positions:[],attributes:{}}]});
function setup(responder){
  const snapshot={...normalizeRealSnapshot(raw()),selectionId:'pin'};
  const session={bridge:'http://127.0.0.1:8765',state:{status:'current',snapshot,parser:{lastSuccessAt:'now',parsing:false}},importCandidates(text){this.imported=JSON.parse(text);}};
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,...options});
    if(options.method==='GET')return Response.json({version:1,token,coachPreview:true,coachSend:true});
    return responder(JSON.parse(options.body),options);
  };
  const actions=new WebActionSession({session,fetcher});actions.sync();
  return {actions,session,calls};
}
const preview=()=>({previewId:'ticket',expiresInSeconds:120,sendEnabled:true,request:{model:'configured-model',store:false,input:'private question'}});
test('preview is local until explicit send; send ticket consumed before a second click',async()=>{
  let sends=0,finish;
  const {actions,calls}=setup(input=>input.action==='coach-preview'?Response.json(preview()):new Promise(resolve=>{sends++;finish=()=>resolve(Response.json({answer:'Evidence',interpretationOnly:true}));}));
  actions.edit('playerId','1');actions.edit('question','Explain');assert.equal(calls.length,0);
  assert.equal(await actions.prepare(),true);assert.equal(sends,0);
  assert.equal(JSON.parse(calls[1].body).scope.selectionId,'pin');
  assert.equal(calls[1].headers['X-Manager-Room-Token'],token);
  assert.equal(calls[1].credentials,'omit');assert.equal(calls[1].redirect,'error');
  const sending=actions.send();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await actions.send(),false);assert.equal(actions.state.preview,null);
  finish();assert.equal(await sending,true);assert.equal(sends,1);assert.equal(actions.state.answer,'Evidence');
  assert.equal(await actions.send(),false);assert.equal(sends,1);
});
test('network failure never reuses a consumed AI preview',async()=>{
  let sends=0;const {actions}=setup(input=>{
    if(input.action==='coach-preview')return Response.json(preview());
    sends++;throw Error('Disconnected');
  });
  await actions.prepare();assert.equal(await actions.send(),false);assert.equal(await actions.send(),false);assert.equal(sends,1);
});
test('new game or parser activity cancels pending results and clears drafts',async()=>{
  let finish;const {actions,session}=setup(()=>new Promise(resolve=>{finish=resolve;}));
  actions.edit('question','private');const waiting=actions.prepare();await new Promise(resolve=>setImmediate(resolve));
  session.state.snapshot={...session.state.snapshot,selectionId:'new',careerKey:'new-game'};actions.sync();
  finish(Response.json(preview()));assert.equal(await waiting,false);
  assert.equal(actions.state.preview,null);assert.equal(actions.state.question,'');
  session.state.parser.parsing=true;actions.sync();assert.equal(await actions.prepare(),false);
});
test('editing a question invalidates the previous approval; expired previews never send',async()=>{
  const {actions,calls}=setup(()=>Response.json(preview()));
  await actions.prepare();actions.edit('question','new');assert.equal(await actions.send(),false);
  await actions.prepare();actions.state.preview.expiresAt=0;const count=calls.length;
  assert.equal(await actions.send(),false);assert.equal(calls.length,count);
});
test('candidate pagination stays in the current career and import happens only on success',async()=>{
  const {actions,session,calls}=setup(input=>Response.json({...raw(),saveId:input.scope.selectionId,externalCandidates:[],
    candidateSearch:{offset:Number(input.offset),scanned:100,matched:0,returned:0,hasMore:false}}));
  actions.edit('query','<Name>');assert.equal(await actions.search(100),true);
  assert.equal(actions.state.page.offset,100);assert.equal(session.imported.saveId,'pin');
  assert.equal(JSON.parse(calls[1].body).query,'<Name>');
  assert.deepEqual(JSON.parse(calls[1].body).scope,actionScope(session.state.snapshot));
});
test('malformed capabilities, excessive body and stale sessions are blocked',async()=>{
  const {actions,session,calls}=setup(()=>Response.json(preview()));
  actions.fetcher=async()=>Response.json({version:1,token:'bad'});
  assert.equal(await actions.prepare(),false);assert.match(actions.state.message,/버전/);
  session.state.status='stale';assert.equal(await actions.prepare(),false);assert.equal(calls.length,0);
  session.state.status='current';actions.sync();
  const normal=setup(()=>Response.json(preview()));normal.actions.edit('question','한'.repeat(4000));
  assert.equal(await normal.actions.prepare(),false);assert.equal(normal.calls.length,1);
});
test('UI escapes request and model output and provides no API-key input',()=>{
  const {session}=setup(()=>{});
  const html=renderRoom('coach',session.state,{query:'',actions:{playerId:'1',question:'</textarea><script>bad()</script>',
    preview:{...preview(),request:{input:'</pre><script>bad()</script>'},expiresAt:Date.now()+10000},answer:'<img src=x onerror=bad()>'}});
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('type="password"'));
});
