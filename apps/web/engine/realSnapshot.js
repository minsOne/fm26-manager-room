/** Read-only normalization. A stored placeholder is never promoted to a fact. */
const SOURCES = new Set(["rust-native", "rust-save-parser", "fmsave"]);
const POSITIONS = new Set(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "LW", "RW", "ST"]);
const PERSONALITY = new Set(["adaptability", "ambition", "loyalty", "pressure", "professionalism", "sportsmanship", "temperament", "controversy"]);
const obj = v => v !== null && typeof v === "object" && !Array.isArray(v);
export const number = (v, min = -Infinity, max = Infinity) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
const integer = (v, min, max) => Number.isInteger(v) ? number(v, min, max) : null;
export const text = v => typeof v === "string" && v.trim() ? v.trim() : null;
export function validDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export function knownNumber(o, key, min, max, explicit = false) {
  if (!obj(o) || o[`${key}Known`] === false || (explicit && o[`${key}Known`] !== true)) return null;
  return number(o[key], min, max);
}
function array(root, key) {
  if (root[key] === undefined || root[key] === null) return [];
  if (!Array.isArray(root[key])) throw new Error(`${key}: 배열 형식이 아닙니다.`);
  return root[key];
}
function id(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  return text(v);
}
function normalizePlayers(rows, gameDate) {
  if (rows.length > 250000) throw new Error("선수 수가 허용 범위를 초과했습니다.");
  const ids = new Set();
  return rows.map(p => {
    if (!obj(p)) throw new Error("선수 레코드 형식이 잘못되었습니다.");
    const uid = id(p.id);
    if (!uid || ids.has(uid)) throw new Error("선수 ID가 없거나 중복됩니다.");
    ids.add(uid);
    const ca = knownNumber(p, "ca", 0, 200);
    if (p.ca != null && (ca === null || !Number.isInteger(ca))) throw new Error("CA 범위가 잘못되었습니다.");
    const pa = p.paKnown === true ? integer(p.pa, 0, 200) : null;
    if (p.paKnown === true && pa === null) throw new Error("확인된 PA 범위가 잘못되었습니다.");
    const fitness = obj(p.fitness) ? p.fitness : {};
    const pt = obj(p.playingTime) ? p.playingTime : {};
    const contract = obj(p.contract) ? p.contract : {};
    const market = obj(p.market) ? p.market : {};
    const end = contract.endKnown !== false && validDate(contract.end) ? contract.end : null;
    const minutes = pt.recentMinutesKnown === true ? number(pt.recentMinutes, 0, 20160) : null;
    const appearances = pt.minutesLast5Known !== false && (pt.minutesLast5Known === true || pt.recentMinutesKnown === true)
      ? number(pt.minutesLast5, 0, 1000) : null;
    const history = array(p, "snapshots").filter(h => obj(h) && validDate(h.date)
      && h.date <= gameDate && integer(h.ca, 0, 200) !== null)
      .map(h => ({ date: h.date, ca: h.ca, lineage: text(h.lineage ?? h.saveId) }));
    const cleanStats = stats => Object.fromEntries(Object.entries(obj(stats) ? stats : {})
      .filter(([key, v]) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(key) && integer(v, 1, 20) !== null));
    const hidden = cleanStats(p.hiddenKnown === false ? {} : p.hidden);
    if (p.personalityKnown === false) for (const key of PERSONALITY) delete hidden[key];
    const wageFlags = [p.wageKnown, contract.wageKnown, contract.weeklyWageKnown];
    const wageKnown = !wageFlags.includes(false) && wageFlags.includes(true);
    const positionsKnown = p.positionsKnown !== false;
    const attributesKnown = p.attributesKnown !== false;
    const primaryPosition = positionsKnown && POSITIONS.has(p.primaryPosition)
      ? p.primaryPosition
      : null;
    return {
      id: uid, name: text(p.name) ?? `선수 ${uid}`, age: p.ageKnown === false ? null : integer(p.age, 14, 100), ca, pa,
      primaryPosition, positionsKnown, attributesKnown,
      birthDate: p.ageKnown !== false && p.birthDateKnown !== false && validDate(p.birthDate) ? p.birthDate : null,
      paRangeCode: p.paKnown !== true ? integer(p.paRangeCode, -10, -1) : null,
      positions: positionsKnown ? array(p, "positions").filter(v => POSITIONS.has(v)) : [],
      positionRatings: positionsKnown ? cleanStats(p.positionRatings) : {},
      leftFoot: knownNumber(p, "leftFoot", 1, 20), rightFoot: knownNumber(p, "rightFoot", 1, 20),
      attributes: cleanStats(attributesKnown ? p.attributes : {}), hidden, history,
      condition: knownNumber(fitness, "condition", 0, 100),
      sharpness: knownNumber(fitness, "matchSharpness", 0, 100),
      fatigue: knownNumber(fitness, "fatigue", 0, 100, true),
      injuryRisk: knownNumber(fitness, "injuryRisk", 0, 20, true),
      minutes, appearances,
      historyComplete: pt.historyComplete === true && pt.recentMinutesKnown === true,
      minutesLast5Team: pt.minutesLast5TeamKnown === true ? number(pt.minutesLast5Team, 0, 1000) : null,
      agreed: pt.agreedKnown === false || contract.squadStatusKnown === false ? null : text(pt.agreed ?? contract.squadStatus),
      contractEnd: end,
      monthsRemaining: end ? knownNumber(contract, "monthsRemaining", 0, 1200) : null,
      // Amount availability and currency/period verification are separate. Explicit false wins.
      wage: wageKnown ? number(contract.weeklyWage ?? p.wage, 0) : null,
      rawWage: number(contract.weeklyWage ?? p.wage, 0),
      value: p.valueKnown === true ? number(p.value, 0) : null,
      interest: knownNumber(market, "interest", 0, 100, true),
      availability: {
        injuryFree: fitness.injuryFreeKnown === true && typeof fitness.injuryFree === "boolean" ? fitness.injuryFree : null,
        eligible: p.eligibilityKnown === true && typeof p.eligible === "boolean" ? p.eligible : null
      }
    };
  });
}
export function normalizeRealSnapshot(input) {
  if (!obj(input)) throw new Error("스냅샷 최상위 형식이 잘못되었습니다.");
  const flat = input.source === "rust-native";
  const meta = flat ? input : input.meta;
  if (!obj(meta) || !SOURCES.has(meta.source)) throw new Error("실제 세이브 출처가 아닙니다. 데모는 별도로 열어주세요.");
  if (flat && ![1, 2].includes(input.schemaVersion)) throw new Error("지원하지 않는 스냅샷 버전입니다.");
  if (!validDate(meta.gameDate)) throw new Error("게임 날짜가 유효하지 않습니다.");
  if (!obj(input.manager) || !Array.isArray(input.players)) throw new Error("관리팀 또는 선수 목록이 없습니다.");
  const clubUid = id(input.manager.clubUid);
  if (!clubUid) throw new Error("관리팀 UID를 확인할 수 없습니다.");
  const name = text(meta.saveName);
  const saveId = text(meta.saveId ?? input.saveId);
  if (!saveId && !name) throw new Error("세이브 식별 정보가 없습니다.");
  const manager = { club: text(input.manager.club) ?? "구단 이름 미확인", clubUid, name: text(input.manager.name) };
  const careerKey = JSON.stringify([saveId ?? name, clubUid, manager.name]);
  const fixtureIds = new Set();
  const fixtures = array(input, "fixtures").map((f, i) => {
    if (!obj(f) || !validDate(f.date)) throw new Error("일정 날짜가 유효하지 않습니다.");
    const uid = id(f.id) ?? `fixture-${i}`;
    if (fixtureIds.has(uid)) throw new Error("일정 ID가 중복됩니다.");
    fixtureIds.add(uid);
    return {
      id: uid, date: f.date, opponent: text(f.opponent) ?? "상대 미확인",
      home: f.homeKnown === false ? null : typeof f.home === "boolean" ? f.home : null,
      competition: f.competitionKnown === true ? text(f.competition) : null,
      importance: f.importanceKnown === true ? number(f.importance, 0, 100) : null
    };
  }).sort((a,b) => a.date.localeCompare(b.date));
  const captured = text(meta.capturedAt);
  return {
    careerKey, saveId, source: meta.source, saveName: name ?? saveId, gameDate: meta.gameDate,
    capturedAt: captured && Number.isFinite(Date.parse(captured)) ? captured : null,
    build: text(meta.build), dbVersion: text(meta.dbVersion),
    buildVerified: meta.knownBuild === true,
    coverage: obj(meta.coverage) ? meta.coverage : {}, manager,
    players: normalizePlayers(input.players, meta.gameDate), fixtures,
    candidates: normalizePlayers(array(input, "externalCandidates"), meta.gameDate),
    candidateCoverage: text(meta.coverage?.externalCandidates) ?? "수록 범위 미확인",
    clubFinance: obj(input.clubFinance) ? Object.fromEntries([
      "balance", "transferBudgetAllocated", "transferBudgetRemaining", "wageBudgetWeekly", "wagePayrollWeekly", "financeRows"
    ].map(key => [key, number(input.clubFinance[key])])) : null,
    currency: meta.currencyKnown === true ? text(meta.currency) : null,
    leagues: array(input, "leagues"), loanOffers: array(input, "loanOffers"),
    outcomes: array(input, "recommendationsHistory"),
    formation: obj(input.formation) ? input.formation : null
  };
}

