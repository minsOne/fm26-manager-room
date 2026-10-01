import { mockSnapshot } from "../data/mockSnapshot.js";
import { normalizeSnapshot } from "./snapshotAdapter.js";

const DEFAULT_BRIDGE="http://127.0.0.1:8765";

export async function loadSnapshot(){
  const bridge=localStorage.getItem("managerRoom.bridge")||DEFAULT_BRIDGE;
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),1500);
    const response=await fetch(`${bridge}/api/snapshot`,{signal:controller.signal,cache:"no-store"});
    clearTimeout(timer);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    return {snapshot:normalizeSnapshot(data),source:"bridge",bridge};
  }catch{
    return {snapshot:structuredClone(mockSnapshot),source:"demo",bridge};
  }
}

export async function bridgeHealth(bridge=DEFAULT_BRIDGE){
  try{
    const response=await fetch(`${bridge}/api/health`,{cache:"no-store"});
    if(!response.ok) return {connected:false};
    return {...await response.json(),connected:true};
  }catch{return{connected:false};}
}
