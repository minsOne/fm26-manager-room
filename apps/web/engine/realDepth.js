import { verifiedRoleFit } from "./realRoleFit.js";

const ROLE_OPTIONS = {
  GK:["Goalkeeper","Sweeper Keeper"],
  CB:["Central Defender","Ball Playing Defender"],
  LB:["Full Back","Wing Back"],
  RB:["Full Back","Wing Back"],
  DM:["Holding Midfielder","Deep Lying Playmaker","Central Midfielder"],
  CM:["Central Midfielder","Deep Lying Playmaker","Advanced Playmaker"],
  AM:["Advanced Playmaker","Central Midfielder","Inside Forward"],
  LW:["Winger","Inside Forward","Advanced Playmaker"],
  RW:["Winger","Inside Forward","Advanced Playmaker"],
  ST:["Advanced Forward","Pressing Forward"]
};

export const depthPositions = ["GK","RB","CB","LB","DM","CM","AM","RW","LW","ST"];

export function verifiedDepth(snapshot, position) {
  const roles = ROLE_OPTIONS[position] ?? [];
  const rows = [];

  for (const player of snapshot.players ?? []) {
    let best = null;
    for (const role of roles) {
      const fit = verifiedRoleFit(player, position, role);
      if (fit.score === null) continue;
      if (!best || fit.score > best.score) best = {role,...fit};
    }
    if (best) rows.push({player,...best});
  }

  rows.sort((a,b)=>b.score-a.score || (b.player.ca ?? -1)-(a.player.ca ?? -1));
  const starter = rows[0] ?? null;
  const backup = rows[1] ?? null;
  const knownPlayers = rows.length;

  let state = "자료 부족";
  let detail = "비교 가능한 선수가 2명 미만입니다.";
  if (starter && backup) {
    if (backup.score < 65) {
      state = "백업 적합도 낮음";
      detail = "두 번째 후보의 휴리스틱 Role Fit이 65 미만입니다.";
    } else if (backup.score < 75) {
      state = "백업 검토";
      detail = "두 번째 후보의 휴리스틱 Role Fit이 65~74입니다.";
    } else {
      state = "2명 이상 확인";
      detail = "확인된 입력으로 주전·백업 후보를 비교할 수 있습니다.";
    }
  }

  return {
    position,
    starter,
    backup,
    knownPlayers,
    state,
    detail,
    official:false,
    methodology:"manager-room-depth-v1"
  };
}

export function verifiedSquadDepth(snapshot) {
  return depthPositions.map(position=>verifiedDepth(snapshot,position));
}
