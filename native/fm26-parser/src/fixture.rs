use crate::club::ClubIndex;
use crate::competition::CompetitionIndex;
use crate::metadata::GameDate;
use crate::stage::StageIndex;
use memchr::memchr_iter;
use serde::Serialize;

const RECORD_BYTES: usize = 68;
const MARKER_BACK: usize = 12;
const MARKER_VALUE: u8 = 0x1c;
const FIRST_SENTINEL_OFFSET: usize = 4;
const SECOND_SENTINEL_OFFSET: usize = 11;
const HOME_TEAM_OFFSET: usize = 0;
const AWAY_TEAM_OFFSET: usize = 7;
const KICK_OFF_PACKED_OFFSET: usize = 13;
const KICK_OFF_YEAR_OFFSET: usize = 15;
const STAGE_ID_BACK: usize = 11;
const MATCH_RECORD_ID_OFFSET: usize = 32;
const PLAYED_OFFSET: usize = 55;
const TEAM_MIN: u32 = 1;
const TEAM_MAX: u32 = 2_999_999;
const YEARS_BEFORE: u16 = 7;
const YEARS_AFTER: u16 = 8;
const CLUSTER_GAP_BYTES: usize = 1_048_576;

#[derive(Debug, Clone)]
struct RawFixture {
    span_offset: usize,
    stage_id: Option<u32>,
    home_team_id: u32,
    away_team_id: u32,
    packed_kick_off: u16,
    kick_off_year: u16,
    match_record_id: Option<u32>,
    played: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureRow {
    pub id: String,
    pub date: String,
    pub opponent: String,
    pub opponent_club_uid: Option<u32>,
    pub competition: String,
    pub competition_known: bool,
    pub competition_id: Option<u32>,
    pub competition_database_id: Option<u32>,
    pub round_raw: Option<u32>,
    pub round_name: Option<&'static str>,
    pub home: bool,
    pub opponent_strength: u8,
    pub opponent_strength_known: bool,
    pub table_impact: u8,
    pub table_impact_known: bool,
    pub knockout: bool,
    pub knockout_known: bool,
    pub rivalry: bool,
    pub rivalry_known: bool,
    pub rest_days_after: u16,
    pub home_team_id: u32,
    pub away_team_id: u32,
    pub stage_id: Option<u32>,
    pub match_record_id: Option<u32>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureStats {
    pub candidates: usize,
    pub strict_accepted: usize,
    pub clusters: usize,
    pub calendar_records: usize,
    pub managed_upcoming: usize,
}

pub fn managed_upcoming(
    span: &[u8],
    clubs: &ClubIndex,
    managed_club_uid: u32,
    clock: GameDate,
    stages: Option<&StageIndex>,
    competitions: Option<&CompetitionIndex>,
    limit: usize,
) -> (Vec<FixtureRow>, FixtureStats) {
    let (strict, mut stats) = scan_strict(span, clock);
    let (calendar, clusters) = largest_cluster(strict);
    stats.clusters = clusters;
    stats.calendar_records = calendar.len();

    let mut selected: Vec<(RawFixture, GameDate, u16, bool, Option<u32>, String)> = calendar
        .into_iter()
        .filter_map(|fixture| {
            if fixture.played { return None; }
            let date = fixture_date(&fixture)?;
            if date < clock { return None; }

            let home_club = clubs.resolve_team(fixture.home_team_id).map(|r| r.club_uid);
            let away_club = clubs.resolve_team(fixture.away_team_id).map(|r| r.club_uid);
            let home = home_club == Some(managed_club_uid);
            let away = away_club == Some(managed_club_uid);
            if !home && !away { return None; }

            let opponent_uid = if home { away_club } else { home_club };
            let opponent_team = if home { fixture.away_team_id } else { fixture.home_team_id };
            let opponent = opponent_uid
                .and_then(|uid| clubs.club(uid))
                .map(|club| club.name.clone())
                .unwrap_or_else(|| format!("Team {opponent_team}"));
            let slot = fixture.packed_kick_off >> 9;
            Some((fixture, date, slot, home, opponent_uid, opponent))
        })
        .collect();

    selected.sort_by_key(|(fixture,date,slot,_,_,_)| {
        (date.year,date.day_of_year,*slot,fixture.home_team_id,fixture.away_team_id)
    });
    selected.truncate(limit);
    stats.managed_upcoming = selected.len();

    let mut result=Vec::with_capacity(selected.len());
    for (index,(fixture,date,_slot,home,opponent_uid,opponent)) in selected.iter().enumerate() {
        let rest_days_after=selected.get(index+1)
            .map(|(_,next,_,_,_,_)| day_number(*next).saturating_sub(day_number(*date)).min(u16::MAX as i64) as u16)
            .unwrap_or(7);
        let stage = fixture.stage_id.and_then(|id| stages.and_then(|index| index.stage(id)));
        let competition_id = stage.and_then(|value| value.competition_id);
        let competition = competition_id
            .and_then(|id| competitions.and_then(|index| index.competition(id)));
        let competition_name = competition.and_then(|value| value.name.clone());

        result.push(FixtureRow{
            id:fixture.match_record_id.map(|id|format!("match-{id}"))
                .unwrap_or_else(||format!("fixture-{}-{}-{}",date_string(*date),fixture.home_team_id,fixture.away_team_id)),
            date:date_string(*date),
            opponent:opponent.clone(),
            opponent_club_uid:*opponent_uid,
            competition: competition_name
                .clone()
                .or_else(|| competition_id.map(|id| format!("Competition {id}")))
                .or_else(|| fixture.stage_id.map(|id| format!("Stage {id}")))
                .unwrap_or_else(|| "Unknown Competition".into()),
            competition_known: competition_name.is_some(),
            competition_id,
            competition_database_id: competition.and_then(|value| value.database_id),
            round_raw: stage.and_then(|value| value.round_raw),
            round_name: stage.and_then(|value| value.round_name),
            home:*home,
            opponent_strength:50,opponent_strength_known:false,
            table_impact:50,table_impact_known:false,
            knockout:false,knockout_known:false,
            rivalry:false,rivalry_known:false,
            rest_days_after,
            home_team_id:fixture.home_team_id,away_team_id:fixture.away_team_id,
            stage_id:fixture.stage_id,match_record_id:fixture.match_record_id,
        });
    }
    (result,stats)
}

fn scan_strict(span:&[u8],clock:GameDate)->(Vec<RawFixture>,FixtureStats){
    let mut fixtures=Vec::new(); let mut stats=FixtureStats::default();
    let first=clock.year.saturating_sub(YEARS_BEFORE); let last=clock.year.saturating_add(YEARS_AFTER);
    for sentinel in memchr_iter(0xff,span){
        if sentinel<FIRST_SENTINEL_OFFSET{continue;}
        let home_at=sentinel-FIRST_SENTINEL_OFFSET;
        if home_at<MARKER_BACK||home_at+RECORD_BYTES>span.len(){continue;}
        let marker=home_at-MARKER_BACK;
        if span[marker]!=MARKER_VALUE||span.get(home_at+SECOND_SENTINEL_OFFSET)!=Some(&0xff){continue;}
        stats.candidates+=1;
        let Some(home)=read_u32(span,home_at+HOME_TEAM_OFFSET) else{continue};
        let Some(away)=read_u32(span,home_at+AWAY_TEAM_OFFSET) else{continue};
        if !(TEAM_MIN..=TEAM_MAX).contains(&home)||!(TEAM_MIN..=TEAM_MAX).contains(&away){continue;}
        let Some(packed)=read_u16(span,home_at+KICK_OFF_PACKED_OFFSET) else{continue};
        let Some(year)=read_u16(span,home_at+KICK_OFF_YEAR_OFFSET) else{continue};
        if !(first..=last).contains(&year)||!(1..=366).contains(&(packed&0x01ff)){continue;}
        let stage=read_u32(span,home_at-STAGE_ID_BACK).unwrap_or(u32::MAX);
        let match_id=read_u32(span,home_at+MATCH_RECORD_ID_OFFSET).unwrap_or(u32::MAX);
        fixtures.push(RawFixture{
            span_offset:home_at,stage_id:(stage!=u32::MAX).then_some(stage),
            home_team_id:home,away_team_id:away,packed_kick_off:packed,kick_off_year:year,
            match_record_id:(match_id!=0&&match_id!=u32::MAX).then_some(match_id),
            played:span[home_at+PLAYED_OFFSET]!=0,
        });
        stats.strict_accepted+=1;
    }
    fixtures.sort_by_key(|f|f.span_offset); (fixtures,stats)
}
fn largest_cluster(fixtures:Vec<RawFixture>)->(Vec<RawFixture>,usize){
    if fixtures.is_empty(){return(Vec::new(),0);}
    let mut bounds=Vec::new(); let mut start=0;
    for i in 1..fixtures.len(){
        if fixtures[i].span_offset.saturating_sub(fixtures[i-1].span_offset)>CLUSTER_GAP_BYTES{
            bounds.push((start,i));start=i;
        }
    }
    bounds.push((start,fixtures.len()));
    let (s,e)=bounds.iter().copied().max_by_key(|(s,e)|e-s).unwrap();
    let count=bounds.len(); (fixtures[s..e].to_vec(),count)
}
fn fixture_date(f:&RawFixture)->Option<GameDate>{
    let day=f.packed_kick_off&0x01ff;
    ((1901..=2200).contains(&f.kick_off_year)&&(1..=366).contains(&day))
        .then_some(GameDate{year:f.kick_off_year,day_of_year:day})
}
fn day_number(d:GameDate)->i64{let y=d.year as i64-1;y*365+y/4-y/100+y/400+d.day_of_year as i64}
fn date_string(d:GameDate)->String{
    let leap=d.year%400==0||(d.year%4==0&&d.year%100!=0);
    let md=[31u16,if leap{29}else{28},31,30,31,30,31,31,30,31,30,31];
    let mut day=d.day_of_year.max(1);let mut month=1u8;
    for days in md{if day<=days{return format!("{:04}-{:02}-{:02}",d.year,month,day);}day-=days;month+=1;}
    format!("{:04}-12-31",d.year)
}
fn read_u16(b:&[u8],o:usize)->Option<u16>{Some(u16::from_le_bytes(b.get(o..o+2)?.try_into().ok()?))}
fn read_u32(b:&[u8],o:usize)->Option<u32>{Some(u32::from_le_bytes(b.get(o..o+4)?.try_into().ok()?))}
