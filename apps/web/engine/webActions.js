import { limitedText } from './snapshotSession.js';

export function actionScope(snapshot){
  return {selectionId:snapshot.selectionId??snapshot.saveId,source:snapshot.source,gameDate:snapshot.gameDate,
    dbVersion:snapshot.dbVersion,build:snapshot.build,clubUid:snapshot.manager.clubUid,managerName:snapshot.manager.name};
}
const marker=s=>JSON.stringify([s.status,s.metadataWarning,s.parser?.parsing,s.parser?.lastError,s.parser?.lastSuccessAt,
  s.snapshot?.careerKey,s.snapshot?.gameDate,s.snapshot?.source,s.snapshot?.dbVersion,s.snapshot?.build,s.snapshot?.players]);

/** No automatic provider calls, retries, persistent prompts, credentials or conversation history. */
export class WebActionSession {
  constructor({session,fetcher=globalThis.fetch.bind(globalThis),onChange=()=>{},now=()=>Date.now()}={}){
    this.session=session;this.fetcher=fetcher;this.onChange=onChange;this.now=now;
    this.state={busy:false,message:'',preview:null,answer:null,query:'',page:null,playerId:'',question:''};
    this.key=marker(session.state);this.generation=0;this.controller=null;this.disposed=false;
  }
  emit(){if(!this.disposed)this.onChange(this.state);}
  sync(){
    const key=marker(this.session.state);if(key===this.key)return false;
    const oldCareer=this.career;this.career=this.session.state.snapshot?.careerKey;
    this.key=key;this.generation++;this.controller?.abort();
    const pending=this.state.busy;this.state.busy=false;this.state.preview=null;this.state.answer=null;this.state.page=null;
    if(oldCareer!==this.career){this.state.playerId='';this.state.question='';this.state.query='';}
    this.state.message=pending?'데이터 상태가 변경되어 요청 결과를 보류했습니다. AI 전송을 눌렀다면 이미 처리되었을 수 있으며 자동 재전송하지 않습니다.':'';
    return true;
  }
  edit(field,value){
    if(this.state.busy||!['query','playerId','question'].includes(field))return;
    this.state[field]=value;this.state.message='';
    if(field==='query')this.state.page=null;
    else {this.state.preview=null;this.state.answer=null;}
    this.emit();
  }
  ready(){
    const s=this.session.state;
    if(this.disposed||s.status!=='current'||s.parser?.parsing||s.parser?.lastError||s.metadataWarning||!s.snapshot?.selectionId)
      throw Error('고정한 커리어의 최신 데이터에 연결한 뒤 요청하세요.');
    return s.snapshot;
  }
  async request(method,body,maxBytes,timeoutMs,token){
    const controller=new AbortController();this.controller=controller;
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const serialized=body===undefined?undefined:JSON.stringify(body);
      if(serialized&&new TextEncoder().encode(serialized).length>8192)throw Error('질문 또는 요청 크기 제한을 초과했습니다.');
      const response=await this.fetcher(`${this.session.bridge}/api/actions`,{method,body:serialized,
        headers:method==='POST'?{'Content-Type':'application/json','X-Manager-Room-Token':token}:{},
        cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
      if(response.status===404)throw Error('설치된 Companion을 업데이트하고 다시 시작하세요.');
      const text=await limitedText(response,maxBytes);let data;
      try{data=JSON.parse(text);}catch{throw Error('Companion 응답 형식을 확인할 수 없습니다.');}
      if(!response.ok)throw Error(typeof data.error==='string'?data.error:`Companion HTTP ${response.status}`);
      return data;
    }finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
  }
  async run(action,fields,apply){
    if(this.state.busy||this.disposed)return false;
    this.sync();const generation=this.generation;
    try{
      const snapshot=this.ready(),scope=actionScope(snapshot);
      this.state.busy=true;this.state.message=action==='coach-send'?'AI 요청 처리 중입니다. 자동 재전송하지 않습니다.':'로컬 Companion에서 처리 중입니다.';this.emit();
      const capabilities=await this.request('GET',undefined,16384,5000);
      if(generation!==this.generation||this.disposed)return false;
      if(capabilities.version!==1||typeof capabilities.token!=='string'||!/^[A-Za-z0-9-]{32,128}$/.test(capabilities.token))throw Error('Companion 작업 API 버전이 올바르지 않습니다.');
      if(action==='coach-preview'&&!capabilities.coachPreview)throw Error('Mac에서 --model 모델명 또는 OPENAI_MODEL을 설정하고 Companion을 다시 시작하세요.');
      if(action==='coach-send'&&!capabilities.coachSend)throw Error('Mac에서 API 키·모델을 설정하고 --enable-web-coach로 다시 시작하세요.');
      const result=await this.request('POST',{action,scope,...fields},action==='candidates'?4*1024*1024:1024*1024,
        action==='candidates'?130000:action==='coach-send'?70000:10000,capabilities.token);
      if(generation!==this.generation||this.disposed)return false;
      this.ready();apply(result);return true;
    }catch(error){
      if(generation===this.generation&&!this.disposed)this.state.message=error.name==='AbortError'
        ?'응답 대기 시간이 초과되었습니다. AI 요청은 처리되었을 수 있으며 자동 재전송하지 않습니다.':error.message;
      return false;
    }finally{if(generation===this.generation){this.state.busy=false;this.emit();}}
  }
  search(offset=0){
    const query=this.state.query;
    return this.run('candidates',{query,offset:String(offset)},result=>{
      this.session.importCandidates(JSON.stringify(result));
      this.state.page={...result.candidateSearch,query};this.state.message=`후보 ${result.candidateSearch.returned}명 · 일치 ${result.candidateSearch.matched}명 · ${offset+1}번째부터`;
    });
  }
  prepare(){
    this.state.preview=null;this.state.answer=null;
    const {playerId,question}=this.state;
    return this.run('coach-preview',{playerId,question},result=>{
      if(typeof result.previewId!=='string'||!result.request||result.expiresInSeconds!==120||typeof result.sendEnabled!=='boolean')throw Error('미리보기 응답 형식이 올바르지 않습니다.');
      this.state.preview={...result,expiresAt:this.now()+120000};
      this.state.message='아직 전송하지 않았습니다. 아래 요청 내용과 비용 발생 가능성을 확인하세요. 미리보기는 2분간 유효합니다.';
    });
  }
  send(){
    if(this.state.busy)return Promise.resolve(false);
    this.sync();
    const preview=this.state.preview;this.state.preview=null;
    if(!preview?.sendEnabled||preview.expiresAt<=this.now()){
      this.state.message='전송 가능한 미리보기가 없거나 만료되었습니다. 다시 확인하세요.';this.emit();return Promise.resolve(false);
    }
    return this.run('coach-send',{previewId:preview.previewId},result=>{
      if(typeof result.answer!=='string'||result.answer.length>65536||result.interpretationOnly!==true)throw Error('AI 응답 형식이 올바르지 않습니다.');
      this.state.answer=result.answer;this.state.message='AI가 생성한 해석입니다. 게임 화면과 대조하세요. 게임 변경 없음.';
    });
  }
  dispose(){this.disposed=true;this.generation++;this.controller?.abort();this.state.preview=null;this.state.answer=null;}
}
