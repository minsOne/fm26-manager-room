/**
 * Rectangular maximum-weight assignment using the Hungarian algorithm.
 * Rows are slots, columns are real players plus per-row dummy columns.
 * Missing edges remain impossible; dummy columns allow a slot to stay empty.
 */
export function maximumWeightAssignment(rowsBySlot) {
  const slotIds=[...rowsBySlot.keys()];
  const playerMap=new Map();

  for (const rows of rowsBySlot.values()) {
    for (const row of rows) playerMap.set(row.player.id,row.player);
  }

  const players=[...playerMap.values()].sort((a,b)=>
    String(a.id).localeCompare(String(b.id),undefined,{numeric:true})
    || String(a.name??"").localeCompare(String(b.name??""))
  );

  const realColumns=players.length;
  const rowCount=slotIds.length;
  const columnCount=realColumns+rowCount;
  const playerIndex=new Map(players.map((player,index)=>[player.id,index]));

  // n rows <= m columns because each row gets its own dummy column.
  const cost=Array.from({length:rowCount},()=>Array(columnCount).fill(1_000_000_000));
  const rowLookup=Array.from({length:rowCount},()=>new Map());

  slotIds.forEach((slotId,rowIndex)=>{
    for (const row of rowsBySlot.get(slotId)??[]) {
      const column=playerIndex.get(row.player.id);
      if (column===undefined) continue;
      // Role Fit dominates every tie-breaker. CA is only secondary.
      const ca=Number.isFinite(row.player.ca)?Math.max(0,Math.min(200,row.player.ca)):0;
      const stableTie=Math.max(0,999-column);
      const utility=row.score*1_000_000+ca*1_000+stableTie;
      cost[rowIndex][column]=-utility;
      rowLookup[rowIndex].set(column,row);
    }
    // Any dummy may represent an unfilled slot. Slightly prefer the row's own dummy.
    for(let dummy=0;dummy<rowCount;dummy++) {
      cost[rowIndex][realColumns+dummy]=dummy===rowIndex?0:1;
    }
  });

  const columns=hungarianMin(cost);
  return slotIds.map((slotId,rowIndex)=>{
    const column=columns[rowIndex];
    return {
      slotId,
      row:column<realColumns?(rowLookup[rowIndex].get(column)??null):null
    };
  });
}

/** Hungarian algorithm for n x m minimization where n <= m. */
function hungarianMin(cost) {
  const n=cost.length;
  if(!n) return [];
  const m=cost[0].length;
  if(n>m) throw new Error("Hungarian assignment requires rows <= columns");

  const u=Array(n+1).fill(0);
  const v=Array(m+1).fill(0);
  const p=Array(m+1).fill(0);
  const way=Array(m+1).fill(0);

  for(let i=1;i<=n;i++) {
    p[0]=i;
    let j0=0;
    const minv=Array(m+1).fill(Infinity);
    const used=Array(m+1).fill(false);

    do {
      used[j0]=true;
      const i0=p[j0];
      let delta=Infinity;
      let j1=0;

      for(let j=1;j<=m;j++) {
        if(used[j]) continue;
        const cur=cost[i0-1][j-1]-u[i0]-v[j];
        if(cur<minv[j]) {
          minv[j]=cur;
          way[j]=j0;
        }
        if(minv[j]<delta || (minv[j]===delta && j<j1)) {
          delta=minv[j];
          j1=j;
        }
      }

      if(!Number.isFinite(delta)) throw new Error("No feasible assignment");
      for(let j=0;j<=m;j++) {
        if(used[j]) {
          u[p[j]]+=delta;
          v[j]-=delta;
        } else {
          minv[j]-=delta;
        }
      }
      j0=j1;
    } while(p[j0]!==0);

    do {
      const j1=way[j0];
      p[j0]=p[j1];
      j0=j1;
    } while(j0!==0);
  }

  const assignment=Array(n).fill(-1);
  for(let j=1;j<=m;j++) {
    if(p[j]>0) assignment[p[j]-1]=j-1;
  }
  return assignment;
}
