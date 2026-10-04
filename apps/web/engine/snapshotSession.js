import { normalizeRealSnapshot } from "./realSnapshot.js";

export const DEFAULT_BRIDGE = "http://127.0.0.1:8765";
export function validateBridge(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error("로컬 Bridge 주소가 유효하지 않습니다."); }
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    || u.username || u.password || u.search || u.hash || u.pathname !== "/") {
    throw new Error("http://127.0.0.1:포트 형태의 로컬 주소만 허용합니다.");
  }
  return u.origin;
}
// A launch URL may select a loopback port; never accept a remote bridge from URL/storage.
export function initialBridge(search = "", saved = null) {
  const requested = new URLSearchParams(search).get("bridge");
  for (const value of [requested, saved, DEFAULT_BRIDGE]) {
    if (value === null) continue;
    try { return validateBridge(value); } catch {}
  }
  return DEFAULT_BRIDGE;
}
async function limitedText(response, maxBytes) {
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) throw new Error("응답이 크기 제한을 초과했습니다.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("응답이 크기 제한을 초과했습니다.");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
  finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", {fatal:true}).decode(buffer);
}

/** Stateful read session: no implicit demo, no overlapping polls, no silent career switch. */
export class SnapshotSession {
  constructor({bridge = DEFAULT_BRIDGE, fetcher = globalThis.fetch.bind(globalThis), timeoutMs = 5000,
    archive = null, now = () => new Date().toISOString(), onChange = () => {}, maxBytes = 32 * 1024 * 1024} = {}) {
    this.bridge = validateBridge(bridge); this.fetcher = fetcher; this.timeoutMs = timeoutMs;
    this.archive = archive; this.now = now; this.onChange = onChange; this.maxBytes = maxBytes;
    this.state = { snapshot:null, status:"empty", error:null, revision:0, receivedAt:null,
      parser:null, metadataWarning:null, pending:null, refreshing:false };
    this.fingerprint = null; this.inflight = null; this.controllers = new Set(); this.disposed = false;
  }
  emit() { if (!this.disposed) this.onChange({...this.state}); }
  async request(path, maxBytes, optional = false) {
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(()=>controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.bridge}${path}`, {
        signal:controller.signal, cache:"no-store", credentials:"omit", redirect:"error"
      });
      if (optional && response.status === 404) return null;
      if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
      return await limitedText(response, maxBytes);
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  refresh() {
    if (this.disposed) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = this.load().finally(()=>{ this.inflight = null; });
    return this.inflight;
  }
  async load() {
    this.state.refreshing = true; this.emit();
    try {
      // Read status as well: /api/snapshot may still serve the old valid file after a parser failure.
      const results = await Promise.allSettled([
        this.request("/api/snapshot", this.maxBytes),
        this.request("/api/parser", 65536, true).then(v=>({body:v}), e=>({error:e.message}))
      ]);
      if (results[0].status === "rejected") throw results[0].reason;
      const body = results[0].value;
      const metadata = results[1].status === "fulfilled" ? results[1].value : {error:"파서 상태 조회 실패"};
      let snapshot = normalizeRealSnapshot(JSON.parse(body));
      let parser = null, warning = metadata.error ?? null;
      try {
        parser = metadata.body === null || metadata.body === undefined ? null : JSON.parse(metadata.body);
        if (parser && (typeof parser !== "object" || Array.isArray(parser))) throw new Error();
      } catch { parser = null; warning = "파서 상태 응답을 확인할 수 없습니다."; }
      if (this.disposed) return;
      this.state.parser = parser; this.state.metadataWarning = warning;
      this.state.receivedAt = this.now();

      // A persisted Companion selection ID is more stable than saveName for same-career saves.
      const selectionId = typeof parser?.selectionId === "string" && parser.selectionId.trim()
        ? parser.selectionId.trim() : null;
      if (selectionId) {
        snapshot.selectionId = selectionId;
        snapshot.careerKey = JSON.stringify([selectionId, snapshot.manager.clubUid, snapshot.manager.name]);
      }

      const previous = this.state.snapshot;
      const boundary=this.archive?.boundary(snapshot) ?? (previous?.careerKey===snapshot.careerKey && snapshot.gameDate<previous.gameDate ? "게임 날짜가 과거로 돌아갔습니다. 별도 기록으로 시작하세요." : null);
      if ((previous && previous.careerKey !== snapshot.careerKey) || boundary) {
        this.state.pending = snapshot; this.state.status = "career-changed";
        this.state.pendingRestart=!!boundary;
        this.state.error = boundary ?? "다른 세이브 또는 감독·구단입니다. 기존 데이터는 유지했습니다.";
        return;
      }
      const fingerprint = JSON.stringify([snapshot,!!parser?.parsing,parser?.lastError??null]);
      if (fingerprint !== this.fingerprint) {
        this.fingerprint = fingerprint;
        if(this.archive && !parser?.parsing && !parser?.lastError && !warning && parser) snapshot=this.archive.capture(snapshot);
        else if(this.archive) snapshot=this.archive.view(snapshot);
        this.state.snapshot = snapshot; this.state.revision += 1;
      }
      this.state.pending = null;this.state.pendingRestart=false;
      this.state.error = typeof parser?.lastError === "string" && parser.lastError ? parser.lastError : null;
      this.state.status = this.state.error ? "stale" : "current";
    } catch (error) {
      if (this.disposed) return;
      this.state.status = this.state.snapshot ? "stale" : "error";
      this.state.error = error.name === "AbortError" ? "Bridge 응답 시간이 초과되었습니다." : error.message;
    } finally { this.state.refreshing = false; this.emit(); }
  }
  acceptPending() {
    if (!this.state.pending || this.disposed) return false;
    let snapshot=this.state.pending;
    if(this.archive && !this.state.parser?.parsing && !this.state.parser?.lastError && !this.state.metadataWarning && this.state.parser)
      snapshot=this.archive.capture(snapshot,{restart:this.state.pendingRestart===true});
    this.state.snapshot = snapshot; this.state.pending = null;this.state.pendingRestart=false;
    this.fingerprint = null; this.state.revision += 1;
    this.state.error = this.state.parser?.lastError ?? null;
    this.state.status = this.state.error ? "stale" : "current"; this.emit(); return true;
  }
  recordDecision(plan){return this.editJournal(a=>a.saveDecision(this.state.snapshot,plan));}
  assessDecision(id,assessment){return this.editJournal(a=>a.assessDecision(this.state.snapshot,id,assessment));}
  editJournal(edit){
    if(!this.archive || !this.state.snapshot || this.state.status!=="current" || this.state.parser?.parsing)return false;
    this.state.snapshot=edit(this.archive);this.state.revision+=1;this.emit();return true;
  }
  startNewObservations(){
    if(!this.archive || !this.state.snapshot || this.state.status!=="current" || !this.state.parser || this.state.metadataWarning || this.state.parser.parsing)return false;
    this.state.snapshot=this.archive.capture(this.state.snapshot,{restart:true});
    this.fingerprint=null;this.state.revision+=1;this.emit();return true;
  }
  dispose() { this.disposed = true; for (const c of this.controllers) c.abort(); }
}
