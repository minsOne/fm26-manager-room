export const mockSnapshot = {
  meta: {
    source: "demo",
    saveName: "Barcelona 2031/32",
    capturedAt: "2031-10-01T10:00:00Z",
    gameDate: "2031-10-01",
    runtime: { platform: "macOS", connected: false, build: "demo" }
  },
  manager: {
    club: "Barcelona",
    philosophy: {
      youthDevelopment: 85,
      winningNow: 78,
      squadStability: 72,
      financialEfficiency: 65,
      rotation: 82
    }
  },
  formation: {
    id: "433",
    name: "4-3-3",
    slots: [
      { id:"gk", position:"GK", ipRole:"Sweeper Keeper", oopRole:"Goalkeeper", x:50, y:91 },
      { id:"lb", position:"LB", ipRole:"Wing Back", oopRole:"Full Back", x:14, y:73 },
      { id:"lcb", position:"CB", ipRole:"Ball Playing Defender", oopRole:"Central Defender", x:38, y:77 },
      { id:"rcb", position:"CB", ipRole:"Central Defender", oopRole:"Central Defender", x:62, y:77 },
      { id:"rb", position:"RB", ipRole:"Wing Back", oopRole:"Full Back", x:86, y:73 },
      { id:"dm", position:"DM", ipRole:"Deep Lying Playmaker", oopRole:"Holding Midfielder", x:50, y:58 },
      { id:"lcm", position:"CM", ipRole:"Central Midfielder", oopRole:"Central Midfielder", x:35, y:45 },
      { id:"rcm", position:"CM", ipRole:"Advanced Playmaker", oopRole:"Central Midfielder", x:65, y:45 },
      { id:"lw", position:"LW", ipRole:"Inside Forward", oopRole:"Winger", x:18, y:26 },
      { id:"rw", position:"RW", ipRole:"Winger", oopRole:"Winger", x:82, y:26 },
      { id:"st", position:"ST", ipRole:"Advanced Forward", oopRole:"Pressing Forward", x:50, y:12 }
    ]
  },
  fixtures: [
    { id:"f1", date:"2031-10-02", opponent:"Mallorca", competition:"LaLiga", home:true, opponentStrength:48, tableImpact:55, knockout:false, rivalry:false, restDaysAfter:3 },
    { id:"f2", date:"2031-10-05", opponent:"Bayern", competition:"Champions League", home:false, opponentStrength:92, tableImpact:90, knockout:false, rivalry:false, restDaysAfter:4 },
    { id:"f3", date:"2031-10-09", opponent:"Espanyol", competition:"LaLiga", home:true, opponentStrength:63, tableImpact:82, knockout:false, rivalry:true, restDaysAfter:5 },
    { id:"f4", date:"2031-10-14", opponent:"Sevilla", competition:"LaLiga", home:false, opponentStrength:74, tableImpact:70, knockout:false, rivalry:false, restDaysAfter:7 }
  ],
  players: [
    player("p1","Marc Vidal",29,"GK",["GK"],166,168,38000000,150000, "Important Player", 430, 5, 420, 96, 30, 4, attrs({reflexes:17,handling:16,aerialReach:15,oneOnOnes:16,kicking:15,passing:13,decisions:16,composure:16,anticipation:15})),
    player("p2","Arnau Costa",25,"RB",["RB","RWB"],160,165,52000000,175000,"Regular Starter",352,4,336,87,72,10,attrs({crossing:15,dribbling:14,tackling:13,marking:12,positioning:13,decisions:14,workRate:17,stamina:17,acceleration:16,pace:16,technique:14,passing:13})),
    player("p3","Eric Soler",20,"RB",["RB","RWB","LB"],142,181,24000000,62000,"Squad Player",71,0,64,99,18,4,attrs({crossing:13,dribbling:13,tackling:12,marking:11,positioning:12,decisions:12,workRate:16,stamina:15,acceleration:16,pace:16,technique:13,passing:12})),
    player("p4","Pau Roca",24,"CB",["CB"],165,174,65000000,160000,"Important Player",298,4,315,94,40,5,attrs({marking:16,tackling:16,positioning:16,decisions:15,anticipation:16,strength:15,jumpingReach:15,pace:14,acceleration:13,passing:15,technique:14,composure:16})),
    player("p5","Ronald Araujo",32,"CB",["CB"],166,166,36000000,210000,"Important Player",312,4,324,92,51,8,attrs({marking:17,tackling:17,positioning:16,decisions:15,anticipation:16,strength:18,jumpingReach:17,pace:14,acceleration:13,passing:12,technique:12,composure:14})),
    player("p6","Jan Novak",19,"CB",["CB","DM"],138,188,27000000,55000,"Squad Player",94,1,82,98,20,5,attrs({marking:13,tackling:14,positioning:12,decisions:13,anticipation:14,strength:14,jumpingReach:14,pace:14,acceleration:13,passing:13,technique:12,composure:13})),
    player("p7","Aleix Balde",28,"LB",["LB","LWB"],163,166,47000000,180000,"Regular Starter",286,3,280,95,34,6,attrs({crossing:14,dribbling:15,tackling:12,marking:12,positioning:13,decisions:13,workRate:16,stamina:16,acceleration:18,pace:18,technique:15,passing:12})),
    player("p8","Nico Serra",20,"LB",["LB","LWB","RB"],145,179,26000000,60000,"Squad Player",122,1,101,99,19,4,attrs({crossing:13,dribbling:13,tackling:13,marking:12,positioning:12,decisions:12,workRate:15,stamina:15,acceleration:16,pace:15,technique:13,passing:12})),
    player("p9","Rodri",35,"DM",["DM","CM"],169,170,30000000,280000,"Star Player",330,4,348,90,68,8,attrs({passing:17,vision:17,firstTouch:16,technique:16,decisions:18,positioning:18,tackling:15,marking:14,composure:18,anticipation:18,stamina:14,strength:15,workRate:15})),
    player("p10","Marc Casado",28,"DM",["DM","CM"],151,163,31000000,110000,"Squad Player",126,1,108,98,21,5,attrs({passing:14,vision:13,firstTouch:14,technique:13,decisions:14,positioning:15,tackling:15,marking:14,composure:14,anticipation:15,stamina:16,strength:13,workRate:17})),
    player("p11","Frenkie de Jong",34,"CM",["CM","DM"],158,164,22000000,235000,"Regular Starter",279,3,274,93,45,7,attrs({passing:17,vision:16,firstTouch:17,technique:17,decisions:16,positioning:14,tackling:12,composure:17,anticipation:15,stamina:14,agility:16,workRate:14,offTheBall:14})),
    player("p12","Pedri",28,"CM",["CM","AM"],174,177,98000000,310000,"Star Player",347,5,388,88,74,9,attrs({passing:18,vision:18,firstTouch:18,technique:18,decisions:17,composure:17,anticipation:16,stamina:15,agility:17,offTheBall:16,dribbling:17,workRate:14})),
    player("p13","Gavi",27,"CM",["CM","AM","DM"],169,174,85000000,260000,"Important Player",252,3,251,96,36,6,attrs({passing:16,vision:15,firstTouch:16,technique:16,decisions:16,composure:15,anticipation:16,stamina:18,agility:16,offTheBall:16,workRate:19,tackling:14})),
    player("p14","Luca Rossi",18,"CM",["CM","AM"],129,190,18000000,32000,"Impact Sub",37,0,28,100,12,3,attrs({passing:14,vision:15,firstTouch:13,technique:15,decisions:12,composure:12,anticipation:12,stamina:11,agility:14,offTheBall:12,workRate:13,strength:9})),
    player("p15","Lamine Yamal",24,"RW",["RW","LW","AM"],178,190,165000000,390000,"Star Player",318,4,331,93,49,5,attrs({dribbling:19,technique:19,firstTouch:18,crossing:16,finishing:16,offTheBall:17,composure:17,decisions:17,vision:17,acceleration:18,pace:18,agility:19,passing:16})),
    player("p16","Marco Silva",24,"RW",["RW","LW"],154,165,42000000,125000,"Squad Player",118,1,97,99,18,4,attrs({dribbling:16,technique:15,firstTouch:14,crossing:14,finishing:13,offTheBall:14,composure:13,decisions:13,acceleration:17,pace:17,agility:15,passing:13})),
    player("p17","Raphinha",34,"LW",["LW","RW"],158,160,21000000,190000,"Regular Starter",241,3,239,94,39,7,attrs({dribbling:15,technique:15,firstTouch:14,crossing:16,finishing:15,offTheBall:16,composure:14,decisions:14,acceleration:15,pace:15,agility:14,passing:14})),
    player("p18","Mateo Ruiz",20,"LW",["LW","RW","ST"],147,184,33000000,70000,"Squad Player",82,1,71,99,15,4,attrs({dribbling:15,technique:14,firstTouch:14,crossing:13,finishing:14,offTheBall:14,composure:13,decisions:13,acceleration:17,pace:17,agility:16,passing:12})),
    player("p19","Joao Ferreira",19,"ST",["ST","LW"],147,188,41000000,76000,"Squad Player",28,0,32,100,10,3,attrs({finishing:14,firstTouch:14,technique:14,dribbling:13,offTheBall:12,composure:11,anticipation:13,decisions:12,acceleration:16,pace:17,strength:11,agility:15,workRate:13})),
    player("p20","Robert Lewandowski",43,"ST",["ST"],157,157,6000000,200000,"Regular Starter",230,3,244,92,44,10,attrs({finishing:18,firstTouch:17,technique:16,offTheBall:18,composure:18,anticipation:17,decisions:16,acceleration:10,pace:10,strength:15,agility:11,workRate:12})),
    player("p21","Tomas Oliveira",17,"DM",["DM","CM"],119,187,9000000,18000,"Future Prospect",0,0,0,100,5,2,attrs({passing:13,vision:13,firstTouch:12,technique:12,decisions:11,positioning:11,tackling:12,marking:11,composure:11,anticipation:12,stamina:12,strength:10,workRate:13}))
  ],
  externalCandidates: [
    candidate("c1","Marco Rossi",23,["DM","CM"],156,180,26000000,72000, attrs({passing:15,vision:14,firstTouch:14,technique:14,decisions:16,positioning:16,tackling:16,marking:15,composure:15,anticipation:16,stamina:17,strength:15,workRate:17})),
    candidate("c2","Joao Costa",21,["DM"],151,186,18000000,48000, attrs({passing:13,vision:12,firstTouch:13,technique:12,decisions:15,positioning:17,tackling:17,marking:16,composure:14,anticipation:16,stamina:17,strength:16,workRate:18})),
    candidate("c3","Luis Silva",19,["CM","DM"],142,191,9000000,26000, attrs({passing:16,vision:16,firstTouch:15,technique:15,decisions:14,positioning:13,tackling:12,marking:11,composure:15,anticipation:14,stamina:14,strength:11,workRate:14})),
    candidate("c4","Milan Petrovic",25,["RB","RWB"],160,164,37000000,85000, attrs({crossing:15,dribbling:14,tackling:15,marking:14,positioning:14,decisions:15,workRate:17,stamina:17,acceleration:16,pace:16,technique:13,passing:13}))
  ],
  loanOffers: [
    { playerId:"p14", club:"Girona", leagueLevel:82, promisedMinutes:"Regular Starter", facilities:16, roleMatch:91, wageShare:70 },
    { playerId:"p14", club:"Betis", leagueLevel:86, promisedMinutes:"Squad Player", facilities:17, roleMatch:85, wageShare:100 },
    { playerId:"p14", club:"Sporting", leagueLevel:71, promisedMinutes:"Important Player", facilities:15, roleMatch:89, wageShare:60 }
  ],
  leagues: [
    { id:"saudi", name:"Saudi Pro League", financialPower:94, sportingPower:60, spendingShare:31, wageGrowth:34, topClubConcentration:78 },
    { id:"england", name:"Premier League", financialPower:88, sportingPower:95, spendingShare:35, wageGrowth:8, topClubConcentration:48 },
    { id:"spain", name:"LaLiga", financialPower:71, sportingPower:90, spendingShare:14, wageGrowth:5, topClubConcentration:44 },
    { id:"germany", name:"Bundesliga", financialPower:68, sportingPower:85, spendingShare:10, wageGrowth:4, topClubConcentration:42 },
    { id:"italy", name:"Serie A", financialPower:64, sportingPower:82, spendingShare:10, wageGrowth:5, topClubConcentration:45 }
  ],
  recommendationsHistory: [
    { id:"r1", type:"rotation", confidence:96, outcome:true },
    { id:"r2", type:"training", confidence:91, outcome:true },
    { id:"r3", type:"loan", confidence:84, outcome:true },
    { id:"r4", type:"lineup", confidence:78, outcome:false },
    { id:"r5", type:"recruitment", confidence:67, outcome:true },
    { id:"r6", type:"training", confidence:58, outcome:false }
  ],
  decisions: [
    { date:"2031-08-10", subject:"Joao Ferreira", decision:"1군 잔류", reason:"Rotation 15+ starts 예상", expected:"1,200분 이상", actual:"현재 32분" }
  ]
};

