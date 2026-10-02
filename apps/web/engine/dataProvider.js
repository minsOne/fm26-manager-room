import { mockSnapshot } from "../data/mockSnapshot.js";
import { SnapshotSession, DEFAULT_BRIDGE } from "./snapshotSession.js";

// Legacy engines run only in the explicitly selected demo page. Real data uses preview.js.
export async function loadSnapshot() {
  if (globalThis.document?.documentElement?.dataset?.mode === "demo") {
    return { snapshot:structuredClone(mockSnapshot), source:"demo", bridge:DEFAULT_BRIDGE };
  }
  throw new Error("실제 데이터는 상태와 누락값을 유지하는 SnapshotSession으로 불러와야 합니다.");
}
export async function bridgeHealth(bridge=DEFAULT_BRIDGE) {
  const session=new SnapshotSession({bridge});
  try {
    const body=await session.request("/api/health",65536);
    return {...JSON.parse(body),connected:true};
  } catch {return {connected:false};} finally {session.dispose();}
}
