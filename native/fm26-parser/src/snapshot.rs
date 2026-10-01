use crate::club::ClubIndex;
use crate::contracts::CurrentContractCore;
use crate::finance::FinanceLatest;
use crate::fixture::FixtureRow;
use crate::match_history::RecentMinutes;
use crate::metadata::{GameDate, SummaryInfo};
use crate::person::PersonCore;
use crate::player_scan::PlayerCandidate;
use serde::Serialize;
use std::collections::BTreeMap;

const MISSING_REFERENCE: u32 = u32::MAX;
const TRANSFER_PLACEHOLDER: u32 = 300_000_000;
const RATINGS_OFFSET: usize = 24;
const RATINGS_COUNT: usize = 15;
const ATTRIBUTES_OFFSET: usize = 39;
const ATTRIBUTE_COUNT: usize = 54;
const POSITION_CODES: [&str; 15] = [
    "GK", "SW", "DL", "DC", "DR", "DM", "ML", "MC", "MR", "AML", "AMC", "AMR", "STC", "WBL", "WBR",
];
const ATTRIBUTE_NAMES: [&str; 52] = [
    "crossing", "dribbling", "finishing", "heading", "longShots", "marking", "offTheBall", "passing",
    "penaltyTaking", "tackling", "vision", "handling", "aerialReach", "commandOfArea", "communication",
    "kicking", "throwing", "anticipation", "decisions", "oneOnOnes", "positioning", "reflexes",
    "firstTouch", "technique", "flair", "corners", "teamwork", "workRate", "longThrows", "eccentricity",
    "rushingOut", "punching", "acceleration", "freeKickTaking", "strength", "stamina", "pace",
    "jumpingReach", "leadership", "dirtiness", "balance", "bravery", "consistency", "aggression",
    "agility", "importantMatches", "injuryProneness", "versatility", "naturalFitness", "determination",
    "composure", "concentration",
];
const HIDDEN_ATTRIBUTES: [&str; 5] = [
    "dirtiness", "consistency", "importantMatches", "injuryProneness", "versatility",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickSnapshot {
    pub schema_version: u32,
    pub source: &'static str,
    pub save_name: String,
    pub db_version: String,
    pub game_date: String,
    pub manager: QuickManager,
    pub club_finance: Option<QuickClubFinance>,
    pub fixtures: Vec<FixtureRow>,
    pub players: Vec<QuickPlayer>,
    pub coverage: QuickCoverage,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickManager {
    pub name: String,
    pub club: String,
    pub club_uid: u32,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickClubFinance {
    pub balance: i32,
    pub transfer_budget_allocated: i32,
    pub transfer_budget_remaining: i32,
    pub wage_budget_weekly: u32,
    pub wage_payroll_weekly: u32,
    pub finance_rows: u32,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCoverage {
    pub players: &'static str,
    pub attributes: &'static str,
    pub personality: &'static str,
    pub contracts: &'static str,
    pub fixtures: &'static str,
    pub recent_minutes: &'static str,
    pub finances: &'static str,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPlayer {
    pub id: String,
    pub name: String,
    pub age: u16,
    pub age_known: bool,
    pub birth_date: Option<String>,
    pub nationality: String,
    pub primary_position: String,
    pub positions: Vec<String>,
    /// Original FM position ratings; the web position list merges DL/WBL etc.
    pub position_ratings: BTreeMap<String, u8>,
    pub ca: u16,
    pub pa: u16,
    pub pa_known: bool,
    /// Preserve range codes instead of interpreting the fallback CA as a PA fact.
    pub pa_range_code: Option<i16>,
    pub value: u32,
    pub value_known: bool,
    pub wage: u32,
    pub wage_known: bool,
    pub attributes: BTreeMap<String, u8>,
    pub hidden: BTreeMap<String, u8>,
    pub personality_known: bool,
    pub raw_left_foot: u8,
    pub raw_right_foot: u8,
    pub left_foot: u8,
    pub right_foot: u8,
    pub playing_time: QuickPlayingTime,
    pub fitness: QuickFitness,
    pub contract: QuickContract,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPlayingTime {
    pub agreed: String,
    pub actual: Option<String>,
    pub recent_minutes: u16,
    pub starts_last5: u8,
    pub minutes_last5: u16,
    pub recent_minutes_known: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickFitness {
    pub condition: u16,
    pub condition_known: bool,
    pub raw_condition: Option<u16>,
    pub match_sharpness: u16,
    pub match_sharpness_known: bool,
    pub raw_match_sharpness: Option<u16>,
    pub fatigue: u8,
    pub fatigue_known: bool,
    pub injury_risk: u8,
    pub injury_risk_known: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickContract {
    pub weekly_wage: u32,
    pub weekly_wage_known: bool,
    pub end: Option<String>,
    pub months_remaining: Option<i32>,
    pub squad_status: String,
    pub squad_status_raw: Option<u8>,
}

pub fn build(
    game_db: &[u8], save_name: String, db_version: String, clock: GameDate,
    summary: &SummaryInfo, candidates: &[PlayerCandidate], people: &[Option<PersonCore>],
    contracts: &[Option<CurrentContractCore>], recent_minutes: &[RecentMinutes],
    clubs: &ClubIndex, finances: &[FinanceLatest], fixtures: Vec<FixtureRow>,
) -> QuickSnapshot {
    let mut players = Vec::new();
    for (index, candidate) in candidates.iter().enumerate() {
        if candidate.team_id == MISSING_REFERENCE { continue; }
        let Some(resolution) = clubs.resolve_team(candidate.team_id) else { continue; };
        if resolution.club_uid != summary.club_uid { continue; }
        let person = people.get(index).and_then(Option::as_ref);
        let contract = contracts.get(index).and_then(Option::as_ref);
        let recent = recent_minutes.get(index).copied().unwrap_or_default();
        players.push(build_player(game_db, candidate, person, contract, recent, clock));
    }
    players.sort_by(|left, right| right.ca.cmp(&left.ca).then_with(|| left.name.cmp(&right.name)));
    let club_finance = finances.iter().find(|row| row.club_uid == summary.club_uid).map(|row| QuickClubFinance {
        balance: row.balance,
        transfer_budget_allocated: row.transfer_budget_allocated,
        transfer_budget_remaining: row.transfer_budget_remaining,
        wage_budget_weekly: row.wage_budget_weekly,
        wage_payroll_weekly: row.wage_payroll_weekly,
        finance_rows: row.rows,
    });
    QuickSnapshot {
        schema_version: 2, source: "rust-native", save_name, db_version,
        game_date: format_date(clock),
        manager: QuickManager { name: summary.manager_name.clone(), club: summary.club_name.clone(), club_uid: summary.club_uid },
        club_finance, fixtures, players,
        coverage: QuickCoverage {
            players: "native", attributes: "native", personality: "native",
            contracts: "native-chain-current", fixtures: "native-managed-upcoming",
            recent_minutes: "native-match-history", finances: "managed-club-native-finance",
        },
    }
}

fn build_player(
    game_db: &[u8], candidate: &PlayerCandidate, person: Option<&PersonCore>,
    contract: Option<&CurrentContractCore>, recent: RecentMinutes, clock: GameDate,
) -> QuickPlayer {
    let ratings = &game_db[candidate.record_offset + RATINGS_OFFSET..candidate.record_offset + RATINGS_OFFSET + RATINGS_COUNT];
    let positions = web_positions(ratings);
    let primary_position = positions.first().cloned().unwrap_or_else(|| "CM".to_owned());
    let position_ratings = POSITION_CODES.iter().zip(ratings).map(|(name, &value)| ((*name).to_owned(), value)).collect();
    let raw_attrs = &game_db[candidate.record_offset + ATTRIBUTES_OFFSET..candidate.record_offset + ATTRIBUTES_OFFSET + ATTRIBUTE_COUNT];
    let attributes = attributes(raw_attrs);
    // One authoritative name -> raw-index map for visible and hidden values.
    let hidden = hidden(person, &attributes);
    let transfer_raw = read_u32(game_db, candidate.record_offset + 93).unwrap_or(0);
    let value_known = !matches!(transfer_raw, 0 | MISSING_REFERENCE | TRANSFER_PLACEHOLDER);
    let value = if value_known { transfer_raw } else { 0 };
    let raw_condition = read_u16(game_db, candidate.record_offset + 110);
    let raw_match_sharpness = read_u16(game_db, candidate.record_offset + 106);
    let condition_known = raw_condition.is_some_and(|value| value <= 10000);
    let match_sharpness_known = raw_match_sharpness.is_some_and(|value| value <= 10000);
    let condition = display_percent(raw_condition, 100);
    let match_sharpness = display_percent(raw_match_sharpness, 0);
    let potential = candidate.potential_ability;
    let pa_known = potential > 0;
    // Numeric fallback retained for schema-2 compatibility; paKnown controls availability.
    let pa = if pa_known { potential as u16 } else { candidate.current_ability };
    let birth = person.map(|value| GameDate { year: value.birth_year, day_of_year: value.birth_day_of_year });
    let age = birth.map(|date| age_at(clock, date.year, date.day_of_year)).unwrap_or(0);
    let contract_end = contract.and_then(|value| value.end);
    let weekly_wage = contract.map(|value| value.wage).unwrap_or(0);
    let wage_known = contract.is_some();
    let agreed = contract.and_then(|value| value.squad_status_raw).map(squad_status_label).unwrap_or_else(|| "Unknown".to_owned());
    QuickPlayer {
        id: candidate.uid.to_string(),
        name: person.and_then(|value| value.name.clone()).unwrap_or_else(|| format!("Player {}", candidate.uid)),
        age, age_known: birth.is_some(), birth_date: birth.map(format_date),
        nationality: person.map(|value| value.nation_id.to_string()).unwrap_or_default(),
        primary_position, positions, position_ratings, ca: candidate.current_ability, pa, pa_known,
        pa_range_code: (potential < 0).then_some(potential), value, value_known,
        wage: weekly_wage, wage_known, attributes, hidden, personality_known: person.is_some(),
        raw_left_foot: raw_attrs[24], raw_right_foot: raw_attrs[25],
        left_foot: scale(raw_attrs[24]), right_foot: scale(raw_attrs[25]),
        playing_time: QuickPlayingTime {
            agreed: agreed.clone(), actual: None, recent_minutes: recent.last14,
            starts_last5: 0, minutes_last5: recent.last5, recent_minutes_known: recent.known,
        },
        fitness: QuickFitness {
            condition, condition_known, raw_condition, match_sharpness, match_sharpness_known,
            raw_match_sharpness, fatigue: 0, fatigue_known: false, injury_risk: 0, injury_risk_known: false,
        },
        contract: QuickContract {
            weekly_wage, weekly_wage_known: wage_known, end: contract_end.map(format_date),
            months_remaining: contract_end.map(|end| months_between(clock, end)),
            squad_status: agreed, squad_status_raw: contract.and_then(|value| value.squad_status_raw),
        },
    }
}

fn display_percent(raw: Option<u16>, fallback: u16) -> u16 {
    raw.map(|value| ((u32::from(value) + 50) / 100).min(100) as u16).unwrap_or(fallback)
}
fn attributes(raw: &[u8]) -> BTreeMap<String, u8> {
    ATTRIBUTE_NAMES.iter().enumerate().map(|(index, name)| {
        let raw_index = if index < 24 { index } else { index + 2 };
        ((*name).to_owned(), scale(raw[raw_index]))
    }).collect()
}
fn hidden(person: Option<&PersonCore>, attributes: &BTreeMap<String, u8>) -> BTreeMap<String, u8> {
    let mut values = BTreeMap::new();
    if let Some(person) = person {
        for (name, value) in ["adaptability", "ambition", "loyalty", "pressure", "professionalism", "sportsmanship", "temperament", "controversy"].into_iter().zip(person.personality) {
            values.insert(name.to_owned(), value);
        }
    }
    for name in HIDDEN_ATTRIBUTES {
        if let Some(&value) = attributes.get(name) { values.insert(name.to_owned(), value); }
    }
    values
}
fn web_positions(ratings: &[u8]) -> Vec<String> {
    let mut ranked: Vec<(u8, usize)> = ratings.iter().copied().enumerate().filter_map(|(i, r)| (r >= 15).then_some((r, i))).collect();
    ranked.sort_by_key(|(rating, index)| (std::cmp::Reverse(*rating), *index));
    let mut result = Vec::new();
    for (_, index) in ranked {
        let mapped = web_position(POSITION_CODES[index]);
        if !result.iter().any(|existing| existing == mapped) { result.push(mapped.to_owned()); }
    }
    result
}
fn web_position(code: &str) -> &str {
    match code {
        "GK" => "GK", "SW" | "DC" => "CB", "DL" | "WBL" => "LB", "DR" | "WBR" => "RB",
        "DM" => "DM", "MC" => "CM", "AMC" => "AM", "ML" | "AML" => "LW", "MR" | "AMR" => "RW", "STC" => "ST", _ => "CM",
    }
}
fn scale(raw: u8) -> u8 { std::cmp::max(1, raw.saturating_add(2) / 5) }
fn squad_status_label(raw: u8) -> String {
    match raw {
        1 => "Star Player", 2 => "Important Player", 3 => "Regular Starter", 4 => "Squad Player", 5 => "Impact Sub",
        7 => "Fringe Player", 9 => "Emergency Backup", 10 => "Breakthrough Prospect", 11 => "Future Prospect",
        13 => "Youngster", 14 => "B Team Regular", 15 => "First Choice Goalkeeper", 16 => "Cup Goalkeeper",
        17 => "Domestic Cup Goalkeeper", 18 => "Continental Cup Goalkeeper", 20 => "Backup",
        21 => "Goalkeeper Emergency Backup", 22 => "Surplus To Requirements", value => return format!("Unknown ({value})"),
    }.to_owned()
}
fn age_at(clock: GameDate, birth_year: u16, birth_day: u16) -> u16 {
    // Ordinals from leap and non-leap years are not comparable birthdays.
    let birthday = month_day(GameDate { year: birth_year, day_of_year: birth_day });
    clock.year.saturating_sub(birth_year).saturating_sub(u16::from(month_day(clock) < birthday))
}
fn months_between(start: GameDate, end: GameDate) -> i32 {
    let (sm, sd) = month_day(start);
    let (em, ed) = month_day(end);
    ((end.year as i32 - start.year as i32) * 12 + em as i32 - sm as i32 - i32::from(ed < sd)).max(0)
}
pub fn format_date(value: GameDate) -> String {
    let (month, day) = month_day(value);
    format!("{:04}-{:02}-{:02}", value.year, month, day)
}
fn month_day(value: GameDate) -> (u8, u8) {
    let months = [31u16, if is_leap(value.year) {29} else {28}, 31,30,31,30,31,31,30,31,30,31];
    let mut remaining = value.day_of_year;
    for (index, days) in months.into_iter().enumerate() {
        if remaining <= days { return ((index + 1) as u8, remaining as u8); }
        remaining -= days;
    }
    (12, 31)
}
fn is_leap(year: u16) -> bool { year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) }
fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(buffer.get(offset..offset + 2)?.try_into().ok()?))
}
fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn date(year: u16, ordinal: u16) -> GameDate { GameDate { year, day_of_year: ordinal } }
    #[test]
    fn birthday_from_leap_year_is_reached_on_march_first() {
        assert_eq!(age_at(date(2037, 60), 2000, 61), 37);
        assert_eq!(age_at(date(2037, 59), 2000, 61), 36);
    }
    #[test]
    fn birthday_in_non_leap_year_is_not_reached_on_february_29() {
        assert_eq!(age_at(date(2036, 60), 2001, 60), 34);
        assert_eq!(age_at(date(2036, 61), 2001, 60), 35);
    }
    #[test]
    fn february_29_birthday_uses_month_day_comparison() {
        assert_eq!(age_at(date(2037, 59), 2000, 60), 36);
        assert_eq!(age_at(date(2037, 60), 2000, 60), 37);
    }
    #[test]
    fn birthdays_and_months_cross_year_boundaries() {
        assert_eq!(age_at(date(2037, 1), 2000, 366), 36);
        assert_eq!(age_at(date(2037, 365), 2000, 366), 37);
        assert_eq!(months_between(date(2037, 31), date(2037, 59)), 0);
        assert_eq!(months_between(date(2037, 31), date(2037, 90)), 2);
        assert_eq!(months_between(date(2037, 60), date(2036, 61)), 0);
    }
    #[test]
    fn named_attributes_straddle_the_two_foot_bytes_correctly() {
        for (name, raw_index) in [("crossing",0),("technique",23),("flair",26),("dirtiness",41),("consistency",44),("importantMatches",47),("injuryProneness",48),("versatility",49),("composure",52),("concentration",53)] {
            let mut raw = [5u8;54]; raw[raw_index] = 95;
            let decoded = attributes(&raw);
            assert_eq!(decoded.len(), 52);
            assert_eq!(decoded[name], 19, "{name} at {raw_index}");
            assert_eq!(decoded.values().filter(|&&v| v == 19).count(), 1);
        }
    }
    #[test]
    fn feet_do_not_shift_or_leak_into_attributes() {
        let mut raw = [5u8;54]; raw[24] = 100; raw[25] = 75;
        assert!(attributes(&raw).values().all(|&v| v == 1));
    }
    #[test]
    fn hidden_values_are_the_same_named_attributes_not_another_index_map() {
        let raw: Vec<u8> = (1u8..=54).collect();
        let attrs = attributes(&raw);
        let values = hidden(None, &attrs);
        assert_eq!(values.len(), 5);
        assert!(!values.contains_key("professionalism"));
        for name in HIDDEN_ATTRIBUTES { assert_eq!(values[name], attrs[name]); }
    }
    #[test]
    fn attribute_scale_boundaries() {
        for (raw, expected) in [(1,1),(5,1),(7,1),(8,2),(92,18),(93,19),(97,19),(98,20),(100,20)] { assert_eq!(scale(raw), expected); }
    }
    #[test]
    fn positions_preserve_specialist_and_deduplicate_fullback_wingback() {
        let mut r=[1u8;15]; r[0]=20; assert_eq!(web_positions(&r),vec!["GK"]);
        r[0]=1; r[2]=20; r[13]=18; r[4]=15;
        assert_eq!(web_positions(&r),vec!["LB","RB"]);
        assert!(web_positions(&[1u8;15]).is_empty());
    }
    #[test]
    fn condition_rounding_is_explicit_half_up() {
        assert_eq!(display_percent(Some(9850),0),99);
        assert_eq!(display_percent(Some(9849),0),98);
        assert_eq!(display_percent(Some(0),100),0);
        assert_eq!(display_percent(None,100),100);
    }
}
