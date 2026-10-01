import { fixtureImportance, medicalAdvice, playingTimeRisk } from "./analysis.js";
import { selectMatchday } from "./matchday.js";
import { trainingRecommendations } from "./training.js";
import { developmentRows } from "./development.js";
import { recruitmentPriorities, candidatesForPosition } from "./recruitment.js";
import { marketHealth } from "./economy.js";

export function askCoach(snapshot,question){
  const q=question.toLowerCase();
  if(/로테이션|선발|라인업|lineup|next match|다음 경기/.test(q)){
    const plan=selectMatchday(snapshot,snapshot.fixtures[0],"balanced");
    const rests=plan.lineup.filter(x=>x.medical.action!=="START").map(x=>x.player.name);
    return response(`다음 경기 Balanced XI의 팀 Fit은 ${plan.teamFit}입니다. ${rests.length?rests.join(", ")+"는 부하 때문에 출전시간 관리가 필요합니다.":"큰 체력 충돌은 없습니다."}`,plan.confidence,["일정 중요도","Role Fit","최근 출전량","체력"]);
  }
  if(/훈련|키워|성장/.test(q)){
    const rows=trainingRecommendations(snapshot).filter(x=>x.changeNeeded).slice(0,4);
    return response(`현재 집중훈련 변경 우선순위는 ${rows.map(x=>x.player.name+" → "+x.primary.action).join(", ")} 입니다.`,Math.round(avg(rows.map(x=>x.primary.confidence))),["Role gap","CA/PA 여유","나이","성장 스냅샷"]);
  }
  if(/임대/.test(q)){
    const rows=developmentRows(snapshot).filter(x=>x.status==="LOAN"||x.status==="NEEDS_MINUTES");
    return response(`임대/출전시간 검토 대상은 ${rows.map(x=>x.player.name).join(", ")||"없습니다"}.`,84,["최근 출전시간","성장 여유","나이"]);
  }
  if(/영입|보강|사야|recruit/.test(q)){
    const priority=recruitmentPriorities(snapshot)[0];
    const targets=candidatesForPosition(snapshot,priority.position).slice(0,3);
    return response(`현재 최우선 보강 포지션은 ${priority.position}입니다. 후보는 ${targets.map(x=>x.player.name+"(Fit "+x.fit+")").join(", ")} 순입니다.`,priority.confidence,["뎁스","현재/미래 전력","Role Fit","비용"]);
  }
  if(/사우디|인플레|경제|market/.test(q)){
    const hot=marketHealth(snapshot)[0];
    return response(`${hot.name}의 Financial/Sporting Power gap은 +${hot.gap}, 상태는 ${hot.status}입니다. World Balance에서는 선수 능력치를 건드리지 않고 클럽 경제만 조정합니다.`,hot.confidence,["구매력","리그 경쟁력","주급 성장","지출 비중"]);
  }
  if(/쉬|체력|부상/.test(q)){
    const next=fixtureImportance(snapshot.fixtures[0]);
    const list=snapshot.players.map(p=>({p,a:medicalAdvice(p,next)})).filter(x=>x.a.action!=="START").slice(0,5);
    return response(`체력 관리 우선 대상은 ${list.map(x=>x.p.name+"("+x.a.action+")").join(", ")||"없습니다"}.`,Math.round(avg(list.map(x=>x.a.confidence))),["최근 14일 출전","Condition","Fatigue","부상 위험"]);
  }
  if(/불만|출전시간/.test(q)){
    const list=snapshot.players.map(p=>({p,r:playingTimeRisk(p)})).filter(x=>x.r.risk>=30).sort((a,b)=>b.r.risk-a.r.risk).slice(0,5);
    return response(`출전시간 불만 위험은 ${list.map(x=>x.p.name+" "+x.r.risk).join(", ")||"낮습니다"}.`,88,["약속 출전시간","최근 5경기 분량"]);
  }
  return response("현재 화면과 세이브 데이터를 기준으로 질문을 더 구체적으로 해주세요. 예: ‘다음 3경기 로테이션’, ‘DM 보강’, ‘João 훈련’, ‘사우디 경제 상태’.",70,["현재 스냅샷"]);
}

function response(text,confidence,evidence){return{text,confidence:Math.max(50,Math.min(99,confidence||70)),evidence};}
function avg(v){return v.length?v.reduce((a,b)=>a+b,0)/v.length:70;}
