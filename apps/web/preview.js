import { SnapshotSession, initialBridge, validateBridge } from "./engine/snapshotSession.js";
import { rooms, esc, statusHTML, renderRoom, playerDetail } from "./previewView.js";
const readStorage = key => { try { return localStorage.getItem(key); } catch { return null; } };
const bridge = initialBridge(window.location.search, readStorage("managerRoom.bridge"));
const ui = {view:"manager",query:"",selectedId:null,fixtureId:null,formation:"4-3-3",rotationMode:"balanced",bridge};
let current = {snapshot:null,status:"empty",revision:0};
let session, timer, generation=0, renderedKey="";
const menu = document.getElementById("roomNavigation");
menu.innerHTML=Object.entries(rooms).map(([key,title])=>`<button data-view="${key}">${esc(title)}</button>`).join("");
function render() {
  document.getElementById("pageTitle").textContent=rooms[ui.view];
  for(const button of menu.querySelectorAll("button")) {
    button.setAttribute("aria-current",button.dataset.view===ui.view?"page":"false");
  }
  document.getElementById("content").innerHTML=renderRoom(ui.view,current,ui);
  const s=current.snapshot;
  const selected=s ? [...s.players,...s.candidates].find(p=>p.id===ui.selectedId) : null;
  document.getElementById("playerDetail").innerHTML=selected?playerDetail(selected,s):ui.selectedId?
    '<p class="notice">선택했던 선수는 새 스냅샷에 수록되지 않았습니다.</p>':"";
}
function update(state) {
  current=state;
  document.getElementById("syncStatus").innerHTML=statusHTML(state);
  document.getElementById("refreshButton").disabled=state.refreshing;
  const key=`${state.revision}/${state.status}/${state.parser?.parsing===true}`;
  // Keep address drafts, search text, selected player/tab/formation and scroll position intact.
  if(key!==renderedKey && ui.view!=="settings") { renderedKey=key; render(); }
}
function startSession() {
  generation+=1; const token=generation;
  clearTimeout(timer); session?.dispose();
  session=new SnapshotSession({bridge:ui.bridge,onChange:update});
  current=session.state; renderedKey=""; update(current); render();
  const tick=async()=>{
    if(token!==generation)return;
    if(!document.hidden)await session.refresh();
    if(token===generation)timer=setTimeout(tick,5000);
  };
  void tick();
}
document.addEventListener("click",event=>{
  const button=event.target.closest("button"); if(!button)return;
  if(button.dataset.view && rooms[button.dataset.view]) {ui.view=button.dataset.view;render();}
  if(button.hasAttribute("data-player")) {ui.selectedId=button.dataset.player;render();}
  if(button.hasAttribute("data-close-player")) {ui.selectedId=null;render();}
  if(button.hasAttribute("data-refresh"))void session.refresh();
  if(button.hasAttribute("data-accept-career")) {
    ui.selectedId=null;ui.fixtureId=null;ui.formation="4-3-3";ui.rotationMode="balanced";ui.query="";
    document.getElementById("searchInput").value="";session.acceptPending();render();
  }
});
document.getElementById("searchInput").addEventListener("input",e=>{ui.query=e.target.value;render();});
document.addEventListener("change",e=>{
  if(e.target.id==="fixtureSelect") {ui.fixtureId=e.target.value;render();}
  if(e.target.id==="formationSelect") {ui.formation=e.target.value;render();}
  if(e.target.id==="rotationModeSelect") {ui.rotationMode=e.target.value;render();}
});
document.addEventListener("submit",e=>{
  if(e.target.id!=="bridgeForm")return;e.preventDefault();
  try {
    ui.bridge=validateBridge(new FormData(e.target).get("bridge"));
    try {localStorage.setItem("managerRoom.bridge",ui.bridge);} catch {}
    ui.selectedId=null;ui.fixtureId=null;ui.query="";ui.formation="4-3-3";ui.rotationMode="balanced";
    document.getElementById("searchInput").value="";ui.view="manager";startSession();
  } catch(error) {document.getElementById("syncStatus").textContent=error.message;}
});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void session.refresh();});
window.addEventListener("pagehide",()=>{generation+=1;clearTimeout(timer);session?.dispose();});
window.addEventListener("pageshow",e=>{if(e.persisted)startSession();});
startSession();
