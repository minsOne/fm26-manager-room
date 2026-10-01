import { loadSnapshot } from "./engine/dataProvider.js";
import { fixtureImportance, squadHealth, buildActionCenter, medicalAdvice, playingTimeRisk, positionHealth } from "./engine/analysis.js";
import { selectMatchday } from "./engine/matchday.js";
import { trainingRecommendations, recommendTraining, bestRole } from "./engine/training.js";
import { developmentRows, rankedLoanOffers } from "./engine/development.js";
import { recruitmentPriorities, candidatesForPosition, upgradeCandidates, buyVsDevelop, shadowSquadImpact } from "./engine/recruitment.js";
import { transferDecisions, contractRisks } from "./engine/transfers.js";
import { marketHealth, rebalancePreview } from "./engine/economy.js";
import { recommendationAccuracy, decisionJournal } from "./engine/reports.js";
import { roleFit, roleScore } from "./engine/roles.js";
import { formationPresets, roleOptionsByPosition, applyFormation, tacticalChemistry } from "./engine/tactics.js";
import { askCoach } from "./engine/coach.js";

const state={
  snapshot:null,
  source:"demo",
  bridge:"",
  view:"manager",
  matchMode:"balanced",
  recruitmentPosition:"DM",
  economyPreset:"balanced",
  coachMessages:[
    {role:"coach",text:"Manager Room이 준비됐습니다. 다음 경기, 훈련, 유망주, 영입, 사우디 경제처럼 바로 질문해보세요.",confidence:96}
  ]
};

const nav=[
  ["Today",[["manager","⌂","Manager Room"],["matchday","◉","Matchday"]]],
  ["Team",[["squad","▦","Squad"],["tactics","⌁","Tactics"],["training","↗","Training"],["development","◎","Development"],["medical","✚","Medical"]]],
  ["Planning",[["recruitment","⌕","Recruitment"],["transfers","⇄","Transfers"],["contracts","▤","Contracts"],["economy","◫","Economy"]]],
  ["Review",[["reports","◌","Reports"],["coach","✦","AI Coach"],["settings","⚙","Settings"]]]
];

const titles={
  manager:["Manager Room","지금 감독이 결정해야 할 것만 먼저 보여줍니다."],
  matchday:["Matchday Room","경기 중요도·상대·부하·출전시간을 동시에 고려해 선발합니다."],
  squad:["Squad Room","선수 목록보다 포지션의 구조적 문제를 먼저 봅니다."],
  tactics:["Tactics Room","포메이션과 In/Out of Possession Role을 바꾸고 즉시 재계산합니다."],
  training:["Training Room","변경할 가치가 있는 집중훈련만 추려냅니다."],
  development:["Development Room","성장·출전·임대·1군 진입 경로를 관리합니다."],
  medical:["Medical Room","누굴 쉬게 하고 몇 분을 써야 할지 판단합니다."],
  recruitment:["Recruitment Room","어디를 왜 보강해야 하는지부터 후보까지 연결합니다."],
  transfers:["Transfer Room","누굴 팔고, 임대 보내고, 남길지 정리합니다."],
  contracts:["Contract Room","계약 만료와 스쿼드 중요도를 함께 봅니다."],
  economy:["Economy Room","장기 세이브의 시장 왜곡을 탐지하고 조정안을 Preview합니다."],
  reports:["Reports","코치 추천이 실제로 맞았는지 추적합니다."],
  coach:["AI Coach","현재 세이브 컨텍스트를 바탕으로 코치에게 대화하듯 묻습니다."],
  settings:["Settings","감독 철학과 로컬 macOS Bridge 연결을 관리합니다."]
};

init();

async function init(){
  const loaded=await loadSnapshot();
  state.snapshot=loaded.snapshot;
  state.source=loaded.source;
  state.bridge=loaded.bridge;
  renderChrome();
  render();
}

function renderChrome(){
  document.getElementById("sidebar").innerHTML=sidebarHtml();
  document.getElementById("topbar").innerHTML=topbarHtml();
  bindGlobal();
}

function render(){
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.nav===state.view));
  const [title,sub]=titles[state.view]??titles.manager;
  document.querySelector("#topbar h1").textContent=title;
  document.querySelector("#topbar p").textContent=sub;

  const renderers={
    manager:renderManager,matchday:renderMatchday,squad:renderSquad,tactics:renderTactics,
    training:renderTraining,development:renderDevelopment,medical:renderMedical,
    recruitment:renderRecruitment,transfers:renderTransfers,contracts:renderContracts,
    economy:renderEconomy,reports:renderReports,coach:renderCoach,settings:renderSettings
  };
  document.getElementById("content").innerHTML=(renderers[state.view]??renderManager)();
  bindContent();
}

function sidebarHtml(){
  return `
    <div class="brand"><div class="brandmark">MR</div><div><strong>Manager Room</strong><small>FM26 Assistant</small></div></div>
    ${nav.map(([section,items])=>`<div class="nav-title">${section}</div>${items.map(([id,icon,label])=>`
      <button class="nav ${state.view===id?"active":""}" data-nav="${id}"><span>${icon}</span>${label}${navBadge(id)}</button>`).join("")}`).join("")}
    <div class="connection"><b>${state.source==="bridge"?"● macOS Bridge connected":"○ Demo snapshot"}</b><br>${esc(state.snapshot?.meta?.saveName??"No save")}<br><span style="color:var(--muted)">${esc(state.bridge)}</span></div>
  `;
}