function attrs(overrides = {}) {
  return {
    finishing:8, firstTouch:10, technique:10, passing:10, dribbling:9, crossing:8,
    tackling:8, marking:8, positioning:10, decisions:11, vision:10, composure:11,
    offTheBall:10, anticipation:11, teamwork:12, workRate:12, acceleration:12,
    pace:12, agility:12, balance:12, strength:12, stamina:12, jumpingReach:11,
    reflexes:8, handling:8, aerialReach:8, oneOnOnes:8, kicking:8,
    ...overrides
  };
}

function player(id,name,age,primaryPosition,positions,ca,pa,value,wage,agreed,recentMinutes,startsLast5,minutesLast5,condition,fatigue,injuryRisk,attributes) {
  const professionalism = age <= 21 ? 15 + (id.charCodeAt(id.length-1) % 4) : 13;
  return {
    id,name,age,nationality:"ESP",primaryPosition,positions,ca,pa,value,wage,attributes,
    hidden:{ professionalism, ambition:15, consistency:14, importantMatches:13, pressure:14, injuryProneness:injuryRisk, versatility: positions.length > 1 ? 15 : 10 },
    playingTime:{ agreed, actual: minutesLast5 > 300 ? "Regular Starter" : minutesLast5 > 120 ? "Squad Player" : "Impact Sub", recentMinutes, startsLast5, minutesLast5 },
    fitness:{ condition, fatigue, injuryRisk },
    contract:{ monthsRemaining: id==="p17" ? 10 : 30 + (id.charCodeAt(id.length-1) % 24), weeklyWage:wage },
    market:{ interest: id==="p17" ? 82 : id==="p10" ? 68 : 32, transferListed:false },
    influence: id==="p5" || id==="p12" ? "Team Leader" : "Normal",
    homegrown: age < 24 || id==="p12" || id==="p13",
    snapshots:[
      { date:"2031-04-01", ca: Math.max(1, ca - (age<=21 ? 7 : 1)) },
      { date:"2031-07-01", ca: Math.max(1, ca - (age<=21 ? 4 : 0)) },
      { date:"2031-10-01", ca }
    ]
  };
}

function candidate(id,name,age,positions,ca,pa,value,wage,attributes) {
  return {
    id,name,age,positions,primaryPosition:positions[0],ca,pa,value,wage,attributes,
    hidden:{professionalism:15,ambition:16,consistency:14,importantMatches:13,pressure:14,injuryProneness:5,versatility:positions.length>1?15:10},
    fitness:{condition:100,fatigue:5,injuryRisk:4},
    contract:{monthsRemaining:24,weeklyWage:wage},
    market:{interest:70,transferListed:false},
    homegrown:false
  };
}
