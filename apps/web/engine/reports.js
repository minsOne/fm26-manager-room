export function recommendationAccuracy(snapshot){
  const rows=snapshot.recommendationsHistory ?? [];
  const groups=[
    {label:"High",min:90,max:100},
    {label:"Medium",min:70,max:89},
    {label:"Low",min:0,max:69}
  ].map(group=>{
    const list=rows.filter(x=>x.confidence>=group.min&&x.confidence<=group.max);
    const correct=list.filter(x=>x.outcome).length;
    return {label:group.label,total:list.length,correct,accuracy:list.length?Math.round(correct/list.length*100):0};
  });
  const total=rows.length, correct=rows.filter(x=>x.outcome).length;
  return {total,correct,accuracy:total?Math.round(correct/total*100):0,groups};
}

export function decisionJournal(snapshot){
  return (snapshot.decisions??[]).map(d=>({
    ...d,
    status:d.actual===d.expected?"ON TRACK":d.actual?.includes("현재")?"REVIEW":"TRACK"
  }));
}