function navBadge(id){
  if(!state.snapshot) return "";
  if(id==="training") return `<span class="badge">${trainingRecommendations(state.snapshot).filter(x=>x.changeNeeded).length}</span>`;
  if(id==="recruitment") return `<span class="badge">${recruitmentPriorities(state.snapshot).filter(x=>x.severity>=20).length}</span>`;
  return "";
}

function topbarHtml(){
  return `
    <div style="display:flex;gap:8px;align-items:flex-start">
      <button class="btn mobile" id="menuBtn">☰</button>
      <div><h1>Manager Room</h1><p></p></div>
    </div>
    <div class="actions">
      <span class="tag ${state.source==="bridge"?"good":"warn"}">${state.source==="bridge"?"LIVE":"DEMO"}</span>
      <button class="btn secondary" data-action="refresh">Refresh</button>
      <button class="btn primary" data-nav="coach">Ask Coach ✦</button>
    </div>
  `;
}

function renderManager(){
  const s=state.snapshot;
  const next=s.fixtures[0];
  const imp=fixtureImportance(next);
  const training=trainingRecommendations(s);
  const dev=developmentRows(s);
  const recruit=recruitmentPriorities(s);
  const economy=marketHealth(s).filter(x=>x.status==="OVERHEATED");
  const actions=buildActionCenter(s,training,dev,recruit,economy).slice(0,7);
  const health=squadHealth(s);
  return `
    <div class="grid">
      <article class="card s7"><div class="hero">
        <div class="kicker">Next match · ${esc(next.competition)}</div>
        <div class="match">
          <div class="club"><div class="crest">MR</div><b>${esc(s.manager.club)}</b><span>${next.home?"Home":"Away"}</span></div>
          <div class="vs"><b>${fmtDate(next.date)}</b><span>D-${daysUntil(next.date)}</span><div style="margin-top:8px"><span class="tag danger">중요도 ${imp}</span></div></div>
          <div class="club"><div class="crest">${initials(next.opponent)}</div><b>${esc(next.opponent)}</b><span>${next.home?"Away":"Home"}</span></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin-top:17px">
          <div><div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:5px"><span>Squad readiness</span><b>82%</b></div><div class="progress"><i style="width:82%"></i></div></div>
          <button class="btn primary" data-nav="matchday">경기 준비</button>
        </div>
      </div></article>

      <article class="card s5">
        <div class="head"><h2>MUST REVIEW TODAY</h2><span class="tag danger">${actions.length} actions</span></div>
        <div class="body list">${actions.map(actionRow).join("")}</div>
      </article>

      <article class="card s4">
        <div class="head"><h3>Squad status</h3><small>${s.players.length} players</small></div>
        <div class="body metrics">
          ${metric("REST",s.players.filter(p=>medicalAdvice(p,imp).action==="REST").length,"danger")}
          ${metric("MINUTES",s.players.filter(p=>playingTimeRisk(p).risk>=45).length,"warn")}
          ${metric("TRAIN",training.filter(x=>x.changeNeeded).length,"")}
          ${metric("LOAN",dev.filter(x=>x.status==="LOAN").length,"good")}
        </div>
      </article>

      <article class="card s4">
        <div class="head"><h3>Position health</h3><button class="btn" data-nav="squad">Open</button></div>
        <div class="body position-grid">${health.map(positionBox).join("")}</div>
      </article>

      <article class="card s4">
        <div class="head"><h3>Coach briefing</h3><span class="tag info">Confidence 92%</span></div>
        <div class="body">
          <b style="font-size:11px">이번 주는 다음 빅매치 대비 주전 부하와 DM 뎁스가 핵심입니다.</b>
          <p style="font-size:9px;color:var(--muted)">쉬어야 할 선수와 출전시간이 부족한 선수를 같은 경기에서 교체하면 경기력을 크게 잃지 않고 두 문제를 동시에 해결할 수 있습니다.</p>
        </div>
      </article>

      <article class="card s8">
        <div class="head"><h3>4-match planning window</h3><small>한 경기보다 일정 전체를 최적화</small></div>
        <div class="body fixture-grid">${s.fixtures.map(fixtureCard).join("")}</div>
      </article>

      <article class="card s4">
        <div class="head"><h3>World market alert</h3><button class="btn" data-nav="economy">Economy</button></div>
        <div class="body">
          ${economy.length?economy.map(x=>`<div class="row"><div class="avatar">!</div><div><b>${esc(x.name)}</b><p>Financial ${x.financialPower} / Sporting ${x.sportingPower}</p></div><span class="tag danger">+${x.gap}</span></div>`).join(""):'<span class="tag good">Normal</span>'}
        </div>
      </article>
    </div>
  `;
}

