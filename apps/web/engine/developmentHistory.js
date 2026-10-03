import { validDate } from "./realSnapshot.js";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function applyDevelopmentHistory(snapshot, input, selectionId) {
  if (!selectionId || !object(input) || input.schemaVersion !== 1
      || input.selectionId !== selectionId || !Array.isArray(input.points)) {
    return snapshot;
  }

  const byPlayer = new Map((snapshot.players ?? []).map(player=>[player.id, []]));
  const points = input.points
    .filter(point=>object(point) && validDate(point.gameDate)
      && point.gameDate <= snapshot.gameDate && Array.isArray(point.players))
    .slice(-400);

  for (const point of points) {
    const seen = new Set();
    for (const row of point.players) {
      if (!object(row)) continue;
      const id = typeof row.id === "string" ? row.id : String(row.id ?? "");
      if (!byPlayer.has(id) || seen.has(id)) continue;
      seen.add(id);

      const ca = Number.isInteger(row.ca) && row.ca >= 0 && row.ca <= 200 ? row.ca : null;
      if (ca === null) continue;

      const pa = Number.isInteger(row.pa) && row.pa >= 0 && row.pa <= 200 ? row.pa : null;
      const value = Number.isInteger(row.value) && row.value >= 0 ? row.value : null;
      const attributes = Object.fromEntries(Object.entries(object(row.attributes) ? row.attributes : {})
        .filter(([key,v])=>/^[A-Za-z][A-Za-z0-9]*$/.test(key)
          && Number.isInteger(v) && v >= 1 && v <= 20));

      byPlayer.get(id).push({
        date:point.gameDate,
        ca,
        pa,
        value,
        attributes,
        lineage:selectionId
      });
    }
  }

  snapshot.selectionId = selectionId;
  snapshot.lineageId = selectionId;
  for (const player of snapshot.players ?? []) {
    const rows = byPlayer.get(player.id) ?? [];
    if (rows.length) {
      const unique = new Map(rows.map(row=>[row.date,row]));
      player.history = [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
    }
  }
  return snapshot;
}

export function historySummary(player, snapshot) {
  const lineage = snapshot.lineageId ?? snapshot.saveId;
  const rows = (player.history ?? [])
    .filter(row=>lineage && row.lineage === lineage && validDate(row.date))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if (rows.length < 2) return {points:rows.length, caDelta:null, attributeChanges:[]};

  const first=rows[0], last=rows.at(-1);
  const keys = new Set([...Object.keys(first.attributes ?? {}),...Object.keys(last.attributes ?? {})]);
  const attributeChanges=[...keys].map(name=>{
    const before=first.attributes?.[name], after=last.attributes?.[name];
    if (!Number.isInteger(before) || !Number.isInteger(after) || before === after) return null;
    return {name,before,after,delta:after-before};
  }).filter(Boolean).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||a.name.localeCompare(b.name));

  return {points:rows.length,caDelta:last.ca-first.ca,attributeChanges,first,last};
}
