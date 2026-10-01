export const roleDefinitions = {
  "Goalkeeper": weights({ reflexes:3, handling:3, aerialReach:2, oneOnOnes:2, decisions:1, composure:1 }),
  "Sweeper Keeper": weights({ reflexes:2, handling:2, oneOnOnes:2, kicking:2, passing:2, firstTouch:1, decisions:2, composure:1 }),
  "Central Defender": weights({ marking:3, tackling:3, positioning:3, anticipation:2, decisions:2, strength:2, jumpingReach:2, pace:1 }),
  "Ball Playing Defender": weights({ marking:2, tackling:2, positioning:2, anticipation:2, decisions:2, strength:1, jumpingReach:1, passing:3, technique:2, composure:2 }),
  "Full Back": weights({ tackling:2, marking:2, positioning:2, decisions:1.5, stamina:2, workRate:2, pace:2, acceleration:2, crossing:1 }),
  "Wing Back": weights({ crossing:3, dribbling:2, stamina:3, workRate:3, pace:2.5, acceleration:2.5, technique:1.5, passing:1, positioning:1 }),
  "Holding Midfielder": weights({ positioning:3, tackling:2.5, marking:2, decisions:3, anticipation:2.5, passing:1.5, composure:2, teamwork:2, strength:1 }),
  "Deep Lying Playmaker": weights({ passing:3, vision:3, firstTouch:2, technique:2, decisions:3, composure:2, positioning:2, anticipation:1.5 }),
  "Central Midfielder": weights({ passing:2, firstTouch:2, technique:1.5, decisions:2.5, vision:1.5, stamina:2, workRate:2, positioning:1.5, offTheBall:1.5 }),
  "Advanced Playmaker": weights({ passing:3, vision:3, firstTouch:2.5, technique:2.5, decisions:2, composure:2, dribbling:1.5, offTheBall:1 }),
  "Winger": weights({ crossing:3, dribbling:3, pace:3, acceleration:3, technique:2, firstTouch:1.5, offTheBall:2, decisions:1 }),
  "Inside Forward": weights({ dribbling:3, finishing:2.5, offTheBall:3, pace:2.5, acceleration:2.5, technique:2, firstTouch:1.5, composure:2, decisions:1.5 }),
  "Advanced Forward": weights({ finishing:3, offTheBall:3, pace:2.5, acceleration:2.5, composure:2.5, anticipation:2, firstTouch:1.5, technique:1.5 }),
  "Pressing Forward": weights({ workRate:3, stamina:2.5, pace:2, acceleration:2, offTheBall:2, anticipation:2, teamwork:2, finishing:1.5, strength:1.5 })
};

export const positionCompatibility = {
  GK:["GK"], CB:["CB","DM"], LB:["LB","LWB","CB"], RB:["RB","RWB","CB"],
  DM:["DM","CM","CB"], CM:["CM","DM","AM"], AM:["AM","CM","LW","RW"],
  LW:["LW","RW","AM","ST"], RW:["RW","LW","AM","ST"], ST:["ST","LW","RW","AM"]
};

export function roleFit(player, slot) {
  const ip = roleScore(player, slot.ipRole);
  const oop = roleScore(player, slot.oopRole);
  const familiarity = positionFamiliarity(player, slot.position);
  return clamp(Math.round((ip * 0.58 + oop * 0.42) * familiarity), 0, 100);
}

export function roleScore(player, role) {
  const def = roleDefinitions[role];
  if (!def) return 50;
  let weighted = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(def)) {
    weighted += (player.attributes?.[key] ?? 1) * weight;
    total += 20 * weight;
  }
  return total ? (weighted / total) * 100 : 50;
}

export function positionFamiliarity(player, position) {
  if (player.positions?.includes(position)) return 1;
  const compatible = positionCompatibility[position] ?? [];
  if (player.positions?.some(p => compatible.includes(p))) return 0.86;
  return 0.58;
}

export function roleGaps(player, role, target=15) {
  const def = roleDefinitions[role] ?? {};
  return Object.entries(def)
    .map(([attribute, weight]) => ({
      attribute,
      value: player.attributes?.[attribute] ?? 1,
      weight,
      gap: Math.max(0, target - (player.attributes?.[attribute] ?? 1))
    }))
    .filter(x => x.gap > 0)
    .sort((a,b) => (b.gap*b.weight) - (a.gap*a.weight));
}

function weights(value) { return value; }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
