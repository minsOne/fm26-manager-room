// Slot IDs, not display order: the saved record places RW before AM.
export function lineupCopyRequest(review,formation){
  if(formation!=='4-2-3-1'||review?.status!=='review'||review.selectedCount!==11||review.bench?.players?.length!==9)return null;
  const lineup=Object.fromEntries(review.lineup.map(row=>[row.slot.id,row.player?.id]));
  const bench=review.bench.players.map(row=>row.player.id);
  const ids=[...Object.values(lineup),...bench];
  if(ids.length!==20||ids.some(id=>typeof id!=='string')||new Set(ids).size!==20)return null;
  return {formation,lineup,bench};
}
export const lineupCopyKey=request=>JSON.stringify(request);
