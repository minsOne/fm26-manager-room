import { normalizeRealSnapshot } from './realSnapshot.js';
export function readCandidatePage(text,snapshot){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>4*1024*1024)throw Error('후보 파일은 4MB 이하여야 합니다.');
  let raw;try{raw=JSON.parse(text);}catch{throw Error('후보 파일 JSON이 올바르지 않습니다.');}
  const data=normalizeRealSnapshot(raw),identity=snapshot.selectionId??snapshot.saveId;
  if(!identity||data.saveId!==identity||data.manager.clubUid!==snapshot.manager.clubUid||data.manager.name!==snapshot.manager.name
    ||data.gameDate!==snapshot.gameDate||data.dbVersion!==snapshot.dbVersion||data.source!==snapshot.source)
    throw Error('현재 커리어·게임 날짜·파서 버전과 일치하는 후보 파일만 가져올 수 있습니다.');
  const search=raw.candidateSearch;
  if(!search||!['scanned','matched','offset','returned'].every(k=>Number.isSafeInteger(search[k])&&search[k]>=0)
    ||search.returned!==Math.min(100,Math.max(0,search.matched-search.offset))||search.offset>250000||search.returned>100||search.returned!==data.candidates.length||search.matched>search.scanned||typeof search.hasMore!=='boolean'
    || search.hasMore!==(search.offset+search.returned<search.matched))throw Error('후보 페이지 범위가 올바르지 않습니다.');
  const owned=new Set(snapshot.players.map(p=>p.id));
  if(data.candidates.some(p=>owned.has(p.id)))throw Error('관리팀 선수와 외부 후보 UID가 겹칩니다.');
  return {players:data.candidates,coverage:data.candidateCoverage,search};
}
