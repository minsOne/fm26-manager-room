import { rotationReview } from "./engine/realRotation.js";
import { CareerArchive } from "./engine/careerArchive.js";
import { SnapshotSession, initialBridge, validateBridge } from "./engine/snapshotSession.js";
import { rooms, esc, statusHTML, renderRoom, playerDetail } from "./previewView.js";
import { editFixtureSelection } from "./engine/realSelection.js";
import { WebActionSession } from "./engine/webActions.js";
const readStorage = key => { try { return localStorage.getItem(key); } catch { return null; } };
const bridge = initialBridge(window.location.search, readStorage("managerRoom.bridge"));
const ui = {view:"manager",query:"",selectedId:null,fixtureId:null,formation:"4-3-3",rotationMode:"balanced",constraintsByFixture:new Map(),restPanelOpen:false,minutePanelOpen:false,bridge};
let current = {snapshot:null,status:"empty",revision:0};
let archiveImport=null;
let session, actions, timer, generation=0, renderedKey="";
const menu = document.getElementById("roomNavigation");
menu.innerHTML=Object.entries(rooms).map(([key,title])=>`<button data-view="${key}">${esc(title)}</button>`).join("");
function render() {
  const active=document.activeElement;
  const draftFocus=active?.matches('#candidateQuery,#coachQuestion,#coachPlayer,#chatGPTProfile,#chatGPTModel')
    ?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
  document.getElementById("pageTitle").textContent=rooms[ui.view];
  for(const button of menu.querySelectorAll("button")) {
    button.setAttribute("aria-current",button.dataset.view===ui.view?"page":"false");
  }
  document.getElementById("content").innerHTML=renderRoom(ui.view,current,ui);
  if(draftFocus){const field=document.getElementById(draftFocus.id);field?.focus({preventScroll:true});
    if(field?.setSelectionRange&&draftFocus.start!==null)field.setSelectionRange(draftFocus.start,draftFocus.end);}
  const s=current.snapshot;
  const selected=s ? [...s.players,...s.candidates].find(p=>p.id===ui.selectedId) : null;
  document.getElementById("playerDetail").innerHTML=selected?playerDetail(selected,s):ui.selectedId?
    '<p class="notice">선택했던 선수는 새 스냅샷에 수록되지 않았습니다.</p>':"";
}
function update(state) {
  current=state;
  const actionChanged=actions?.sync();ui.actions=actions?.state;
  document.getElementById("syncStatus").innerHTML=statusHTML(state);
  document.getElementById("refreshButton").disabled=state.refreshing;
  const key=`${state.revision}/${state.status}/${state.parser?.parsing===true}`;
  // Keep address drafts, search text, selected player/tab/formation and scroll position intact.
  if((key!==renderedKey||actionChanged) && ui.view!=="settings") { renderedKey=key; render(); }
}
function startSession() {
  archiveImport=null;
  generation+=1; const token=generation;
  clearTimeout(timer); actions?.dispose();actions=null;session?.dispose();
  let storage=null;try{storage=window.localStorage;}catch{}
  session=new SnapshotSession({bridge:ui.bridge,onChange:update,archive:new CareerArchive({storage,namespace:ui.bridge})});
  actions=new WebActionSession({session,onChange:state=>{ui.actions=state;render();}});ui.actions=actions.state;
  current=session.state; renderedKey=""; update(current); render();
  const tick=async()=>{
    if(token!==generation)return;
    if(!document.hidden){await session.refresh();if(ui.view==='coach')await actions.refreshAuth();}
    if(token===generation)timer=setTimeout(tick,5000);
  };
  void tick();
}
function editSelection(fixtureId,edit){
  if(!current.snapshot?.fixtures.some(f=>f.id===fixtureId && f.date>=current.snapshot.gameDate)) return;
  // Native details toggle events can still be queued when an edit replaces the DOM.
  // Capture the visible panel state synchronously before removing those elements.
  ui.restPanelOpen=document.querySelector('details[data-rest-controls]')?.open??ui.restPanelOpen;
  ui.minutePanelOpen=document.querySelector('details[data-minute-controls]')?.open??ui.minutePanelOpen;
  ui.fixtureId=fixtureId;
  editFixtureSelection(ui.constraintsByFixture,fixtureId,edit);
  render();
}
document.addEventListener("click",event=>{
  const button=event.target.closest("button"); if(!button)return;
  if(button.dataset.view && rooms[button.dataset.view]) {ui.view=button.dataset.view;render();if(ui.view==='coach')void actions.refreshAuth();}
  if(button.hasAttribute("data-player")) {ui.selectedId=button.dataset.player;render();}
  if(button.hasAttribute("data-close-player")) {ui.selectedId=null;render();}
  if(button.hasAttribute("data-refresh"))void session.refresh();
  if(button.hasAttribute("data-candidate-offset"))void actions.search(Number(button.dataset.candidateOffset));
  if(button.hasAttribute("data-coach-send"))void actions.send();
  if(button.hasAttribute("data-auth-login"))void actions.manage('auth-login',button.dataset.authLogin?{profileId:button.dataset.authLogin,consent:button.hasAttribute('data-auth-consent')}:{});
  if(button.hasAttribute("data-auth-action"))void actions.manage(button.dataset.authAction);
  if(button.hasAttribute("data-auth-refresh"))void actions.refreshAuth();
  if(button.hasAttribute("data-clear-selection"))editSelection(button.dataset.fixtureId,{type:"clear"});
  if(button.hasAttribute("data-unlock-slot"))editSelection(button.dataset.fixtureId,{type:"lock",slotId:button.dataset.unlockSlot,playerId:""});
  if(button.hasAttribute("data-export-archive")){
    const blob=new Blob([session.exportArchive()],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download="manager-room-observations.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(button.hasAttribute("data-confirm-archive") && archiveImport){
    try{session.importArchive(archiveImport);archiveImport=null;render();document.getElementById("archiveImportStatus").textContent="기록 가져오기 완료. 같은 커리어 ID·버전만 비교합니다.";}
    catch(e){document.getElementById("archiveImportStatus").textContent=e.message;}
  }
  if(button.hasAttribute("data-save-review") && current.snapshot){
    const rotation=rotationReview(current.snapshot,{fixtureId:ui.fixtureId,formation:ui.formation,mode:ui.rotationMode,constraintsByFixture:ui.constraintsByFixture});
    session.recordDecision(rotation.plans[0]);
  }
  if(button.hasAttribute("data-new-observations")){
    if(session.startNewObservations()){
      ui.constraintsByFixture.clear();ui.selectedId=null;ui.fixtureId=null;ui.formation="4-3-3";ui.rotationMode="balanced";ui.query="";
      ui.restPanelOpen=false;ui.minutePanelOpen=false;document.getElementById("searchInput").value="";render();
    }
  }
  if(button.hasAttribute("data-accept-career")) {
    archiveImport=null;ui.selectedId=null;ui.fixtureId=null;ui.formation="4-3-3";ui.rotationMode="balanced";ui.query="";
    ui.constraintsByFixture.clear();
    ui.restPanelOpen=false;ui.minutePanelOpen=false;
    document.getElementById("searchInput").value="";session.acceptPending();render();
  }
});
document.getElementById("searchInput").addEventListener("input",e=>{ui.query=e.target.value;render();});
document.addEventListener("input",e=>{
  if(e.target.id==='candidateQuery')actions.edit('query',e.target.value);
  if(e.target.id==='coachQuestion')actions.edit('question',e.target.value);
});
document.addEventListener("change",async e=>{
  if(e.target.id==='chatGPTProfile'&&e.target.value)void actions.manage('auth-select',{profileId:e.target.value});
  if(e.target.id==='chatGPTModel'&&e.target.value)void actions.manage('auth-model',{model:e.target.value});
  if(e.target.id==='coachPlayer')actions.edit('playerId',e.target.value);
  if(e.target.id==="candidateImportFile"){
    const file=e.target.files?.[0];if(!file)return;const token=generation;
    try{if(file.size>4*1024*1024)throw Error("후보 파일 크기 제한을 초과했습니다.");const text=await file.text();if(token!==generation)return;session.importCandidates(text);}
    catch(error){const status=document.getElementById("candidateImportStatus");if(status)status.textContent=error.message;}
  }
  if(e.target.id==="archiveImportFile"){
    const file=e.target.files?.[0];archiveImport=null;
    document.querySelector('[data-confirm-archive]').disabled=true;if(!file)return;
    const generationAtStart=generation;
    try{
      if(file.size>3*1024*1024+65536)throw Error("파일 크기 제한을 초과했습니다.");
      const text=await file.text();if(generation!==generationAtStart)return;
      const info=session.inspectArchive(text);archiveImport=text;
      document.getElementById("archiveImportStatus").textContent=`${info.segments}개 구간 / ${info.dates}일 기록. 확인 버튼을 누르면 기존 보관 기록 전체를 이 파일로 교체합니다.`;
      document.querySelector('[data-confirm-archive]').disabled=false;
    }catch(error){const status=document.getElementById("archiveImportStatus");if(status)status.textContent=error.message;}
  }
  if(e.target.hasAttribute("data-review-assessment"))session.assessDecision(e.target.dataset.reviewAssessment,e.target.value);
  if(e.target.id==="fixtureSelect") {ui.fixtureId=e.target.value;render();}
  if(e.target.id==="formationSelect") {ui.formation=e.target.value;render();}
  if(e.target.id==="rotationModeSelect") {ui.rotationMode=e.target.value;render();}
  if(e.target.hasAttribute("data-match-rule"))editSelection(e.target.dataset.fixtureId,{type:"rule",field:e.target.dataset.matchRule,value:e.target.validity.badInput?"invalid":e.target.value===""?null:Number(e.target.value)});
  if(e.target.hasAttribute("data-lock-slot"))editSelection(e.target.dataset.fixtureId,{type:"lock",slotId:e.target.dataset.lockSlot,playerId:e.target.value});
  if(e.target.hasAttribute("data-minute-cap-player"))editSelection(e.target.dataset.fixtureId,{type:"cap",playerId:e.target.dataset.minuteCapPlayer,minutes:e.target.validity.badInput?"invalid":e.target.value===""?null:Number(e.target.value)});
  if(e.target.hasAttribute("data-sub-slot"))editSelection(e.target.dataset.fixtureId,{type:"sub",slotId:e.target.dataset.subSlot,field:e.target.dataset.subField,value:e.target.dataset.subField==="minute"?(e.target.validity.badInput?"invalid":e.target.value===""?null:Number(e.target.value)):e.target.value});
  if(e.target.hasAttribute("data-rest-player"))editSelection(e.target.dataset.fixtureId,{type:"rest",playerId:e.target.dataset.restPlayer,rest:e.target.checked});
});
document.addEventListener("toggle",e=>{
  if(e.target.isConnected && e.target.hasAttribute("data-minute-controls"))ui.minutePanelOpen=e.target.open;
  if(e.target.isConnected && e.target.hasAttribute("data-rest-controls"))ui.restPanelOpen=e.target.open;
},true);
document.addEventListener("submit",e=>{
  if(e.target.id==='candidateSearchForm'){e.preventDefault();void actions.search(0);return;}
  if(e.target.id==='coachForm'){e.preventDefault();void actions.prepare();return;}
  if(e.target.id!=="bridgeForm")return;e.preventDefault();
  try {
    ui.bridge=validateBridge(new FormData(e.target).get("bridge"));
    try {localStorage.setItem("managerRoom.bridge",ui.bridge);} catch {}
    ui.selectedId=null;ui.fixtureId=null;ui.query="";ui.formation="4-3-3";ui.rotationMode="balanced";
    ui.constraintsByFixture.clear();
    ui.restPanelOpen=false;ui.minutePanelOpen=false;
    document.getElementById("searchInput").value="";ui.view="manager";startSession();
  } catch(error) {document.getElementById("syncStatus").textContent=error.message;}
});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void session.refresh();});
window.addEventListener("pagehide",()=>{generation+=1;clearTimeout(timer);actions?.dispose();session?.dispose();});
window.addEventListener("pageshow",e=>{if(e.persisted)startSession();});
startSession();