/** Observations are not calibrated success probabilities or automatic game instructions. */
export function medicalReview(player, snapshot, stale = false) {
  const missing = [];
  for (const [key, label] of [["condition","컨디션"],["fatigue","피로"],["injuryRisk","부상 위험"],["minutes","출전 기록"]]) {
    if (player[key] === null) missing.push(label);
  }
  if (!player.historyComplete) missing.push("출전 기록 완전성");
  if (player.availability.injuryFree === null) missing.push("현재 부상 여부");
  if (player.availability.eligible === null) missing.push("출전 자격·징계·등록");
  const evidence = [player.condition !== null ? `컨디션 ${player.condition}` : null,
    player.minutes !== null ? `수록된 최근 14일 ${player.minutes}분${player.historyComplete ? "" : " (하한)"}` : null].filter(Boolean);
  if (stale) missing.push("최신 스냅샷");
  if (!snapshot.buildVerified) missing.push("빌드 지원 확인");
  const blocked = player.availability.injuryFree === false || player.availability.eligible === false;
  return { action: blocked ? "출전 불가 정보 확인" : missing.length ? "판단 보류" : "감독 최종 확인",
    evidence, missing, observedFields: 4 - [player.condition, player.fatigue, player.injuryRisk, player.minutes].filter(v=>v===null).length,
    denominator: 4, probability: null };
}
export function playingTimeReview(player) {
  if (player.minutesLast5Team === null || !player.agreed || player.agreed === "Unknown") {
    return { action: "불만 위험 판단 보류", risk: null, reason: "팀의 최근 5경기 분량과 출전 약속이 모두 필요합니다." };
  }
  return { action: "출전 약속 대조 필요", risk: null, reason: `팀 최근 5경기 ${player.minutesLast5Team}분 / ${player.agreed}. 실제 불만 상태는 미확인입니다.` };
}
export function growthReview(player, snapshot) {
  const lineage = snapshot.lineageId ?? snapshot.saveId;
  const rows = player.history.filter(h => lineage && h.lineage === lineage);
  const dated = [...new Map(rows.map(h => [h.date,h])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  if (dated.length < 2) return { delta: null, message: "동일 세이브의 비교 가능한 성장 기록이 부족합니다." };
  const first = dated[0], last = dated.at(-1);
  return { delta: last.ca - first.ca, message: `${first.date} → ${last.date}; 관측 변화이며 성장 예측이 아닙니다.` };
}