function renderMatchday(){
  const plan=selectMatchday(state.snapshot,state.snapshot.fixtures[0],state.matchMode);
  return `
    <div class="grid">
      <article class="card s8">
        <div class="head">
          <div><h2>Recommended XI · vs ${esc(plan.fixture.opponent)}</h2><small>Team Fit ${plan.teamFit} · Confidence ${plan.confidence}%</small></div>
          <div class="controls">${["best","balanced","development","protect"].map(x=>`<button class="control ${state.matchMode===x?"active":""}" data-mode="${x}">${x}</button>`).join("")}</div>
        </div>
        <div class="body"><div class="pitch">${plan.lineup.map(playerNode).join("")}</div></div>
      </article>
      <div class="s4" style="display:grid;gap:13px">
        <article class="card"><div class="head"><h3>Selection conflicts</h3><span class="tag ${plan.conflicts.length?"warn":"good"}">${plan.conflicts.length}</span></div><div class="body list">
          ${plan.conflicts.length?plan.conflicts.map(c=>`<div class="row"><div class="avatar">${initials(c.player.name)}</div><div><b>${playerButton(c.player)}</b><p>${esc(c.detail)}</p></div><span class="tag warn">${c.confidence}%</span></div>`).join(""):'<span class="tag good">No conflict</span>'}
        </div></article>
        <article class="card"><div class="head"><h3>Bench optimizer</h3><small>coverage first</small></div><div class="body">${table(["Player","Fit","Cover"],plan.bench.map(x=>[playerButton(x.player),x.fit,(x.covers??x.player.positions).join("/")]))}</div></article>
        <article class="card"><div class="head"><h3>Minute plan</h3></div><div class="body">${table(["Player","Target","Reason"],plan.minutePlan.filter(x=>x.targetMinutes<90).map(x=>[playerButton(x.player),x.targetMinutes+"'",x.reason]))}</div></article>
      </div>
    </div>
  `;
}

function renderSquad(){
  const s=state.snapshot, health=squadHealth(s);
  return `
    <div class="grid">
      <article class="card s5"><div class="head"><h2>Position health</h2><small>quality + depth + succession</small></div><div class="body position-grid">${health.map(positionBox).join("")}</div></article>
      <article class="card s7"><div class="head"><h2>Critical positions</h2><small>실제 대체 품질 기준</small></div><div class="body">
        ${health.sort((a,b)=>a.score-b.score).slice(0,5).map(h=>`<div style="display:grid;grid-template-columns:38px 1fr 34px;gap:8px;align-items:center;margin:9px 0"><b style="font-size:9px">${h.position}</b><div class="bar"><i style="width:${h.score}%"></i></div><span style="font-size:9px">${h.score}</span></div>`).join("")}
      </div></article>
      <article class="card s12"><div class="head"><h2>Squad list</h2><small>click player for full analysis</small></div><div class="body">
        ${table(["Player","Age","Pos","CA / PA","Agreed","Recent min","Condition","Contract"],s.players.map(p=>[
          playerButton(p),p.age,p.positions.join("/"),`${p.ca} / ${p.pa}`,p.playingTime.agreed,p.playingTime.recentMinutes,p.fitness.condition+"%",p.contract.monthsRemaining+"m"
        ]))}
      </div></article>
    </div>
  `;
}

function renderTactics(){
  const plan=selectMatchday(state.snapshot,state.snapshot.fixtures[0],"best");
  const chemistry=tacticalChemistry(state.snapshot,plan.lineup);
  return `
    <div class="grid">
      <article class="card s8">
        <div class="head"><div><h2>Formation & Roles</h2><small>변경 즉시 Role Fit과 XI 재계산</small></div>
          <select class="select" id="formationSelect">${Object.entries(formationPresets).map(([id,f])=>`<option value="${id}" ${state.snapshot.formation.id===id?"selected":""}>${f.name}</option>`).join("")}</select>
        </div>
        <div class="body"><div class="pitch">${plan.lineup.map(playerNode).join("")}</div></div>
      </article>
      <article class="card s4"><div class="head"><h3>Team balance</h3></div><div class="body">
        ${scoreLine("Overall",chemistry.overall)}${scoreLine("Width",chemistry.width)}${scoreLine("Central",chemistry.central)}${scoreLine("Defensive cover",chemistry.defensiveCover)}${scoreLine("Aerial",chemistry.aerial)}
        <div class="list" style="margin-top:12px">${chemistry.issues.length?chemistry.issues.map(x=>`<div class="row"><div class="avatar">!</div><div><b>Issue</b><p>${esc(x)}</p></div></div>`).join(""):'<span class="tag good">Balanced</span>'}</div>
      </div></article>
      <article class="card s12"><div class="head"><h3>Role editor</h3><small>IP / OOP separately</small></div><div class="body">
        ${table(["Slot","Position","In possession","Out of possession"],state.snapshot.formation.slots.map(slot=>[
          slot.id.toUpperCase(),slot.position,roleSelect(slot,"ipRole"),roleSelect(slot,"oopRole")
        ]))}
      </div></article>
    </div>
  `;
}

