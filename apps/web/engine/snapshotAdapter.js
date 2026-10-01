const DEFAULT_FORMATION = {
  id:"433",
  name:"4-3-3",
  slots:[
    {id:"gk",position:"GK",ipRole:"Sweeper Keeper",oopRole:"Goalkeeper",x:50,y:92},
    {id:"lb",position:"LB",ipRole:"Wing Back",oopRole:"Full Back",x:14,y:74},
    {id:"lcb",position:"CB",ipRole:"Ball Playing Defender",oopRole:"Central Defender",x:38,y:77},
    {id:"rcb",position:"CB",ipRole:"Central Defender",oopRole:"Central Defender",x:62,y:77},
    {id:"rb",position:"RB",ipRole:"Wing Back",oopRole:"Full Back",x:86,y:74},
    {id:"dm",position:"DM",ipRole:"Deep Lying Playmaker",oopRole:"Holding Midfielder",x:50,y:58},
    {id:"lcm",position:"CM",ipRole:"Central Midfielder",oopRole:"Central Midfielder",x:35,y:45},
    {id:"rcm",position:"CM",ipRole:"Advanced Playmaker",oopRole:"Central Midfielder",x:65,y:45},
    {id:"lw",position:"LW",ipRole:"Inside Forward",oopRole:"Winger",x:18,y:26},
    {id:"rw",position:"RW",ipRole:"Winger",oopRole:"Winger",x:82,y:26},
    {id:"st",position:"ST",ipRole:"Advanced Forward",oopRole:"Pressing Forward",x:50,y:12},
  ]
};

const DEFAULT_PHILOSOPHY={
  youthDevelopment:75,
  winningNow:75,
  squadStability:75,
  financialEfficiency:65,
  rotation:75
};

export function normalizeSnapshot(input){
  if(!input || typeof input!=="object") throw new Error("Invalid snapshot");
  if(input.meta && input.formation && Array.isArray(input.players)) return input;
  if(input.source!=="rust-native" || !input.schemaVersion) {
    throw new Error("Unsupported snapshot schema");
  }

  return {
    meta:{
      source:"rust-native",
      schemaVersion:input.schemaVersion,
      saveName:input.saveName??"FM26 Save",
      dbVersion:input.dbVersion??null,
      gameDate:input.gameDate,
      capturedAt:new Date().toISOString(),
      runtime:{platform:"macOS",connected:true,build:input.dbVersion??"unknown"},
      coverage:input.coverage??{}
    },
    manager:{
      name:input.manager?.name??"",
      club:input.manager?.club??"Unknown Club",
      clubUid:input.manager?.clubUid??null,
      philosophy:{...DEFAULT_PHILOSOPHY}
    },
    formation:structuredClone(DEFAULT_FORMATION),
    clubFinance:input.clubFinance??null,
    fixtures:(input.fixtures??[]).map(normalizeFixture),
    players:(input.players??[]).map(player=>normalizePlayer(player,input.gameDate)),
    externalCandidates:[],
    loanOffers:[],
    leagues:[],
    recommendationsHistory:[],
    decisions:[],
    training:[]
  };
}

function normalizeFixture(fixture){
  return {
    id:fixture.id,
    date:fixture.date,
    opponent:fixture.opponent??"Unknown opponent",
    opponentClubUid:fixture.opponentClubUid??null,
    competition:fixture.competition??"Unknown Competition",
    competitionKnown:fixture.competitionKnown===true,
    competitionId:fixture.competitionId??null,
    competitionDatabaseId:fixture.competitionDatabaseId??null,
    roundRaw:fixture.roundRaw??null,
    roundName:fixture.roundName??null,
    home:fixture.home===true,
    opponentStrength:fixture.opponentStrength??50,
    opponentStrengthKnown:fixture.opponentStrengthKnown===true,
    tableImpact:fixture.tableImpact??50,
    tableImpactKnown:fixture.tableImpactKnown===true,
    knockout:fixture.knockout===true,
    knockoutKnown:fixture.knockoutKnown===true,
    rivalry:fixture.rivalry===true,
    rivalryKnown:fixture.rivalryKnown===true,
    restDaysAfter:fixture.restDaysAfter??7,
    homeTeamId:fixture.homeTeamId??null,
    awayTeamId:fixture.awayTeamId??null,
    stageId:fixture.stageId??null,
    matchRecordId:fixture.matchRecordId??null
  };
}

function normalizePlayer(player,gameDate){
  const playing=player.playingTime??{};
  const fitness=player.fitness??{};
  const contract=player.contract??{};
  const agreed=playing.agreed??contract.squadStatus??"Unknown";
  return {
    ...player,
    positions:Array.isArray(player.positions)&&player.positions.length?player.positions:[player.primaryPosition??"CM"],
    primaryPosition:player.primaryPosition??player.positions?.[0]??"CM",
    attributes:player.attributes??{},
    hidden:player.hidden??{},
    playingTime:{
      agreed,
      actual:playing.actual??null,
      recentMinutes:playing.recentMinutes??0,
      startsLast5:playing.startsLast5??0,
      minutesLast5:playing.minutesLast5??0,
      recentMinutesKnown:playing.recentMinutesKnown===true
    },
    fitness:{
      condition:fitness.condition??100,
      matchSharpness:fitness.matchSharpness??0,
      fatigue:fitness.fatigue??0,
      fatigueKnown:fitness.fatigueKnown===true,
      injuryRisk:fitness.injuryRisk??0,
      injuryRiskKnown:fitness.injuryRiskKnown===true
    },
    contract:{
      ...contract,
      weeklyWage:contract.weeklyWage??player.wage??0,
      monthsRemaining:contract.monthsRemaining??99
    },
    market:player.market??{interest:0,interestKnown:false,transferListed:false},
    influence:player.influence??"Unknown",
    homegrown:player.homegrown??false,
    homegrownKnown:player.homegrownKnown??false,
    snapshots:Array.isArray(player.snapshots)&&player.snapshots.length
      ?player.snapshots
      :[{date:gameDate,ca:player.ca}]
  };
}
