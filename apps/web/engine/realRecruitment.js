import { verifiedSquadDepth } from "./realDepth.js";

export function recruitmentReview(snapshot) {
  return verifiedSquadDepth(snapshot).map(row=>{
    if (row.knownPlayers < 2 || !row.starter || !row.backup) {
      return {
        position:row.position,
        status:"자료 부족",
        action:"추가 데이터 확인",
        priority:null,
        reason:"비교 가능한 주전·백업 후보가 2명 미만입니다.",
        starter:row.starter,
        backup:row.backup,
        methodology:"manager-room-recruitment-review-v1",
        official:false
      };
    }

    const starterScore=row.starter.score;
    const backupScore=row.backup.score;

    if (starterScore < 65) {
      return {
        position:row.position,
        status:"주전 적합도 검토",
        action:"내부 역할/전술 먼저 검토",
        priority:Math.min(100,Math.max(0,100-starterScore)),
        reason:"최상위 후보의 휴리스틱 Role Fit이 65 미만입니다. 영입 결론이 아니라 현재 역할 적합도 검토 신호입니다.",
        starter:row.starter,
        backup:row.backup,
        methodology:"manager-room-recruitment-review-v1",
        official:false
      };
    }

    if (backupScore < 65) {
      return {
        position:row.position,
        status:"백업 뎁스 검토",
        action:"대체 자원 검토",
        priority:Math.min(100,Math.max(0,100-backupScore)),
        reason:"두 번째 후보의 휴리스틱 Role Fit이 65 미만입니다. 외부 영입 필요성은 후보/계약/등록 정보 확인 전까지 확정하지 않습니다.",
        starter:row.starter,
        backup:row.backup,
        methodology:"manager-room-recruitment-review-v1",
        official:false
      };
    }

    if (backupScore < 75) {
      return {
        position:row.position,
        status:"백업 상태 관찰",
        action:"내부 성장·역할 재검토",
        priority:Math.min(50,75-backupScore),
        reason:"두 번째 후보의 휴리스틱 Role Fit이 65~74입니다.",
        starter:row.starter,
        backup:row.backup,
        methodology:"manager-room-recruitment-review-v1",
        official:false
      };
    }

    return {
      position:row.position,
      status:"현재 뎁스 확인됨",
      action:"관찰",
      priority:0,
      reason:"확인된 입력 기준 두 명 이상의 비교 가능한 후보가 있습니다.",
      starter:row.starter,
      backup:row.backup,
      methodology:"manager-room-recruitment-review-v1",
      official:false
    };
  }).sort((a,b)=>{
    if (a.priority===null && b.priority!==null) return 1;
    if (b.priority===null && a.priority!==null) return -1;
    return (b.priority??-1)-(a.priority??-1) || a.position.localeCompare(b.position);
  });
}