function renderTraining(){
  const rows=trainingRecommendations(state.snapshot);
  return `
    <div class="grid">
      <article class="card s4"><div class="head"><h2>Training actions</h2></div><div class="body metrics">
        ${metric("CHANGE",rows.filter(x=>x.changeNeeded).length,"danger")}${metric("KEEP",rows.filter(x=>!x.changeNeeded).length,"good")}${metric("U21",rows.filter(x=>x.player.age<=21).length,"warn")}${metric("NO FOCUS",rows.filter(x=>x.primary.action==="No additional focus").length,"")}
      </div></article>
      <article class="card s8"><div class="head"><h2>Recommended changes</h2><small>Role gap + age + CA/PA headroom</small></div><div class="body">
        ${table(["Player","Role","Recommendation","Evidence","Confidence"],rows.filter(x=>x.changeNeeded).slice(0,14).map(r=>[
          playerButton(r.player),r.role,tag(r.primary.action,"info"),r.primary.evidence.slice(2).join(" · "),r.primary.confidence+"%"
        ]))}
      </div></article>
      <article class="card s12"><div class="head"><h3>Principle</h3></div><div class="body" style="font-size:10px;color:var(--muted)">Role 핵심 능력만 밀지 않습니다. 기본 능력의 floor, 성장 여유, 나이, 부상 위험을 함께 보고 ‘No additional focus’도 정상적인 추천으로 취급합니다.</div></article>
    </div>
  `;
}

function renderDevelopment(){
  const rows=developmentRows(state.snapshot);
  const offers=rankedLoanOffers(state.snapshot,"p14");
  return `
    <div class="grid">
      <article class="card s4"><div class="head"><h2>Development status</h2></div><div class="body list">
        ${["FAST","STALLED","NEEDS_MINUTES","LOAN","PROMOTE"].map(code=>{
          const list=rows.filter(x=>x.status===code); if(!list.length)return "";
          return `<div class="row"><div class="avatar">${list.length}</div><div><b>${esc(list[0].statusLabel)}</b><p>${list.map(x=>x.player.name).join(", ")}</p></div></div>`;
        }).join("")}
      </div></article>
      <article class="card s8"><div class="head"><h2>Young player pipeline</h2><small>snapshot growth</small></div><div class="body">
        ${table(["Player","Age","CA/PA","Growth","Recent min","Status","Confidence"],rows.map(r=>[
          playerButton(r.player),r.player.age,`${r.player.ca}/${r.player.pa}`,`+${r.growth}`,r.minutes,tag(r.statusLabel,toneStatus(r.status)),r.confidence+"%"
        ]))}
      </div></article>
      <article class="card s12"><div class="head"><h3>Loan offer comparison · Luca Rossi</h3></div><div class="body">
        ${offers.length?table(["Club","League","Promised","Facilities","Role match","Score"],offers.map(o=>[o.club,o.leagueLevel,o.promisedMinutes,o.facilities+"/20",o.roleMatch,o.score])):"No offers"}
      </div></article>
    </div>
  `;
}

function renderMedical(){
  const imp=fixtureImportance(state.snapshot.fixtures[0]);
  const rows=state.snapshot.players.map(p=>({p,a:medicalAdvice(p,imp)})).sort((a,b)=>(b.a.payload?.load??0)-(a.a.payload?.load??0));
  return `
    <div class="grid">
      <article class="card s4"><div class="head"><h2>Match availability</h2></div><div class="body metrics">
        ${metric("REST",rows.filter(x=>x.a.action==="REST").length,"danger")}${metric("MANAGE",rows.filter(x=>x.a.action==="MANAGE MINUTES").length,"warn")}${metric("ROTATE",rows.filter(x=>x.a.action==="ROTATE").length,"warn")}${metric("START",rows.filter(x=>x.a.action==="START").length,"good")}
      </div></article>
      <article class="card s8"><div class="head"><h2>Workload board</h2><small>다음 경기 중요도 ${imp}</small></div><div class="body">
        ${table(["Player","Load","Condition","Fatigue","Recent min","Advice","Confidence"],rows.map(x=>[
          playerButton(x.p),x.a.payload.load,x.p.fitness.condition+"%",x.p.fitness.fatigue,x.p.playingTime.recentMinutes,tag(x.a.action,x.a.action==="REST"?"danger":x.a.action==="START"?"good":"warn"),x.a.confidence+"%"
        ]))}
      </div></article>
    </div>
  `;
}

function renderRecruitment(){
  const priorities=recruitmentPriorities(state.snapshot);
  const selected=state.recruitmentPosition;
  const candidates=candidatesForPosition(state.snapshot,selected);
  const upgrades=upgradeCandidates(state.snapshot,selected);
  const decision=buyVsDevelop(state.snapshot,selected);
  const shadow=candidates[0]?shadowSquadImpact(state.snapshot,selected,candidates[0].player):null;
  return `
    <div class="grid">
      <article class="card s4"><div class="head"><h2>Recruitment priorities</h2><small>why before who</small></div><div class="body list">
        ${priorities.slice(0,7).map(p=>`<button class="row" style="width:100%;color:inherit;text-align:left;cursor:pointer" data-position="${p.position}"><div class="avatar">${p.position}</div><div><b>${p.position}</b><p>Health ${p.health.score} · Backup ${p.health.backup?.fit??0}</p></div><span class="tag ${p.level==="NOW"?"danger":p.level==="NO NEED"?"good":"warn"}">${p.level}</span></button>`).join("")}
      </div></article>
      <article class="card s8"><div class="head"><div><h2>${selected} target board</h2><small>Role Fit + cost + future value</small></div><span class="tag info">${candidates.length} candidates</span></div><div class="body candidates">
        ${candidates.slice(0,6).map(c=>`<div class="candidate"><div class="avatar">${initials(c.player.name)}</div><div><b>${esc(c.player.name)}</b><br><small style="color:var(--muted)">Age ${c.player.age} · PA ${c.player.pa} · Confidence ${c.confidence}%</small></div><div class="fit">${c.fit}</div><div class="price">${money(c.player.value)}</div></div>`).join("")||"No candidates"}
      </div></article>
      <article class="card s4"><div class="head"><h3>Upgrade finder</h3><span class="tag good">+${4} Fit only</span></div><div class="body"><b style="font-size:18px">${upgrades.length}</b><p style="font-size:9px;color:var(--muted)">현재 주전보다 의미 있게 좋아지는 후보만 표시합니다.</p></div></article>
      <article class="card s4"><div class="head"><h3>Buy vs Develop</h3></div><div class="body"><span class="tag ${decision.decision==="BUY"?"warn":"good"}">${decision.decision}</span><p style="font-size:9px;color:var(--muted)">${esc(decision.reason)}</p></div></article>
      <article class="card s4"><div class="head"><h3>Shadow squad</h3></div><div class="body">${shadow?`<b style="font-size:18px;color:var(--good)">+${shadow.delta}</b><p style="font-size:9px;color:var(--muted)">${esc(candidates[0].player.name)} 영입 시 ${selected} Health ${shadow.before} → ${shadow.after}</p>`:"No candidate"}</div></article>
    </div>
  `;
}

