/** Team-list slot zero is the first team; other slots are not labelled by age or ability. */
export function workloadGroup(player){
  if(player.teamId==null||!Number.isInteger(player.teamSlot)||player.teamSlot<0)return 'unknown';
  return player.teamSlot===0?'first':'development';
}
export function filterWorkloadRows(rows,{includeDevelopment=false,includeUnknown=false}={}){
  return rows.filter(({player})=>{
    const group=workloadGroup(player);
    return group==='first'||(group==='development'&&includeDevelopment)||(group==='unknown'&&includeUnknown);
  });
}
/** Stable ordering. Unknown CA/PA remain last in both directions, never treated as zero. */
export function sortTrainingPlayers(players,sort){
  if(!['ca','pa'].includes(sort?.key)||!['asc','desc'].includes(sort?.direction))return [...players];
  return players.map((player,index)=>({player,index})).sort((a,b)=>{
    const av=a.player[sort.key],bv=b.player[sort.key];
    const ak=Number.isFinite(av),bk=Number.isFinite(bv);
    if(ak!==bk)return ak?-1:1;
    return (ak?(av-bv)*(sort.direction==='asc'?1:-1):0)||a.index-b.index;
  }).map(r=>r.player);
}
