import { roleFit } from "./roles.js";

export const formationPresets={
  "433": {name:"4-3-3",slots:[
    slot("gk","GK",50,92,"Sweeper Keeper","Goalkeeper"),slot("lb","LB",14,74,"Wing Back","Full Back"),slot("lcb","CB",38,77,"Ball Playing Defender","Central Defender"),slot("rcb","CB",62,77,"Central Defender","Central Defender"),slot("rb","RB",86,74,"Wing Back","Full Back"),slot("dm","DM",50,58,"Deep Lying Playmaker","Holding Midfielder"),slot("lcm","CM",35,45,"Central Midfielder","Central Midfielder"),slot("rcm","CM",65,45,"Advanced Playmaker","Central Midfielder"),slot("lw","LW",18,26,"Inside Forward","Winger"),slot("rw","RW",82,26,"Winger","Winger"),slot("st","ST",50,12,"Advanced Forward","Pressing Forward")
  ]},
  "4231": {name:"4-2-3-1",slots:[
    slot("gk","GK",50,92,"Sweeper Keeper","Goalkeeper"),slot("lb","LB",14,74,"Wing Back","Full Back"),slot("lcb","CB",38,77,"Ball Playing Defender","Central Defender"),slot("rcb","CB",62,77,"Central Defender","Central Defender"),slot("rb","RB",86,74,"Full Back","Full Back"),slot("ldm","DM",38,57,"Deep Lying Playmaker","Holding Midfielder"),slot("rdm","DM",62,57,"Holding Midfielder","Holding Midfielder"),slot("am","AM",50,38,"Advanced Playmaker","Central Midfielder"),slot("lw","LW",18,27,"Inside Forward","Winger"),slot("rw","RW",82,27,"Winger","Winger"),slot("st","ST",50,12,"Advanced Forward","Pressing Forward")
  ]},
  "3421": {name:"3-4-2-1",slots:[
    slot("gk","GK",50,92,"Sweeper Keeper","Goalkeeper"),slot("lcb","CB",28,76,"Ball Playing Defender","Central Defender"),slot("cb","CB",50,79,"Central Defender","Central Defender"),slot("rcb","CB",72,76,"Ball Playing Defender","Central Defender"),slot("lwb","LB",13,55,"Wing Back","Full Back"),slot("lcm","CM",40,55,"Central Midfielder","Central Midfielder"),slot("rcm","CM",60,55,"Deep Lying Playmaker","Holding Midfielder"),slot("rwb","RB",87,55,"Wing Back","Full Back"),slot("lam","AM",35,31,"Advanced Playmaker","Winger"),slot("ram","AM",65,31,"Advanced Playmaker","Winger"),slot("st","ST",50,13,"Advanced Forward","Pressing Forward")
  ]}
};

export const roleOptionsByPosition={
  GK:["Goalkeeper","Sweeper Keeper"],CB:["Central Defender","Ball Playing Defender"],LB:["Full Back","Wing Back"],RB:["Full Back","Wing Back"],DM:["Holding Midfielder","Deep Lying Playmaker","Central Midfielder"],CM:["Central Midfielder","Deep Lying Playmaker","Advanced Playmaker"],AM:["Advanced Playmaker","Central Midfielder","Inside Forward"],LW:["Winger","Inside Forward","Advanced Playmaker"],RW:["Winger","Inside Forward","Advanced Playmaker"],ST:["Advanced Forward","Pressing Forward"]
};

export function applyFormation(snapshot,id){
  const preset=formationPresets[id]??formationPresets["433"];
  return {...snapshot,formation:{id,name:preset.name,slots:preset.slots.map(x=>({...x}))}};
}

export function tacticalChemistry(snapshot,lineup){
  const byPosition=new Map(lineup.map(x=>[x.slot.position,x]));
  const avg=Math.round(lineup.reduce((s,x)=>s+x.fit,0)/Math.max(1,lineup.length));
  const width=Math.round(((byPosition.get("LW")?.fit??70)+(byPosition.get("RW")?.fit??70)+(byPosition.get("LB")?.fit??70)+(byPosition.get("RB")?.fit??70))/4);
  const central=Math.round(((byPosition.get("DM")?.fit??70)+average(lineup.filter(x=>["CM","AM"].includes(x.slot.position)).map(x=>x.fit)))/2);
  const aerial=Math.round(average(lineup.filter(x=>["CB","ST"].includes(x.slot.position)).map(x=>(x.player.attributes.jumpingReach??10)*5)));
  const defensiveCover=Math.round(average(lineup.filter(x=>["CB","DM","LB","RB"].includes(x.slot.position)).map(x=>x.fit)));
  const issues=[];
  const attackingFullbacks=lineup.filter(x=>["LB","RB"].includes(x.slot.position)&&x.slot.ipRole==="Wing Back").length;
  if(attackingFullbacks>=2 && defensiveCover<84) issues.push("양쪽 풀백이 동시에 공격적으로 움직이며 수비 커버가 부족합니다.");
  if(aerial<70) issues.push("현재 XI의 제공권이 약합니다. 세트피스 수비 리스크가 있습니다.");
  if(central<78) issues.push("중앙 역할 조합의 안정성이 낮습니다.");
  return {overall:avg,width,central,aerial,defensiveCover,issues};
}

function slot(id,position,x,y,ipRole,oopRole){return{id,position,x,y,ipRole,oopRole};}
function average(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:70;}
