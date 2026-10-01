import { coachConfidence } from "./confidence.js";

export function marketHealth(snapshot){
  return snapshot.leagues.map(league=>{
    const gap=league.financialPower-league.sportingPower;
    const heat=Math.round(gap*.48+league.wageGrowth*.28+league.spendingShare*.12+league.topClubConcentration*.12);
    const status=heat>=45?"OVERHEATED":heat>=28?"HIGH":heat<=5?"WEAK":"NORMAL";
    const confidence=coachConfidence({dataCompleteness:.86,sampleSize:.82,modelAgreement:Math.min(1,Math.abs(gap)/30+.45),volatility:.2,futureUncertainty:.12});
    return {...league,gap,heat,status,confidence};
  }).sort((a,b)=>b.heat-a.heat);
}

export const rebalancePresets={
  mild:{transferBudget:-20,wageBudget:-20,maxWage:-25,balance:-10,reputation:0},
  balanced:{transferBudget:-45,wageBudget:-45,maxWage:-50,balance:-30,reputation:-5},
  strong:{transferBudget:-60,wageBudget:-60,maxWage:-65,balance:-40,reputation:-12}
};

export function rebalancePreview(snapshot,leagueId="saudi",preset="balanced"){
  const league=marketHealth(snapshot).find(x=>x.id===leagueId);
  const changes=rebalancePresets[preset]??rebalancePresets.balanced;
  return {
    league,preset,changes,
    safeguards:[
      "Player CA/PA/attributes unchanged",
      "Preview required before apply",
      "Explicit manager approval required",
      "Read-back verification required",
      "Rollback snapshot required"
    ],
    confidence:league?.confidence??70
  };
}