function renderTransfers(){
  const rows=transferDecisions(state.snapshot);
  return `
    <div class="grid">
      <article class="card s4"><div class="head"><h2>Decisions</h2></div><div class="body metrics">
        ${metric("SELL",rows.filter(x=>x.decision==="SELL").length,"danger")}${metric("LOAN",rows.filter(x=>x.decision==="LOAN").length,"warn")}${metric("KEEP",rows.filter(x=>x.decision==="KEEP").length,"good")}${metric("REVIEW",rows.filter(x=>x.score>=55&&x.decision==="KEEP").length,"")}
      </div></article>
      <article class="card s8"><div class="head"><h2>Transfer advisor</h2></div><div class="body">
        ${table(["Player","Rank","Decision","Reason","Interest","Confidence"],rows.map(r=>[
          playerButton(r.player),`${r.rank.position} #${r.rank.rank}`,tag(r.decision,r.decision==="SELL"?"danger":r.decision==="LOAN"?"warn":"good"),r.reason,r.player.market.interest+"%",r.confidence+"%"
        ]))}
      </div></article>
    </div>
  `;
}

function renderContracts(){
  const rows=contractRisks(state.snapshot);
  return `
    <div class="grid">
      <article class="card s4"><div class="head"><h2>Contract risks</h2></div><div class="body metrics">
        ${metric("< 6M",rows.filter(x=>x.months<=6).length,"danger")}${metric("< 12M",rows.filter(x=>x.months<=12).length,"warn")}${metric("RENEW",rows.filter(x=>x.priority==="RENEW").length,"danger")}${metric("REVIEW",rows.filter(x=>x.priority==="REVIEW").length,"warn")}
      </div></article>
      <article class="card s8"><div class="head"><h2>Renewal priorities</h2></div><div class="body">
        ${table(["Player","Months","Agreed role","Wage","Risk","Priority"],rows.map(r=>[
          playerButton(r.player),r.months,r.player.playingTime.agreed,money(r.player.wage)+"/w",r.risk,tag(r.priority,r.priority==="RENEW"?"danger":"warn")
        ]))}
      </div></article>
    </div>
  `;
}

function renderEconomy(){
  const rows=marketHealth(state.snapshot);
  if(!rows.length){
    const finance=state.snapshot.clubFinance;
    return `
      <div class="grid">
        <article class="card s6"><div class="head"><h2>Managed club finance</h2><span class="tag info">REAL SAVE DATA</span></div><div class="body">
          ${finance? `
            <div class="metrics">
              ${metric("BALANCE",money(finance.balance),"")}
              ${metric("TRANSFER",money(finance.transferBudgetRemaining),"")}
              ${metric("WAGE / W",money(finance.wageBudgetWeekly),"")}
              ${metric("PAYROLL / W",money(finance.wagePayrollWeekly),"")}
            </div>`
            : '<span class="tag warn">Finance unavailable</span>'}
        </div></article>
        <article class="card s6"><div class="head"><h2>World economy mapping</h2><span class="tag warn">IN PROGRESS</span></div><div class="body">
          <p style="font-size:10px;color:var(--muted)">클럽 재정은 실제 세이브에서 읽었습니다. 리그 단위 Saudi / World Market Health는 club → competition 매핑이 검증된 뒤 활성화합니다. 데모 시장 수치는 실제 세이브에 섞지 않습니다.</p>
        </div></article>
      </div>
    `;
  }
  const preview=rebalancePreview(state.snapshot,"saudi",state.economyPreset);
  return `
    <div class="grid">
      <article class="card s5"><div class="head"><h2>World market health</h2><span class="tag danger">${rows.filter(x=>x.status==="OVERHEATED").length} anomaly</span></div><div class="body"><div class="econ">
        ${rows.map(x=>`<div class="econ-item ${x.status==="OVERHEATED"?"hot":""}"><div class="econ-bar" style="height:${x.financialPower}%"></div><small>${esc(x.name.replace(" League",""))}</small></div>`).join("")}
      </div></div></article>
      <article class="card s7"><div class="head"><h2>Saudi market imbalance</h2><span class="tag danger">${preview.league.status}</span></div><div class="body metrics">
        ${metric("FIN",preview.league.financialPower,"danger")}${metric("SPORT",preview.league.sportingPower,"")}${metric("GAP","+"+preview.league.gap,"danger")}${metric("CONF",preview.confidence+"%","warn")}
      </div></article>
      <article class="card s12"><div class="head"><h2>World Balance preview</h2><div class="controls">${["mild","balanced","strong"].map(x=>`<button class="control ${state.economyPreset===x?"active":""}" data-economy="${x}">${x}</button>`).join("")}</div></div><div class="body">
        ${table(["Scope","Transfer budget","Wage budget","Max wage","Balance","Player data"],[
          ["Saudi Big 4",pctChange(preview.changes.transferBudget),pctChange(preview.changes.wageBudget),pctChange(preview.changes.maxWage),pctChange(preview.changes.balance),tag("READ ONLY","good")],
          ["Other Saudi clubs","future","future","future","—",tag("READ ONLY","good")]
        ])}
        <div style="display:flex;justify-content:flex-end;gap:7px;margin-top:12px"><button class="btn" data-action="snapshot">Save rollback snapshot</button><button class="btn primary" data-action="previewWrite">Preview exact changes</button></div>
      </div></article>
    </div>
  `;
}

function renderReports(){
  const accuracy=recommendationAccuracy(state.snapshot);
  const journal=decisionJournal(state.snapshot);
  return `
    <div class="grid">
      <article class="card s4"><div class="head"><h2>Coach performance</h2></div><div class="body"><div class="metric good"><b>${accuracy.accuracy}%</b><small>Recommendation outcomes</small></div></div></article>
      <article class="card s8"><div class="head"><h2>Confidence calibration</h2><small>Confidence가 실제로 의미 있는지 검증</small></div><div class="body">
        ${table(["Band","Correct","Total","Accuracy"],accuracy.groups.map(x=>[x.label,x.correct,x.total,x.accuracy+"%"]))}
      </div></article>
      <article class="card s12"><div class="head"><h2>Decision journal</h2><small>감독의 과거 판단을 사후 검토</small></div><div class="body">
        ${table(["Date","Subject","Decision","Reason","Expected","Actual","Status"],journal.map(x=>[x.date,x.subject,x.decision,x.reason,x.expected,x.actual,tag(x.status,x.status==="REVIEW"?"warn":"good")]))}
      </div></article>
    </div>
  `;
}

function renderCoach(){
  return `
    <div class="chat">
      <article class="card"><div class="head"><h2>AI Coach</h2><span class="tag good">Context aware</span></div><div class="body messages" id="messages">
        ${state.coachMessages.map(m=>`<div class="bubble ${m.role}">${esc(m.text)}${m.confidence?`<div style="margin-top:5px;font-size:7px;color:var(--muted)">Coach Confidence ${m.confidence}%</div>`:""}</div>`).join("")}
        <form class="composer" id="coachForm"><input id="coachInput" placeholder="예: 다음 3경기 로테이션 짜줘" autocomplete="off"/><button class="btn primary">Send</button></form>
      </div></article>
      <aside class="card"><div class="head"><h3>Active context</h3></div><div class="body">
        ${context("Next match",`${state.snapshot.fixtures[0].opponent} · 중요도 ${fixtureImportance(state.snapshot.fixtures[0])}`)}
        ${context("Squad alert",recruitmentPriorities(state.snapshot)[0].position+" depth")}
        ${context("Data source",state.source==="bridge"?"macOS Bridge":"Demo snapshot")}
        ${context("Confidence policy","90+ high · 70–89 review · <70 observe")}
      </div></aside>
    </div>
  `;
}

function renderSettings(){
  const p=state.snapshot.manager.philosophy;
  return `
    <div class="grid">
      <article class="card s6"><div class="head"><h2>Manager philosophy</h2><small>추천 가중치에 사용</small></div><div class="body">
        ${slider("Youth development","youthDevelopment",p.youthDevelopment)}
        ${slider("Winning now","winningNow",p.winningNow)}
        ${slider("Squad stability","squadStability",p.squadStability)}
        ${slider("Financial efficiency","financialEfficiency",p.financialEfficiency)}
        ${slider("Rotation","rotation",p.rotation)}
      </div></article>
      <article class="card s6"><div class="head"><h2>macOS Bridge</h2><span class="tag ${state.source==="bridge"?"good":"warn"}">${state.source==="bridge"?"CONNECTED":"DEMO"}</span></div><div class="body">
        <label style="display:block;font-size:9px;color:var(--muted);margin-bottom:5px">Local endpoint</label>
        <input id="bridgeInput" value="${esc(state.bridge)}" style="width:100%;border:1px solid var(--line);background:#0c1521;color:var(--text);border-radius:10px;padding:9px"/>
        <div style="display:flex;gap:7px;margin-top:10px"><button class="btn primary" data-action="saveBridge">Save & reload</button><button class="btn" data-action="refresh">Test connection</button></div>
        <p style="font-size:9px;color:var(--muted)">실제 배포에서는 FM26 BepInEx macOS Bridge가 이 endpoint에 snapshot을 제공합니다. 연결 실패 시 데모 데이터로 안전하게 fallback합니다.</p>
      </div></article>
    </div>
  `;
}

function openPlayer(id){
  const p=state.snapshot.players.find(x=>x.id===id)??state.snapshot.externalCandidates.find(x=>x.id===id);
  if(!p)return;
  const training=recommendTraining(p,bestRole(state.snapshot,p),null);
  const roleRows=state.snapshot.formation.slots.map(slot=>({role:slot.ipRole,position:slot.position,fit:roleFit(p,slot)})).sort((a,b)=>b.fit-a.fit).slice(0,5);
  const hidden=p.hidden??{};
  const stats=Object.entries(p.attributes).sort((a,b)=>b[1]-a[1]);
  const modal=document.getElementById("modal");
  modal.className="modal-host open";
  modal.innerHTML=`
    <div class="modal-card">
      <div class="modal-top"><div><b>${esc(p.name)}</b><div style="font-size:9px;color:var(--muted)">${p.age} · ${p.positions.join("/")} · CA ${p.ca} / PA ${p.pa}</div></div><button class="modal-close" data-close>×</button></div>
      <div class="modal-content grid">
        <div class="s4 card"><div class="head"><h3>Summary</h3></div><div class="body metrics">${metric("CA",p.ca,"")}${metric("PA",p.pa,"good")}${metric("HEADROOM","+"+(p.pa-p.ca),"warn")}${metric("VALUE",money(p.value),"")}</div></div>
        <div class="s4 card"><div class="head"><h3>Hidden</h3></div><div class="body">${table(["Attribute","Value"],Object.entries(hidden).map(([k,v])=>[label(k),v]))}</div></div>
        <div class="s4 card"><div class="head"><h3>Best tactical fits</h3></div><div class="body">${table(["Pos","Role","Fit"],roleRows.map(x=>[x.position,x.role,x.fit]))}</div></div>
        <div class="s6 card"><div class="head"><h3>Training recommendation</h3><span class="tag info">${training.primary.confidence}%</span></div><div class="body"><b>${esc(training.primary.action)}</b><p style="font-size:9px;color:var(--muted)">${training.primary.evidence.join(" · ")}</p></div></div>
        <div class="s6 card"><div class="head"><h3>Availability</h3></div><div class="body">${table(["Metric","Value"],[
          ["Recent minutes",p.playingTime?.recentMinutes??0],["Condition",(p.fitness?.condition??100)+"%"],["Fatigue",p.fitness?.fatigue??0],["Playing time",p.playingTime?.agreed??"-"],["Contract",p.contract?.monthsRemaining+" months"]
        ])}</div></div>
        <div class="s12 card"><div class="head"><h3>Attributes</h3><small>quick visual scan</small></div><div class="body stat-grid">${stats.map(([k,v])=>`<div class="stat"><span>${label(k)}</span><strong class="${v>=15?"good":v<=10?"bad":"warn"}">${v}</strong></div>`).join("")}</div></div>
      </div>
    </div>`;
  modal.querySelector("[data-close]").addEventListener("click",closeModal);
  modal.addEventListener("click",e=>{if(e.target===modal)closeModal();},{once:true});
}

function bindGlobal(){
  document.querySelectorAll("[data-nav]").forEach(el=>el.addEventListener("click",()=>navigate(el.dataset.nav)));
  document.getElementById("menuBtn")?.addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
}

function bindContent(){
  document.querySelectorAll("[data-nav]").forEach(el=>el.addEventListener("click",()=>navigate(el.dataset.nav)));
  document.querySelectorAll("[data-player]").forEach(el=>el.addEventListener("click",()=>openPlayer(el.dataset.player)));
  document.querySelectorAll("[data-mode]").forEach(el=>el.addEventListener("click",()=>{state.matchMode=el.dataset.mode;render();}));
  document.querySelectorAll("[data-position]").forEach(el=>el.addEventListener("click",()=>{state.recruitmentPosition=el.dataset.position;render();}));
  document.querySelectorAll("[data-economy]").forEach(el=>el.addEventListener("click",()=>{state.economyPreset=el.dataset.economy;render();}));
  document.querySelectorAll("[data-role-slot]").forEach(el=>el.addEventListener("change",()=>{
    const slot=state.snapshot.formation.slots.find(x=>x.id===el.dataset.roleSlot);
    if(slot){slot[el.dataset.phase]=el.value;render();}
  }));
  document.getElementById("formationSelect")?.addEventListener("change",e=>{state.snapshot=applyFormation(state.snapshot,e.target.value);render();});
  document.querySelectorAll("[data-philosophy]").forEach(el=>el.addEventListener("input",()=>{
    state.snapshot.manager.philosophy[el.dataset.philosophy]=Number(el.value);
    const out=document.querySelector(`[data-output="${el.dataset.philosophy}"]`);if(out)out.textContent=el.value;
  }));
  document.querySelectorAll("[data-action]").forEach(el=>el.addEventListener("click",()=>handleAction(el.dataset.action)));
  const form=document.getElementById("coachForm");
  form?.addEventListener("submit",e=>{
    e.preventDefault();
    const input=document.getElementById("coachInput"); const q=input.value.trim(); if(!q)return;
    state.coachMessages.push({role:"user",text:q});
    const answer=askCoach(state.snapshot,q);
    state.coachMessages.push({role:"coach",text:answer.text,confidence:answer.confidence});
    render();
    requestAnimationFrame(()=>document.getElementById("messages")?.scrollTo(0,99999));
  });
}

async function handleAction(action){
  if(action==="refresh"){toast("데이터를 다시 읽습니다…");location.reload();return;}
  if(action==="saveBridge"){
    const value=document.getElementById("bridgeInput")?.value.trim();
    if(value){localStorage.setItem("managerRoom.bridge",value);toast("Bridge endpoint 저장됨");setTimeout(()=>location.reload(),500);}
    return;
  }
  if(action==="snapshot"){toast("Prototype: rollback snapshot 요청을 큐에 추가했습니다.");return;}
  if(action==="previewWrite"){toast("Safe Writer가 연결되기 전까지 Preview only입니다.");return;}
}

function navigate(view){state.view=view;document.getElementById("sidebar").classList.remove("open");renderChrome();render();window.scrollTo({top:0,behavior:"smooth"});}
function closeModal(){const m=document.getElementById("modal");m.className="";m.innerHTML="";}

function actionRow(a){return `<div class="row"><div class="avatar">${iconFor(a.type)}</div><div><b>${esc(a.title)}</b><p>${esc(a.detail)}</p></div><div class="confidence"><b>${a.confidence}%</b><small>Confidence</small></div></div>`;}
function positionBox(h){return `<div class="position ${h.status==="CRITICAL"?"critical":h.status==="ATTENTION"?"attention":""}"><b>${h.position}</b><small>${h.status} · ${h.score}</small></div>`;}
function fixtureCard(f){const i=fixtureImportance(f);const mode=i>=85?"BEST XI":i<=50?"DEVELOPMENT":"BALANCED";return `<div class="fixture"><small>${fmtDate(f.date)} · ${f.home?"HOME":"AWAY"}</small><b>${esc(f.opponent)}</b><em>${mode} · ${i}</em></div>`;}
function playerNode(x){return `<button class="player-node" data-player="${x.player.id}" style="left:${x.slot.x}%;top:${x.slot.y}%"><b>${esc(x.player.name)}</b><small>${esc(x.slot.ipRole)}</small><span class="score">${x.fit}</span></button>`;}
function playerButton(p){return `<button class="link" data-player="${p.id}">${esc(p.name)}</button>`;}
function roleSelect(slot,phase){const roles=roleOptionsByPosition[slot.position]??[slot[phase]];return `<select class="select" data-role-slot="${slot.id}" data-phase="${phase}">${roles.map(r=>`<option ${slot[phase]===r?"selected":""}>${r}</option>`).join("")}</select>`;}
function slider(labelText,key,value){return `<div class="slider-row"><label>${labelText}</label><input type="range" min="0" max="100" value="${value}" data-philosophy="${key}"/><output data-output="${key}">${value}</output></div>`;}
function context(title,text){return `<div class="context"><b>${esc(title)}</b><small>${esc(text)}</small></div>`;}
function metric(labelText,value,tone){return `<div class="metric ${tone}"><b>${value}</b><small>${labelText}</small></div>`;}
function tag(text,tone="info"){return `<span class="tag ${tone}">${esc(String(text))}</span>`;}
function scoreLine(name,value){return `<div style="display:grid;grid-template-columns:100px 1fr 30px;gap:8px;align-items:center;margin:9px 0"><span style="font-size:9px">${name}</span><div class="bar"><i style="width:${value}%"></i></div><b style="font-size:9px">${value}</b></div>`;}
function table(headers,rows){return `<div style="overflow:auto"><table class="table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c??"—"}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${headers.length}">No data</td></tr>`}</tbody></table></div>`;}
function toneStatus(status){return ({FAST:"good",PROMOTE:"good",LOAN:"info",NEEDS_MINUTES:"warn",STALLED:"danger"})[status]??"info";}
function iconFor(type){return ({medical:"✚",minutes:"⌛",training:"↗",development:"◎",recruitment:"⌕",economy:"◫"})[type]??"!";}
function money(v){if(v==null)return"—";if(v>=1e9)return"€"+(v/1e9).toFixed(1)+"B";if(v>=1e6)return"€"+(v/1e6).toFixed(v>=1e8?0:1)+"M";if(v>=1e3)return"€"+Math.round(v/1e3)+"K";return"€"+v;}
function pctChange(v){return (v>0?"+":"")+v+"%";}
function fmtDate(d){return new Intl.DateTimeFormat("ko-KR",{month:"short",day:"numeric"}).format(new Date(d+"T00:00:00Z"));}
function daysUntil(d){const now=new Date(state.snapshot.meta.gameDate+"T00:00:00Z");const target=new Date(d+"T00:00:00Z");return Math.max(0,Math.round((target-now)/86400000));}
function initials(name){return name.split(/\s+/).map(x=>x[0]).join("").slice(0,3).toUpperCase();}
function label(key){return key.replace(/([A-Z])/g," $1").replace(/^./,x=>x.toUpperCase());}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function toast(text){const el=document.getElementById("toast");el.textContent=text;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1800);}
